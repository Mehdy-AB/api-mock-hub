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

const flags = {
  method: 'GET',
  path: '/flags',
  tags: ['flags'],
  responses: [
    { name: 'Success', status: 200, body: { ok: true } },
    { name: 'Not found', status: 404, body: { error: 'nope' }, description: 'Unknown flag' },
    { id: 'slow', name: 'Slow', status: 200, body: { ok: true }, delayMs: 5 },
  ],
};

describe('response cases', () => {
  let dir: string;
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  let flagsId: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mock-hub-cases-'));
    app = await createApp(dir);
    http = request(app.getHttpServer());
    tokens.admin = (await http.post('/_hub/api/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200)).body
      .token;
    await http
      .post('/_hub/api/users')
      .set(as('admin'))
      .send({ username: 'fay', password: 'secret123', role: 'frontend' })
      .expect(201);
    tokens.fay = (await http.post('/_hub/api/auth/login').send({ username: 'fay', password: 'secret123' }).expect(200)).body.token;

    await http.post('/_hub/api/commits').set(as('admin')).send({ title: 'flags', changes: [{ type: 'add', endpoint: flags }] }).expect(201);
    const list = (await http.get('/_hub/api/endpoints').set(as('admin')).expect(200)).body;
    flagsId = list.find((e: { path: string }) => e.path === '/flags').id;
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the first case until someone switches it', async () => {
    const res = await http.get('/flags').expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['x-mock-case']).toBe('success');
  });

  it('lets any role switch the live case at once, with no proposal, commit or version bump', async () => {
    const before = (await http.get('/_hub/api/commits').set(as('fay')).expect(200)).body.length;
    const proposalsBefore = (await http.get('/_hub/api/proposals').set(as('fay')).expect(200)).body.length;

    const switched = (await http.put(`/_hub/api/endpoints/${flagsId}/active-case`).set(as('fay')).send({ case: 'Not found' }).expect(200))
      .body;
    expect(switched.active).toMatchObject({ caseId: 'not-found', by: 'fay' });
    expect(switched.version).toBe(1);

    const res = await http.get('/flags').expect(404);
    expect(res.body).toEqual({ error: 'nope' });
    expect(res.headers['x-mock-case']).toBe('not-found');

    expect((await http.get('/_hub/api/commits').set(as('fay')).expect(200)).body).toHaveLength(before);
    expect((await http.get('/_hub/api/proposals').set(as('fay')).expect(200)).body).toHaveLength(proposalsBefore);
    expect((await http.get('/_hub/api/proposals?status=open,conflict').set(as('fay')).expect(200)).body).toHaveLength(0);
  });

  it('answers one call with another case, without changing the switch', async () => {
    expect((await http.get('/flags').set({ 'x-mock-case': 'success' }).expect(200)).body).toEqual({ ok: true });
    expect((await http.get('/flags?__case=slow').expect(200)).headers['x-mock-case']).toBe('slow');
    // The switch is untouched by those calls.
    await http.get('/flags').expect(404);

    const bad = await http.get('/flags').set({ 'x-mock-case': 'nope' }).expect(400);
    expect(bad.body.error).toMatch(/Unknown response case/);
    expect(bad.body.cases.map((c: { id: string }) => c.id)).toEqual(['success', 'not-found', 'slow']);
  });

  it('rejects an unknown case on the switch itself', async () => {
    const res = await http.put(`/_hub/api/endpoints/${flagsId}/active-case`).set(as('fay')).send({ case: 'nope' }).expect(400);
    expect(res.body.message).toMatch(/success, not-found, slow/);
  });

  it('switches many endpoints at once and reports the ones without that case', async () => {
    await http
      .post('/_hub/api/commits')
      .set(as('admin'))
      .send({
        title: 'one case only',
        changes: [{ type: 'add', endpoint: { method: 'GET', path: '/single', response: { status: 200, body: {} } } }],
      })
      .expect(201);
    const list = (await http.get('/_hub/api/endpoints').set(as('admin')).expect(200)).body;
    const singleId = list.find((e: { path: string }) => e.path === '/single').id;

    const res = await http
      .post('/_hub/api/endpoints/active-case')
      .set(as('fay'))
      .send({ endpointIds: [flagsId, singleId], case: 'not-found' })
      .expect(201);
    expect(res.body.changed).toEqual(['GET /flags']);
    expect(res.body.skipped).toEqual([{ endpoint: 'GET /single', reason: 'has no case "not-found"' }]);
    await http.get('/single').expect(200);
  });

  it('keeps the live case through an edit, and falls back when that case is deleted', async () => {
    const current = (await http.get(`/_hub/api/endpoints/${flagsId}`).set(as('admin')).expect(200)).body;
    expect(current.active.caseId).toBe('not-found');

    await http
      .post('/_hub/api/commits')
      .set(as('admin'))
      .send({
        title: 'reword the error',
        changes: [
          {
            type: 'update',
            endpointId: flagsId,
            baseVersion: current.version,
            endpoint: {
              ...flags,
              responses: [flags.responses[0], { ...flags.responses[1], body: { error: 'unknown flag' } }, flags.responses[2]],
            },
          },
        ],
      })
      .expect(201);
    expect((await http.get('/flags').expect(404)).body).toEqual({ error: 'unknown flag' });

    const v2 = (await http.get(`/_hub/api/endpoints/${flagsId}`).set(as('admin')).expect(200)).body;
    await http
      .post('/_hub/api/commits')
      .set(as('admin'))
      .send({
        title: 'drop the error case',
        changes: [
          {
            type: 'update',
            endpointId: flagsId,
            baseVersion: v2.version,
            endpoint: { ...flags, responses: [flags.responses[0]] },
          },
        ],
      })
      .expect(201);
    const v3 = (await http.get(`/_hub/api/endpoints/${flagsId}`).set(as('admin')).expect(200)).body;
    expect(v3.active).toBeUndefined();
    await http.get('/flags').expect(200);

    // Put the cases back for the tests that follow.
    await http
      .post('/_hub/api/commits')
      .set(as('admin'))
      .send({
        title: 'restore the cases',
        changes: [{ type: 'update', endpointId: flagsId, baseVersion: v3.version, endpoint: flags }],
      })
      .expect(201);
  });

  it('turns a single "response" into one case, and exports cases', async () => {
    const list = (await http.get('/_hub/api/endpoints').set(as('admin')).expect(200)).body;
    const single = list.find((e: { path: string }) => e.path === '/single');
    expect(single.responses).toEqual([{ id: 'success', name: 'Success', status: 200, body: {} }]);

    const hub = (await http.get('/_hub/api/endpoints/export').set(as('admin')).expect(200)).body;
    expect(hub.endpoints.every((e: { responses: unknown[] }) => Array.isArray(e.responses))).toBe(true);
    expect(hub.endpoints.some((e: { responses: unknown[] }) => e.responses.length === 1)).toBe(true);
  });

  it('documents every case in the generated OpenAPI, naming the live one', async () => {
    await http.put(`/_hub/api/endpoints/${flagsId}/active-case`).set(as('fay')).send({ case: 'success' }).expect(200);
    const doc = (await http.get('/_hub/openapi.json').expect(200)).body;
    const op = doc.paths['/flags'].get;
    expect(Object.keys(op.responses).sort()).toEqual(['200', '404']);
    // The two 200 cases share the status, so they become named examples.
    expect(Object.keys(op.responses['200'].content['application/json'].examples)).toEqual(['success', 'slow']);
    expect(op.responses['200'].description).toMatch(/returned now/);
    expect(op.responses['404'].description).toMatch(/Not found/);
    expect(op.description).toMatch(/x-mock-case/);
    expect(op['x-mock-hub'].activeCase).toBe('success');
    expect(op['x-mock-hub'].cases.map((c: { id: string }) => c.id)).toEqual(['success', 'not-found', 'slow']);
  });

  it('keeps the selected case across a restart', async () => {
    await http.put(`/_hub/api/endpoints/${flagsId}/active-case`).set(as('fay')).send({ case: 'slow' }).expect(200);
    await app.close();
    app = await createApp(dir);
    http = request(app.getHttpServer());
    const res = await http.get('/flags').expect(200);
    expect(res.headers['x-mock-case']).toBe('slow');
  });
});
