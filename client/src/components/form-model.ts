/*
 * Pure form model for editing an endpoint. No UI imports here, so pages can use it
 * without pulling in the code editor.
 */
import type { EndpointContent, HttpMethod, ParamDoc, RequestDoc, ResponseCase } from '../types';
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

/** One response case being edited. `key` is UI identity; `id` is the stored case id ('' for a new case). */
export interface CaseForm {
  key: string;
  id: string;
  name: string;
  description: string;
  status: string;
  delayMs: string;
  headers: HeaderRow[];
  body: string;
}

export interface FormState {
  method: HttpMethod;
  path: string;
  /** '' when the endpoint belongs to no project. A layer always needs a project. */
  projectId: string;
  layerId: string;
  summary: string;
  description: string;
  tags: string;
  cases: CaseForm[];
  /** Which case tab is open. Not saved with the endpoint. */
  caseKey: string;
  pathParams: Record<string, { description: string; example: string }>;
  query: ParamRow[];
  reqHeaders: ParamRow[];
  bodyExample: string;
}

export interface CaseErrors {
  name?: string;
  status?: string;
  delayMs?: string;
  headers?: string;
  body?: string;
}

export type ErrorKey = 'path' | 'bodyExample' | 'query' | 'reqHeaders' | 'cases' | 'caseList';
export interface Errors {
  path?: string;
  bodyExample?: string;
  query?: string;
  reqHeaders?: string;
  /** Keyed by CaseForm.key. */
  cases?: Record<string, CaseErrors>;
  caseList?: string;
}

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

export const blankEndpoint = (
  method: HttpMethod = 'GET',
  path = '/',
  scope: { projectId?: string; layerId?: string } = {},
): EndpointContent => ({
  method,
  path,
  tags: [],
  ...(scope.projectId ? { projectId: scope.projectId } : {}),
  ...(scope.projectId && scope.layerId ? { layerId: scope.layerId } : {}),
  responses: [{ id: 'success', name: 'Success', status: 200, body: {} }],
});

const toCase = (c: ResponseCase): CaseForm => ({
  key: uid(),
  id: c.id,
  name: c.name ?? '',
  description: c.description ?? '',
  status: String(c.status),
  delayMs: c.delayMs ? String(c.delayMs) : '',
  headers: Object.entries(c.headers ?? {}).map(([name, value]) => ({ id: uid(), name, value })),
  body: pretty(c.body),
});

/** A fresh case for the "Add case" button: an error next to the success one, by default. */
export const blankCase = (status = 404): CaseForm => ({
  key: uid(),
  id: '',
  name: defaultCaseName(status),
  description: '',
  status: String(status),
  delayMs: '',
  headers: [],
  body: pretty({ error: defaultCaseName(status) }),
});

const toRows = (list?: ParamDoc[]): ParamRow[] =>
  (list ?? []).map((p) => ({
    id: uid(),
    name: p.name,
    description: p.description ?? '',
    required: !!p.required,
    example: exampleText(p.example),
  }));

export function toForm(c: EndpointContent, openCaseId?: string): FormState {
  const cases = (c.responses.length ? c.responses : blankEndpoint().responses).map(toCase);
  return {
    method: c.method,
    path: c.path,
    projectId: c.projectId ?? '',
    layerId: c.layerId ?? '',
    summary: c.summary ?? '',
    description: c.description ?? '',
    tags: c.tags.join(', '),
    cases,
    caseKey: (openCaseId && cases.find((x) => x.id === openCaseId)?.key) || cases[0].key,
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

function caseValue(c: CaseForm, errors: CaseErrors): ResponseCase | undefined {
  const status = Number(c.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) errors.status = 'Use a status from 100 to 599';

  let delayMs: number | undefined;
  if (c.delayMs.trim()) {
    const d = Number(c.delayMs);
    if (!Number.isInteger(d) || d < 0 || d > 60000) errors.delayMs = 'Use 0 to 60000 ms';
    else if (d > 0) delayMs = d;
  }

  const headers: Record<string, string> = {};
  for (const h of c.headers) {
    if (!h.name.trim() && !h.value.trim()) continue;
    if (!h.name.trim()) errors.headers = 'Every header needs a name';
    else headers[h.name.trim()] = h.value;
  }

  const body = parseJsonText(c.body);
  if (!body.ok) errors.body = `Invalid JSON: ${body.error}`;
  if (Object.keys(errors).length) return undefined;

  const out: ResponseCase = {
    id: c.id,
    name: c.name.trim() || defaultCaseName(status),
    status,
  };
  if (c.description.trim()) out.description = c.description.trim();
  if (Object.keys(headers).length) out.headers = headers;
  if (body.ok && body.value !== undefined) out.body = body.value;
  if (delayMs) out.delayMs = delayMs;
  return out;
}

/** Validates the form with the same rules as the server and builds endpoint content. */
export function fromForm(f: FormState): { value?: EndpointContent; errors: Errors } {
  const errors: Errors = {};
  const path = normalizePath(f.path);
  if (!path) errors.path = 'Path is required';
  else if (path === '/_hub' || path.startsWith('/_hub/')) errors.path = '/_hub is reserved for the hub itself';
  else if (/[?#\s]/.test(path)) errors.path = 'No spaces, "?" or "#". Add query params under More.';
  else if (/[{}()[\]+!]/.test(path)) errors.path = 'Use only :param and *wildcard segments';

  const caseErrors: Record<string, CaseErrors> = {};
  const responses: ResponseCase[] = [];
  const names = new Map<string, string>();
  for (const c of f.cases) {
    const own: CaseErrors = {};
    const key = (c.name.trim() || `status ${c.status}`).toLowerCase();
    if (names.has(key)) own.name = 'Another case already has this name';
    names.set(key, c.key);
    const v = caseValue(c, own);
    if (Object.keys(own).length) caseErrors[c.key] = own;
    if (v) responses.push(v);
  }
  if (!f.cases.length) errors.caseList = 'Add at least one response case';
  if (Object.keys(caseErrors).length) errors.cases = caseErrors;

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

  if (Object.keys(errors).length || !responses.length) return { errors };

  const request: RequestDoc = {};
  if (params.length) request.params = params;
  if (query.length) request.query = query;
  if (reqHeaders.length) request.headers = reqHeaders;
  if (bodyExample.ok && bodyExample.value !== undefined) request.bodyExample = bodyExample.value;

  const value: EndpointContent = {
    method: f.method,
    path,
    tags: [...new Set(f.tags.split(',').map((t) => t.trim()).filter(Boolean))],
    responses,
  };
  if (f.projectId) {
    value.projectId = f.projectId;
    if (f.layerId) value.layerId = f.layerId;
  }
  if (f.summary.trim()) value.summary = f.summary.trim();
  if (f.description.trim()) value.description = f.description.trim();
  if (Object.keys(request).length) value.request = request;
  return { value, errors };
}
