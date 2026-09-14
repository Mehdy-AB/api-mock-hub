import type { ReactNode } from 'react';
import { ApiError } from '../api';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const list = error instanceof ApiError ? error.errors : [];
  return (
    <div className="banner banner-error" role="alert">
      <strong>{error instanceof Error ? error.message : String(error)}</strong>
      {list.length > 0 && (
        <ul>
          {list.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {onRetry && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field${error ? ' invalid' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function NotFound() {
  return (
    <Empty title="Page not found">
      <a href="#/endpoints">Go to endpoints</a>
    </Empty>
  );
}
