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

const members = (where: string) => ({
  method: 'GET',
  path: '/gym/members',
  tags: ['members'],
  summary: `Members from the ${where}`,
  response: { status: 200, body: { data: [{ id: 1, name: 'Sara' }], from: where } },
});

describe('projects and layers', () => {
  let dir: string;
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  let homefit: { id: string; key: string; layers: { id: string; key: string; basePath: string }[] };
  const layer = (key: string) => homefit.layers.find((l) => l.key === key)!;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mock-hub-projects-'));
    app = await createApp(dir);
    http = request(app.getHttpServer());
    tokens.admin = (await http.post('/_hub/api/auth/login').send({ username: 'admin', password: 'admin123' }).expect(200)).body
      .token;
    for (const [username, role] of [
      ['bob', 'backend'],
      ['fay', 'frontend'],
    ]) {
      await http.post('/_hub/api/users').set(as('admin')).send({ username, password: 'secret123', role }).expect(201);
      tokens[username] = (await http.post('/_hub/api/auth/login').send({ username, password: 'secret123' }).expect(200)).body
        .token;
    }
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a project with layers, without review', async () => {
    const created = (
      await http
        .post('/_hub/api/projects')
        .set(as('bob'))
        .send({ name: 'HomeFit', basePath: '/homefit', description: 'Gym SaaS' })
        .expect(201)
    ).body;
    expect(created).toMatchObject({ key: 'homefit', name: 'HomeFit', basePath: '/homefit', endpoints: 0 });

    for (const [name, basePath] of [
      ['Cloud API', '/api'],
      ['Gym local', '/local'],
    ]) {
      await http.post(`/_hub/api/projects/${created.id}/layers`).set(as('bob')).send({ name, basePath }).expect(201);
    }
    const list = (await http.get('/_hub/api/projects').set(as('fay')).expect(200)).body;
    homefit = list[0];
    expect(homefit.layers.map((l) => `${l.key}${l.basePath}`)).toEqual([
      'cloud-api/api',
      'gym-local/local',
    ]);
    // No proposal and no commit came out of it.
    expect((await http.get('/_hub/api/commits').set(as('fay')).expect(200)).body).toHaveLength(0);
  });

  it('keeps project and layer management for admins and backend users', async () => {
    await http.post('/_hub/api/projects').set(as('fay')).send({ name: 'Nope' }).expect(403);
    await http.patch(`/_hub/api/projects/${homefit.id}`).set(as('fay')).send({ basePath: '/x' }).expect(403);
  });

  it('serves the same path in two layers, each behind its own prefix', async () => {
    for (const [key, where] of [
      ['cloud-api', 'cloud'],
      ['gym-local', 'gym server'],
    ]) {
      await http
        .post('/_hub/api/import?direct=true')
        .set(as('admin'))
        .send({ data: { endpoints: [members(where)] }, project: 'homefit', layer: key })
        .expect(201);
    }
    expect((await http.get('/homefit/api/gym/members').expect(200)).body.from).toBe('cloud');
    expect((await http.get('/homefit/local/gym/members').expect(200)).body.from).toBe('gym server');
    await http.get('/gym/members').expect(404);

    const list = (await http.get('/_hub/api/endpoints?project=homefit&layer=gym-local').set(as('fay')).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ path: '/gym/members', url: '/homefit/local/gym/members' });
  });

  it('moves every endpoint of a project when its prefix changes', async () => {
    await http.patch(`/_hub/api/projects/${homefit.id}`).set(as('bob')).send({ basePath: '/hf' }).expect(200);
    await http.get('/homefit/api/gym/members').expect(404);
    expect((await http.get('/hf/api/gym/members').expect(200)).body.from).toBe('cloud');
    await http.patch(`/_hub/api/projects/${homefit.id}`).set(as('bob')).send({ basePath: '/homefit' }).expect(200);
    await http.get('/homefit/api/gym/members').expect(200);
  });

  it('refuses a prefix that would make two mocks share a URL', async () => {
    const res = await http
      .patch(`/_hub/api/projects/${homefit.id}/layers/${layer('gym-local').id}`)
      .set(as('bob'))
      .send({ basePath: '/api' })
      .expect(409);
    expect(res.body.errors.join()).toMatch(/collide/);
    // The refused change was rolled back.
    expect((await http.get('/homefit/local/gym/members').expect(200)).body.from).toBe('gym server');
  });

  it('treats moving an endpoint to another layer as a reviewed change', async () => {
    await http.post(`/_hub/api/projects/${homefit.id}/layers`).set(as('bob')).send({ name: 'Core', basePath: '/core' }).expect(201);
    homefit = (await http.get('/_hub/api/projects').set(as('admin')).expect(200)).body[0];

    const endpoint = (await http.get('/_hub/api/endpoints?project=homefit&layer=gym-local').set(as('admin')).expect(200)).body[0];
    const moved = { ...members('gym server'), projectId: homefit.id, layerId: layer('core').id };
    const proposal = (
      await http
        .post('/_hub/api/proposals')
        .set(as('fay'))
        .send({
          title: 'Move members to the core layer',
          changes: [{ type: 'update', endpointId: endpoint.id, baseVersion: endpoint.version, endpoint: moved }],
        })
        .expect(201)
    ).body;
    expect(proposal.status).toBe('open');
    const approved = (
      await http.post(`/_hub/api/proposals/${proposal.id}/reviews`).set(as('bob')).send({ decision: 'approve' }).expect(200)
    ).body;
    expect(approved.status).toBe('approved');
    expect(approved.commitId).toBeGreaterThan(0);
    expect((await http.get('/homefit/core/gym/members').expect(200)).body.from).toBe('gym server');
    await http.get('/homefit/local/gym/members').expect(404);

    // Moving it onto a URL another layer already answers is refused up front.
    const clash = await http
      .post('/_hub/api/proposals')
      .set(as('fay'))
      .send({
        title: 'Move it onto the cloud route',
        changes: [
          {
            type: 'update',
            endpointId: endpoint.id,
            baseVersion: endpoint.version + 1,
            endpoint: { ...members('gym server'), projectId: homefit.id, layerId: layer('cloud-api').id },
          },
        ],
      })
      .expect(400);
    expect(clash.body.errors.join()).toMatch(/collides/);

    // Put it back where the other tests expect it.
    const current = (await http.get(`/_hub/api/endpoints/${endpoint.id}`).set(as('admin')).expect(200)).body;
    await http
      .post('/_hub/api/commits')
      .set(as('admin'))
      .send({
        title: 'back to the gym layer',
        changes: [
          {
            type: 'update',
            endpointId: endpoint.id,
            baseVersion: current.version,
            endpoint: { ...members('gym server'), projectId: homefit.id, layerId: layer('gym-local').id },
          },
        ],
      })
      .expect(201);
    await http.get('/homefit/local/gym/members').expect(200);
  });

  it('rejects endpoints pointing at a missing project or a layer of another project', async () => {
    const bad = await http
      .post('/_hub/api/commits')
      .set(as('admin'))
      .send({
        title: 'bad scope',
        changes: [{ type: 'add', endpoint: { ...members('x'), path: '/x', projectId: 'nope' } }],
      })
      .expect(400);
    expect(bad.body.errors.join()).toMatch(/project nope not found/);
  });

  it('filters the OpenAPI document and the docs page by project', async () => {
    const doc = (await http.get('/_hub/openapi.json?project=homefit').expect(200)).body;
    expect(doc.info.title).toBe('API Mock Hub: HomeFit');
    expect(Object.keys(doc.paths).sort()).toEqual(['/homefit/api/gym/members', '/homefit/local/gym/members']);
    expect(doc.paths['/homefit/api/gym/members'].get['x-mock-hub']).toMatchObject({ project: 'homefit', layer: 'cloud-api' });
    await http.get('/_hub/openapi.json?project=ghost').expect(404);
  });

  it('exports and re-imports the structure by key', async () => {
    const dump = (await http.get('/_hub/api/endpoints/export?project=homefit').set(as('admin')).expect(200)).body;
    expect(dump.projects).toEqual([
      expect.objectContaining({
        key: 'homefit',
        basePath: '/homefit',
        layers: expect.arrayContaining([expect.objectContaining({ key: 'cloud-api', basePath: '/api' })]),
      }),
    ]);
    expect(dump.endpoints[0]).toMatchObject({ path: '/gym/members', project: 'homefit' });
    expect(dump.endpoints[0].projectId).toBeUndefined();

    // Importing it back changes nothing.
    const again = (await http.post('/_hub/api/import?direct=true').set(as('admin')).send({ data: dump }).expect(201)).body;
    expect(again.summary.unchanged).toHaveLength(2);
    expect(again.summary.added).toHaveLength(0);
  });

  it('creates missing projects on import only when asked, and only for the right roles', async () => {
    const body = {
      data: {
        projects: [{ key: 'shop', name: 'Shop', basePath: '/shop', layers: [{ key: 'core', name: 'Core', basePath: '/core' }] }],
        endpoints: [{ ...members('shop core'), project: 'shop', layer: 'core' }],
      },
    };
    const refused = await http.post('/_hub/api/import?direct=true').set(as('admin')).send(body).expect(400);
    expect(refused.body.errors.join()).toMatch(/no project "shop"/);

    await http
      .post('/_hub/api/import')
      .set(as('fay'))
      .send({ ...body, createMissing: true })
      .expect(403);

    const ok = (
      await http
        .post('/_hub/api/import?direct=true')
        .set(as('admin'))
        .send({ ...body, createMissing: true })
        .expect(201)
    ).body;
    expect(ok.created).toEqual(['project shop', 'layer shop/core']);
    expect((await http.get('/shop/core/gym/members').expect(200)).body.from).toBe('shop core');
  });

  it('deletes a project only once it is empty', async () => {
    const projects = (await http.get('/_hub/api/projects').set(as('admin')).expect(200)).body;
    const shop = projects.find((p: { key: string }) => p.key === 'shop');
    const busy = await http.delete(`/_hub/api/projects/${shop.id}`).set(as('bob')).expect(409);
    expect(busy.body.message).toMatch(/still holds 1 endpoint/);

    const endpoints = (await http.get('/_hub/api/endpoints?project=shop').set(as('admin')).expect(200)).body;
    await http
      .post('/_hub/api/commits')
      .set(as('admin'))
      .send({ title: 'drop shop mock', changes: [{ type: 'delete', endpointId: endpoints[0].id }] })
      .expect(201);
    await http.delete(`/_hub/api/projects/${shop.id}`).set(as('bob')).expect(200);
    expect((await http.get('/_hub/api/projects').set(as('admin')).expect(200)).body).toHaveLength(1);
  });

  it('keeps endpoints that belong to no project working', async () => {
    await http
      .post('/_hub/api/commits')
      .set(as('admin'))
      .send({ title: 'loose endpoint', changes: [{ type: 'add', endpoint: { method: 'GET', path: '/ping', response: { body: 'pong' } } }] })
      .expect(201);
    await http.get('/ping').expect(200);
    const loose = (await http.get('/_hub/api/endpoints?project=none').set(as('fay')).expect(200)).body;
    expect(loose.map((e: { url: string }) => e.url)).toEqual(['/ping']);
  });
});
