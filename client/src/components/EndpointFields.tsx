import { useState } from 'react';
import { HttpMethod, METHODS } from '../types';
import { paramNames, parseJsonText, pretty, uid } from '../util';
import { Field } from './Common';
import { Errors, FormState, normalizePath, ParamRow } from './form-model';
import { JsonEditor } from './JsonEditor';

function ParamRows({
  label,
  rows,
  onChange,
  error,
  namePlaceholder,
}: {
  label: string;
  rows: ParamRow[];
  onChange: (rows: ParamRow[]) => void;
  error?: string;
  namePlaceholder: string;
}) {
  const update = (i: number, patch: Partial<ParamRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">{label}</span>
      {rows.map((r, i) => (
        <div key={r.id} className="param-row">
          <input
            type="text"
            className="mono"
            placeholder={namePlaceholder}
            aria-label={`${label} name`}
            value={r.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            type="text"
            className="mono"
            placeholder="example"
            aria-label={`${label} example`}
            value={r.example}
            onChange={(e) => update(i, { example: e.target.value })}
          />
          <input
            type="text"
            placeholder="description"
            aria-label={`${label} description`}
            value={r.description}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <label className="checkbox small">
            <input type="checkbox" checked={r.required} onChange={(e) => update(i, { required: e.target.checked })} />
            required
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Remove ${label} row`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      {error && <span className="error-text">{error}</span>}
      <div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onChange([...rows, { id: uid(), name: '', description: '', required: false, example: '' }])}
        >
          Add {label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

/** Every editable field of an endpoint, controlled by the parent. */
export function EndpointFields({
  form: f,
  onChange,
  errors,
  idPrefix,
}: {
  form: FormState;
  onChange: (next: FormState) => void;
  errors: Errors;
  idPrefix: string;
}) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => onChange({ ...f, [key]: value });
  const names = paramNames(normalizePath(f.path));
  const hasReqBody = f.method !== 'GET' && f.method !== 'HEAD';
  const [moreOpen] = useState(
    () => !!(f.description || f.query.length || f.reqHeaders.length || Object.keys(f.pathParams).length || f.bodyExample.trim()),
  );
  const statusList = `status-codes-${idPrefix}`;

  const format = (key: 'body' | 'bodyExample') => {
    const p = parseJsonText(f[key]);
    if (p.ok && p.value !== undefined) set(key, pretty(p.value));
  };

  return (
    <div className="stack fields">
      <div className="form-row">
        <Field label="Method">
          <select value={f.method} onChange={(e) => set('method', e.target.value as HttpMethod)}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Path" error={errors.path} hint="Use :id for params and *rest for wildcards">
          <input type="text" className="mono" value={f.path} placeholder="/users/:id" onChange={(e) => set('path', e.target.value)} />
        </Field>
      </div>
      <div className="form-row-2">
        <Field label="Summary">
          <input type="text" value={f.summary} placeholder="Get one user" onChange={(e) => set('summary', e.target.value)} />
        </Field>
        <Field label="Tags" hint="Comma separated; the first one groups it">
          <input type="text" value={f.tags} placeholder="users" onChange={(e) => set('tags', e.target.value)} />
        </Field>
      </div>

      <div className="form-row-3">
        <Field label="Status" error={errors.status}>
          <input type="number" min={100} max={599} list={statusList} value={f.status} onChange={(e) => set('status', e.target.value)} />
        </Field>
        <Field label="Delay (ms)" error={errors.delayMs}>
          <input
            type="number"
            min={0}
            max={60000}
            placeholder="0"
            value={f.delayMs}
            onChange={(e) => set('delayMs', e.target.value)}
          />
        </Field>
      </div>
      <datalist id={statusList}>
        {[200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 500, 503].map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="stack" style={{ gap: 6 }}>
        <span className="label">Response headers</span>
        {f.headers.map((h, i) => (
          <div key={h.id} className="header-row">
            <input
              type="text"
              className="mono"
              placeholder="X-Total-Count"
              aria-label="Header name"
              value={h.name}
              onChange={(e) => set('headers', f.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              type="text"
              className="mono"
              placeholder="value"
              aria-label="Header value"
              value={h.value}
              onChange={(e) => set('headers', f.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Remove header"
              onClick={() => set('headers', f.headers.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        {errors.headers && <span className="error-text">{errors.headers}</span>}
        <div>
          <button type="button" className="btn btn-sm" onClick={() => set('headers', [...f.headers, { id: uid(), name: '', value: '' }])}>
            Add header
          </button>
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <div className="row">
          <span className="label">Response body (JSON)</span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={() => format('body')}>
            Format
          </button>
        </div>
        <JsonEditor value={f.body} onChange={(v) => set('body', v)} invalid={!!errors.body} minHeight="160px" />
        {errors.body ? (
          <span className="error-text">{errors.body}</span>
        ) : (
          <span className="muted small">Returned exactly as written. Leave empty for no body.</span>
        )}
      </div>

      <details open={moreOpen}>
        <summary>
          More <span className="muted small">(description, params, request body)</span>
        </summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <Field label="Description">
            <textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          {names.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="label">Path params</span>
              {names.map((n) => {
                const d = f.pathParams[n] ?? { description: '', example: '' };
                const update = (patch: Partial<typeof d>) => set('pathParams', { ...f.pathParams, [n]: { ...d, ...patch } });
                return (
                  <div key={n} className="form-row-3" style={{ alignItems: 'center' }}>
                    <span className="mono">:{n}</span>
                    <input
                      type="text"
                      className="mono"
                      placeholder="example"
                      aria-label={`${n} example`}
                      value={d.example}
                      onChange={(e) => update({ example: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="description"
                      aria-label={`${n} description`}
                      value={d.description}
                      onChange={(e) => update({ description: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <ParamRows label="Query params" namePlaceholder="page" rows={f.query} onChange={(rows) => set('query', rows)} error={errors.query} />
          <ParamRows
            label="Request headers"
            namePlaceholder="Authorization"
            rows={f.reqHeaders}
            onChange={(rows) => set('reqHeaders', rows)}
            error={errors.reqHeaders}
          />
          {hasReqBody && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row">
                <span className="label">Request body example (JSON)</span>
                <span className="spacer" />
                <button type="button" className="btn btn-sm" onClick={() => format('bodyExample')}>
                  Format
                </button>
              </div>
              <JsonEditor value={f.bodyExample} onChange={(v) => set('bodyExample', v)} invalid={!!errors.bodyExample} />
              {errors.bodyExample && <span className="error-text">{errors.bodyExample}</span>}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export default EndpointFields;
