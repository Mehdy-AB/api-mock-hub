export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON.stringify with sorted object keys, so equal values give equal strings. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    }
    return out;
  }
  return v;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export interface FieldDiff {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

/** Field-level diff between two JSON values. Arrays of different length are reported as one change. */
export function diffValues(before: unknown, after: unknown, base = ''): FieldDiff[] {
  if (deepEqual(before, after)) return [];
  const label = base || '(root)';
  if (before === undefined) return [{ path: label, kind: 'added', after }];
  if (after === undefined) return [{ path: label, kind: 'removed', before }];

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffValues(before[k], after[k], base ? `${base}.${k}` : k));
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((item, i) => diffValues(item, after[i], `${base}[${i}]`));
  }
  return [{ path: label, kind: 'changed', before, after }];
}
