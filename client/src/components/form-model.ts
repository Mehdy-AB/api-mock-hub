/*
 * Pure form model for editing an endpoint. No UI imports here, so pages can use it
 * without pulling in the code editor.
 */
import type { EndpointContent, HttpMethod, MockResponse, ParamDoc, RequestDoc } from '../types';
import { exampleText, looseValue, paramNames, parseJsonText, pretty, uid } from '../util';

export interface ParamRow {
  id: string;
  name: string;
  description: string;
  required: boolean;
  example: string;
}

export interface HeaderRow {
  id: string;
  name: string;
  value: string;
}

export interface FormState {
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string;
  status: string;
  delayMs: string;
  headers: HeaderRow[];
  body: string;
  pathParams: Record<string, { description: string; example: string }>;
  query: ParamRow[];
  reqHeaders: ParamRow[];
  bodyExample: string;
}

export type ErrorKey = 'path' | 'status' | 'delayMs' | 'headers' | 'body' | 'bodyExample' | 'query' | 'reqHeaders';
export type Errors = Partial<Record<ErrorKey, string>>;

export const blankEndpoint = (method: HttpMethod = 'GET', path = '/'): EndpointContent => ({
  method,
  path,
  tags: [],
  response: { status: 200, body: {} },
});

const toRows = (list?: ParamDoc[]): ParamRow[] =>
  (list ?? []).map((p) => ({
    id: uid(),
    name: p.name,
    description: p.description ?? '',
    required: !!p.required,
    example: exampleText(p.example),
  }));

export function toForm(c: EndpointContent): FormState {
  return {
    method: c.method,
    path: c.path,
    summary: c.summary ?? '',
    description: c.description ?? '',
    tags: c.tags.join(', '),
    status: String(c.response.status),
    delayMs: c.response.delayMs ? String(c.response.delayMs) : '',
    headers: Object.entries(c.response.headers ?? {}).map(([name, value]) => ({ id: uid(), name, value })),
    body: pretty(c.response.body),
    pathParams: Object.fromEntries(
      (c.request?.params ?? []).map((p) => [p.name, { description: p.description ?? '', example: exampleText(p.example) }]),
    ),
    query: toRows(c.request?.query),
    reqHeaders: toRows(c.request?.headers),
    bodyExample: pretty(c.request?.bodyExample),
  };
}

export function normalizePath(raw: string): string {
  let p = raw.trim();
  if (!p) return p;
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** Validates the form with the same rules as the server and builds endpoint content. */
export function fromForm(f: FormState): { value?: EndpointContent; errors: Errors } {
  const errors: Errors = {};
  const path = normalizePath(f.path);
  if (!path) errors.path = 'Path is required';
  else if (path === '/_hub' || path.startsWith('/_hub/')) errors.path = '/_hub is reserved for the hub itself';
  else if (/[?#\s]/.test(path)) errors.path = 'No spaces, "?" or "#". Add query params under More.';
  else if (/[{}()[\]+!]/.test(path)) errors.path = 'Use only :param and *wildcard segments';

  const status = Number(f.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) errors.status = 'Use a status from 100 to 599';

  let delayMs: number | undefined;
  if (f.delayMs.trim()) {
    const d = Number(f.delayMs);
    if (!Number.isInteger(d) || d < 0 || d > 60000) errors.delayMs = 'Use 0 to 60000 ms';
    else if (d > 0) delayMs = d;
  }

  const headers: Record<string, string> = {};
  for (const h of f.headers) {
    if (!h.name.trim() && !h.value.trim()) continue;
    if (!h.name.trim()) errors.headers = 'Every header needs a name';
    else headers[h.name.trim()] = h.value;
  }

  const body = parseJsonText(f.body);
  if (!body.ok) errors.body = `Invalid JSON: ${body.error}`;
  const hasReqBody = f.method !== 'GET' && f.method !== 'HEAD';
  const bodyExample = hasReqBody ? parseJsonText(f.bodyExample) : ({ ok: true, value: undefined } as const);
  if (!bodyExample.ok) errors.bodyExample = `Invalid JSON: ${bodyExample.error}`;

  const rows = (list: ParamRow[], key: 'query' | 'reqHeaders'): ParamDoc[] => {
    const out: ParamDoc[] = [];
    for (const r of list) {
      if (!r.name.trim()) {
        if (r.description.trim() || r.example.trim()) errors[key] = 'Every row needs a name';
        continue;
      }
      const p: ParamDoc = { name: r.name.trim() };
      if (r.description.trim()) p.description = r.description.trim();
      if (r.required) p.required = true;
      const ex = looseValue(r.example);
      if (ex !== undefined) p.example = ex;
      out.push(p);
    }
    return out;
  };
  const query = rows(f.query, 'query');
  const reqHeaders = rows(f.reqHeaders, 'reqHeaders');
  const params = paramNames(path).flatMap((name): ParamDoc[] => {
    const d = f.pathParams[name];
    if (!d || (!d.description.trim() && !d.example.trim())) return [];
    const p: ParamDoc = { name };
    if (d.description.trim()) p.description = d.description.trim();
    const ex = looseValue(d.example);
    if (ex !== undefined) p.example = ex;
    return [p];
  });

  if (Object.keys(errors).length) return { errors };

  const request: RequestDoc = {};
  if (params.length) request.params = params;
  if (query.length) request.query = query;
  if (reqHeaders.length) request.headers = reqHeaders;
  if (bodyExample.ok && bodyExample.value !== undefined) request.bodyExample = bodyExample.value;

  const response: MockResponse = { status };
  if (Object.keys(headers).length) response.headers = headers;
  if (body.ok && body.value !== undefined) response.body = body.value;
  if (delayMs) response.delayMs = delayMs;

  const value: EndpointContent = {
    method: f.method,
    path,
    tags: [...new Set(f.tags.split(',').map((t) => t.trim()).filter(Boolean))],
    response,
  };
  if (f.summary.trim()) value.summary = f.summary.trim();
  if (f.description.trim()) value.description = f.description.trim();
  if (Object.keys(request).length) value.request = request;
  return { value, errors };
}
