export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const ROLES = ['admin', 'backend', 'frontend'] as const;
export type Role = (typeof ROLES)[number];

export interface ParamDoc {
  name: string;
  description?: string;
  required?: boolean;
  example?: unknown;
}

export interface RequestDoc {
  params?: ParamDoc[];
  query?: ParamDoc[];
  headers?: ParamDoc[];
  bodyExample?: unknown;
}

export interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  delayMs?: number;
}

/** The editable part of an endpoint. This is what proposals change and what import/export carry. */
export interface EndpointContent {
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  request?: RequestDoc;
  response: MockResponse;
}

export interface Endpoint extends EndpointContent {
  id: string;
  owner: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CHANGE_TYPES = ['add', 'update', 'delete'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export interface Change {
  type: ChangeType;
  /** Target endpoint (update/delete). Filled for "add" once applied. */
  endpointId?: string;
  /** Endpoint version this change was written against (update/delete). */
  baseVersion?: number;
  /** Snapshot of the live endpoint when the change was written (update/delete). */
  before?: Endpoint;
  /** Desired content (add/update). */
  after?: EndpointContent;
  /** Endpoint version produced by this change, once applied. */
  resultVersion?: number;
}

export const PROPOSAL_KINDS = ['publish', 'request'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ['open', 'conflict', 'approved', 'rejected', 'closed'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const REVIEW_DECISIONS = ['approve', 'request-changes'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export interface Review {
  reviewer: string;
  role: Role;
  decision: ReviewDecision;
  comment?: string;
  at: string;
}

export interface Comment {
  author: string;
  text: string;
  at: string;
}

export interface ConflictInfo {
  changeIndex: number;
  reason: string;
}

export interface Proposal {
  id: number;
  title: string;
  message: string;
  kind: ProposalKind;
  author: string;
  status: ProposalStatus;
  changes: Change[];
  reviews: Review[];
  comments: Comment[];
  conflicts?: ConflictInfo[];
  commitId?: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface Commit {
  id: number;
  proposalId: number;
  title: string;
  message: string;
  author: string;
  approvedBy: string[];
  changes: Change[];
  at: string;
  /** Saved directly, without review. */
  direct?: boolean;
  /** This commit undoes that commit. */
  revertOf?: number;
  /** Set when a later commit undid this one. */
  revertedBy?: { commitId: number; by: string; at: string };
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  disabled?: boolean;
  createdAt: string;
}

export interface Settings {
  /** When false, proposals are applied as soon as they are created. */
  requireApproval: boolean;
  /** Number of eligible approvals needed before a proposal is applied. */
  minApprovals: number;
  /** The author's own approval does not count. */
  approverMustDiffer: boolean;
  /** Role an approver must have, per proposal kind. Admins always qualify. null = anyone. */
  requiredApproverRole: Record<ProposalKind, Role | null>;
  /** Save in the UI applies changes at once; teammates can discard the commit afterwards. */
  allowDirectCommits: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  allowDirectCommits: true,
  requireApproval: true,
  minApprovals: 1,
  approverMustDiffer: true,
  requiredApproverRole: { publish: null, request: null },
};

export interface Db {
  endpoints: Endpoint[];
  proposals: Proposal[];
  commits: Commit[];
  users: User[];
  settings: Settings;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}
