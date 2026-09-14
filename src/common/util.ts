export const nowIso = (): string => new Date().toISOString();

export const nextId = (items: { id: number }[]): number => items.reduce((m, i) => Math.max(m, i.id), 0) + 1;

/** Removes keys whose value is undefined (keeps output JSON and OpenAPI docs tidy). */
export function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
