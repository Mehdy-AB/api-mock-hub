import { parseOpenApi } from '../src/import/openapi-parser';
import { generateOpenApi } from '../src/openapi/openapi-generator';
import { sanitizeEndpoint } from '../src/endpoints/route-rules';

const doc = {
  openapi: '3.0.1',
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/users/{user-id}': {
      parameters: [{ name: 'user-id', in: 'path', required: true, schema: { type: 'integer', example: 7 } }],
      get: {
        tags: ['users'],
        summary: 'Get user',
        parameters: [{ name: 'expand', in: 'query', schema: { type: 'string', enum: ['posts'] } }],
        responses: {
          '404': { description: 'nope' },
          '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        },
      },
    },
    '/users': {
      post: {
        requestBody: { content: { 'application/json': { example: { name: 'Sara' } } } },
        responses: { '201': { $ref: '#/components/responses/Created' } },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          manager: { $ref: '#/components/schemas/User' },
          roles: { type: 'array', items: { type: 'string', enum: ['admin', 'user'] } },
        },
      },
    },
    responses: {
      Created: { description: 'created', content: { 'application/json': { examples: { a: { value: { id: 99 } } } } } },
    },
  },
};

describe('parseOpenApi', () => {
  it('converts paths, params, examples and schema samples', () => {
    const { endpoints } = parseOpenApi(doc);
    expect(endpoints).toHaveLength(2);
    const get = endpoints.find((e) => e.method === 'GET')!;
    expect(get.path).toBe('/v1/users/:user_id');
    expect(get.response).toEqual({
      status: 200,
      // User references itself through "manager"; the cycle guard stops at the first repeat.
      body: { id: 0, email: 'user@example.com', manager: null, roles: ['admin'] },
    });
    expect(get.request).toMatchObject({ params: [{ name: 'user_id', example: 7 }], query: [{ name: 'expand', example: 'posts' }] });

    const post = endpoints.find((e) => e.method === 'POST')!;
    expect(post.response).toEqual({ status: 201, body: { id: 99 } });
    expect((post.request as Record<string, unknown>).bodyExample).toEqual({ name: 'Sara' });

    for (const e of endpoints) expect(sanitizeEndpoint(e).errors).toEqual([]);
  });

  it('honours an explicit basePath', () => {
    expect(parseOpenApi(doc, { basePath: '' }).endpoints[0].path).toBe('/users/:user_id');
  });

  it('rejects non-OpenAPI data', () => {
    expect(() => parseOpenApi({ foo: 1 })).toThrow(/paths/);
  });
});

describe('generateOpenApi', () => {
  it('describes endpoints with path params and examples', () => {
    const out = generateOpenApi(
      [
        {
          id: 'abc-123',
          method: 'GET',
          path: '/users/:id',
          tags: ['users'],
          response: { status: 200, body: { id: 1 } },
          owner: 'sara',
          version: 2,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
      { commitId: 5 },
    ) as any;
    const op = out.paths['/users/{id}'].get;
    expect(op.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
    expect(op.responses['200'].content['application/json'].example).toEqual({ id: 1 });
    expect(out.info.version).toBe('commit-5');
  });
});
