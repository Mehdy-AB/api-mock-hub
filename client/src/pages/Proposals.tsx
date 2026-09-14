import { useState } from 'react';
import { api } from '../api';
import { useUser } from '../auth';
import { KindBadge, StatusBadge } from '../components/Badges';
import { Empty, ErrorBox, Loading } from '../components/Common';
import { hubStore, useHubData } from '../data';
import { useAsync } from '../hooks';
import { href } from '../router';
import { useToast } from '../toast';
import type { AuthUser, ProposalSummary, Settings } from '../types';
import { errorText, formatDate, plural, timeAgo } from '../util';

interface Tab {
  id: string;
  label: string;
  match: (p: ProposalSummary, u: AuthUser) => boolean;
}

type Reviewable = Pick<ProposalSummary, 'status' | 'author' | 'approval'>;

export const needsMyReview = (p: Reviewable, u: AuthUser) =>
  p.status === 'open' && (p.author !== u.username || u.role === 'admin') && !p.approval.approvedBy.includes(u.username);

const TABS: Tab[] = [
  { id: 'review', label: 'Needs my review', match: needsMyReview },
  { id: 'open', label: 'Open', match: (p) => p.status === 'open' || p.status === 'conflict' },
  { id: 'mine', label: 'Mine', match: (p, u) => p.author === u.username },
  { id: 'approved', label: 'Approved', match: (p) => p.status === 'approved' },
  { id: 'closed', label: 'Rejected & closed', match: (p) => p.status === 'rejected' || p.status === 'closed' },
  { id: 'all', label: 'All', match: () => true },
];

/** Mirrors the server rule, so only proposals you may approve get a checkbox. */
export function canApprove(p: Reviewable, u: AuthUser, s?: Settings): boolean {
  if (p.status !== 'open' || p.approval.approvedBy.includes(u.username)) return false;
  const isAdmin = u.role === 'admin';
  if (p.author === u.username && !isAdmin && (s?.approverMustDiffer ?? true)) return false;
  const role = p.approval.requiredRole;
  return !role || u.role === role || isAdmin;
}

interface Result {
  id: number;
  ok: boolean;
  text: string;
}

export function ProposalsPage({ tab }: { tab: string | null }) {
  const user = useUser();
  const hub = useHubData();
  const toast = useToast();
  const settings = useAsync(() => api.settings(), []);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const active = TABS.find((t) => t.id === tab) ?? TABS[1];

  if (!hub.loaded) return hub.error ? <ErrorBox error={hub.error} /> : <Loading />;
  const rows = hub.proposals.filter((p) => active.match(p, user));
  const selectable = rows.filter((p) => canApprove(p, user, settings.data));
  const allChecked = selectable.length > 0 && selectable.every((p) => selected.has(p.id));

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = async (decision: 'approve' | 'reject') => {
    const ids = [...selected].sort((a, b) => a - b); // oldest first
    if (decision === 'reject' && !window.confirm(`Reject ${plural(ids.length, 'proposal')}?`)) return;
    setBusy(true);
    setResults(null);
    const out: Result[] = [];
    for (const id of ids) {
      try {
        if (decision === 'approve') {
          const p = await api.review(id, 'approve');
          out.push({
            id,
            ok: true,
            text:
              p.status === 'approved'
                ? 'approved and live'
                : p.status === 'conflict'
                  ? 'approval saved, but it conflicts with a change approved just before'
                  : 'approval saved, needs more approvals',
          });
        } else {
          await api.reject(id);
          out.push({ id, ok: true, text: 'rejected' });
        }
      } catch (e) {
        out.push({ id, ok: false, text: errorText(e) });
      }
    }
    setResults(out);
    setSelected(new Set());
    setBusy(false);
    await hubStore.refresh();
    const failed = out.filter((r) => !r.ok).length;
    toast(failed ? `${out.length - failed} done, ${failed} failed` : `${plural(out.length, 'proposal')} ${decision === 'approve' ? 'approved' : 'rejected'}`, failed ? 'error' : 'ok');
  };

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Proposals</h1>
          <p className="muted">Tick several to approve or reject them together.</p>
        </div>
        <a className="btn btn-primary" href={href('/draft')}>
          Open draft
        </a>
      </div>

      <nav className="tabs" aria-label="Proposal filters" style={{ marginBottom: 0 }}>
        {TABS.map((t) => (
          <a
            key={t.id}
            href={href(`/proposals?tab=${t.id}`)}
            className={t.id === active.id ? 'active' : ''}
            onClick={() => setSelected(new Set())}
          >
            {t.label} <span className="muted">{hub.proposals.filter((p) => t.match(p, user)).length}</span>
          </a>
        ))}
      </nav>

      {results && (
        <div className="banner banner-info">
          <strong>Bulk result</strong>
          <ul>
            {results.map((r) => (
              <li key={r.id} className={r.ok ? '' : 'error-text'}>
                <a href={href(`/proposals/${r.id}`)}>#{r.id}</a> {r.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <button type="button" className="btn btn-sm btn-ok" disabled={busy} onClick={() => bulk('approve')}>
            {busy ? 'Working…' : 'Approve selected'}
          </button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => bulk('reject')}>
            Reject selected
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title="Nothing here" />
      ) : (
        <div className="card proposal-list">
          {selectable.length > 0 && (
            <label className="proposal-row checkbox small" style={{ padding: '8px 16px' }}>
              <input
                type="checkbox"
                aria-label="Select all you can approve"
                checked={allChecked}
                onChange={() => setSelected(allChecked ? new Set() : new Set(selectable.map((p) => p.id)))}
              />
              Select all you can approve ({selectable.length})
            </label>
          )}
          {rows.map((p) => {
            const selectableRow = canApprove(p, user, settings.data);
            return (
              <div key={p.id} className={`proposal-row${selected.has(p.id) ? ' selected' : ''}`}>
                <div className="check-col" style={{ paddingTop: 2 }}>
                  {selectableRow && (
                    <input
                      type="checkbox"
                      aria-label={`Select proposal #${p.id}`}
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row">
                    <a className="title" href={href(`/proposals/${p.id}`)}>
                      #{p.id} {p.title}
                    </a>
                    <StatusBadge status={p.status} />
                    <KindBadge kind={p.kind} />
                  </div>
                  <div className="routes">
                    {p.changes.slice(0, 4).map((c, i) => (
                      <div key={i}>{c}</div>
                    ))}
                    {p.changes.length > 4 && <div>+{p.changes.length - 4} more</div>}
                  </div>
                </div>
                <div className="small muted" style={{ textAlign: 'right' }}>
                  <div>by {p.author}</div>
                  {p.status === 'open' && (
                    <div>
                      {p.approval.approvedBy.length}/{p.approval.required} approvals
                      {p.approval.changesRequestedBy.length > 0 && ' · changes requested'}
                    </div>
                  )}
                  <div title={formatDate(p.updatedAt)}>{timeAgo(p.updatedAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
