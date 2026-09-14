import type { ChangeType, ProposalKind, ProposalStatus } from '../types';

export function MethodBadge({ method }: { method: string }) {
  return <span className={`method method-${method}`}>{method}</span>;
}

export function StatusBadge({ status }: { status: ProposalStatus }) {
  return <span className={`badge status-${status}`}>{status}</span>;
}

export function KindBadge({ kind }: { kind: ProposalKind }) {
  return (
    <span className="badge" title={kind === 'publish' ? 'Backend publishes a contract' : 'Frontend requests data'}>
      {kind === 'publish' ? 'contract' : 'request'}
    </span>
  );
}

export function ChangeTypeBadge({ type }: { type: ChangeType }) {
  return <span className={`badge change-${type}`}>{type}</span>;
}
