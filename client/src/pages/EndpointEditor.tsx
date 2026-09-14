import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useUser } from '../auth';
import { ErrorBox, Loading } from '../components/Common';
import { EndpointFields } from '../components/EndpointFields';
import { Errors, fromForm, normalizePath, toForm } from '../components/form-model';
import { hubStore, useHubData } from '../data';
import { draftStore } from '../draft';
import { useAsync } from '../hooks';
import { href, navigate } from '../router';
import { useToast } from '../toast';
import type { EndpointContent } from '../types';
import { errorText, routeKey } from '../util';

/** Full-page editor for a change that lives in the draft (used when reviewing a draft). */
export function EndpointEditorPage({ draftKey }: { draftKey: string }) {
  const toast = useToast();
  const user = useUser();
  const hub = useHubData();
  const source = useAsync(async () => {
    const c = draftStore.get().changes.find((x) => x.key === draftKey);
    if (!c?.endpoint) throw new Error('This draft change no longer exists');
    return c;
  }, [draftKey]);

  if (source.error) return <ErrorBox error={source.error} />;
  if (!source.data) return <Loading />;
  const change = source.data;

  const save = async (content: EndpointContent, action: 'draft' | 'publish') => {
    if (action === 'draft') {
      draftStore.upsertChange({ ...change, endpoint: content });
      toast('Draft updated');
      navigate('/draft');
      return;
    }
    let p = await api.createProposal({
      title: `${change.type === 'add' ? 'Add' : 'Update'} ${content.method} ${content.path}`,
      kind: user.role === 'frontend' ? 'request' : 'publish',
      changes: [{ type: change.type, endpointId: change.endpointId, baseVersion: change.baseVersion, endpoint: content }],
    });
    draftStore.remove(change.key);
    if (user.role === 'admin' && p.status === 'open') {
      try {
        p = await api.review(p.id, 'approve', 'Published from the draft editor');
      } catch (e) {
        toast(`Proposal #${p.id} was created but not approved: ${errorText(e)}`, 'error');
      }
    }
    await hubStore.refresh();
    toast(p.status === 'approved' ? `Live now as commit #${p.commitId}` : `Proposal #${p.id} is waiting for review`);
    navigate(p.status === 'approved' ? '/' : `/proposals/${p.id}`);
  };

  return (
    <DraftEditorForm
      initial={change.endpoint!}
      existing={hub.endpoints.filter((e) => e.id !== change.endpointId)}
      onSave={save}
      publishLabel={user.role === 'admin' ? 'Publish now' : 'Submit for review'}
    />
  );
}

function DraftEditorForm({
  initial,
  existing,
  onSave,
  publishLabel,
}: {
  initial: EndpointContent;
  existing: { id: string; method: string; path: string }[];
  onSave: (content: EndpointContent, action: 'draft' | 'publish') => Promise<void>;
  publishLabel: string;
}) {
  const [f, setF] = useState(() => toForm(initial));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const path = normalizePath(f.path);
  const collision = path ? existing.find((e) => routeKey(e.method, e.path) === routeKey(f.method, path)) : undefined;

  const run = async (action: 'draft' | 'publish') => {
    const r = fromForm(f);
    setErrors(r.errors);
    if (!r.value) return;
    setBusy(true);
    setSaveError(null);
    try {
      await onSave(r.value, action);
    } catch (e) {
      setSaveError(e);
      setBusy(false);
    }
  };

  return (
    <form
      className="stack-lg"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        run('draft');
      }}
    >
      <div>
        <a className="small" href={href('/draft')}>
          ← Draft
        </a>
        <h1>Edit draft change</h1>
      </div>
      {collision && (
        <div className="banner banner-warn">
          {collision.method} {collision.path} already exists. <a href={href(`/endpoints/${collision.id}`)}>Open it</a>
        </div>
      )}
      <div className="card">
        <EndpointFields form={f} onChange={setF} errors={errors} idPrefix="draft-editor" />
      </div>
      {saveError != null && <ErrorBox error={saveError} />}
      <div className="sticky-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save to draft
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => run('publish')}>
          {publishLabel}
        </button>
        <a className="btn btn-ghost" href={href('/draft')}>
          Cancel
        </a>
      </div>
    </form>
  );
}
