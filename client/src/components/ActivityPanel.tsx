import { useState } from 'react';
import { api } from '../api';
import { useUser } from '../auth';
import { hubStore, isOpen, useHubData } from '../data';
import { needsMyReview } from '../pages/Proposals';
import { href } from '../router';
import { useToast } from '../toast';
import type { BackendStatus, Commit } from '../types';
import { contentOf, errorText, formatDate, timeAgo } from '../util';
import { ChangeTypeBadge, StatusBadge } from './Badges';
import { ErrorBox, Loading } from './Common';
import { ReadableDiff } from './ReadableDiff';

type Detail = Commit | 'loading' | Error;
type BackendFilter = 'all' | 'pending' | 'done';

export function BackendBadge({ status }: { status?: BackendStatus }) {
  return status?.done ? (
    <span className="badge badge-ok" title={`Marked done by ${status.by} ${timeAgo(status.at)}`}>
      ✓ in backend
    </span>
  ) : (
    <span className="badge badge-warn" title="The real backend does not implement this yet">
      not in backend
    </span>
  );
}

/** Mark whether the real backend implements a commit (backend team and admins). */
function BackendBox({ commit, onChanged }: { commit: Commit; onChanged: () => void }) {
  const user = useUser();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const status = commit.backend;
  const canMark = user.role === 'backend' || user.role === 'admin';

  const mark = async (done: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.markBackend(commit.id, done, note);
      toast(done ? `Commit #${commit.id} marked done in the real backend` : `Commit #${commit.id} marked not done`);
      setNote('');
      await hubStore.refresh();
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backend-box">
      <div className="row" style={{ gap: 6 }}>
        <span className="label small">Real backend</span>
        <BackendBadge status={status} />
      </div>
      {status && (
        <span className="muted small">
          {status.done ? 'Marked done' : 'Marked not done'} by {status.by} {timeAgo(status.at)}
          {status.note ? `: ${status.note}` : ''}
        </span>
      )}
      {canMark && (
        <>
          <input
            type="text"
            aria-label="Backend note"
            placeholder="Note, e.g. PR link (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div>
            {status?.done ? (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => mark(false)}>
                Mark not done
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-ok" disabled={busy} onClick={() => mark(true)}>
                Mark done in backend
              </button>
            )}
          </div>
        </>
      )}
      {error != null && <ErrorBox error={error} />}
    </div>
  );
}

