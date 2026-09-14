import { match } from 'path-to-regexp';
import { HUB_BASE } from '../constants';
import { isPlainObject, stableStringify } from '../common/json-utils';
import {
  Endpoint,
  EndpointContent,
  HTTP_METHODS,
  HttpMethod,
  MockResponse,
  ParamDoc,
  RequestDoc,
} from '../storage/models';

const NAME = '[A-Za-z_$][\\w$]*';
const PARAM_RE = new RegExp(`[:*](${NAME})`, 'g');

export function normalizePath(raw: string): string {
  let p = raw.trim();
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** Returns an error message, or null when the path is a valid mock route. */
export function pathError(p: string): string | null {
  if (!p.startsWith('/')) return 'path must start with "/"';
  if (p === HUB_BASE || p.startsWith(HUB_BASE + '/')) return `paths under ${HUB_BASE} are reserved for the hub`;
  if (/[?#\s]/.test(p)) return 'path must not contain spaces, "?" or "#" (document query params in request.query)';
  if (/[{}()[\]+!]/.test(p)) return 'only ":param" and "*wildcard" segments are supported';
  try {
    match(p);
  } catch (e) {
    return `invalid path pattern: ${e.message}`;
  }
  return null;
}

export function pathParamNames(p: string): string[] {
  return [...p.matchAll(PARAM_RE)].map((m) => m[1]);
}

/** "/users/:id" -> "/users/{id}" */
export function toOpenApiPath(p: string): string {
  return p.replace(PARAM_RE, '{$1}');
}

/** Two routes with the same key would shadow each other ("/users/:id" == "/Users/:userId"). */
export function routeKey(method: string, p: string): string {
  const shape = p
    .replace(new RegExp(`:${NAME}`, 'g'), ':')
    .replace(new RegExp(`\\*${NAME}`, 'g'), '*')
    .toLowerCase();
  return `${method.toUpperCase()} ${shape}`;
}

export function routeLabel(e: { method: string; path: string }): string {
  return `${e.method} ${e.path}`;
}

function segmentWeight(s: string): number {
  if (s.startsWith('*')) return 0;
  if (s.includes(':')) return 1;
  return 2;
}

/** Sort comparator: more specific routes first, so "/users/me" wins over "/users/:id". */
export function compareSpecificity(a: string, b: string): number {
  const sa = a.split('/').filter(Boolean);
  const sb = b.split('/').filter(Boolean);
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    if (i >= sa.length) return 1;
    if (i >= sb.length) return -1;
    const d = segmentWeight(sb[i]) - segmentWeight(sa[i]);
    if (d !== 0) return d;
  }
  return 0;
}

export function contentOf(e: EndpointContent | Endpoint): EndpointContent {
  const c: EndpointContent = { method: e.method, path: e.path, tags: e.tags, response: e.response };
  if (e.summary !== undefined) c.summary = e.summary;
  if (e.description !== undefined) c.description = e.description;
  if (e.request !== undefined) c.request = e.request;
  return structuredClone(c);
}

export function sameContent(a: EndpointContent, b: EndpointContent): boolean {
  return stableStringify(contentOf(a)) === stableStringify(contentOf(b));
}

/**
 * Validates and normalises raw endpoint input (API body, import file).
 * Single source of truth for endpoint validation.
 */
export function sanitizeEndpoint(input: unknown, at = 'endpoint'): { value?: EndpointContent; errors: string[] } {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`${at}: ${m}`);
  if (!isPlainObject(input)) return { errors: [`${at}: must be an object`] };

  const method = typeof input.method === 'string' ? input.method.trim().toUpperCase() : '';
  if (!HTTP_METHODS.includes(method as HttpMethod)) err(`method must be one of ${HTTP_METHODS.join(', ')}`);

  let path = '';
  if (typeof input.path !== 'string' || !input.path.trim()) {
    err('path is required');
  } else {
    path = normalizePath(input.path);
    const pe = pathError(path);
    if (pe) err(pe);
  }

  const optString = (key: string): string | undefined => {
    const v = input[key];
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string') {
      err(`${key} must be a string`);
      return undefined;
    }
    return v;
  };
  const summary = optString('summary');
  const description = optString('description');

  let tags: string[] = [];
  if (input.tags !== undefined && input.tags !== null) {
    if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string')) {
      err('tags must be an array of strings');
    } else {
      tags = [...new Set((input.tags as string[]).map((t) => t.trim()).filter(Boolean))];
    }
  }

  const request = sanitizeRequest(input.request, err);
  const response = sanitizeResponse(input.response, err);
  if (errors.length || !response) return { errors };

  const value: EndpointContent = { method: method as HttpMethod, path, tags, response };
  if (summary) value.summary = summary;
  if (description) value.description = description;
  if (request) value.request = request;
  return { value, errors };
}

function sanitizeParams(v: unknown, name: string, err: (m: string) => void): ParamDoc[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) {
    err(`request.${name} must be an array`);
    return undefined;
  }
  const out: ParamDoc[] = [];
  v.forEach((p, i) => {
    if (!isPlainObject(p) || typeof p.name !== 'string' || !p.name.trim()) {
      err(`request.${name}[${i}].name is required`);
      return;
    }
    const d: ParamDoc = { name: p.name.trim() };
    if (typeof p.description === 'string' && p.description) d.description = p.description;
    if (p.required !== undefined) d.required = Boolean(p.required);
    if (p.example !== undefined) d.example = p.example;
    out.push(d);
  });
  return out.length ? out : undefined;
}

function sanitizeRequest(v: unknown, err: (m: string) => void): RequestDoc | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isPlainObject(v)) {
    err('request must be an object');
    return undefined;
  }
  const r: RequestDoc = {};
  const params = sanitizeParams(v.params, 'params', err);
  const query = sanitizeParams(v.query, 'query', err);
  const headers = sanitizeParams(v.headers, 'headers', err);
  if (params) r.params = params;
  if (query) r.query = query;
  if (headers) r.headers = headers;
  if (v.bodyExample !== undefined) r.bodyExample = v.bodyExample;
  return Object.keys(r).length ? r : undefined;
}

function sanitizeResponse(v: unknown, err: (m: string) => void): MockResponse | undefined {
  if (v === undefined || v === null) {
    err('response is required, e.g. { "status": 200, "body": {} }');
    return undefined;
  }
  if (!isPlainObject(v)) {
    err('response must be an object');
    return undefined;
  }
  const status = v.status === undefined ? 200 : v.status;
  // Keep checking the other fields after a bad status, so one run reports every problem.
  if (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599) {
    err('response.status must be an integer between 100 and 599');
  }
  const r: MockResponse = { status: status as number };
  if (v.headers !== undefined && v.headers !== null) {
    if (!isPlainObject(v.headers) || Object.values(v.headers).some((h) => typeof h !== 'string')) {
      err('response.headers must be an object of string values');
    } else if (Object.keys(v.headers).length) {
      r.headers = v.headers as Record<string, string>;
    }
  }
  if (v.delayMs !== undefined && v.delayMs !== null) {
    if (!Number.isInteger(v.delayMs) || (v.delayMs as number) < 0 || (v.delayMs as number) > 60000) {
      err('response.delayMs must be an integer between 0 and 60000');
    } else if (v.delayMs) {
      r.delayMs = v.delayMs as number;
    }
  }
  if (v.body !== undefined) r.body = v.body;
  return r;
}
