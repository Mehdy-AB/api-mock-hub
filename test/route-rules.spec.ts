import {
  compareSpecificity,
  normalizePath,
  pathError,
  routeKey,
  sanitizeEndpoint,
  toOpenApiPath,
} from '../src/endpoints/route-rules';

describe('route rules', () => {
  it('normalizes paths', () => {
    expect(normalizePath('users//1/')).toBe('/users/1');
    expect(normalizePath('/')).toBe('/');
  });

  it('rejects reserved and unsupported paths', () => {
    expect(pathError('/_hub/x')).toMatch(/reserved/);
    expect(pathError('/users?id=1')).toMatch(/must not contain/);
    expect(pathError('/files{/:name}')).toMatch(/only/);
    expect(pathError('/users/:id')).toBeNull();
    expect(pathError('/files/*rest')).toBeNull();
  });

  it('treats routes differing only by param name or case as the same', () => {
    expect(routeKey('get', '/Users/:id')).toBe(routeKey('GET', '/users/:userId'));
    expect(routeKey('GET', '/users/:id')).not.toBe(routeKey('POST', '/users/:id'));
  });

  it('orders static segments before params before wildcards', () => {
    const paths = ['/files/*rest', '/users/:id', '/users/me', '/users/:id/posts', '/files/readme'];
    const sorted = [...paths].sort(compareSpecificity);
    expect(sorted.indexOf('/users/me')).toBeLessThan(sorted.indexOf('/users/:id'));
    expect(sorted.indexOf('/files/readme')).toBeLessThan(sorted.indexOf('/files/*rest'));
  });

  it('converts to OpenAPI paths', () => {
    expect(toOpenApiPath('/users/:id/files/*rest')).toBe('/users/{id}/files/{rest}');
  });

  it('validates and normalizes endpoint input', () => {
    const ok = sanitizeEndpoint({ method: 'get', path: 'users/:id/', response: { body: { id: 1 } } });
    expect(ok.errors).toEqual([]);
    expect(ok.value).toEqual({ method: 'GET', path: '/users/:id', tags: [], response: { status: 200, body: { id: 1 } } });

    const bad = sanitizeEndpoint({ method: 'FETCH', path: '/_hub', response: { status: 99, headers: { a: 1 } } });
    expect(bad.value).toBeUndefined();
    expect(bad.errors.join('\n')).toMatch(/method/);
    expect(bad.errors.join('\n')).toMatch(/reserved/);
    expect(bad.errors.join('\n')).toMatch(/status/);
  });
});
