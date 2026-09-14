import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import type { CommitSummary, Endpoint, Proposal, ProposalSummary } from './types';
import { errorText } from './util';

/**
 * One shared cache for the sidebars and pages, so navigation is instant.
 * Refreshed in the background and after every action that changes data.
 */
export interface HubData {
  endpoints: Endpoint[];
  proposals: ProposalSummary[];
  commits: CommitSummary[];
  /** Open and conflicting proposals in full, so their edits show on the API page. */
  openProposals: Proposal[];
  loaded: boolean;
  error?: string;
}

const initial: HubData = { endpoints: [], proposals: [], commits: [], openProposals: [], loaded: false };
let state: HubData = initial;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const hubStore = {
  get: (): HubData => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  refresh(): Promise<void> {
    if (inflight) return inflight;
    inflight = Promise.all([api.endpoints(), api.proposals(), api.commits({ limit: 100 }), api.openProposals()])
      .then(([endpoints, proposals, commits, openProposals]) => {
        state = { endpoints, proposals, commits, openProposals, loaded: true };
        emit();
      })
      .catch((e) => {
        state = { ...state, error: errorText(e) };
        emit();
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },
  reset() {
    state = initial;
    emit();
  },
};

export function useHubData(): HubData {
  const data = useSyncExternalStore(hubStore.subscribe, hubStore.get);
  useEffect(() => {
    if (!hubStore.get().loaded) hubStore.refresh();
  }, []);
  return data;
}

export const isOpen = (p: ProposalSummary) => p.status === 'open' || p.status === 'conflict';
