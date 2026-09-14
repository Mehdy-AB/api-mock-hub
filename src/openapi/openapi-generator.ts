import { isPlainObject } from '../common/json-utils';
import { clean } from '../common/util';
import { pathParamNames, routeLabel, toOpenApiPath } from '../endpoints/route-rules';
import { Endpoint, ParamDoc } from '../storage/models';

type Json = Record<string, unknown>;

/** Rough JSON schema from an example value, so Swagger shows field types. */
export function inferSchema(v: unknown): Json {
  if (v === null) return { nullable: true };
  if (Array.isArray(v)) return { type: 'array', items: v.length ? inferSchema(v[0]) : {} };
  if (isPlainObject(v)) {
    return { type: 'object', properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inferSchema(x)])) };
  }
  switch (typeof v) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: Number.isInteger(v) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    default:
      return {};
  }
}

function parameter(doc: ParamDoc | undefined, name: string, where: string, required: boolean): Json {
  return clean({
    name,
    in: where,
    required,
    description: doc?.description,
    schema: doc?.example !== undefined ? inferSchema(doc.example) : { type: 'string' },
    example: doc?.example,
  });
}

/** OpenAPI 3 document describing the live mock endpoints. */
export function generateOpenApi(endpoints: Endpoint[], meta: { commitId: number }): Json {
  const paths: Record<string, Json> = {};
  const tags = new Set<string>();
  const sorted = [...endpoints].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  for (const e of sorted) {
    const req = e.request ?? {};
    const parameters = [
      ...pathParamNames(e.path).map((n) => parameter(req.params?.find((p) => p.name === n), n, 'path', true)),
      ...(req.query ?? []).map((q) => parameter(q, q.name, 'query', !!q.required)),
      ...(req.headers ?? []).map((h) => parameter(h, h.name, 'header', !!h.required)),
    ];
    const opTags = e.tags.length ? e.tags : ['untagged'];
    opTags.forEach((t) => tags.add(t));

    const r = e.response;
    const headerEntries = Object.entries(r.headers ?? {});
    const contentType =
      headerEntries.find(([k]) => k.toLowerCase() === 'content-type')?.[1].split(';')[0].trim() || 'application/json';
    const hasBody = r.body !== undefined && r.body !== null;

    const meta_ = [`Mock v${e.version} by \`${e.owner}\`, updated ${e.updatedAt}`];
    if (r.delayMs) meta_.push(`simulated delay ${r.delayMs} ms`);

    const operation = clean({
      tags: opTags,
      summary: e.summary ?? routeLabel(e),
      description: [e.description, meta_.join(', ')].filter(Boolean).join('\n\n'),
      operationId: `${e.method.toLowerCase()}_${e.id.replace(/-/g, '').slice(0, 12)}`,
      parameters: parameters.length ? parameters : undefined,
      requestBody:
        req.bodyExample !== undefined && e.method !== 'GET' && e.method !== 'HEAD'
          ? { content: { 'application/json': { schema: inferSchema(req.bodyExample), example: req.bodyExample } } }
          : undefined,
      responses: {
        [String(r.status)]: clean({
          description: `Mock response`,
          headers: headerEntries.length
            ? Object.fromEntries(headerEntries.map(([k, v]) => [k, { schema: { type: 'string', example: v } }]))
            : undefined,
          content: hasBody ? { [contentType]: { schema: inferSchema(r.body), example: r.body } } : undefined,
        }),
      },
      'x-mock-hub': { id: e.id, version: e.version, owner: e.owner, updatedAt: e.updatedAt },
    });
    const key = toOpenApiPath(e.path);
    (paths[key] ??= {})[e.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'API Mock Hub: mock endpoints',
      version: `commit-${meta.commitId}`,
      description:
        'Live mock endpoints. Every call on this page hits the mock server and returns the approved static response.',
    },
    servers: [{ url: '/', description: 'This mock server' }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
  };
}