/** One commit opened in the side panel: what changed, backend status, and Discard. */
function CommitDetail({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (detail === 'loading') return <Loading />;
  if (detail instanceof Error) return <ErrorBox error={detail} />;
  const c = detail;

  const discard = async () => {
    if (!window.confirm(`Discard commit #${c.id}? Its changes are undone for everyone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.discardCommit(c.id, reason);
      toast(`Discarded. The undo is commit #${r.discardCommitId}.`);
      setReason('');
      await hubStore.refresh();
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="act-changes">
      <div className="row small" style={{ gap: 6 }}>
        {c.direct ? <span className="badge">saved directly</span> : <span className="badge badge-ok">reviewed</span>}
        {c.revertOf && <span className="badge">undoes #{c.revertOf}</span>}
        <span className="muted">{formatDate(c.at)}</span>
      </div>
      {c.message && (
        <p className="pre-wrap small" style={{ margin: 0 }}>
          {c.message}
        </p>
      )}
      <BackendBox commit={c} onChanged={onChanged} />
      {c.changes.map((ch, i) => (
        <div key={i} className="act-change">
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <ChangeTypeBadge type={ch.type} />
            <span className="mono small ep-path">{ch.route}</span>
          </div>
          <ReadableDiff before={ch.before ? contentOf(ch.before) : undefined} after={ch.type === 'delete' ? undefined : ch.after} />
        </div>
      ))}
      {c.revertedBy ? (
        <div className="banner banner-warn small">
          Discarded by <strong>{c.revertedBy.by}</strong> {timeAgo(c.revertedBy.at)} in commit #{c.revertedBy.commitId}.
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <input
            type="text"
            aria-label="Discard reason"
            placeholder="Why discard it? (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={discard}>
              {busy ? 'Discarding…' : 'Discard this commit'}
            </button>
          </div>
        </div>
      )}
      {error != null && <ErrorBox error={error} />}
    </div>
  );
}

/** Right-hand panel: open proposals and commit history, filtered to one endpoint when one is selected. */
export function ActivityPanel({ endpointId }: { endpointId?: string }) {
  const user = useUser();
  const hub = useHubData();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, Detail>>({});
  const [filter, setFilter] = useState<BackendFilter>('all');

  const scoped = !!endpointId && hub.endpoints.some((e) => e.id === endpointId);
  const open = hub.proposals.filter((p) => isOpen(p) && (!scoped || p.endpointIds.includes(endpointId!)));
  const scopedCommits = hub.commits.filter((c) => !scoped || (c.endpointIds ?? []).includes(endpointId!));
  const pendingCount = scopedCommits.filter((c) => !c.backend?.done).length;
  const commits = scopedCommits.filter(
    (c) => filter === 'all' || (filter === 'done' ? c.backend?.done : !c.backend?.done),
  );

  const loadCommit = async (id: number) => {
    setDetails((d) => ({ ...d, [id]: 'loading' }));
    try {
      const c = await api.commit(id);
      setDetails((d) => ({ ...d, [id]: c }));
    } catch (e) {
      setDetails((d) => ({ ...d, [id]: new Error(errorText(e)) }));
    }
  };

  const toggleCommit = (id: number) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!details[id] || details[id] instanceof Error) loadCommit(id);
  };

  const chip = (id: BackendFilter, label: string) => (
    <button type="button" className={`chip${filter === id ? ' active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
      {label}
    </button>
  );

  return (
    <div className="activity">
      <section>
        <div className="side-title">{scoped ? 'Open proposals for this endpoint' : 'Open proposals'}</div>
        {!hub.loaded ? (
          <p className="muted small side-empty">Loading…</p>
        ) : open.length === 0 ? (
          <p className="muted small side-empty">Nothing waiting.</p>
        ) : (
          open.map((p) => {
            const mine = needsMyReview(p, user);
            return (
              <a key={p.id} className={`act-item${mine ? ' needs' : ''}`} href={href(`/?proposal=${p.id}`)}>
                <div className="row" style={{ gap: 6 }}>
                  <StatusBadge status={p.status} />
                  {mine && <span className="badge badge-accent">your review</span>}
                </div>
                <div className="act-title">
                  #{p.id} {p.title}
                </div>
                <div className="small muted">
                  {p.author} · {timeAgo(p.updatedAt)}
                </div>
              </a>
            );
          })
        )}
      </section>

      <section>
        <div className="side-title">{scoped ? 'History of this endpoint' : 'History'}</div>
        {scopedCommits.length > 0 && (
          <div className="filter-chips" role="group" aria-label="Filter by real backend status">
            {chip('all', 'All')}
            {chip('pending', `Not in backend (${pendingCount})`)}
            {chip('done', 'In backend')}
          </div>
        )}
        {hub.loaded && scopedCommits.length === 0 && <p className="muted small side-empty">No commits yet.</p>}
        {scopedCommits.length > 0 && commits.length === 0 && <p className="muted small side-empty">No commits match.</p>}
        {commits.slice(0, 40).map((c) => {
          const isExpanded = expanded === c.id;
          return (
            <div key={c.id} className="act-item commit">
              <button type="button" className="act-toggle" aria-expanded={isExpanded} onClick={() => toggleCommit(c.id)}>
                <div className="act-title">
                  <span className="muted">#{c.id}</span> {c.title}
                  {c.revertedBy && (
                    <>
                      {' '}
                      <span className="badge status-rejected">discarded</span>
                    </>
                  )}
                </div>
                <div className="row small muted" style={{ gap: 6 }}>
                  <BackendBadge status={c.backend} />
                  <span title={formatDate(c.at)}>
                    {c.author}
                    {c.approvedBy.length > 0 && ` → ${c.approvedBy.join(', ')}`} · {timeAgo(c.at)}
                  </span>
                </div>
              </button>
              {isExpanded && details[c.id] && <CommitDetail detail={details[c.id]} onChanged={() => loadCommit(c.id)} />}
            </div>
          );
        })}
      </section>
    </div>
  );
}
