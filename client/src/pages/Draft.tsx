import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useUser } from '../auth';
import { ChangeTypeBadge, MethodBadge } from '../components/Badges';
import { Empty, Field } from '../components/Common';
import { ReadableDiff } from '../components/ReadableDiff';
import { hubStore, useHubData } from '../data';
import { Draft, DraftChange, draftRoute, draftStore, useDraft } from '../draft';
import { href, navigate } from '../router';
import { useToast } from '../toast';
import type { Endpoint, ProposalKind } from '../types';
import { contentOf, errorText, plural } from '../util';

interface Failure {
  message: string;
  general: string[];
  byIndex: Record<number, string[]>;
}

export function DraftPage() {
  const user = useUser();
  const toast = useToast();
  const draft = useDraft();
  const hub = useHubData();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  if (!draft.changes.length && !draft.proposalId) {
    return (
      <Empty title="Your draft is empty">
        <p>Create or edit endpoints. Changes collect here until you submit them as one proposal.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <a className="btn btn-primary" href={href('/endpoints/new')}>
            New endpoint
          </a>
          <a className="btn" href={href('/endpoints')}>
            Browse endpoints
          </a>
          <a className="btn" href={href('/import')}>
            Import a file
          </a>
        </div>
      </Empty>
    );
  }

  const liveById = new Map(hub.endpoints.map((e) => [e.id, e]));
  const defaultKind: ProposalKind = user.role === 'frontend' ? 'request' : 'publish';
  const setField = (patch: Partial<Draft>) => draftStore.update((d) => ({ ...d, ...patch }));

  const submit = async (ev: FormEvent | null, publish = false) => {
    ev?.preventDefault();
    if (!draft.title.trim()) {
      setFailure({ message: 'Give the proposal a title.', general: [], byIndex: {} });
      return;
    }
    setBusy(true);
    setFailure(null);
    const body = {
      title: draft.title.trim(),
      message: draft.message,
      kind: draft.kind ?? defaultKind,
      changes: draft.changes.map((c) => ({
        type: c.type,
        endpointId: c.endpointId,
        baseVersion: c.baseVersion,
        endpoint: c.type === 'delete' ? undefined : c.endpoint,
      })),
    };
    try {
      let p = draft.proposalId ? await api.updateProposal(draft.proposalId, body) : await api.createProposal(body);
      draftStore.clear();
      if (publish && p.status === 'open') {
        try {
          p = await api.review(p.id, 'approve', 'Published from the draft');
        } catch (e) {
          toast(`Proposal #${p.id} was created but not approved: ${errorText(e)}`, 'error');
        }
      }
      hubStore.refresh();
      toast(p.status === 'approved' ? `Proposal #${p.id} is live` : `Proposal #${p.id} is waiting for review`);
      navigate(`/proposals/${p.id}`);
    } catch (e) {
      const byIndex: Record<number, string[]> = {};
      const general: string[] = [];
      for (const m of e instanceof ApiError ? e.errors : []) {
        const match = /^changes\[(\d+)\](?:\.endpoint)?:?\s*/.exec(m);
        if (match) (byIndex[Number(match[1])] ??= []).push(m.slice(match[0].length));
        else general.push(m);
      }
      setFailure({ message: errorText(e), general, byIndex });
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (!window.confirm('Discard every change in your draft?')) return;
    draftStore.clear();
    toast('Draft discarded');
  };

  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <div className="page-head">
        <div>
          <h1>{draft.proposalId ? `Edit proposal #${draft.proposalId}` : 'Draft proposal'}</h1>
          <p className="muted">{plural(draft.changes.length, 'change')}, kept in this browser until you submit.</p>
        </div>
      </div>

      {draft.proposalId && (
        <div className="banner banner-info row">
          <span>
            Submitting replaces the changes of <a href={href(`/proposals/${draft.proposalId}`)}>proposal #{draft.proposalId}</a>{' '}
            and clears its reviews.
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setField({ proposalId: undefined })}>
            Submit as a new proposal instead
          </button>
        </div>
      )}

      <section className="card stack">
        <Field label="Title" hint="Like a commit subject: what and why, in a few words">
          <input
            type="text"
            maxLength={200}
            placeholder="Add user endpoints for the profile page"
            value={draft.title}
            onChange={(e) => setField({ title: e.target.value })}
          />
        </Field>
        <Field label="Message">
          <textarea
            rows={3}
            placeholder="Context for reviewers: which screen needs it, what was agreed, open questions"
            value={draft.message}
            onChange={(e) => setField({ message: e.target.value })}
          />
        </Field>
        <Field label="Kind">
          <select value={draft.kind ?? defaultKind} onChange={(e) => setField({ kind: e.target.value as ProposalKind })}>
            <option value="publish">Contract: backend publishes what it will build</option>
            <option value="request">Request: frontend asks for data it needs</option>
          </select>
        </Field>
      </section>

      {failure && (
        <div className="banner banner-error" role="alert">
          <strong>{failure.message}</strong>
          {failure.general.length > 0 && (
            <ul>
              {failure.general.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}
          {Object.keys(failure.byIndex).length > 0 && <div>The problems are marked on the changes below.</div>}
        </div>
      )}

      <div className="stack">
        {draft.changes.length === 0 && (
          <div className="banner banner-warn">
            This edit has no changes left. Add a change, or close the proposal from its page.
          </div>
        )}
        {draft.changes.map((c, i) => (
          <DraftChangeCard
            key={c.key}
            change={c}
            live={hub.loaded ? (liveById.get(c.endpointId ?? '') ?? null) : undefined}
            errors={failure?.byIndex[i] ?? []}
          />
        ))}
      </div>

      <div className="sticky-actions">
        {user.role === 'admin' && (
          <button
            type="button"
            className="btn btn-ok"
            disabled={busy || !draft.changes.length}
            onClick={() => submit(null, true)}
          >
            Publish now
          </button>
        )}
        <button type="submit" className={`btn${user.role === 'admin' ? '' : ' btn-primary'}`} disabled={busy || !draft.changes.length}>
          {busy ? 'Submitting…' : draft.proposalId ? `Update proposal #${draft.proposalId}` : 'Submit for review'}
        </button>
        <a className="btn" href={href('/endpoints/new')}>
          Add endpoint
        </a>
        <span className="spacer" />
        <button type="button" className="btn btn-danger" onClick={discard}>
          Discard draft
        </button>
      </div>
    </form>
  );
}

function DraftChangeCard({
  change,
  live,
  errors,
}: {
  change: DraftChange;
  /** undefined while loading, null when the endpoint does not exist */
  live: Endpoint | null | undefined;
  errors: string[];
}) {
  const { method, path } = draftRoute(change);
  const targetsLive = change.type !== 'add';
  const missing = targetsLive && live === null;
  const stale = targetsLive && !!live && live.version !== change.baseVersion;
  const editHref = change.type === 'delete' ? null : `/draft/edit/${change.key}`;

  const baseOnLive = () => {
    if (live) draftStore.upsertChange({ ...change, baseVersion: live.version, before: contentOf(live) });
  };

  return (
    <div className={`card change${errors.length || missing ? ' has-error' : stale ? ' has-warn' : ''}`}>
      <div className="change-head">
        <ChangeTypeBadge type={change.type} />
        <MethodBadge method={method} />
        <span className="mono">{path}</span>
        <span className="spacer" />
        {editHref && (
          <a className="btn btn-sm" href={href(editHref)}>
            Edit
          </a>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => draftStore.remove(change.key)}>
          Remove
        </button>
      </div>
      {errors.length > 0 && (
        <div className="banner banner-error" style={{ marginBottom: 10 }}>
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
      {missing && (
        <div className="banner banner-error" style={{ marginBottom: 10 }}>
          This endpoint no longer exists. Remove this change.
        </div>
      )}
      {stale && live && (
        <div className="banner banner-warn row" style={{ marginBottom: 10 }}>
          <span>
            Someone changed this endpoint. Live is v{live.version}, you edited v{change.baseVersion}.
          </span>
          <button type="button" className="btn btn-sm" onClick={baseOnLive}>
            Base my change on v{live.version}
          </button>
          <a className="small" href={href(`/endpoints/${live.id}`)}>
            View live
          </a>
        </div>
      )}
      <ReadableDiff before={change.type === 'add' ? undefined : change.before} after={change.type === 'delete' ? undefined : change.endpoint} />
    </div>
  );
}
