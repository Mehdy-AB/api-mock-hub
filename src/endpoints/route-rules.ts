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
  ResponseCase,
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

export const MAX_RESPONSE_CASES = 20;
const CASE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

const STATUS_NAMES: Record<number, string> = {
  200: 'Success',
  201: 'Created',
  202: 'Accepted',
  204: 'No content',
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  422: 'Invalid data',
  429: 'Too many requests',
  500: 'Server error',
  503: 'Unavailable',
};

export function defaultCaseName(status: number): string {
  return STATUS_NAMES[status] ?? (status < 400 ? `Status ${status}` : `Error ${status}`);
}

/** "Not found" -> "not-found", made unique against `taken`. */
export function caseIdFrom(name: string, taken: Set<string> = new Set()): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'case';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Looks a case up by id, then by name. Used by the switch and the x-mock-case header. */
export function findCase(cases: ResponseCase[], ref: string): ResponseCase | undefined {
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  return cases.find((c) => c.id === needle) ?? cases.find((c) => c.name.toLowerCase() === needle);
}

/** The case this endpoint serves right now: the selected one, or the first. */
export function activeCase(e: Endpoint): ResponseCase {
  const id = e.active?.caseId;
  return (id ? e.responses.find((c) => c.id === id) : undefined) ?? e.responses[0];
}

export function contentOf(e: EndpointContent | Endpoint): EndpointContent {
  const c: EndpointContent = { method: e.method, path: e.path, tags: e.tags, responses: e.responses };
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
  const responses = sanitizeCases(input, err);
  if (errors.length || !responses) return { errors };

  const value: EndpointContent = { method: method as HttpMethod, path, tags, responses };
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

/**
 * Response cases, from either `responses: [...]` (many cases) or `response: {...}` (one).
 * Ids are filled in from the names, so import files only need to name their cases.
 */
function sanitizeCases(input: Record<string, unknown>, err: (m: string) => void): ResponseCase[] | undefined {
  const hasList = input.responses !== undefined && input.responses !== null;
  const hasSingle = input.response !== undefined && input.response !== null;
  if (hasList && hasSingle) {
    err('use either "responses" (a list of cases) or "response" (a single one), not both');
    return undefined;
  }
  if (!hasList) {
    const single = sanitizeResponse(input.response, err, 'response');
    return single ? [namedCase(input.response as Record<string, unknown>, single, new Set(), err, 'response')] : undefined;
  }
  if (!Array.isArray(input.responses)) {
    err('responses must be an array of response cases');
    return undefined;
  }
  if (!input.responses.length) {
    err('responses needs at least one case');
    return undefined;
  }
  if (input.responses.length > MAX_RESPONSE_CASES) {
    err(`responses can hold at most ${MAX_RESPONSE_CASES} cases`);
    return undefined;
  }
  const out: ResponseCase[] = [];
  const taken = new Set<string>();
  input.responses.forEach((raw, i) => {
    const at = `responses[${i}]`;
    const base = sanitizeResponse(raw, err, at);
    if (!base) return;
    const c = namedCase(raw as Record<string, unknown>, base, taken, err, at);
    if (c) out.push(c);
  });
  return out.length === input.responses.length ? out : undefined;
}

function namedCase(
  raw: Record<string, unknown>,
  base: MockResponse,
  taken: Set<string>,
  err: (m: string) => void,
  at: string,
): ResponseCase {
  let id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
  if (id && (!CASE_ID_RE.test(id) || id.length > 40)) {
    err(`${at}.id must be up to 40 characters of lowercase letters, digits, "-" or "_"`);
    id = '';
  }
  const name = (typeof raw.name === 'string' && raw.name.trim()) || (id ? id.replace(/[-_]/g, ' ') : defaultCaseName(base.status));
  if (!id) id = caseIdFrom(name, taken);
  if (taken.has(id)) {
    err(`${at}.id "${id}" is used by another case`);
  }
  taken.add(id);
  const c: ResponseCase = { id, name, ...base };
  if (typeof raw.description === 'string' && raw.description.trim()) c.description = raw.description.trim();
  return c;
}

function sanitizeResponse(v: unknown, err: (m: string) => void, at: string): MockResponse | undefined {
  if (v === undefined || v === null) {
    err(`${at} is required, e.g. { "status": 200, "body": {} }`);
    return undefined;
  }
  if (!isPlainObject(v)) {
    err(`${at} must be an object`);
    return undefined;
  }
  const status = v.status === undefined ? 200 : v.status;
  // Keep checking the other fields after a bad status, so one run reports every problem.
  if (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599) {
    err(`${at}.status must be an integer between 100 and 599`);
  }
  const r: MockResponse = { status: status as number };
  if (v.headers !== undefined && v.headers !== null) {
    if (!isPlainObject(v.headers) || Object.values(v.headers).some((h) => typeof h !== 'string')) {
      err(`${at}.headers must be an object of string values`);
    } else if (Object.keys(v.headers).length) {
      r.headers = v.headers as Record<string, string>;
    }
  }
  if (v.delayMs !== undefined && v.delayMs !== null) {
    if (!Number.isInteger(v.delayMs) || (v.delayMs as number) < 0 || (v.delayMs as number) > 60000) {
      err(`${at}.delayMs must be an integer between 0 and 60000`);
    } else if (v.delayMs) {
      r.delayMs = v.delayMs as number;
    }
  }
  if (v.body !== undefined) r.body = v.body;
  return r;
}
