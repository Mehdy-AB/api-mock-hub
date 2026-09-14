export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
export type HttpMethod = (typeof METHODS)[number];

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

export type ChangeType = 'add' | 'update' | 'delete';

export interface FieldDiff {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

export interface Change {
  type: ChangeType;
  endpointId?: string;
  baseVersion?: number;
  before?: Endpoint;
  after?: EndpointContent;
  resultVersion?: number;
  route: string;
  diff: FieldDiff[];
}

export type ProposalStatus = 'open' | 'conflict' | 'approved' | 'rejected' | 'closed';
export type ProposalKind = 'publish' | 'request';
export type ReviewDecision = 'approve' | 'request-changes';

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

export interface ApprovalState {
  required: number;
  requiredRole: Role | null;
  approvedBy: string[];
  changesRequestedBy: string[];
  ready: boolean;
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
  conflicts?: { changeIndex: number; reason: string }[];
  commitId?: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  approval: ApprovalState;
}

export interface ProposalSummary {
  id: number;
  title: string;
  kind: ProposalKind;
  author: string;
  status: ProposalStatus;
  changes: string[];
  endpointIds: string[];
  approval: ApprovalState;
  commitId?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommitSummary {
  id: number;
  proposalId: number;
  title: string;
  author: string;
  approvedBy: string[];
  at: string;
  changes: string[];
  endpointIds: string[];
  direct?: boolean;
  revertOf?: number;
  revertedBy?: RevertInfo;
}

export interface RevertInfo {
  commitId: number;
  by: string;
  at: string;
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
  direct?: boolean;
  revertOf?: number;
  revertedBy?: RevertInfo;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

export interface User extends AuthUser {
  disabled?: boolean;
  createdAt: string;
}

export interface Settings {
  requireApproval: boolean;
  minApprovals: number;
  approverMustDiffer: boolean;
  requiredApproverRole: Record<ProposalKind, Role | null>;
  allowDirectCommits: boolean;
}

export interface ImportResult {
  proposal: Proposal | null;
  format: string;
  summary: { added: string[]; updated: string[]; unchanged: string[] };
  warnings: string[];
}

export interface ChangePayload {
  type: ChangeType;
  endpointId?: string;
  baseVersion?: number;
  endpoint?: EndpointContent;
}

export interface ProposalPayload {
  title: string;
  message?: string;
  kind?: ProposalKind;
  changes: ChangePayload[];
}
