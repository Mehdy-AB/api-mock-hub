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

/** One answer an endpoint can give. Editing the list is reviewed; picking the live one is not. */
export interface ResponseCase extends MockResponse {
  id: string;
  name: string;
  description?: string;
}

export interface ActiveCase {
  caseId: string;
  by: string;
  at: string;
}

/** A product whose mocks live together. Its basePath prefixes every endpoint inside it. */
export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string;
  basePath: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  endpoints?: number;
  layers: Layer[];
}

/** A tier inside a project: cloud API, local server, core… */
export interface Layer {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description?: string;
  basePath: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  endpoints?: number;
}

export interface EndpointContent {
  method: HttpMethod;
  /** Relative to the project and layer prefixes. */
  path: string;
  projectId?: string;
  layerId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  request?: RequestDoc;
  /** At least one case; the first answers when nothing is selected. */
  responses: ResponseCase[];
}

export interface Endpoint extends EndpointContent {
  id: string;
  /** Full URL the mock answers on, prefixes included. Sent by the server. */
  url?: string;
  owner: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Which case is live. Not versioned: switching it is instant and leaves no commit. */
  active?: ActiveCase;
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
  backend?: BackendStatus;
}

export interface BackendStatus {
  done: boolean;
  by: string;
  at: string;
  note?: string;
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
  backend?: BackendStatus;
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
  /** Projects and layers the import had to create. */
  created?: string[];
}

export interface ProjectInput {
  name?: string;
  key?: string;
  description?: string;
  basePath?: string;
  order?: number;
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
