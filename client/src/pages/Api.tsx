import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useUser } from '../auth';
import { BackendBadge } from '../components/ActivityPanel';
import { Empty, ErrorBox, Loading } from '../components/Common';
import { importDialog } from '../components/ImportDialog';
import { blankEndpoint, Errors, FormState, fromForm, normalizePath, toForm } from '../components/form-model';
import { LazyProposalCard, ProposalCard } from '../components/ProposalCard';
import { TryPanel } from '../components/TryPanel';
import { hubStore, isOpen, useHubData } from '../data';
import { useAsync } from '../hooks';
import { href } from '../router';
import { useToast } from '../toast';
import { ChangePayload, CommitSummary, Endpoint, EndpointContent, HttpMethod, METHODS, Proposal } from '../types';
import { contentOf, errorText, exampleText, plural, routeKey, sameJson, timeAgo, uid } from '../util';
import { canApprove, needsMyReview } from './Proposals';

// The fields pull in the code editor, so they load when the first row opens.
const EndpointFields = lazy(() => import('../components/EndpointFields'));

/** Local editing state for one row: a live endpoint (key = its id) or a new one (key = "new-..."). */
interface Edit {
  key: string;
  endpointId?: string;
  baseVersion?: number;
  base: EndpointContent | null;
  form: FormState;
  remove?: boolean;
  errors: Errors;
  serverErrors: string[];
}

interface Persisted {
  owner: string;
  edits: Record<string, Edit>;
  newKeys: string[];
  open: string[];
  message: string;
  editingProposal: number | null;
}

const emptyPersisted = (owner: string): Persisted => ({
  owner,
  edits: {},
  newKeys: [],
  open: [],
  message: '',
  editingProposal: null,
});

// Survives navigating to other screens (not a reload), so unsaved edits aren't lost.
let persisted: Persisted = emptyPersisted('');

type BulkAction = 'delay' | 'status' | 'addTag' | 'removeTag' | 'delete';
const BULK: { id: BulkAction; label: string; placeholder?: string; numeric?: boolean }[] = [
  { id: 'delay', label: 'Set delay (ms)', placeholder: '0 to 60000', numeric: true },
  { id: 'status', label: 'Set status', placeholder: '100 to 599', numeric: true },
  { id: 'addTag', label: 'Add tag', placeholder: 'tag' },
  { id: 'removeTag', label: 'Remove tag', placeholder: 'tag' },
  { id: 'delete', label: 'Delete' },
];

const freshEdit = (e: Endpoint): Edit => ({
  key: e.id,
  endpointId: e.id,
  baseVersion: e.version,
  base: contentOf(e),
  form: toForm(e),
  errors: {},
  serverErrors: [],
});

function isDirty(ed: Edit): boolean {
  if (ed.remove || !ed.base) return true;
  const r = fromForm(ed.form);
  return !r.value || !sameJson(r.value, ed.base);
}

/** What a row currently looks like, including unsaved edits. */
function preview(ed: Edit | undefined, e: Endpoint | null): EndpointContent {
  if (ed?.remove && ed.base) return ed.base;
  if (ed) {
    const r = fromForm(ed.form);
    if (r.value) return r.value;
    return { ...blankEndpoint(ed.form.method, normalizePath(ed.form.path) || '/'), response: { status: Number(ed.form.status) || 200 } };
  }
  return e ? contentOf(e) : blankEndpoint();
}

const routeOfEdit = (ed: Edit) => {
  const c = preview(ed, null);
  return `${c.method} ${c.path}`;
};

function autoTitle(list: Edit[]): string {
  if (list.length === 1) {
    const ed = list[0];
    const verb = ed.remove ? 'Delete' : ed.endpointId ? 'Update' : 'Add';
    return `${verb} ${routeOfEdit(ed)}`;
  }
  return `Update ${list.length} endpoints`;
}

const queryText = (c: EndpointContent) =>
  (c.request?.query ?? []).map((p) => (p.example === undefined ? p.name : `${p.name}=${exampleText(p.example)}`)).join('&');

const scrollToId = (id: string, block: ScrollLogicalPosition = 'start') =>
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block }));

