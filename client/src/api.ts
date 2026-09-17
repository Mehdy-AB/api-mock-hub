import type {
  AuthUser,
  Commit,
  CommitSummary,
  Endpoint,
  ImportResult,
  Proposal,
  ProposalKind,
  ProposalPayload,
  ProposalSummary,
  ReviewDecision,
  Role,
  Settings,
  User,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors: string[] = [],
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'mockhub.token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode: session only */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

function qs(q: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/_hub/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    const d = (data ?? {}) as { message?: unknown; errors?: unknown };
    const list = Array.isArray(d.errors) ? d.errors : Array.isArray(d.message) ? d.message : [];
    const message = typeof d.message === 'string' ? d.message : list.length ? 'Request was rejected' : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, list.map(String));
  }
  return data as T;
}

const id = (v: string | number) => encodeURIComponent(String(v));

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/login', { username, password }),
  me: () => request<AuthUser>('GET', '/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/auth/password', { currentPassword, newPassword }),

  endpoints: () => request<Endpoint[]>('GET', '/endpoints'),
  endpoint: (endpointId: string) => request<Endpoint>('GET', `/endpoints/${id(endpointId)}`),

  proposals: (q: { status?: string; endpointId?: string } = {}) =>
    request<ProposalSummary[]>('GET', `/proposals${qs(q)}`),
  proposal: (proposalId: number) => request<Proposal>('GET', `/proposals/${id(proposalId)}`),
  /** Every open or conflicting proposal, with its changes and diffs. */
  openProposals: () => request<Proposal[]>('GET', '/proposals?status=open,conflict&full=true'),
  createProposal: (body: ProposalPayload) => request<Proposal>('POST', '/proposals', body),
  updateProposal: (proposalId: number, body: Partial<ProposalPayload>) =>
    request<Proposal>('PATCH', `/proposals/${id(proposalId)}`, body),
  review: (proposalId: number, decision: ReviewDecision, comment?: string) =>
    request<Proposal>('POST', `/proposals/${id(proposalId)}/reviews`, { decision, comment: comment || undefined }),
  comment: (proposalId: number, text: string) =>
    request<Proposal>('POST', `/proposals/${id(proposalId)}/comments`, { text }),
  reject: (proposalId: number, reason?: string) =>
    request<Proposal>('POST', `/proposals/${id(proposalId)}/reject`, { reason: reason || undefined }),
  close: (proposalId: number, reason?: string) =>
    request<Proposal>('POST', `/proposals/${id(proposalId)}/close`, { reason: reason || undefined }),
  rebase: (proposalId: number) => request<Proposal>('POST', `/proposals/${id(proposalId)}/rebase`),

  commits: (q: { endpointId?: string; limit?: number; before?: number } = {}) =>
    request<CommitSummary[]>('GET', `/commits${qs(q)}`),
  commit: (commitId: number) => request<Commit>('GET', `/commits/${id(commitId)}`),
  /** Save and apply at once; returns the applied proposal (with commitId). */
  directCommit: (body: ProposalPayload) => request<Proposal>('POST', '/commits', body),
  markBackend: (commitId: number, done: boolean, note?: string) =>
    request<Commit>('POST', `/commits/${id(commitId)}/backend`, { done, note: note || undefined }),
  discardCommit: (commitId: number, reason?: string) =>
    request<{ commit: Commit; discardCommitId: number }>('POST', `/commits/${id(commitId)}/discard`, {
      reason: reason || undefined,
    }),

  settings: () => request<Settings>('GET', '/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('PATCH', '/settings', patch),

  users: () => request<User[]>('GET', '/users'),
  createUser: (username: string, password: string, role: Role) =>
    request<User>('POST', '/users', { username, password, role }),
  updateUser: (userId: string, patch: { role?: Role; password?: string; disabled?: boolean }) =>
    request<User>('PATCH', `/users/${id(userId)}`, patch),

  import: (
    body: { format: string; data: unknown; basePath?: string; title?: string; message?: string; kind?: ProposalKind },
    direct: boolean,
  ) => request<ImportResult>('POST', `/import${direct ? '?direct=true' : ''}`, body),
};
