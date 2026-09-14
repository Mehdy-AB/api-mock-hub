import type { EndpointContent } from './types';

export function pretty(v: unknown): string {
  return v === undefined ? '' : JSON.stringify(v, null, 2);
}

export type JsonParse = { ok: true; value: unknown } | { ok: false; error: string };

/** Empty text means "no value". */
export function parseJsonText(text: string): JsonParse {
  if (!text.trim()) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** For example fields: JSON when it parses (42, true, {"a":1}), plain string otherwise. */
export function looseValue(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export function exampleText(v: unknown): string {
  if (v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

export function contentOf(e: EndpointContent): EndpointContent {
  const c: EndpointContent = { method: e.method, path: e.path, tags: e.tags ?? [], response: e.response };
  if (e.summary !== undefined) c.summary = e.summary;
  if (e.description !== undefined) c.description = e.description;
  if (e.request !== undefined) c.request = e.request;
  return JSON.parse(JSON.stringify(c));
}

const NAME = /[:*]([A-Za-z_$][\w$]*)/g;

export function paramNames(path: string): string[] {
  return [...path.matchAll(NAME)].map((m) => m[1]);
}

/** Same rule as the server: routes differing only by param name or case collide. */
export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(/:[A-Za-z_$][\w$]*/g, ':').replace(/\*[A-Za-z_$][\w$]*/g, '*').toLowerCase()}`;
}

export const routeOf = (e: { method: string; path: string }) => `${e.method} ${e.path}`;

export function splitRoute(route: string): { method: string; path: string } {
  const i = route.indexOf(' ');
  return i < 0 ? { method: '', path: route } : { method: route.slice(0, i), path: route.slice(i + 1) };
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)} h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** crypto.randomUUID needs a secure context; the hub often runs on plain http://ip:port. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
