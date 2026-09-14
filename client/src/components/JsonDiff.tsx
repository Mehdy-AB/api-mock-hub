import { diffLines } from 'diff';
import { useMemo } from 'react';
import { pretty } from '../util';

type Line = { kind: 'same' | 'add' | 'del'; text: string };
type Row = Line | { kind: 'gap'; count: number };

/** Hides long runs of unchanged lines, keeping `context` lines around each change. */
function collapse(lines: Line[], context: number): Row[] {
  const out: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'same') {
      out.push(lines[i++]);
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === 'same') j++;
    const run = lines.slice(i, j);
    const head = i === 0 ? 0 : context;
    const tail = j === lines.length ? 0 : context;
    if (run.length > head + tail + 1) {
      out.push(...run.slice(0, head), { kind: 'gap', count: run.length - head - tail }, ...run.slice(run.length - tail));
    } else {
      out.push(...run);
    }
    i = j;
  }
  return out;
}

export function JsonDiff({ before, after, context = 3 }: { before: unknown; after: unknown; context?: number }) {
  const rows = useMemo(() => {
    const a = before === undefined ? '' : `${pretty(before)}\n`;
    const b = after === undefined ? '' : `${pretty(after)}\n`;
    const lines: Line[] = [];
    for (const part of diffLines(a, b)) {
      const kind = part.added ? 'add' : part.removed ? 'del' : 'same';
      const texts = part.value.split('\n');
      if (texts[texts.length - 1] === '') texts.pop();
      for (const text of texts) lines.push({ kind, text });
    }
    return collapse(lines, context);
  }, [before, after, context]);

  if (!rows.some((r) => r.kind === 'add' || r.kind === 'del')) return <p className="muted">No differences.</p>;

  return (
    <div className="diff mono">
      {rows.map((r, i) =>
        r.kind === 'gap' ? (
          <div key={i} className="diff-gap">
            ⋯ {r.count} unchanged lines
          </div>
        ) : (
          <div key={i} className={`diff-line diff-${r.kind}`}>
            <span className="diff-sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</span>
            {r.text}
          </div>
        ),
      )}
    </div>
  );
}
