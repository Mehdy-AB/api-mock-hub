import { isPlainObject } from '../common/json-utils';
import { clean } from '../common/util';
import { normalizePath } from '../endpoints/route-rules';

type Json = Record<string, unknown>;

export interface ParseResult {
  /** Raw endpoint objects; validated later by sanitizeEndpoint. */
  endpoints: Json[];
  warnings: string[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head'] as const;

class RefResolver {
  constructor(private readonly doc: Json) {}

  resolve(ref: string): unknown {
    if (!ref.startsWith('#/')) return undefined; // external refs are not supported
    let cur: unknown = this.doc;
    for (const raw of ref.slice(2).split('/')) {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isPlainObject(cur) && !Array.isArray(cur)) return undefined;
      cur = (cur as Json)[key];
    }
    return cur;
  }

  deref(v: unknown): unknown {
    for (let i = 0; i < 10 && isPlainObject(v) && typeof v.$ref === 'string'; i++) v = this.resolve(v.$ref);
    return v;
  }
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function safeName(n: string): string {
  const s = n.replace(/[^\w$]/g, '_');
  return /^[A-Za-z_$]/.test(s) ? s : `_${s}`;
}

function detectBasePath(doc: Json): string {
  if (typeof doc.basePath === 'string') return doc.basePath;
  const server = asArray(doc.servers)[0];
  if (!isPlainObject(server) || typeof server.url !== 'string') return '';
  const url = server.url;
  if (url.startsWith('/')) return url;
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export function sampleFromSchema(schema: unknown, r: RefResolver, depth = 0, stack = new Set<string>()): unknown {
  if (depth > 8 || !isPlainObject(schema)) return null;
  if (typeof schema.$ref === 'string') {
    if (stack.has(schema.$ref)) return null;
    return sampleFromSchema(r.resolve(schema.$ref), r, depth + 1, new Set(stack).add(schema.$ref));
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    const parts = schema.allOf.map((s) => sampleFromSchema(s, r, depth + 1, stack));
    return parts.every(isPlainObject) ? Object.assign({}, ...parts) : parts[0];
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length) return sampleFromSchema(options[0], r, depth + 1, stack);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (type === 'object' || (!type && (schema.properties || schema.additionalProperties))) {
    const out: Json = {};
    const props = isPlainObject(schema.properties) ? schema.properties : {};
    for (const [k, s] of Object.entries(props)) out[k] = sampleFromSchema(s, r, depth + 1, stack);
    if (!Object.keys(props).length && isPlainObject(schema.additionalProperties)) {
      out.key = sampleFromSchema(schema.additionalProperties, r, depth + 1, stack);
    }
    return out;
  }
  if (type === 'array') return schema.items ? [sampleFromSchema(schema.items, r, depth + 1, stack)] : [];
  if (type === 'string') {
    switch (schema.format) {
      case 'date-time':
        return '2024-01-01T12:00:00Z';
      case 'date':
        return '2024-01-01';
      case 'email':
        return 'user@example.com';
      case 'uuid':
        return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      case 'uri':
      case 'url':
        return 'https://example.com';
      default:
        return 'string';
    }
  }
  if (type === 'integer' || type === 'number') return typeof schema.minimum === 'number' ? schema.minimum : 0;
  if (type === 'boolean') return true;
  return null;
}

function mediaExample(media: unknown, r: RefResolver): unknown {
  if (!isPlainObject(media)) return undefined;
  if (media.example !== undefined) return media.example;
  if (isPlainObject(media.examples)) {
    const first = r.deref(Object.values(media.examples)[0]);
    if (isPlainObject(first) && first.value !== undefined) return first.value;
  }
  return media.schema ? sampleFromSchema(media.schema, r) : undefined;
}

function pickMedia(content: Json): [string | undefined, unknown] {
  const entries = Object.entries(content);
  return entries.find(([t]) => t.includes('json')) ?? entries[0] ?? [undefined, undefined];
}

function paramExample(p: Json, r: RefResolver): unknown {
  if (p.example !== undefined) return p.example;
  if (p['x-example'] !== undefined) return p['x-example'];
  if (isPlainObject(p.examples)) {
    const first = r.deref(Object.values(p.examples)[0]);
    if (isPlainObject(first) && first.value !== undefined) return first.value;
  }
  const schema = r.deref(p.schema);
  if (isPlainObject(schema)) {
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  }
  return undefined;
}

function pickResponse(op: Json, r: RefResolver, warnings: string[], label: string): Json {
  const responses = isPlainObject(op.responses) ? op.responses : {};
  const codes = Object.keys(responses);
  const code =
    codes.filter((c) => /^2\d\d$/.test(c)).sort()[0] ??
    codes.find((c) => /^2xx$/i.test(c)) ??
    codes.filter((c) => /^\d{3}$/.test(c)).sort()[0] ??
    (codes.includes('default') ? 'default' : undefined);
  if (!code) {
    warnings.push(`${label}: no responses defined, using 200 with an empty object`);
    return { status: 200, body: {} };
  }
  const status = /^\d{3}$/.test(code) ? Number(code) : 200;
  const res = r.deref(responses[code]);
  let body: unknown;
  let headers: Record<string, string> | undefined;
  if (isPlainObject(res)) {
    if (isPlainObject(res.content)) {
      const [type, media] = pickMedia(res.content);
      body = mediaExample(media, r);
      if (type && !type.includes('json')) headers = { 'Content-Type': type };
    } else if (isPlainObject(res.examples) && res.examples['application/json'] !== undefined) {
      body = res.examples['application/json']; // Swagger 2
    } else if (res.schema) {
      body = sampleFromSchema(res.schema, r); // Swagger 2
    }
  }
  return clean({ status, headers, body });
}

function requestBodyExample(op: Json, params: Json[], r: RefResolver): unknown {
  const rb = r.deref(op.requestBody);
  if (isPlainObject(rb) && isPlainObject(rb.content)) return mediaExample(pickMedia(rb.content)[1], r);
  const bodyParam = params.find((p) => p.in === 'body'); // Swagger 2
  if (bodyParam) return bodyParam['x-example'] ?? sampleFromSchema(bodyParam.schema, r);
  return undefined;
}

/**
 * Converts an OpenAPI 3 or Swagger 2 document into raw endpoint objects.
 * The first 2xx response becomes the mock; its example (or a schema-derived sample) is the static body.
 */
export function parseOpenApi(doc: unknown, opts: { basePath?: string } = {}): ParseResult {
  if (!isPlainObject(doc) || !isPlainObject(doc.paths)) {
    throw new Error('Not an OpenAPI/Swagger document: the "paths" object is missing');
  }
  const r = new RefResolver(doc);
  const warnings: string[] = [];
  const rawBase = (opts.basePath ?? detectBasePath(doc)).trim();
  const base = rawBase && rawBase !== '/' ? normalizePath(rawBase) : '';
  const endpoints: Json[] = [];

  for (const [rawPath, rawItem] of Object.entries(doc.paths)) {
    const item = r.deref(rawItem);
    if (!isPlainObject(item)) continue;
    if (item.options || item.trace) warnings.push(`${rawPath}: OPTIONS and TRACE operations are skipped`);

    for (const m of METHODS) {
      const op = item[m];
      if (!isPlainObject(op)) continue;
      const label = `${m.toUpperCase()} ${rawPath}`;
      const path = normalizePath(base + rawPath.replace(/\{([^}]+)\}/g, (_, n: string) => ':' + safeName(n)));

      const merged = new Map<string, Json>();
      for (const raw of [...asArray(item.parameters), ...asArray(op.parameters)]) {
        const p = r.deref(raw);
        if (isPlainObject(p) && typeof p.name === 'string') merged.set(`${p.in}:${p.name}`, p);
      }
      const params = [...merged.values()];
      const group = (where: string) =>
        params
          .filter((p) => p.in === where)
          .map((p) =>
            clean({
              name: where === 'path' ? safeName(p.name as string) : p.name,
              description: typeof p.description === 'string' ? p.description : undefined,
              required: p.required === true ? true : undefined,
              example: paramExample(p, r),
            }),
          );

      const request: Json = {};
      const pathParams = group('path');
      const query = group('query');
      const headers = group('header');
      if (pathParams.length) request.params = pathParams;
      if (query.length) request.query = query;
      if (headers.length) request.headers = headers;
      const bodyExample = requestBodyExample(op, params, r);
      if (bodyExample !== undefined) request.bodyExample = bodyExample;

      endpoints.push(
        clean({
          method: m.toUpperCase(),
          path,
          summary: typeof op.summary === 'string' ? op.summary : undefined,
          description: typeof op.description === 'string' ? op.description : undefined,
          tags: Array.isArray(op.tags) ? op.tags.filter((t) => typeof t === 'string') : undefined,
          request: Object.keys(request).length ? request : undefined,
          response: pickResponse(op, r, warnings, label),
        }),
      );
    }
  }
  return { endpoints, warnings };
}
