import { FormEvent, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api';
import { useUser } from '../auth';
import { hubStore, useHubData } from '../data';
import { useToast } from '../toast';
import type { Layer, Project } from '../types';
import { errorText, normalizeBasePath, plural } from '../util';

let isOpen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Open the projects popup from anywhere: projectsDialog.open() */
export const projectsDialog = {
  open: () => {
    isOpen = true;
    emit();
  },
  close: () => {
    isOpen = false;
    emit();
  },
  get: () => isOpen,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Name and prefix of one project or layer, saved on its own. */
function ScopeRow({
  item,
  kind,
  canEdit,
  onSave,
  onDelete,
}: {
  item: Project | Layer;
  kind: 'project' | 'layer';
  canEdit: boolean;
  onSave: (patch: { name: string; basePath: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [basePath, setBasePath] = useState(item.basePath);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== item.name || normalizeBasePath(basePath) !== item.basePath;
  const count = item.endpoints ?? 0;

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ name: name.trim(), basePath: normalizeBasePath(basePath) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`scope-row${kind === 'layer' ? ' layer' : ''}`}>
      <input
        type="text"
        aria-label={`${kind} name`}
        value={name}
        disabled={!canEdit}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="text"
        className="mono"
        aria-label={`${kind} base path`}
        placeholder="no prefix"
        value={basePath}
        disabled={!canEdit}
        onChange={(e) => setBasePath(e.target.value)}
      />
      <span className="muted small">{plural(count, 'endpoint')}</span>
      {canEdit && (
        <>
          <button type="button" className="btn btn-sm" disabled={!dirty || busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={busy}
            title={count ? 'Move its endpoints elsewhere first' : `Delete this ${kind}`}
            onClick={onDelete}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function AddScope({ what, onAdd }: { what: string; onAdd: (v: { name: string; basePath: string }) => Promise<void> }) {
  const [name, setName] = useState('');
  const [basePath, setBasePath] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onAdd({ name: name.trim(), basePath: normalizeBasePath(basePath) });
      setName('');
      setBasePath('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="scope-row add" onSubmit={submit}>
      <input type="text" aria-label={`New ${what} name`} placeholder={`New ${what}`} value={name} onChange={(e) => setName(e.target.value)} />
      <input
        type="text"
        className="mono"
        aria-label={`New ${what} base path`}
        placeholder="/prefix (optional)"
        value={basePath}
        onChange={(e) => setBasePath(e.target.value)}
      />
      <button type="submit" className="btn btn-sm btn-primary" disabled={!name.trim() || busy}>
        {busy ? 'Adding…' : `Add ${what}`}
      </button>
    </form>
  );
}

function ProjectsManager() {
  const user = useUser();
  const hub = useHubData();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const canEdit = user.role === 'admin' || user.role === 'backend';

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await hubStore.refresh();
      toast(what);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        A project groups the mocks of one product and can prefix their URLs. A layer is a tier inside it — cloud API, local
        server, core services — and adds a second prefix. Changes here apply at once, without review; moving an endpoint
        between them is a normal edit.
      </p>
      {error && <div className="banner banner-error">{error}</div>}

      {hub.projects.map((p) => (
        <div key={p.id} className="card stack scope-card">
          <ScopeRow
            item={p}
            kind="project"
            canEdit={canEdit}
            onSave={(patch) => run(`Project ${patch.name} saved`, () => api.updateProject(p.id, patch))}
            onDelete={() => run(`Project ${p.name} deleted`, () => api.deleteProject(p.id))}
          />
          <div className="stack scope-layers">
            {p.layers.map((l) => (
              <ScopeRow
                key={l.id}
                item={l}
                kind="layer"
                canEdit={canEdit}
                onSave={(patch) => run(`Layer ${patch.name} saved`, () => api.updateLayer(p.id, l.id, patch))}
                onDelete={() => run(`Layer ${l.name} deleted`, () => api.deleteLayer(p.id, l.id))}
              />
            ))}
            {canEdit && <AddScope what="layer" onAdd={(v) => run(`Layer ${v.name} added`, () => api.createLayer(p.id, v))} />}
          </div>
          <div className="row small">
            <span className="muted">
              key <code className="mono">{p.key}</code>
            </span>
            <span className="spacer" />
            <a href={`/_hub/docs/?project=${encodeURIComponent(p.key)}`} target="_blank" rel="noreferrer">
              Swagger for this project
            </a>
          </div>
        </div>
      ))}

      {hub.projects.length === 0 && (
        <p className="muted">
          No projects yet. Endpoints without one answer at their own path, exactly as before.
        </p>
      )}
      {canEdit ? (
        <AddScope what="project" onAdd={(v) => run(`Project ${v.name} added`, () => api.createProject(v))} />
      ) : (
        <p className="muted small">Admins and backend users manage projects and layers.</p>
      )}
    </div>
  );
}

export function ProjectsDialog() {
  const open = useSyncExternalStore(projectsDialog.subscribe, projectsDialog.get);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') projectsDialog.close();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && projectsDialog.close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="projects-title">
        <div className="modal-head">
          <h2 id="projects-title">Projects and layers</h2>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={projectsDialog.close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <ProjectsManager />
        </div>
      </div>
    </div>
  );
}
