import { applyChanges, checkApplicable } from '../src/proposals/apply';
import { Endpoint, EndpointContent } from '../src/storage/models';

const content = (method: string, path: string, body: unknown = {}): EndpointContent =>
  ({ method, path, tags: [], response: { status: 200, body } }) as EndpointContent;

const live = (id: string, method: string, path: string, version = 1): Endpoint => ({
  ...content(method, path),
  id,
  owner: 'x',
  version,
  createdAt: 't',
  updatedAt: 't',
});

describe('checkApplicable / applyChanges', () => {
  const users = live('u', 'GET', '/users/:id', 2);

  it('accepts a clean add and update', () => {
    const changes = [
      { type: 'add' as const, after: content('GET', '/orders') },
      { type: 'update' as const, endpointId: 'u', baseVersion: 2, before: users, after: content('GET', '/users/:id', { a: 1 }) },
    ];
    expect(checkApplicable([users], changes)).toEqual([]);
    const r = applyChanges([users], changes, 'sara', 'now');
    expect(r.endpoints).toHaveLength(2);
    expect(r.endpoints.find((e) => e.id === 'u')).toMatchObject({ version: 3, owner: 'sara', response: { body: { a: 1 } } });
    expect(r.changes[0].endpointId).toBeDefined();
  });

  it('flags stale versions', () => {
    const c = checkApplicable([users], [{ type: 'update', endpointId: 'u', baseVersion: 1, after: content('GET', '/users/:id') }]);
    expect(c[0].reason).toMatch(/changed by someone else/);
  });

  it('flags vanished endpoints', () => {
    const c = checkApplicable([], [{ type: 'delete', endpointId: 'u', baseVersion: 2, before: users }]);
    expect(c[0].reason).toMatch(/no longer exists/);
  });

  it('flags route collisions with live endpoints and within the proposal', () => {
    expect(checkApplicable([users], [{ type: 'add', after: content('GET', '/users/:userId') }])[0].reason).toMatch(/collides/);
    const dup = checkApplicable([], [
      { type: 'add', after: content('GET', '/a') },
      { type: 'add', after: content('GET', '/a') },
    ]);
    expect(dup).toHaveLength(1);
  });

  it('allows moving a route into a path freed by the same proposal', () => {
    const other = live('o', 'GET', '/old');
    const changes = [
      { type: 'delete' as const, endpointId: 'u', baseVersion: 2, before: users },
      { type: 'update' as const, endpointId: 'o', baseVersion: 1, before: other, after: content('GET', '/users/:id') },
    ];
    expect(checkApplicable([users, other], changes)).toEqual([]);
  });
});