/**
 * The one-page workspace: endpoints edited in place, open proposals with their
 * discussion and review actions, and closed proposals. History lives in the side panel.
 */
export function ApiPage({
  focusId,
  focusProposal,
  newDefaults,
}: {
  focusId?: string;
  focusProposal?: number;
  newDefaults?: { method: string | null; path: string | null };
}) {
  const user = useUser();
  const hub = useHubData();
  const toast = useToast();
  const settings = useAsync(() => api.settings(), []);
  if (persisted.owner !== user.username) persisted = emptyPersisted(user.username);

  const [edits, setEdits] = useState<Record<string, Edit>>(persisted.edits);
  const [newKeys, setNewKeys] = useState<string[]>(persisted.newKeys);
  const [open, setOpen] = useState<Set<string>>(() => new Set([...persisted.open, ...(focusId ? [focusId] : [])]));
  const [message, setMessage] = useState(persisted.message);
  const [editingProposal, setEditingProposal] = useState<number | null>(persisted.editingProposal);
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>('delay');
  const [bulkValue, setBulkValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [proposalOpen, setProposalOpen] = useState<Record<number, boolean>>({});
  const [showClosed, setShowClosed] = useState(false);
  const handledNew = useRef(false);

  const direct = settings.data?.allowDirectCommits ?? true;
  const byId = useMemo(() => new Map(hub.endpoints.map((e) => [e.id, e])), [hub.endpoints]);
  const dirtyEdits = Object.values(edits).filter(isDirty);

  useEffect(() => {
    persisted = { owner: user.username, edits, newKeys, open: [...open], message, editingProposal };
  }, [edits, newKeys, open, message, editingProposal, user.username]);

  // Create state for opened rows, and follow newer live versions of rows you haven't touched.
  useEffect(() => {
    setEdits((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const ed of Object.values(prev)) {
        if (!ed.endpointId) continue;
        const live = byId.get(ed.endpointId);
        if (!live) {
          if (hub.loaded && !isDirty(ed)) {
            delete next[ed.key];
            changed = true;
          }
        } else if (live.version !== ed.baseVersion && !isDirty(ed)) {
          next[ed.key] = freshEdit(live);
          changed = true;
        }
      }
      for (const key of open) {
        const live = byId.get(key);
        if (live && !next[key]) {
          next[key] = freshEdit(live);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [byId, open, hub.loaded]);

  // #/endpoints/:id opens that row.
  useEffect(() => {
    if (!focusId || !hub.loaded) return;
    setOpen((s) => (s.has(focusId) ? s : new Set(s).add(focusId)));
    scrollToId(`op-${focusId}`);
  }, [focusId, hub.loaded]);

  // #/?proposal=N opens that proposal card.
  useEffect(() => {
    if (!focusProposal || !hub.loaded) return;
    setProposalOpen((s) => ({ ...s, [focusProposal]: true }));
    if (!hub.openProposals.some((p) => p.id === focusProposal)) setShowClosed(true);
    scrollToId(`proposal-${focusProposal}`);
  }, [focusProposal, hub.loaded]);

  // Warn before closing the tab with unsaved edits.
  const hasDirty = dirtyEdits.length > 0;
  useEffect(() => {
    if (!hasDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDirty]);

  const addNew = (content: EndpointContent = blankEndpoint()) => {
    const key = `new-${uid()}`;
    setEdits((p) => ({ ...p, [key]: { key, base: null, form: toForm(content), errors: {}, serverErrors: [] } }));
    setNewKeys((k) => [key, ...k]);
    setOpen((s) => new Set(s).add(key));
    scrollToId(`op-${key}`, 'center');
  };

  // #/endpoints/new?method=GET&path=/x (the link in mock 404 responses)
  useEffect(() => {
    if (!newDefaults || handledNew.current) return;
    handledNew.current = true;
    const m = METHODS.includes(newDefaults.method as HttpMethod) ? (newDefaults.method as HttpMethod) : 'GET';
    addNew(blankEndpoint(m, newDefaults.path || '/'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleOpen = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setForm = (key: string, form: FormState) =>
    setEdits((p) => ({ ...p, [key]: { ...p[key], form, errors: {}, serverErrors: [] } }));
  const discardNew = (key: string) => {
    setEdits((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
    setNewKeys((k) => k.filter((x) => x !== key));
    setOpen((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  };
  const resetRow = (key: string) => {
    const live = byId.get(key);
    if (live) setEdits((p) => ({ ...p, [key]: freshEdit(live) }));
    else discardNew(key);
  };
  const markRemove = (key: string, remove: boolean) =>
    setEdits((p) => ({ ...p, [key]: { ...p[key], remove, serverErrors: [] } }));

  /** After a conflict: keep my edits and base them on the newest live version (fetched fresh, not from cache). */
  const keepMine = async (key: string) => {
    try {
      const live = await api.endpoint(key);
      setEdits((p) => ({ ...p, [key]: { ...p[key], baseVersion: live.version, base: contentOf(live), serverErrors: [] } }));
    } catch (e) {
      setEdits((p) => ({ ...p, [key]: { ...p[key], serverErrors: [errorText(e)] } }));
    }
  };
  /** After a conflict: drop my edits and load the newest live version. */
  const takeLatest = async (key: string) => {
    await hubStore.refresh();
    const live = hubStore.get().endpoints.find((x) => x.id === key);
    if (live) setEdits((p) => ({ ...p, [key]: freshEdit(live) }));
    else discardNew(key);
  };

  /** Throw away every unsaved edit (and leave proposal-editing mode). */
  const resetAll = () => {
    setEdits((p) => {
      const next = { ...p };
      for (const ed of Object.values(p)) {
        if (!isDirty(ed)) continue;
        const live = ed.endpointId ? byId.get(ed.endpointId) : undefined;
        if (live) next[ed.key] = freshEdit(live);
        else delete next[ed.key];
      }
      return next;
    });
    setNewKeys([]);
    setOpen((s) => new Set([...s].filter((k) => !k.startsWith('new-'))));
    setMessage('');
    setSaveError(null);
    setEditingProposal(null);
  };

  const cancelAll = () => {
    if (dirtyEdits.length > 1 && !window.confirm(`Throw away ${plural(dirtyEdits.length, 'unsaved change')}?`)) return;
    resetAll();
  };

  /** Load a proposal's edits into the rows so its author can change them here. */
  const editProposal = (p: Proposal) => {
    if (dirtyEdits.length && !window.confirm('Replace your unsaved edits with this proposal’s edits?')) return;
    const next: Record<string, Edit> = {};
    const added: string[] = [];
    const toOpen: string[] = [];
    for (const c of p.changes) {
      if (c.type === 'add' && c.after) {
        const key = `new-${uid()}`;
        next[key] = { key, base: null, form: toForm(c.after), errors: {}, serverErrors: [] };
        added.push(key);
        toOpen.push(key);
      } else if (c.endpointId) {
        const live = byId.get(c.endpointId);
        if (!live) continue;
        const ed = freshEdit(live);
        if (c.type === 'delete') ed.remove = true;
        else if (c.after) ed.form = toForm(c.after);
        next[live.id] = ed;
        toOpen.push(live.id);
      }
    }
    setEdits(next);
    setNewKeys(added);
    setOpen(new Set(toOpen));
    setMessage(p.title);
    setSaveError(null);
    setEditingProposal(p.id);
    setProposalOpen((s) => ({ ...s, [p.id]: false }));
    toast(`Editing proposal #${p.id}. Change the rows, then click “Update proposal”.`);
    if (toOpen[0]) scrollToId(`op-${toOpen[0]}`);
  };

  /** direct = apply now; propose = new proposal; update = replace the edits of the proposal being edited. */
  const save = async (mode: 'direct' | 'propose' | 'update') => {
    const list = [...dirtyEdits];
    let invalid = false;
    const values = list.map((ed) => {
      if (ed.remove) return undefined;
      const r = fromForm(ed.form);
      if (!r.value) {
        invalid = true;
        setEdits((p) => ({ ...p, [ed.key]: { ...p[ed.key], errors: r.errors } }));
        setOpen((s) => new Set(s).add(ed.key));
      }
      return r.value;
    });
    if (invalid) {
      setSaveError('Fix the highlighted fields first.');
      return;
    }
    if (!list.length) {
      setSaveError(mode === 'update' ? 'No edits left. Withdraw the proposal instead.' : 'Nothing to save.');
      return;
    }
    const changes: ChangePayload[] = list.map((ed, i) =>
      ed.remove
        ? { type: 'delete', endpointId: ed.endpointId, baseVersion: ed.baseVersion }
        : ed.endpointId
          ? { type: 'update', endpointId: ed.endpointId, baseVersion: ed.baseVersion, endpoint: values[i] }
          : { type: 'add', endpoint: values[i] },
    );
    const title = message.trim() || autoTitle(list);

    setSaving(true);
    setSaveError(null);
    try {
      const p =
        mode === 'direct'
          ? await api.directCommit({ title, changes })
          : mode === 'update' && editingProposal
            ? await api.updateProposal(editingProposal, { title, changes })
            : await api.createProposal({ title, changes });
      setEdits((prev) => {
        const next = { ...prev };
        for (const ed of list) delete next[ed.key];
        return next;
      });
      setNewKeys([]);
      setOpen((s) => new Set([...s].filter((key) => !key.startsWith('new-'))));
      setMessage('');
      setEditingProposal(null);
      await hubStore.refresh();
      if (mode === 'direct') {
        toast(`Saved and live as commit #${p.commitId}`);
      } else {
        toast(mode === 'update' ? `Proposal #${p.id} updated; reviews start over` : `Proposal #${p.id} is at the top, waiting for review`);
        setProposalOpen((s) => ({ ...s, [p.id]: true }));
        scrollToId(`proposal-${p.id}`);
      }
    } catch (e) {
      const general: string[] = [];
      const byKey: Record<string, string[]> = {};
      for (const m of e instanceof ApiError ? e.errors : []) {
        const match = /^changes\[(\d+)\](?:\.endpoint)?:?\s*/.exec(m);
        const ed = match ? list[Number(match[1])] : undefined;
        if (ed) (byKey[ed.key] ??= []).push(m.slice(match![0].length));
        else general.push(m);
      }
      if (Object.keys(byKey).length) {
        setEdits((p) => {
          const next = { ...p };
          for (const [key, msgs] of Object.entries(byKey)) if (next[key]) next[key] = { ...next[key], serverErrors: msgs };
          return next;
        });
        setOpen((s) => new Set([...s, ...Object.keys(byKey)]));
      }
      setSaveError([errorText(e), ...general].join(' · '));
      // The failure may be caused by someone else's newer save; pull it in so the rows show it.
      hubStore.refresh();
    } finally {
      setSaving(false);
    }
  };

  if (!hub.loaded) return hub.error ? <ErrorBox error={hub.error} /> : <Loading />;

  const pendingById = new Map<string, number[]>();
  for (const p of hub.proposals.filter(isOpen)) {
    for (const id of p.endpointIds) pendingById.set(id, [...(pendingById.get(id) ?? []), p.id]);
  }
  const approvable = hub.openProposals.filter((p) => canApprove(p, user, settings.data));
  const closedProposals = hub.proposals.filter((p) => p.status === 'rejected' || p.status === 'closed');
  // Commits come newest first, so the first one seen per endpoint is its latest change.
  const latestCommitByEndpoint = new Map<string, CommitSummary>();
  for (const c of hub.commits) {
    for (const id of c.endpointIds ?? []) if (!latestCommitByEndpoint.has(id)) latestCommitByEndpoint.set(id, c);
  }

  const approveAll = async (list: Proposal[]) => {
    if (!window.confirm(`Approve ${plural(list.length, 'proposal')}? Approved edits go live.`)) return;
    let ok = 0;
    const failed: string[] = [];
    for (const p of [...list].sort((a, b) => a.id - b.id)) {
      try {
        await api.review(p.id, 'approve');
        ok++;
      } catch (e) {
        failed.push(`#${p.id}: ${errorText(e)}`);
      }
    }
    await hubStore.refresh();
    toast(
      failed.length ? `${ok} approved, ${failed.length} failed. ${failed.join('; ')}` : `${plural(ok, 'proposal')} approved`,
      failed.length ? 'error' : 'ok',
    );
  };

  const needle = q.trim().toLowerCase();
  const rows = hub.endpoints
    .filter(
      (e) =>
        (!method || e.method === method) &&
        (!needle ||
          e.path.toLowerCase().includes(needle) ||
          (e.summary ?? '').toLowerCase().includes(needle) ||
          e.tags.some((t) => t.toLowerCase().includes(needle))),
    )
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const groups = new Map<string, Endpoint[]>();
  for (const e of rows) groups.set(e.tags[0] ?? 'other', [...(groups.get(e.tags[0] ?? 'other') ?? []), e]);
  const ordered = [...groups].sort(([a], [b]) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)));
  const visibleIds = rows.map((e) => e.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const currentBulk = BULK.find((b) => b.id === bulkAction)!;

  const applyBulk = () => {
    const v = bulkValue.trim();
    const n = Number(v);
    if (bulkAction !== 'delete' && !v) return toast('Enter a value first', 'error');
    if (bulkAction === 'delay' && (!Number.isInteger(n) || n < 0 || n > 60000)) return toast('Delay must be 0 to 60000 ms', 'error');
    if (bulkAction === 'status' && (!Number.isInteger(n) || n < 100 || n > 599)) return toast('Status must be 100 to 599', 'error');
    setEdits((p) => {
      const next = { ...p };
      for (const id of selected) {
        const live = byId.get(id);
        if (!live) continue;
        const ed = next[id] ?? freshEdit(live);
        if (bulkAction === 'delete') {
          next[id] = { ...ed, remove: true };
          continue;
        }
        const c = structuredClone(fromForm(ed.form).value ?? contentOf(live));
        if (bulkAction === 'delay') {
          if (n > 0) c.response.delayMs = n;
          else delete c.response.delayMs;
        } else if (bulkAction === 'status') c.response.status = n;
        else if (bulkAction === 'addTag') c.tags = [...new Set([...c.tags, v])];
        else if (bulkAction === 'removeTag') c.tags = c.tags.filter((t) => t !== v);
        next[id] = { ...ed, remove: false, form: toForm(c), errors: {}, serverErrors: [] };
      }
      return next;
    });
    toast(`${plural(selected.size, 'endpoint')} changed. Check them, then save.`);
    setSelected(new Set());
    setBulkValue('');
  };

  const renderOp = (key: string, e: Endpoint | null) => {
    const ed = edits[key];
    const isOpenRow = open.has(key);
    const dirty = ed ? isDirty(ed) : false;
    const c = preview(ed, e);
    const qs = queryText(c);
    const collision =
      isOpenRow && ed && !ed.remove
        ? hub.endpoints.find((o) => o.id !== e?.id && routeKey(o.method, o.path) === routeKey(c.method, c.path))
        : undefined;
    const stale = !!ed?.serverErrors.some((m) => /now at version|changed by someone|was changed/i.test(m));

    return (
      <div
        key={key}
        id={`op-${key}`}
        className={`op${isOpenRow ? ' open' : ''}${dirty ? ' dirty' : ''}${ed?.remove ? ' removing' : ''}`}
        data-method={c.method}
        data-path={c.path}
        data-new={e ? undefined : 'true'}
      >
        <div className="op-head">
          {e ? (
            <input
              type="checkbox"
              className="op-check"
              aria-label={`Select ${e.method} ${e.path}`}
              checked={selected.has(e.id)}
              onChange={() =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (next.has(e.id)) next.delete(e.id);
                  else next.add(e.id);
                  return next;
                })
              }
            />
          ) : (
            <span className="op-check" />
          )}
          <button type="button" className="op-toggle" aria-expanded={isOpenRow} onClick={() => toggleOpen(key)}>
            <span className={`method method-${c.method}`}>{c.method}</span>
            <span className="op-path mono">
              {c.path}
              {qs && (
                <>
                  <span className="tok-q">?</span>
                  <span className="tok tok-plain">{qs}</span>
                </>
              )}
            </span>
            {c.summary && <span className="op-summary">{c.summary}</span>}
            <span className="spacer" />
            {!e && <span className="badge badge-ok">new</span>}
            {ed?.remove ? (
              <span className="badge status-rejected">will be deleted</span>
            ) : e && dirty ? (
              <span className="badge badge-warn">edited</span>
            ) : null}
            {e && latestCommitByEndpoint.has(e.id) && <BackendBadge status={latestCommitByEndpoint.get(e.id)!.backend} />}
            <span className={`http-status http-${String(c.response.status)[0]}`}>{c.response.status}</span>
            <span className="chev" aria-hidden="true">
              ▸
            </span>
          </button>
          {e &&
            (pendingById.get(e.id) ?? []).map((pid) => (
              <a key={pid} className="badge status-open op-prop" href={href(`/?proposal=${pid}`)} title="An open proposal changes this endpoint">
                #{pid} proposed
              </a>
            ))}
        </div>

        {isOpenRow && ed && (
          <div className="op-body">
            {ed.serverErrors.length > 0 && (
              <div className="banner banner-error stack" style={{ gap: 6 }}>
                {ed.serverErrors.map((m, i) => (
                  <div key={i}>{m}</div>
                ))}
                {stale && e && (
                  <div className="row">
                    <button type="button" className="btn btn-sm" onClick={() => keepMine(key)}>
                      Keep my edits
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => takeLatest(key)}>
                      Take the latest version
                    </button>
                  </div>
                )}
              </div>
            )}
            {ed.remove ? (
              <div className="banner banner-warn row">
                <span>This endpoint will be deleted when you save.</span>
                <button type="button" className="btn btn-sm" onClick={() => markRemove(key, false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <div className={e ? 'op-grid' : ''}>
                <div className="op-edit">
                  <Suspense fallback={<Loading label="Loading editor…" />}>
                    <EndpointFields form={ed.form} onChange={(f) => setForm(key, f)} errors={ed.errors} idPrefix={key} />
                  </Suspense>
                  {collision && (
                    <div className="banner banner-warn" style={{ marginTop: 10 }}>
                      {collision.method} {collision.path} already exists.{' '}
                      <a href={href(`/endpoints/${collision.id}`)}>Go to it</a>
                    </div>
                  )}
                </div>
                {e && (
                  <div className="op-try">
                    <TryPanel key={`${e.id}@${e.version}`} endpoint={e} />
                    {dirty && <p className="muted small">Try it calls the live version. Save to try your edits.</p>}
                  </div>
                )}
              </div>
            )}
            <div className="op-actions">
              {e && (
                <span className="muted small">
                  v{e.version} · {e.owner} · {timeAgo(e.updatedAt)}
                </span>
              )}
              <span className="spacer" />
              {e && dirty && !ed.remove && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => resetRow(key)}>
                  Reset
                </button>
              )}
              {e && (
                <button type="button" className="btn btn-sm" onClick={() => addNew({ ...contentOf(e), path: `${e.path}-copy` })}>
                  Duplicate
                </button>
              )}
              {e && !ed.remove && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => markRemove(key, true)}>
                  Delete
                </button>
              )}
              {!e && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => discardNew(key)}>
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const showSaveBar = dirtyEdits.length > 0 || editingProposal !== null;

  return (
    <div className="stack api-page">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>API</h1>
          <p className="muted">
            {plural(hub.endpoints.length, 'endpoint')}. Open one and edit it directly.{' '}
            {direct
              ? 'Save makes it live at once (teammates can discard it). Propose waits for approval.'
              : 'Propose sends your edits for review; approved proposals go live.'}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={importDialog.open}>
            Import
          </button>
          <button type="button" className="btn btn-primary" onClick={() => addNew()}>
            + New endpoint
          </button>
        </div>
      </div>

      {hub.endpoints.length > 0 && (
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label className="checkbox small" title="Select all for bulk changes">
            <input
              type="checkbox"
              aria-label="Select all endpoints"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))}
            />
            All
          </label>
          <input type="search" placeholder="Filter by path, summary or tag" aria-label="Filter endpoints" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All methods</option>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(new Set([...open, ...visibleIds]))}>
            Expand all
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(new Set(newKeys))}>
            Collapse all
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <select aria-label="Bulk action" value={bulkAction} onChange={(e) => setBulkAction(e.target.value as BulkAction)}>
            {BULK.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          {bulkAction !== 'delete' && (
            <input
              type={currentBulk.numeric ? 'number' : 'text'}
              aria-label="Bulk value"
              placeholder={currentBulk.placeholder}
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyBulk()}
            />
          )}
          <button type="button" className={`btn btn-sm ${bulkAction === 'delete' ? 'btn-danger' : 'btn-primary'}`} onClick={applyBulk}>
            Apply
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {hub.openProposals.length > 0 && (
        <section className="op-group" aria-label="Open proposals">
          <div className="row">
            <h2 className="op-group-title">
              Open proposals <span className="muted">{hub.openProposals.length}</span>
            </h2>
            <span className="spacer" />
            {approvable.length > 1 && (
              <button type="button" className="btn btn-sm btn-ok" onClick={() => approveAll(approvable)}>
                Approve all I can ({approvable.length})
              </button>
            )}
          </div>
          {hub.openProposals.map((p) => {
            const expanded = proposalOpen[p.id] ?? (needsMyReview(p, user) && editingProposal !== p.id);
            return (
              <ProposalCard
                key={p.id}
                proposal={p}
                settings={settings.data}
                expanded={expanded}
                onToggle={() => setProposalOpen((s) => ({ ...s, [p.id]: !expanded }))}
                onEdit={editProposal}
              />
            );
          })}
        </section>
      )}

      {newKeys.length > 0 && (
        <section className="op-group">
          <h2 className="op-group-title">New</h2>
          {newKeys.map((key) => renderOp(key, null))}
        </section>
      )}

      {hub.endpoints.length === 0 && newKeys.length === 0 ? (
        <Empty title="No endpoints yet">
          <p>Click “+ New endpoint”, or import a JSON or OpenAPI file.</p>
        </Empty>
      ) : rows.length === 0 && hub.endpoints.length > 0 ? (
        <Empty title="No endpoint matches" />
      ) : (
        ordered.map(([tag, list]) => (
          <section key={tag} className="op-group">
            <h2 className="op-group-title">
              {tag} <span className="muted">{list.length}</span>
            </h2>
            {list.map((e) => renderOp(e.id, e))}
          </section>
        ))
      )}

      {closedProposals.length > 0 && (
        <section className="op-group" aria-label="Rejected and withdrawn proposals">
          <button type="button" className="btn btn-sm btn-ghost closed-toggle" aria-expanded={showClosed} onClick={() => setShowClosed((s) => !s)}>
            {showClosed ? '▾' : '▸'} Rejected and withdrawn proposals ({closedProposals.length})
          </button>
          {showClosed && closedProposals.map((p) => <LazyProposalCard key={p.id} summary={p} settings={settings.data} />)}
        </section>
      )}

      {showSaveBar && (
        <div className={`save-bar${editingProposal ? ' editing' : ''}`} role="region" aria-label="Unsaved changes">
          <div className="save-bar-info">
            <strong>{editingProposal ? `Editing proposal #${editingProposal}` : plural(dirtyEdits.length, 'unsaved change')}</strong>
            <span className="muted small">
              {dirtyEdits.length ? dirtyEdits.slice(0, 3).map(routeOfEdit).join(' · ') : 'No edits left'}
              {dirtyEdits.length > 3 ? ' …' : ''}
            </span>
          </div>
          <input
            type="text"
            aria-label="Commit message"
            maxLength={200}
            placeholder={dirtyEdits.length ? autoTitle(dirtyEdits) : 'Title'}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !saving && save(editingProposal ? 'update' : direct ? 'direct' : 'propose')}
          />
          {editingProposal ? (
            <>
              <button type="button" className="btn" disabled={saving} onClick={resetAll}>
                Stop editing
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save('update')}>
                {saving ? 'Updating…' : `Update proposal #${editingProposal}`}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled={saving} onClick={cancelAll}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn${direct ? '' : ' btn-primary'}`}
                disabled={saving}
                onClick={() => save('propose')}
                title="Create a proposal. Nothing goes live until it is approved."
              >
                {saving && !direct ? 'Proposing…' : 'Propose'}
              </button>
              {direct && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => save('direct')}
                  title="Apply now. Teammates can discard the commit."
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </>
          )}
          {saveError && <span className="error-text save-bar-error">{saveError}</span>}
        </div>
      )}
    </div>
  );
}
