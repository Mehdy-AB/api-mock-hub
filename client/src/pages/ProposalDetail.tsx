import { useState } from 'react';
import { api, ApiError } from '../api';
import { useUser } from '../auth';
import { KindBadge, StatusBadge } from '../components/Badges';
import { ChangeView } from '../components/ChangeView';
import { ErrorBox, Loading } from '../components/Common';
import { hubStore } from '../data';
import { draftStore } from '../draft';
import { useAsync } from '../hooks';
import { href, navigate } from '../router';
import { useToast } from '../toast';
import type { Comment, Proposal, Review, Settings } from '../types';
import { contentOf, errorText, formatDate, timeAgo, uid } from '../util';

type Event = { at: string; review?: Review; comment?: Comment };

export function ProposalDetailPage({ id }: { id: number }) {
  const user = useUser();
  const toast = useToast();
  const { data, error, reload, setData } = useAsync(() => Promise.all([api.proposal(id), api.settings()]), [id]);
  const [reviewText, setReviewText] = useState('');
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const [p, settings] = data as [Proposal, Settings];

  const run = async (action: () => Promise<Proposal>, message: (next: Proposal) => string, after?: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      setData([next, settings]);
      hubStore.refresh();
      toast(message(next));
      after?.();
    } catch (e) {
      setActionError(e);
      if (!(e instanceof ApiError)) toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const isAuthor = p.author === user.username;
  const isAdmin = user.role === 'admin';
  const editable = p.status === 'open' || p.status === 'conflict';
  const requiredRole = p.approval.requiredRole;
  const roleOk = !requiredRole || user.role === requiredRole || isAdmin;
  // Admins may approve their own proposals.
  const selfBlocked = isAuthor && settings.approverMustDiffer && !isAdmin;
  const myReview = p.reviews.find((r) => r.reviewer === user.username);
  const canManage = editable && (isAuthor || isAdmin);

  const conflictsByIndex = new Map<number, string[]>();
  for (const c of p.conflicts ?? []) conflictsByIndex.set(c.changeIndex, [...(conflictsByIndex.get(c.changeIndex) ?? []), c.reason]);

  const events: Event[] = [
    ...p.reviews.map((review) => ({ at: review.at, review })),
    ...p.comments.map((comment) => ({ at: comment.at, comment })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const review = (decision: 'approve' | 'request-changes') =>
    run(
      () => api.review(p.id, decision, reviewText),
      (next) =>
        next.status === 'approved'
          ? `Approved. Proposal #${next.id} is live.`
          : decision === 'approve'
            ? 'Approval recorded'
            : 'Changes requested',
      () => setReviewText(''),
    );

  const reject = () => {
    const reason = window.prompt('Why are you rejecting this proposal? (optional)');
    if (reason === null) return;
    run(() => api.reject(p.id, reason), () => 'Proposal rejected');
  };

  const close = () => {
    const reason = window.prompt('Close this proposal? Add a reason (optional)');
    if (reason === null) return;
    run(() => api.close(p.id, reason), () => 'Proposal closed');
  };

  const editInDraft = () => {
    const current = draftStore.get();
    if (current.changes.length && current.proposalId !== p.id && !window.confirm('Replace your current draft with this proposal?')) {
      return;
    }
    draftStore.replace({
      proposalId: p.id,
      title: p.title,
      message: p.message,
      kind: p.kind,
      changes: p.changes.map((c) => ({
        key: c.endpointId ? `ep:${c.endpointId}` : `new:${uid()}`,
        type: c.type,
        endpointId: c.endpointId,
        baseVersion: c.baseVersion,
        before: c.before ? contentOf(c.before) : undefined,
        endpoint: c.after,
      })),
    });
    navigate('/draft');
  };

  const approveHint = !editable
    ? null
    : p.status === 'conflict'
      ? 'Reviews are paused until the author resolves the conflict.'
      : selfBlocked
        ? 'You cannot approve your own proposal.'
        : !roleOk
          ? `Only ${requiredRole} users or admins can approve ${p.kind === 'publish' ? 'contracts' : 'requests'}.`
          : null;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <a className="small" href={href('/proposals')}>
            ← Proposals
          </a>
          <h1>
            #{p.id} {p.title}
          </h1>
          <div className="row small muted">
            <StatusBadge status={p.status} />
            <KindBadge kind={p.kind} />
            <span>
              by <strong>{p.author}</strong>
            </span>
            <span title={formatDate(p.createdAt)}>opened {timeAgo(p.createdAt)}</span>
          </div>
        </div>
      </div>

      {p.status === 'approved' && (
        <div className="banner banner-ok">
          Live since {formatDate(p.resolvedAt ?? p.updatedAt)} as{' '}
          <a href={href(`/history?commit=${p.commitId}`)}>commit #{p.commitId}</a>
          {p.resolvedBy ? `, approved by ${p.resolvedBy}` : ''}.
        </div>
      )}
      {(p.status === 'rejected' || p.status === 'closed') && (
        <div className="banner banner-error">
          {p.status === 'rejected' ? 'Rejected' : 'Closed'} by {p.resolvedBy} {p.resolvedAt ? timeAgo(p.resolvedAt) : ''}.
        </div>
      )}
      {p.status === 'conflict' && (
        <div className="banner banner-warn stack" style={{ gap: 6 }}>
          <strong>This proposal conflicts with changes that went live after it was written.</strong>
          <ul style={{ margin: 0 }}>
            {(p.conflicts ?? []).map((c, i) => (
              <li key={i}>{c.reason}</li>
            ))}
          </ul>
          {canManage ? (
            <div className="row">
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => api.rebase(p.id), () => 'Rebased on the latest endpoints')}>
                Rebase: keep my content, use latest versions
              </button>
              <button type="button" className="btn btn-sm" onClick={editInDraft}>
                Edit changes
              </button>
            </div>
          ) : (
            <span className="small">The author needs to rebase or edit it.</span>
          )}
        </div>
      )}
      {actionError != null && <ErrorBox error={actionError} />}

      <div className="grid-main">
        <div className="stack-lg">
          {p.message && (
            <div className="card">
              <p className="pre-wrap" style={{ margin: 0 }}>
                {p.message}
              </p>
            </div>
          )}

          <div className="stack">
            <h2 style={{ margin: 0 }}>Changes ({p.changes.length})</h2>
            {p.changes.map((c, i) => (
              <ChangeView key={i} change={c} conflicts={conflictsByIndex.get(i)} />
            ))}
          </div>

          <div className="stack">
            <h2 style={{ margin: 0 }}>Discussion</h2>
            <div className="timeline">
              {events.length === 0 && <p className="muted">No reviews or comments yet.</p>}
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
                    {ev.review.comment && (
                      <p className="pre-wrap" style={{ margin: '6px 0 0' }}>
                        {ev.review.comment}
                      </p>
                    )}
                  </div>
                ) : ev.comment ? (
                  <div key={i} className={`event${ev.comment.author === 'system' ? ' system' : ''}`}>
                    <div className="event-head">
                      <strong>{ev.comment.author}</strong>
                      <span className="muted small" title={formatDate(ev.comment.at)}>
                        {timeAgo(ev.comment.at)}
                      </span>
                    </div>
                    <p className="pre-wrap" style={{ margin: '6px 0 0' }}>
                      {ev.comment.text}
                    </p>
                  </div>
                ) : null,
              )}
            </div>
            <form
              className="stack"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (commentText.trim()) run(() => api.comment(p.id, commentText), () => 'Comment added', () => setCommentText(''));
              }}
            >
              <textarea
                rows={3}
                placeholder="Ask a question or suggest a field"
                aria-label="Comment"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <div>
                <button type="submit" className="btn" disabled={busy || !commentText.trim()}>
                  Comment
                </button>
              </div>
            </form>
          </div>
        </div>

        <aside className="stack">
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Approval</h2>
            <dl className="kv" style={{ margin: 0 }}>
              <dt>Needed</dt>
              <dd>
                {p.approval.required === 0 ? 'none' : p.approval.required}
                {requiredRole ? ` from ${requiredRole}` : ''}
              </dd>
              <dt>Approved by</dt>
              <dd>
                {p.approval.approvedBy.join(', ') ||
                  (p.status === 'approved' ? `${p.resolvedBy ?? p.author} (applied directly)` : '(nobody yet)')}
              </dd>
              {p.approval.changesRequestedBy.length > 0 && (
                <>
                  <dt>Changes requested</dt>
                  <dd>{p.approval.changesRequestedBy.join(', ')}</dd>
                </>
              )}
            </dl>

            {p.status === 'open' && !isAuthor && (
              <div className="stack" style={{ gap: 6 }}>
                {myReview && (
                  <p className="small muted" style={{ margin: 0 }}>
                    You {myReview.decision === 'approve' ? 'approved' : 'requested changes'} {timeAgo(myReview.at)}. A new review replaces it.
                  </p>
                )}
                <textarea
                  rows={3}
                  placeholder="Review comment (optional)"
                  aria-label="Review comment"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                />
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-ok"
                    disabled={busy || !!approveHint}
                    onClick={() => review('approve')}
                  >
                    Approve
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => review('request-changes')}>
                    Request changes
                  </button>
                </div>
              </div>
            )}
            {approveHint && <p className="small muted" style={{ margin: 0 }}>{approveHint}</p>}
            {p.status === 'open' && isAuthor && !selfBlocked && (
              <div className="row">
                <button type="button" className="btn btn-ok" disabled={busy} onClick={() => review('approve')}>
                  Approve
                </button>
              </div>
            )}
          </div>

          {editable && (canManage || (!isAuthor && roleOk)) && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Actions</h2>
              <div className="row">
                {canManage && (
                  <button type="button" className="btn" onClick={editInDraft}>
                    Edit changes
                  </button>
                )}
                {canManage && p.status === 'open' && (
                  <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.rebase(p.id), () => 'Rebased on the latest endpoints')}>
                    Rebase
                  </button>
                )}
                {!isAuthor && roleOk && (
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={reject}>
                    Reject
                  </button>
                )}
                {canManage && (
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={close}>
                    Close
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
