import { useState } from 'react';
import { href } from '../router';
import type { Change } from '../types';
import { contentOf, splitRoute } from '../util';
import { ChangeTypeBadge, MethodBadge } from './Badges';
import { JsonDiff } from './JsonDiff';
import { ReadableDiff } from './ReadableDiff';

/** A change as stored on a proposal or commit. */
export function ChangeView({ change, conflicts = [] }: { change: Change; conflicts?: string[] }) {
  const [mode, setMode] = useState<'readable' | 'json'>('readable');
  const { method, path } = splitRoute(change.route);
  const before = change.before ? contentOf(change.before) : undefined;
  const after = change.type === 'delete' ? undefined : change.after;
  const versions =
    change.type === 'update'
      ? `v${change.baseVersion} → v${change.resultVersion ?? (change.baseVersion ?? 0) + 1}`
      : change.type === 'delete'
        ? `was v${change.baseVersion}`
        : '';

  return (
    <div className={`card change${conflicts.length ? ' has-warn' : ''}`}>
      <div className="change-head">
        <ChangeTypeBadge type={change.type} />
        <MethodBadge method={method} />
        <span className="mono">{path}</span>
        <span className="spacer" />
        {versions && <span className="muted small">{versions}</span>}
        {change.endpointId && change.type !== 'delete' && (
          <a className="small" href={href(`/endpoints/${change.endpointId}`)}>
            Open endpoint
          </a>
        )}
      </div>
      {conflicts.length > 0 && (
        <div className="banner banner-warn" style={{ marginBottom: 10 }}>
          {conflicts.map((c, i) => (
            <div key={i}>{c}</div>
          ))}
        </div>
      )}
      {change.type === 'update' && (
        <div className="tabs">
          <button type="button" className={mode === 'readable' ? 'active' : ''} onClick={() => setMode('readable')}>
            Changes
          </button>
          <button type="button" className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>
            Full JSON diff
          </button>
        </div>
      )}
      {mode === 'json' && change.type === 'update' ? (
        <JsonDiff before={before} after={after} />
      ) : (
        <ReadableDiff before={before} after={after} />
      )}
    </div>
  );
}
