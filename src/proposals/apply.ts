import { randomUUID } from 'crypto';
import { contentOf, routeKey, routeLabel } from '../endpoints/route-rules';
import { Change, ConflictInfo, Endpoint } from '../storage/models';

/**
 * Checks whether `changes` can be applied to the `live` endpoint set right now.
 * Detects stale versions, vanished endpoints and route collisions in the resulting set.
 */
export function checkApplicable(live: Endpoint[], changes: Change[]): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const byId = new Map(live.map((e) => [e.id, e]));
  const replaced = new Set<string>();

  changes.forEach((c, i) => {
    if (c.type === 'add') {
      // Restoring a deleted endpoint re-uses its id.
      if (c.endpointId && byId.has(c.endpointId)) {
        conflicts.push({ changeIndex: i, reason: `endpoint ${c.endpointId} already exists` });
      }
      return;
    }
    const label = c.before ? routeLabel(c.before) : c.endpointId;
    const cur = c.endpointId ? byId.get(c.endpointId) : undefined;
    if (!cur) {
      conflicts.push({ changeIndex: i, reason: `${label} no longer exists` });
    } else if (cur.version !== c.baseVersion) {
      conflicts.push({
        changeIndex: i,
        reason: `${label} was changed by someone else (now version ${cur.version}, this change is based on version ${c.baseVersion})`,
      });
    }
    if (c.endpointId) replaced.add(c.endpointId);
  });

  const taken = new Map<string, string>();
  for (const e of live) {
    if (!replaced.has(e.id)) taken.set(routeKey(e.method, e.path), `existing endpoint ${routeLabel(e)}`);
  }
  changes.forEach((c, i) => {
    if (!c.after) return;
    const key = routeKey(c.after.method, c.after.path);
    const clash = taken.get(key);
    if (clash) {
      conflicts.push({ changeIndex: i, reason: `${routeLabel(c.after)} collides with ${clash}` });
    } else {
      taken.set(key, `change #${i + 1} of this proposal`);
    }
  });
  return conflicts;
}

/** Applies changes (already checked) and returns the new endpoint set plus the frozen changes. */
export function applyChanges(
  live: Endpoint[],
  changes: Change[],
  owner: string,
  now: string,
): { endpoints: Endpoint[]; changes: Change[] } {
  const byId = new Map(live.map((e) => [e.id, e]));
  const frozen: Change[] = [];

  for (const c of changes) {
    if (c.type === 'add') {
      // A restored endpoint keeps its id and continues its version numbers.
      const version = (c.baseVersion ?? 0) + 1;
      const e: Endpoint = { ...contentOf(c.after!), id: c.endpointId ?? randomUUID(), owner, version, createdAt: now, updatedAt: now };
      byId.set(e.id, e);
      frozen.push({ ...c, endpointId: e.id, resultVersion: version });
    } else if (c.type === 'update') {
      const cur = byId.get(c.endpointId!)!;
      const e: Endpoint = {
        ...contentOf(c.after!),
        id: cur.id,
        owner,
        version: cur.version + 1,
        createdAt: cur.createdAt,
        updatedAt: now,
      };
      byId.set(e.id, e);
      frozen.push({ ...c, resultVersion: e.version });
    } else {
      byId.delete(c.endpointId!);
      frozen.push({ ...c });
    }
  }
  return { endpoints: [...byId.values()], changes: frozen };
}
