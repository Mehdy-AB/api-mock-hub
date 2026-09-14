import { diffValues, FieldDiff } from '../common/json-utils';
import { contentOf, routeLabel } from '../endpoints/route-rules';
import { Change, Proposal, Review, Role, Settings } from '../storage/models';

export function changeRoute(c: Change): string {
  const e = c.after ?? c.before;
  return e ? routeLabel(e) : (c.endpointId ?? '?');
}

export function changeWithDiff(c: Change): Change & { route: string; diff: FieldDiff[] } {
  const diff = c.type === 'update' && c.before ? diffValues(contentOf(c.before), c.after) : [];
  return { ...c, route: changeRoute(c), diff };
}

export interface ApprovalState {
  required: number;
  requiredRole: Role | null;
  approvedBy: string[];
  changesRequestedBy: string[];
  ready: boolean;
}

export function approvalState(s: Settings, p: Proposal): ApprovalState {
  const requiredRole = s.requiredApproverRole[p.kind] ?? null;
  const eligible = (r: Review) =>
    (!s.approverMustDiffer || r.reviewer !== p.author || r.role === 'admin') &&
    (!requiredRole || r.role === requiredRole || r.role === 'admin');
  const approvedBy = p.reviews.filter((r) => r.decision === 'approve' && eligible(r)).map((r) => r.reviewer);
  const changesRequestedBy = p.reviews.filter((r) => r.decision === 'request-changes').map((r) => r.reviewer);
  const required = s.requireApproval ? s.minApprovals : 0;
  return {
    required,
    requiredRole,
    approvedBy,
    changesRequestedBy,
    ready: approvedBy.length >= required && changesRequestedBy.length === 0,
  };
}
