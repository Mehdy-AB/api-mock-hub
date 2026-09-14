import { useState } from 'react';
import { api } from '../api';
import { ChangeView } from '../components/ChangeView';
import { ErrorBox, Loading } from '../components/Common';
import { hubStore } from '../data';
import { useAsync } from '../hooks';
import { href } from '../router';
import { useToast } from '../toast';
import { formatDate, timeAgo } from '../util';

/** What a commit changed, with a button to discard it for everyone. */
export function CommitPage({ id }: { id: number }) {
  const toast = useToast();
  const { data: c, error, reload } = useAsync(() => api.commit(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!c) return <Loading />;

  const discard = async () => {
    const reason = window.prompt(
      `Discard commit #${c.id}? Its changes are undone for everyone, as a new commit.\n\nReason (optional):`,
    );
    if (reason === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.discardCommit(c.id, reason);
      toast(`Discarded. The undo is commit #${r.discardCommitId}.`);
      await hubStore.refresh();
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <a className="small" href={href('/')}>
            ← API
          </a>
          <h1>
            <span className="muted">#{c.id}</span> {c.title}
          </h1>
          <div className="row small muted">
            {c.direct ? <span className="badge">saved directly</span> : <span className="badge badge-ok">reviewed</span>}
            {c.revertOf && (
              <a className="badge" href={href(`/commits/${c.revertOf}`)}>
                undoes #{c.revertOf}
              </a>
            )}
            <span>
              by <strong>{c.author}</strong>
              {c.approvedBy.length > 0 && `, approved by ${c.approvedBy.join(', ')}`}
            </span>
            <span title={formatDate(c.at)}>{timeAgo(c.at)}</span>
          </div>
        </div>
        {!c.revertedBy && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={discard}>
            {busy ? 'Discarding…' : 'Discard this commit'}
          </button>
        )}
      </div>

      {c.revertedBy && (
        <div className="banner banner-warn">
          Discarded by <strong>{c.revertedBy.by}</strong> {timeAgo(c.revertedBy.at)} in{' '}
          <a href={href(`/commits/${c.revertedBy.commitId}`)}>commit #{c.revertedBy.commitId}</a>. These changes are no longer live.
        </div>
      )}
      {actionError != null && <ErrorBox error={actionError} />}
      {c.message && (
        <div className="card">
          <p className="pre-wrap" style={{ margin: 0 }}>
            {c.message}
          </p>
        </div>
      )}

      <div className="stack">
        <h2 style={{ margin: 0 }}>What changed ({c.changes.length})</h2>
        {c.changes.map((ch, i) => (
          <ChangeView key={i} change={ch} />
        ))}
      </div>
      <p className="small muted">
        Discussion and reviews: <a href={href(`/proposals/${c.proposalId}`)}>proposal #{c.proposalId}</a>
      </p>
    </div>
  );
}
