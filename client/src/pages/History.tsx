import { useEffect, useState } from 'react';
import { api } from '../api';
import { ChangeView } from '../components/ChangeView';
import { Empty, ErrorBox, Loading } from '../components/Common';
import { href } from '../router';
import type { Commit, CommitSummary } from '../types';
import { formatDate, timeAgo } from '../util';

const PAGE = 30;
type Expanded = Commit | 'loading' | Error;

function CommitDetail({ state }: { state: Expanded }) {
  if (state === 'loading') return <Loading />;
  if (state instanceof Error) return <ErrorBox error={state} />;
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      {state.message && <p className="pre-wrap">{state.message}</p>}
      <p className="small muted" style={{ margin: 0 }}>
        From <a href={href(`/proposals/${state.proposalId}`)}>proposal #{state.proposalId}</a> · {formatDate(state.at)}
      </p>
      {state.changes.map((c, i) => (
        <ChangeView key={i} change={c} />
      ))}
    </div>
  );
}

export function HistoryPage({ focus }: { focus: number | null }) {
  const [items, setItems] = useState<CommitSummary[] | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<Record<number, Expanded>>({});

  const load = async (before?: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.commits({ limit: PAGE, before });
      setItems((xs) => (before && xs ? [...xs, ...page] : page));
      setDone(page.length < PAGE);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const open = async (id: number) => {
    setExpanded((x) => ({ ...x, [id]: 'loading' }));
    try {
      const c = await api.commit(id);
      setExpanded((x) => ({ ...x, [id]: c }));
    } catch (e) {
      setExpanded((x) => ({ ...x, [id]: e as Error }));
    }
  };

  const toggle = (id: number) => {
    if (expanded[id]) {
      setExpanded((x) => {
        const next = { ...x };
        delete next[id];
        return next;
      });
    } else {
      open(id);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (focus) open(focus);
  }, [focus]);

  if (error && !items) return <ErrorBox error={error} onRetry={() => load()} />;
  if (!items) return <Loading />;
  const focusMissing = focus && !items.some((c) => c.id === focus) && expanded[focus];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>History</h1>
          <p className="muted">Every approved proposal, newest first.</p>
        </div>
      </div>

      {focusMissing && (
        <div className="card">
          <h2>Commit #{focus}</h2>
          <CommitDetail state={expanded[focus]} />
        </div>
      )}

      {items.length === 0 ? (
        <Empty title="No commits yet">
          <p>Approved proposals show up here.</p>
        </Empty>
      ) : (
        <div className="card proposal-list">
          {items.map((c) => (
            <div key={c.id} className="proposal-row" style={{ display: 'block' }}>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={!!expanded[c.id]}
                  onClick={() => toggle(c.id)}
                >
                  {expanded[c.id] ? '▾' : '▸'}
                </button>
                <strong>#{c.id}</strong>
                <a className="title" href={href(`/commits/${c.id}`)}>
                  {c.title}
                </a>
                {c.revertedBy && <span className="badge status-rejected">discarded</span>}
                <span className="spacer" />
                <span className="small muted" title={formatDate(c.at)}>
                  {c.author}
                  {c.approvedBy.length > 0 && ` · approved by ${c.approvedBy.join(', ')}`} · {timeAgo(c.at)}
                </span>
              </div>
              {!expanded[c.id] && (
                <div className="routes" style={{ paddingLeft: 36 }}>
                  {c.changes.slice(0, 3).map((ch, i) => (
                    <div key={i}>{ch}</div>
                  ))}
                  {c.changes.length > 3 && <div>+{c.changes.length - 3} more</div>}
                </div>
              )}
              {expanded[c.id] && <CommitDetail state={expanded[c.id]} />}
            </div>
          ))}
        </div>
      )}

      {error != null && <ErrorBox error={error} />}
      {!done && items.length > 0 && (
        <div>
          <button type="button" className="btn" disabled={loading} onClick={() => load(items[items.length - 1].id)}>
            {loading ? 'Loading…' : 'Load older commits'}
          </button>
        </div>
      )}
    </div>
  );
}
