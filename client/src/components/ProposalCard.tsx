import { useState } from 'react';
import { api } from '../api';
import { useUser } from '../auth';
import { hubStore } from '../data';
import { canApprove, needsMyReview } from '../pages/Proposals';
import type { Comment, Proposal, ProposalSummary, Review, Settings } from '../types';
import { formatDate, plural, timeAgo } from '../util';
import { useToast } from '../toast';
import { KindBadge, StatusBadge } from './Badges';
import { ChangeView } from './ChangeView';
import { ErrorBox, Loading } from './Common';

type Event = { at: string; review?: Review; comment?: Comment };

function Discussion({ proposal: p }: { proposal: Proposal }) {
  const events: Event[] = [
    ...p.reviews.map((review) => ({ at: review.at, review })),
    ...p.comments.map((comment) => ({ at: comment.at, comment })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (!events.length) return <p className="muted small" style={{ margin: 0 }}>No comments yet.</p>;
  return (
    <div className="timeline">
      {events.map((ev, i) =>
        ev.review ? (
          <div key={i} className="event">
            <div className="event-head">
              <strong>{ev.review.reviewer}</strong>
              <span className={`badge ${ev.review.decision === 'approve' ? 'badge-ok' : 'badge-warn'}`}>
                {ev.review.decision === 'approve' ? 'approved' : 'requested changes'}
              </span>
              <span className="muted small" title={formatDate(ev.review.at)}>
                {timeAgo(ev.review.at)}
              </span>
            </div>
            {ev.review.comment && <p className="pre-wrap event-text">{ev.review.comment}</p>}
          </div>
        ) : ev.comment ? (
          <div key={i} className={`event${ev.comment.author === 'system' ? ' system' : ''}`}>
            <div className="event-head">
              <strong>{ev.comment.author}</strong>
              <span className="muted small" title={formatDate(ev.comment.at)}>
                {timeAgo(ev.comment.at)}
              </span>
            </div>
            <p className="pre-wrap event-text">{ev.comment.text}</p>
          </div>
        ) : null,
      )}
    </div>
  );
}

/** A proposal with its edits, its discussion and every review action, shown on the API page. */
export function ProposalCard({
  proposal: p,
  settings,
  expanded,
  onToggle,
  onEdit,
  onChanged,
}: {
  proposal: Proposal;
  settings?: Settings;
  expanded: boolean;
  onToggle: () => void;
  /** Load this proposal's edits into the endpoint rows for editing. */
  onEdit?: (p: Proposal) => void;
  onChanged?: () => void;
}) {
  const user = useUser();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const isAuthor = p.author === user.username;
  const isAdmin = user.role === 'admin';
  const role = p.approval.requiredRole;
  const roleOk = !role || user.role === role || isAdmin;
  const editable = p.status === 'open' || p.status === 'conflict';
  const mayApprove = canApprove(p, user, settings);
  const needs = needsMyReview(p, user);

  const conflicts = new Map<number, string[]>();
  for (const c of p.conflicts ?? []) conflicts.set(c.changeIndex, [...(conflicts.get(c.changeIndex) ?? []), c.reason]);

  const run = async (action: () => Promise<Proposal>, message: (next: Proposal) => string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      toast(message(next));
      setNote('');
      await hubStore.refresh();
      onChanged?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const requestChanges = () => {
    if (!note.trim()) {
      setError(new Error('Write what should change in the box first.'));
      return;
    }
    run(() => api.review(p.id, 'request-changes', note), () => 'Changes requested');
  };

  const whyNot =
    p.status === 'conflict'
      ? 'Waiting for the author to rebase or edit.'
      : p.approval.approvedBy.includes(user.username)
        ? 'You approved this.'
        : isAuthor && !isAdmin && settings?.approverMustDiffer !== false
          ? 'A teammate needs to approve your proposal.'
          : !roleOk
            ? `Only ${role} users or admins can approve this.`
            : null;

  const outcome =
    p.status === 'approved' ? 'Approved' : p.status === 'rejected' ? 'Rejected' : p.status === 'closed' ? 'Withdrawn' : null;

  return (
    <div id={`proposal-${p.id}`} data-proposal={p.id} className={`card proposal-card${expanded ? ' open' : ''}${needs ? ' needs' : ''}`}>
      <button type="button" className="op-toggle" aria-expanded={expanded} onClick={onToggle}>
        <StatusBadge status={p.status} />
        <span className="proposal-card-title">
          <strong>
            #{p.id} {p.title}
          </strong>
          <span className="muted small">
            {' '}
            by {p.author} · {timeAgo(p.createdAt)} · {plural(p.changes.length, 'change')}
            {p.status === 'open' && ` · ${p.approval.approvedBy.length}/${p.approval.required} approvals`}
            {p.comments.length + p.reviews.length > 0 && ` · ${plural(p.comments.length + p.reviews.length, 'comment')}`}
          </span>
        </span>
        <span className="spacer" />
        {needs && <span className="badge badge-accent">your review</span>}
        <KindBadge kind={p.kind} />
        <span className="chev" aria-hidden="true">
          ▸
        </span>
      </button>

      {expanded && (
        <div className="proposal-card-body">
          {outcome && (
            <div className={`banner ${p.status === 'approved' ? 'banner-ok' : 'banner-error'}`}>
              {outcome} by {p.resolvedBy}
              {p.resolvedAt ? ` ${timeAgo(p.resolvedAt)}` : ''}
              {p.commitId ? `, live as commit #${p.commitId}` : ''}.
            </div>
          )}
          {p.message && (
            <p className="pre-wrap" style={{ margin: 0 }}>
              {p.message}
            </p>
          )}
          {p.status === 'conflict' && (
            <div className="banner banner-warn row">
              <span>Someone changed these endpoints after this proposal was written.</span>
              {(isAuthor || isAdmin) && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => run(() => api.rebase(p.id), () => 'Rebased on the latest endpoints')}
                >
                  Rebase on latest
                </button>
              )}
            </div>
          )}

          {p.changes.map((c, i) => (
            <ChangeView key={i} change={c} conflicts={conflicts.get(i)} />
          ))}

          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Discussion</span>
            <Discussion proposal={p} />
            <textarea
              rows={2}
              aria-label="Comment or review note"
              placeholder={editable ? 'Write a comment, or what should change…' : 'Add a comment…'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {error != null && <ErrorBox error={error} />}
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={busy || !note.trim()}
                onClick={() => run(() => api.comment(p.id, note), () => 'Comment added')}
              >
                Comment
              </button>
              {mayApprove && (
                <button
                  type="button"
                  className="btn btn-ok"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api.review(p.id, 'approve', note),
                      (next) => (next.status === 'approved' ? `#${p.id} approved and live` : 'Approval saved'),
                    )
                  }
                >
                  Approve
                </button>
              )}
              {p.status === 'open' && !isAuthor && (
                <button type="button" className="btn" disabled={busy} onClick={requestChanges}>
                  Request changes
                </button>
              )}
              {editable && !isAuthor && roleOk && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => window.confirm(`Reject proposal #${p.id}?`) && run(() => api.reject(p.id, note), () => `#${p.id} rejected`)}
                >
                  Reject
                </button>
              )}
              {editable && (isAuthor || isAdmin) && onEdit && (
                <button type="button" className="btn" disabled={busy} onClick={() => onEdit(p)}>
                  Edit changes
                </button>
              )}
              {editable && (isAuthor || isAdmin) && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`Withdraw proposal #${p.id}? Its edits will not go live.`) &&
                    run(() => api.close(p.id, note), () => `#${p.id} withdrawn`)
                  }
                >
                  Withdraw
                </button>
              )}
              {editable && !mayApprove && whyNot && <span className="muted small">{whyNot}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A closed proposal: only its summary is cached, so the full card loads when opened. */
export function LazyProposalCard({ summary, settings }: { summary: ProposalSummary; settings?: Settings }) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<Proposal | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = () =>
    api.proposal(summary.id).then(
      (p) => setFull(p),
      (e) => setError(e),
    );
  const toggle = () => {
    if (!expanded && !full) load();
    setExpanded(!expanded);
  };

  if (expanded && full) {
    return <ProposalCard proposal={full} settings={settings} expanded onToggle={toggle} onChanged={load} />;
  }
  return (
    <div id={`proposal-${summary.id}`} className="card proposal-card">
      <button type="button" className="op-toggle" aria-expanded={expanded} onClick={toggle}>
        <StatusBadge status={summary.status} />
        <span className="proposal-card-title">
          <strong>
            #{summary.id} {summary.title}
          </strong>
          <span className="muted small">
            {' '}
            by {summary.author} · {timeAgo(summary.updatedAt)}
          </span>
        </span>
        <span className="spacer" />
        <span className="chev" aria-hidden="true">
          ▸
        </span>
      </button>
      {expanded && <div className="proposal-card-body">{error != null ? <ErrorBox error={error} /> : <Loading />}</div>}
    </div>
  );
}
