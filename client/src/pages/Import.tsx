import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { api } from '../api';
import { useUser } from '../auth';
import { StatusBadge } from '../components/Badges';
import { hubStore } from '../data';
import { ErrorBox, Field } from '../components/Common';
import { href } from '../router';
import type { ImportResult, ProposalKind } from '../types';
import { isObject, parseJsonText, plural } from '../util';

type Format = 'auto' | 'hub' | 'openapi';

interface Detected {
  data: unknown;
  format: 'hub' | 'openapi';
  count: number;
  wrapper?: { title?: string; message?: string };
}

const OPERATIONS = ['get', 'put', 'post', 'delete', 'patch', 'head'];

function detect(value: unknown): Detected | null {
  if (value === undefined) return null;
  let data: unknown = value;
  let wrapper: Detected['wrapper'];
  // Accept the request-body shape too, e.g. examples/sample-import.json
  if (isObject(value) && 'data' in value && !('paths' in value) && !('endpoints' in value)) {
    data = value.data;
    wrapper = {
      title: typeof value.title === 'string' ? value.title : undefined,
      message: typeof value.message === 'string' ? value.message : undefined,
    };
  }
  if (isObject(data) && (typeof data.openapi === 'string' || typeof data.swagger === 'string')) {
    const paths = isObject(data.paths) ? Object.values(data.paths) : [];
    const count = paths.reduce<number>((n, item) => n + (isObject(item) ? OPERATIONS.filter((m) => m in item).length : 0), 0);
    return { data, format: 'openapi', count, wrapper };
  }
  if (Array.isArray(data)) return { data, format: 'hub', count: data.length, wrapper };
  if (isObject(data) && Array.isArray(data.endpoints)) return { data, format: 'hub', count: data.endpoints.length, wrapper };
  if (isObject(data) && 'method' in data && 'path' in data) return { data, format: 'hub', count: 1, wrapper };
  return { data, format: 'hub', count: 0, wrapper };
}

export function ImportPage() {
  const user = useUser();
  const [text, setText] = useState('');
  const [format, setFormat] = useState<Format>('auto');
  const [overrideBase, setOverrideBase] = useState(false);
  const [basePath, setBasePath] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'' | ProposalKind>('');
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsed = useMemo(() => parseJsonText(text), [text]);
  const detected = parsed.ok ? detect(parsed.value) : null;
  const effectiveFormat = format === 'auto' ? detected?.format : format;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
    e.target.value = '';
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detected) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.import(
        {
          format,
          data: detected.data,
          basePath: effectiveFormat === 'openapi' && overrideBase ? basePath : undefined,
          title: title.trim() || detected.wrapper?.title,
          message: message.trim() || detected.wrapper?.message,
          kind: kind || undefined,
        },
        direct,
      );
      setResult(r);
      hubStore.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Import</h1>
          <p className="muted">
            Paste or upload endpoints. The import becomes one proposal: new routes are added, changed routes are updated, identical routes
            are skipped, nothing is deleted.
          </p>
        </div>
      </div>

      {result && (
        <div className={`banner ${result.proposal ? 'banner-ok' : 'banner-info'} stack`} style={{ gap: 6 }}>
          {result.proposal ? (
            <div className="row">
              <strong>
                <a href={href(`/proposals/${result.proposal.id}`)}>
                  Proposal #{result.proposal.id} {result.proposal.title}
                </a>
              </strong>
              <StatusBadge status={result.proposal.status} />
            </div>
          ) : (
            <strong>Everything is already up to date. No proposal was created.</strong>
          )}
          <div className="small">
            {plural(result.summary.added.length, 'added endpoint')}, {plural(result.summary.updated.length, 'updated endpoint')},{' '}
            {result.summary.unchanged.length} unchanged.
          </div>
          {result.warnings.length > 0 && (
            <ul className="small">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error != null && <ErrorBox error={error} />}

      <form className="stack-lg" onSubmit={submit}>
        <section className="card stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>Source</h2>
            <span className="spacer" />
            <label className="btn btn-sm">
              Choose JSON file
              <input type="file" accept=".json,application/json" onChange={onFile} hidden />
            </label>
          </div>
          <textarea
            className="mono"
            rows={14}
            spellCheck={false}
            aria-label="Import JSON"
            placeholder={'{ "endpoints": [ { "method": "GET", "path": "/users", "response": { "status": 200, "body": [] } } ] }\n\nor a whole OpenAPI 3 / Swagger 2 document'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {!parsed.ok && <span className="error-text">Invalid JSON: {parsed.error}</span>}
          {detected && (
            <span className="small muted">
              Detected {detected.format === 'openapi' ? 'an OpenAPI document' : 'hub endpoints'} with {plural(detected.count, 'endpoint')}.
            </span>
          )}
          <div className="form-row-3">
            <Field label="Format">
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                <option value="auto">Detect automatically</option>
                <option value="hub">Hub JSON</option>
                <option value="openapi">OpenAPI / Swagger</option>
              </select>
            </Field>
          </div>
          {effectiveFormat === 'openapi' && (
            <div className="stack" style={{ gap: 6 }}>
              <label className="checkbox">
                <input type="checkbox" checked={overrideBase} onChange={(e) => setOverrideBase(e.target.checked)} />
                Override the path prefix
              </label>
              <span className="small muted">
                By default the path from the document’s server URL or basePath is put in front of every route, for example /api/v1.
              </span>
              {overrideBase && (
                <input
                  type="text"
                  className="mono"
                  placeholder="empty = no prefix"
                  aria-label="Path prefix"
                  value={basePath}
                  onChange={(e) => setBasePath(e.target.value)}
                />
              )}
            </div>
          )}
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>Proposal</h2>
          <Field label="Title" hint={detected?.wrapper?.title ? `Default: ${detected.wrapper.title}` : 'Default: Import N endpoint(s)'}>
            <input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Message">
            <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value as '' | ProposalKind)}>
              <option value="">From my role</option>
              <option value="publish">Contract</option>
              <option value="request">Request</option>
            </select>
          </Field>
          {user.role === 'admin' && (
            <label className="checkbox">
              <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
              Apply immediately without review (admin)
            </label>
          )}
        </section>

        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || !detected || !parsed.ok}>
            {busy ? 'Importing…' : direct ? 'Import and apply' : 'Import as proposal'}
          </button>
        </div>
      </form>
    </div>
  );
}
