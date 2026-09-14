import { useSyncExternalStore } from 'react';
import type { ChangeType, EndpointContent, ProposalKind } from './types';
import { uid } from './util';

/** A pending change in the user's local draft, before it becomes a proposal. */
export interface DraftChange {
  key: string;
  type: ChangeType;
  endpointId?: string;
  baseVersion?: number;
  /** Live content the change was written against (update/delete). */
  before?: EndpointContent;
  /** Desired content (add/update). */
  endpoint?: EndpointContent;
}

export interface Draft {
  /** Set when the draft edits an existing proposal. */
  proposalId?: number;
  title: string;
  message: string;
  kind?: ProposalKind;
  changes: DraftChange[];
}

const empty = (): Draft => ({ title: '', message: '', changes: [] });

let owner = '';
let current: Draft = empty();
const listeners = new Set<() => void>();

const storageKey = () => `mockhub.draft.${owner}`;

function load(): Draft {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch {
    /* unavailable or corrupt: start fresh */
  }
  return empty();
}

function save(next: Draft): void {
  current = next;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(next));
  } catch {
    /* keep in memory only */
  }
  listeners.forEach((l) => l());
}

export const draftStore = {
  /** Drafts are kept per user in this browser. */
  setOwner(username: string) {
    if (owner === username) return;
    owner = username;
    current = load();
    listeners.forEach((l) => l());
  },
  get: (): Draft => current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  update(fn: (d: Draft) => Draft) {
    save(fn(current));
  },
  replace(d: Draft) {
    save(d);
  },
  /** One change per endpoint: a new change for the same endpoint replaces the old one. */
  upsertChange(change: Omit<DraftChange, 'key'> & { key?: string }) {
    const key = change.key ?? (change.endpointId ? `ep:${change.endpointId}` : `new:${uid()}`);
    const next: DraftChange = { ...change, key };
    const idx = current.changes.findIndex((c) => c.key === key);
    const changes = [...current.changes];
    if (idx >= 0) changes[idx] = next;
    else changes.push(next);
    save({ ...current, changes });
  },
  remove(key: string) {
    save({ ...current, changes: current.changes.filter((c) => c.key !== key) });
  },
  clear() {
    save(empty());
  },
};

export function useDraft(): Draft {
  return useSyncExternalStore(draftStore.subscribe, draftStore.get);
}

export function draftRoute(c: DraftChange): { method: string; path: string } {
  const e = c.endpoint ?? c.before;
  return e ? { method: e.method, path: e.path } : { method: '?', path: c.endpointId ?? '?' };
}
