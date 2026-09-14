import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';

async function createApp(dataDir: string): Promise<NestExpressApplication> {
  process.env.DATA_DIR = dataDir;
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.JWT_SECRET = 'test-secret';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  return app;
}

const userEndpoint = (body: unknown, p = '/users/:id') => ({
  method: 'GET',
  path: p,
  tags: ['users'],
  response: { status: 200, body },
});

describe('API Mock Hub end to end', () => {
  let dir: string;
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mock-hub-'));
    app = await createApp(dir);
    http = request(app.getHttpServer());

    tokens.admin = (await http.post('/_hub/api/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200)).body.token;
    for (const [username, role] of [
      ['bob', 'backend'],
      ['bea', 'backend'],
      ['fay', 'frontend'],
    ]) {
      await http.post('/_hub/api/users').set(as('admin')).send({ username, password: 'secret123', role }).expect(201);
      tokens[username] = (await http.post('/_hub/api/auth/login').send({ username, password: 'secret123' }).expect(200)).body.token;
    }
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('protects the management API but leaves mocks open', async () => {
    await http.get('/_hub/api/proposals').expect(401);
    const res = await http.get('/nothing/here').expect(404);
    expect(res.body.error).toMatch(/No mock/);
    expect(res.body.create).toBe('/_hub/#/endpoints/new?method=GET&path=%2Fnothing%2Fhere');
    await http.post('/_hub/api/users').set(as('fay')).send({ username: 'x1', password: 'secret123', role: 'frontend' }).expect(403);
  });

  it('publishes endpoints only after a teammate approves', async () => {
    const created = await http
      .post('/_hub/api/proposals')
      .set(as('bob'))
      .send({
        title: 'User endpoints',
        message: 'For the profile page',
        changes: [
          { type: 'add', endpoint: userEndpoint({ id: 1, name: 'Sara' }) },
          { type: 'add', endpoint: userEndpoint({ id: 0, name: 'Me' }, '/users/me') },
        ],
      })
      .expect(201);
    const id = created.body.id;
    expect(created.body).toMatchObject({ status: 'open', kind: 'publish', author: 'bob' });

    await http.get('/users/1').expect(404);
    await http.post(`/_hub/api/proposals/${id}/reviews`).set(as('bob')).send({ decision: 'approve' }).expect(403);

    await http.post(`/_hub/api/proposals/${id}/reviews`).set(as('fay')).send({ decision: 'request-changes', comment: 'add email?' }).expect(200);
    await http.get('/users/1').expect(404);

    const approved = await http.post(`/_hub/api/proposals/${id}/reviews`).set(as('fay')).send({ decision: 'approve' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', commitId: 1 });

    const one = await http.get('/users/1').expect(200);
    expect(one.body).toEqual({ id: 1, name: 'Sara' });
    expect(one.headers['x-mock-hub']).toMatch(/@v1$/);
    expect((await http.get('/users/me').expect(200)).body.name).toBe('Me');
    await http.head('/users/1').expect(200);
    await http.options('/users/1').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET').expect(204);

    const openapi = await http.get('/_hub/openapi.json').expect(200);
    expect(openapi.body.paths['/users/{id}'].get).toBeDefined();

    const commits = await http.get('/_hub/api/commits').set(as('fay')).expect(200);
    expect(commits.body[0]).toMatchObject({ id: 1, author: 'bob', approvedBy: ['fay'] });
  });

  it('rejects route collisions when proposing', async () => {
    const res = await http
      .post('/_hub/api/proposals')
      .set(as('fay'))
      .send({ title: 'dup', changes: [{ type: 'add', endpoint: userEndpoint({}, '/users/:userId') }] })
      .expect(400);
    expect(res.body.errors[0]).toMatch(/collides/);
  });

  it('detects conflicting edits and resolves them with rebase', async () => {
    const a = await http
      .post('/_hub/api/proposals')
      .set(as('bob'))
      .send({ title: 'A', changes: [{ type: 'update', ref: 'GET /users/:id', endpoint: userEndpoint({ id: 1, name: 'A' }) }] })
      .expect(201);
    const b = await http
      .post('/_hub/api/proposals')
      .set(as('fay'))
      .send({ title: 'B', changes: [{ type: 'update', ref: 'GET /users/:id', endpoint: userEndpoint({ id: 1, name: 'B', email: 'b@x.io' }) }] })
      .expect(201);
    expect(b.body.kind).toBe('request');
    expect(b.body.changes[0].diff.map((d: { path: string }) => d.path)).toEqual(['response.body.email', 'response.body.name']);

    await http.post(`/_hub/api/proposals/${a.body.id}/reviews`).set(as('fay')).send({ decision: 'approve' }).expect(200);
    expect((await http.get('/users/1')).body.name).toBe('A');

    const bNow = await http.get(`/_hub/api/proposals/${b.body.id}`).set(as('fay')).expect(200);
    expect(bNow.body.status).toBe('conflict');
    await http.post(`/_hub/api/proposals/${b.body.id}/reviews`).set(as('bob')).send({ decision: 'approve' }).expect(409);
    await http.post(`/_hub/api/proposals/${b.body.id}/rebase`).set(as('bob')).expect(403);

    const rebased = await http.post(`/_hub/api/proposals/${b.body.id}/rebase`).set(as('fay')).expect(200);
    expect(rebased.body.status).toBe('open');
    await http.post(`/_hub/api/proposals/${b.body.id}/reviews`).set(as('bob')).send({ decision: 'approve' }).expect(200);

    const res = await http.get('/users/1').expect(200);
    expect(res.body).toEqual({ id: 1, name: 'B', email: 'b@x.io' });
    expect(res.headers['x-mock-hub']).toMatch(/@v3$/);
  });

  it('enforces the required approver role', async () => {
    await http
      .patch('/_hub/api/settings')
      .set(as('admin'))
      .send({ requiredApproverRole: { publish: 'frontend', request: 'backend' } })
      .expect(200);
    const p = await http
      .post('/_hub/api/proposals')
      .set(as('bob'))
      .send({ title: 'orders', changes: [{ type: 'add', endpoint: { method: 'GET', path: '/orders', response: { body: [] } } }] })
      .expect(201);
    await http.post(`/_hub/api/proposals/${p.body.id}/reviews`).set(as('bea')).send({ decision: 'approve' }).expect(403);
    await http.post(`/_hub/api/proposals/${p.body.id}/reject`).set(as('fay')).send({ reason: 'not needed' }).expect(200);
    await http.get('/orders').expect(404);
    await http.patch('/_hub/api/settings').set(as('admin')).send({ requiredApproverRole: { publish: null, request: null } }).expect(200);
  });

  it('imports OpenAPI documents and skips unchanged endpoints', async () => {
    const doc = {
      openapi: '3.0.0',
      paths: {
        '/products/{id}': {
          get: { responses: { '200': { content: { 'application/json': { example: { id: 5, price: 10 } } } } } },
        },
      },
    };
    await http.post('/_hub/api/import?direct=true').set(as('fay')).send({ data: doc }).expect(403);
    const first = await http.post('/_hub/api/import?direct=true').set(as('admin')).send({ data: doc }).expect(201);
    expect(first.body).toMatchObject({ format: 'openapi', summary: { added: ['GET /products/:id'] }, proposal: { status: 'approved' } });
    expect((await http.get('/products/5').expect(200)).body).toEqual({ id: 5, price: 10 });

    const again = await http.post('/_hub/api/import').set(as('bob')).send({ data: doc }).expect(201);
    expect(again.body).toMatchObject({ proposal: null, summary: { unchanged: ['GET /products/:id'] } });

    const exported = await http.get('/_hub/api/endpoints/export').set(as('bob')).expect(200);
    const reimport = await http.post('/_hub/api/import').set(as('bob')).send({ data: exported.body }).expect(201);
    expect(reimport.body.proposal).toBeNull();
  });

  it('filters proposals and commits by endpoint', async () => {
    const endpoints = (await http.get('/_hub/api/endpoints').set(as('bob')).expect(200)).body;
    const users = endpoints.find((e: { method: string; path: string }) => e.method === 'GET' && e.path === '/users/:id');
    const commits = (await http.get(`/_hub/api/commits?endpointId=${users.id}`).set(as('bob')).expect(200)).body;
    expect(commits.map((c: { id: number }) => c.id)).toEqual([3, 2, 1]);
    expect(commits.every((c: { endpointIds: string[] }) => c.endpointIds.includes(users.id))).toBe(true);
    const proposals = (await http.get(`/_hub/api/proposals?endpointId=${users.id}`).set(as('bob')).expect(200)).body;
    expect(proposals.length).toBe(3);
    expect(proposals.every((p: { endpointIds: string[] }) => p.endpointIds.includes(users.id))).toBe(true);
  });

  it('saves directly and lets teammates discard commits', async () => {
    const endpoint = (v: number) => ({ method: 'GET', path: '/direct', response: { body: { v } } });
    const created = await http
      .post('/_hub/api/commits')
      .set(as('bob'))
      .send({ title: 'direct v1', changes: [{ type: 'add', endpoint: endpoint(1) }] })
      .expect(201);
    expect(created.body.status).toBe('approved');
    expect((await http.get('/direct').expect(200)).body).toEqual({ v: 1 });
    const endpointId = created.body.changes[0].endpointId;

    const updated = await http
      .post('/_hub/api/commits')
      .set(as('bob'))
      .send({ title: 'direct v2', changes: [{ type: 'update', endpointId, endpoint: endpoint(2) }] })
      .expect(201);

    // The older commit can't be discarded while a later one changed the same endpoint.
    const blocked = await http.post(`/_hub/api/commits/${created.body.commitId}/discard`).set(as('fay')).send({}).expect(409);
    expect(blocked.body.errors[0]).toMatch(/changed after this commit/);

    const discarded = await http
      .post(`/_hub/api/commits/${updated.body.commitId}/discard`)
      .set(as('fay'))
      .send({ reason: 'not agreed' })
      .expect(200);
    expect(discarded.body.commit.revertedBy).toMatchObject({ by: 'fay' });
    expect((await http.get('/direct')).body).toEqual({ v: 1 });
    await http.post(`/_hub/api/commits/${updated.body.commitId}/discard`).set(as('fay')).send({}).expect(409);

    // Now the first commit can be discarded too, which deletes the endpoint...
    const gone = await http.post(`/_hub/api/commits/${created.body.commitId}/discard`).set(as('fay')).send({}).expect(200);
    await http.get('/direct').expect(404);
    // ...and discarding that discard restores it with the same id.
    await http.post(`/_hub/api/commits/${gone.body.discardCommitId}/discard`).set(as('bob')).send({}).expect(200);
    expect((await http.get('/direct').expect(200)).body).toEqual({ v: 1 });
    const restored = (await http.get(`/_hub/api/endpoints/${endpointId}`).set(as('bob')).expect(200)).body;
    expect(restored.version).toBeGreaterThan(1);
    const original = (await http.get(`/_hub/api/commits/${created.body.commitId}`).set(as('bob')).expect(200)).body;
    expect(original.revertedBy).toBeUndefined();

    await http.patch('/_hub/api/settings').set(as('admin')).send({ allowDirectCommits: false }).expect(200);
    await http
      .post('/_hub/api/commits')
      .set(as('bob'))
      .send({ title: 'off', changes: [{ type: 'add', endpoint: { method: 'GET', path: '/direct-off', response: {} } }] })
      .expect(403);
    await http.patch('/_hub/api/settings').set(as('admin')).send({ allowDirectCommits: true }).expect(200);
  });

  it('lists whole open proposals in one call', async () => {
    const p = await http
      .post('/_hub/api/proposals')
      .set(as('bob'))
      .send({ title: 'full list', changes: [{ type: 'add', endpoint: { method: 'GET', path: '/full-list', response: { body: {} } } }] })
      .expect(201);
    const list = (await http.get('/_hub/api/proposals?status=open,conflict&full=true').set(as('fay')).expect(200)).body;
    const found = list.find((x: { id: number }) => x.id === p.body.id);
    expect(found.changes[0]).toMatchObject({ type: 'add', route: 'GET /full-list' });
    expect(found.approval).toMatchObject({ required: 1 });
    expect(list.every((x: { status: string }) => ['open', 'conflict'].includes(x.status))).toBe(true);
    await http.post(`/_hub/api/proposals/${p.body.id}/close`).set(as('bob')).send({}).expect(200);
    await http.get('/_hub/api/proposals?status=open,bogus').set(as('fay')).expect(400);
  });

  it('lets admins approve their own proposals', async () => {
    const p = await http
      .post('/_hub/api/proposals')
      .set(as('admin'))
      .send({ title: 'admin self', changes: [{ type: 'add', endpoint: { method: 'GET', path: '/admin-self', response: { body: { ok: true } } } }] })
      .expect(201);
    const approved = await http.post(`/_hub/api/proposals/${p.body.id}/reviews`).set(as('admin')).send({ decision: 'approve' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', approval: { approvedBy: ['admin'] } });
    expect((await http.get('/admin-self').expect(200)).body).toEqual({ ok: true });
  });

  it('serves both Swagger UIs', async () => {
    await http.get('/_hub/docs').expect(301).expect('Location', '/_hub/docs/');
    expect((await http.get('/_hub/docs/').expect(200)).text).toMatch(/swagger/i);
    await http.get('/_hub/api-docs').expect(200);
    await http.get('/_hub').expect(200);
  });

  it('persists data across restarts', async () => {
    await app.close();
    app = await createApp(dir);
    http = request(app.getHttpServer());
    expect((await http.get('/users/1').expect(200)).body.name).toBe('B');
    await http.get('/_hub/api/auth/me').set(as('fay')).expect(200);
  });
});
