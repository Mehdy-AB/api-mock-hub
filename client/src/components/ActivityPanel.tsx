import { useState } from 'react';
import { api } from '../api';
import { useUser } from '../auth';
import { hubStore, isOpen, useHubData } from '../data';
import { needsMyReview } from '../pages/Proposals';
import { href } from '../router';
import { useToast } from '../toast';
import type { Commit } from '../types';
import { contentOf, errorText, formatDate, timeAgo } from '../util';
import { ChangeTypeBadge, StatusBadge } from './Badges';
import { ErrorBox, Loading } from './Common';
import { ReadableDiff } from './ReadableDiff';

type Detail = Commit | 'loading' | Error;

/** One commit opened in the side panel: what changed, and a Discard button. */
function CommitDetail({ detail, onDiscarded }: { detail: Detail; onDiscarded: () => void }) {
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
      onDiscarded();
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
        <span className="muted" title={formatDate(c.at)}>
          {formatDate(c.at)}
        </span>
      </div>
      {c.message && <p className="pre-wrap small" style={{ margin: 0 }}>{c.message}</p>}
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

  const scoped = !!endpointId && hub.endpoints.some((e) => e.id === endpointId);
  const open = hub.proposals.filter((p) => isOpen(p) && (!scoped || p.endpointIds.includes(endpointId!)));
  const commits = hub.commits.filter((c) => !scoped || (c.endpointIds ?? []).includes(endpointId!));

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
        {hub.loaded && commits.length === 0 && <p className="muted small side-empty">No commits yet.</p>}
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
                <div className="small muted" title={formatDate(c.at)}>
                  {c.author}
                  {c.approvedBy.length > 0 && ` → ${c.approvedBy.join(', ')}`} · {timeAgo(c.at)}
                </div>
              </button>
              {isExpanded && details[c.id] && <CommitDetail detail={details[c.id]} onDiscarded={() => loadCommit(c.id)} />}
            </div>
          );
        })}
      </section>
    </div>
  );
}
