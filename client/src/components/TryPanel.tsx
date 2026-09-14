import { useState } from 'react';
import type { Endpoint } from '../types';
import { errorText, exampleText, paramNames, pretty } from '../util';
import { Field } from './Common';
import { HttpStatus } from './EndpointView';

interface Result {
  status: number;
  statusText: string;
  ms: number;
  headers: [string, string][];
  body: string;
  error?: string;
}

const KEY_STORAGE = 'mockhub.mockKey';

function buildPath(path: string, params: Record<string, string>): string {
  return path.replace(/([:*])([A-Za-z_$][\w$]*)/g, (_, kind: string, name: string) => {
    const v = params[name] ?? '';
    return kind === ':' ? encodeURIComponent(v) : v.split('/').map(encodeURIComponent).join('/');
  });
}

/** Sends a real request to the live mock from the browser. */
export function TryPanel({ endpoint }: { endpoint: Endpoint }) {
  const names = paramNames(endpoint.path);
  const hasBody = endpoint.method !== 'GET' && endpoint.method !== 'HEAD';

  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      names.map((n) => {
        const ex = exampleText(endpoint.request?.params?.find((p) => p.name === n)?.example);
        return [n, ex || (/id$/i.test(n) ? '1' : 'value')];
      }),
    ),
  );
  const [query, setQuery] = useState(() =>
    (endpoint.request?.query ?? [])
      .filter((q) => q.example !== undefined)
      .map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(exampleText(q.example))}`)
      .join('&'),
  );
  const [body, setBody] = useState(() => pretty(endpoint.request?.bodyExample));
  const [mockKey, setMockKey] = useState(() => {
    try {
      return localStorage.getItem(KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const q = query.trim().replace(/^\?/, '');
  const url = buildPath(endpoint.path, params) + (q ? `?${q}` : '');
  const sendBody = hasBody && body.trim() ? body : undefined;

  const send = async () => {
    setBusy(true);
    const started = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (sendBody) headers['Content-Type'] = 'application/json';
      if (mockKey) headers['x-mock-key'] = mockKey;
      const res = await fetch(url, { method: endpoint.method, headers, body: sendBody });
      const text = endpoint.method === 'HEAD' ? '' : await res.text();
      let shown = text;
      try {
        if (text) shown = pretty(JSON.parse(text));
      } catch {
        /* not JSON: show as-is */
      }
      setResult({
        status: res.status,
        statusText: res.statusText,
        ms: Math.round(performance.now() - started),
        headers: [...res.headers.entries()],
        body: shown,
      });
    } catch (e) {
      setResult({ status: 0, statusText: 'Network error', ms: 0, headers: [], body: '', error: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveKey = (v: string) => {
    setMockKey(v);
    try {
      localStorage.setItem(KEY_STORAGE, v);
    } catch {
      /* ignore */
    }
  };

  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const curl = [
    `curl -i -X ${endpoint.method} ${quote(`${window.location.origin}${url}`)}`,
    sendBody ? ` -H 'Content-Type: application/json' -d ${quote(sendBody.replace(/\s*\n\s*/g, ' '))}` : '',
    mockKey ? ` -H ${quote(`x-mock-key: ${mockKey}`)}` : '',
  ].join('');

  return (
    <div className="card stack">
      <div className="card-head">
        <h2>Try it</h2>
        <span className="muted small">Calls the live mock from your browser</span>
      </div>
      {names.length > 0 && (
        <div className="form-row-3">
          {names.map((n) => (
            <Field key={n} label={`:${n}`}>
              <input
                type="text"
                className="mono"
                value={params[n] ?? ''}
                onChange={(e) => setParams({ ...params, [n]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      )}
      <Field label="Query string" hint="For example page=1&size=20">
        <input type="text" className="mono" value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      {hasBody && (
        <Field label="Request body">
          <textarea className="mono" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      )}
      <details>
        <summary className="small">Mock API key</summary>
        <div style={{ marginTop: 6 }}>
          <input
            type="text"
            className="mono"
            placeholder="Only needed if the server sets MOCK_API_KEY"
            value={mockKey}
            onChange={(e) => saveKey(e.target.value)}
          />
        </div>
      </details>
      <div className="try-url">
        {endpoint.method} {window.location.origin}
        {url}
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </div>

      {result && (
        <div className="stack">
          <div className="try-result-head">
            <HttpStatus status={result.status} />
            <span>{result.statusText}</span>
            <span className="muted small">{result.ms} ms</span>
          </div>
          {result.error && <div className="banner banner-error">{result.error}</div>}
          {result.headers.length > 0 && (
            <details>
              <summary className="small">Response headers ({result.headers.length})</summary>
              <table className="table-plain mono small" style={{ marginTop: 6 }}>
                <tbody>
                  {result.headers.map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {result.body ? <pre className="code">{result.body}</pre> : !result.error && <p className="muted">Empty body</p>}
        </div>
      )}

      <details>
        <summary className="small">curl</summary>
        <pre className="code" style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {curl}
        </pre>
      </details>
    </div>
  );
}
