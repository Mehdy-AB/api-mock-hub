import { isPlainObject } from '../common/json-utils';
import { clean } from '../common/util';
import { MOCK_CASE_HEADER, MOCK_CASE_QUERY } from '../constants';
import { activeCase, PathIndex, pathParamNames, toOpenApiPath } from '../endpoints/route-rules';
import { Endpoint, ParamDoc, Project, ResponseCase } from '../storage/models';

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

/** One OpenAPI response per status code; cases sharing a status become named examples. */
function responsesByStatus(cases: ResponseCase[], live: ResponseCase): Json {
  const byStatus = new Map<number, ResponseCase[]>();
  for (const c of cases) byStatus.set(c.status, [...(byStatus.get(c.status) ?? []), c]);

  const out: Json = {};
  for (const [status, list] of byStatus) {
    const headerEntries = Object.entries(list[0].headers ?? {});
    const contentType =
      headerEntries.find(([k]) => k.toLowerCase() === 'content-type')?.[1].split(';')[0].trim() || 'application/json';
    const withBody = list.filter((c) => c.body !== undefined && c.body !== null);
    const label = (c: ResponseCase) =>
      [c.name, c.id === live.id ? '(returned now)' : '', c.description].filter(Boolean).join(' ');
    out[String(status)] = clean({
      description: list.map(label).join(' · ') || 'Mock response',
      headers: headerEntries.length
        ? Object.fromEntries(headerEntries.map(([k, v]) => [k, { schema: { type: 'string', example: v } }]))
        : undefined,
      content: withBody.length
        ? {
            [contentType]: clean({
              schema: inferSchema(withBody[0].body),
              example: withBody.length === 1 ? withBody[0].body : undefined,
              examples:
                withBody.length > 1
                  ? Object.fromEntries(
                      withBody.map((c) => [c.id, clean({ summary: label(c), description: c.description, value: c.body })]),
                    )
                  : undefined,
            }),
          }
        : undefined,
    });
  }
  return out;
}

/** OpenAPI 3 document describing the live mock endpoints, at the URLs they answer on. */
export function generateOpenApi(
  endpoints: Endpoint[],
  meta: { commitId: number; index?: PathIndex; project?: Project },
): Json {
  const index = meta.index ?? new PathIndex();
  const paths: Record<string, Json> = {};
  const tags = new Set<string>();
  const sorted = [...endpoints]
    .map((e) => ({ e, full: index.full(e) }))
    .sort((a, b) => a.full.localeCompare(b.full) || a.e.method.localeCompare(b.e.method));

  for (const { e, full } of sorted) {
    const req = e.request ?? {};
    const parameters = [
      ...pathParamNames(full).map((n) => parameter(req.params?.find((p) => p.name === n), n, 'path', true)),
      ...(req.query ?? []).map((q) => parameter(q, q.name, 'query', !!q.required)),
      ...(req.headers ?? []).map((h) => parameter(h, h.name, 'header', !!h.required)),
    ];
    const opTags = e.tags.length ? e.tags : ['untagged'];
    opTags.forEach((t) => tags.add(t));

    const live = activeCase(e);
    const scope = index.scopeName(e);
    const meta_ = [`Mock v${e.version} by \`${e.owner}\`, updated ${e.updatedAt}`];
    if (scope) meta_.unshift(`**${scope}**`);
    if (live.delayMs) meta_.push(`simulated delay ${live.delayMs} ms`);
    if (e.responses.length > 1) {
      meta_.push(
        `returns **${live.name}** right now; ` +
          `cases: ${e.responses.map((c) => `\`${c.id}\` ${c.status}`).join(', ')} ` +
          `(send \`${MOCK_CASE_HEADER}: <id>\` or \`?${MOCK_CASE_QUERY}=<id>\` for one call)`,
      );
    }

    const operation = clean({
      tags: opTags,
      summary: e.summary ?? `${e.method} ${full}`,
      description: [e.description, meta_.join(', ')].filter(Boolean).join('\n\n'),
      operationId: `${e.method.toLowerCase()}_${e.id.replace(/-/g, '').slice(0, 12)}`,
      parameters: parameters.length ? parameters : undefined,
      requestBody:
        req.bodyExample !== undefined && e.method !== 'GET' && e.method !== 'HEAD'
          ? { content: { 'application/json': { schema: inferSchema(req.bodyExample), example: req.bodyExample } } }
          : undefined,
      responses: responsesByStatus(e.responses, live),
      'x-mock-hub': {
        id: e.id,
        version: e.version,
        owner: e.owner,
        updatedAt: e.updatedAt,
        project: index.project(e)?.key,
        layer: index.layer(e)?.key,
        activeCase: live.id,
        cases: e.responses.map((c) => ({ id: c.id, name: c.name, status: c.status })),
      },
    });
    const key = toOpenApiPath(full);
    (paths[key] ??= {})[e.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: meta.project ? `API Mock Hub: ${meta.project.name}` : 'API Mock Hub: mock endpoints',
      version: `commit-${meta.commitId}`,
      description: [
        'Live mock endpoints. Every call on this page hits the mock server and returns the approved static response.',
        meta.project?.description,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    servers: [{ url: '/', description: 'This mock server' }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
  };
}
