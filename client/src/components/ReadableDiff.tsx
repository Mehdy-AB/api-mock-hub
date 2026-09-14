import type { ReactNode } from 'react';
import type { EndpointContent, ParamDoc } from '../types';
import { exampleText, pretty, sameJson } from '../util';
import { JsonDiff } from './JsonDiff';

/** same = unchanged, add = new (green), del = removed (red, struck), plain = live value (green, no diff) */
type TokState = 'same' | 'add' | 'del' | 'plain';
interface Tok {
  text: string;
  state: TokState;
}
type Entries = [key: string, text: string][];

/** Diffs keyed entries: new keys are green, removed keys red, changed values show old then new. */
function diffTokens(before: Entries | null, after: Entries | null): Tok[] {
  const b = new Map(before ?? []);
  const a = new Map(after ?? []);
  const out: Tok[] = [];
  for (const [key, text] of after ?? []) {
    if (before === null || !b.has(key)) out.push({ text, state: 'add' });
    else if (b.get(key) !== text) out.push({ text: b.get(key)!, state: 'del' }, { text, state: 'add' });
    else out.push({ text, state: 'same' });
  }
  for (const [key, text] of before ?? []) if (!a.has(key)) out.push({ text, state: 'del' });
  return out;
}

const queryEntries = (list?: ParamDoc[]): Entries =>
  (list ?? []).map((p) => [p.name, p.example === undefined ? p.name : `${p.name}=${exampleText(p.example)}`]);
const headerDocEntries = (list?: ParamDoc[]): Entries =>
  (list ?? []).map((p) => [p.name.toLowerCase(), p.example === undefined ? p.name : `${p.name}: ${exampleText(p.example)}`]);
const paramEntries = (list?: ParamDoc[]): Entries =>
  (list ?? []).map((p) => [p.name, p.example === undefined ? `:${p.name}` : `:${p.name} = ${exampleText(p.example)}`]);
const responseHeaderEntries = (h?: Record<string, string>): Entries =>
  Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), `${k}: ${v}`]);
const one = (key: string, value: unknown): Entries => (value === undefined || value === '' ? [] : [[key, String(value)]]);

function Toks({ toks, sep }: { toks: Tok[]; sep: string }) {
  return (
    <>
      {toks.map((t, i) => (
        <span key={i}>
          {i > 0 && <span className="tok-sep">{sep}</span>}
          <span className={`tok tok-${t.state}`}>{t.text}</span>
        </span>
      ))}
    </>
  );
}

/** A live request written like the real call: GET /users?page=1 with the query in green. */
export function RequestLine({ method, path, query }: { method: string; path: string; query?: ParamDoc[] }) {
  const toks = queryEntries(query).map(([, text]) => ({ text, state: 'plain' as const }));
  return (
    <div className="req-line mono">
      <span className={`m m-${method}`}>{method}</span> <span>{path}</span>
      {toks.length > 0 && (
        <>
          <span className="tok-q">?</span>
          <Toks toks={toks} sep="&" />
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rd-row">
      <div className="rd-label">{label}</div>
      <div className="rd-value">{children}</div>
    </div>
  );
}

/**
 * Human-readable view of one endpoint change.
 * before only = delete, after only = add, both = update (unchanged sections are hidden).
 */
export function ReadableDiff({ before, after }: { before?: EndpointContent; after?: EndpointContent }) {
  const b = before ?? null;
  const a = after ?? null;
  const isUpdate = !!b && !!a;
  const entries = (f: (e: EndpointContent) => Entries) => [b && f(b), a && f(a)] as const;

  /** Show a section when either side has a value and, for updates, the value changed. */
  const show = (pick: (e: EndpointContent) => unknown) => {
    const has = (e: EndpointContent | null) => {
      if (!e) return false;
      const v = pick(e);
      if (Array.isArray(v)) return v.length > 0;
      if (v && typeof v === 'object') return Object.keys(v).length > 0;
      return v !== undefined && v !== null && v !== '';
    };
    return (has(b) || has(a)) && (!isUpdate || !sameJson(pick(b!), pick(a!)));
  };

  const [qb, qa] = entries((e) => queryEntries(e.request?.query));
  const queryToks = diffTokens(qb, qa);

  return (
    <div className="readable-diff">
      <Row label="Request">
        <span className="mono">
          <Toks toks={diffTokens(...entries((e) => one('m', e.method)))} sep=" " />{' '}
          <Toks toks={diffTokens(...entries((e) => one('p', e.path)))} sep=" " />
          {queryToks.length > 0 && (
            <>
              <span className="tok-q">?</span>
              <Toks toks={queryToks} sep="&" />
            </>
          )}
        </span>
      </Row>

      {show((e) => e.request?.params) && (
        <Row label="Path params">
          <span className="mono">
            <Toks toks={diffTokens(...entries((e) => paramEntries(e.request?.params)))} sep="   " />
          </span>
        </Row>
      )}
      {show((e) => e.request?.headers) && (
        <Row label="Req headers">
          <span className="mono tok-lines">
            <Toks toks={diffTokens(...entries((e) => headerDocEntries(e.request?.headers)))} sep="" />
          </span>
        </Row>
      )}
      {show((e) => e.request?.bodyExample) && (
        <Row label="Req body">
          {isUpdate ? (
            <JsonDiff before={b!.request?.bodyExample} after={a!.request?.bodyExample} />
          ) : (
            <pre className={`code ${a ? 'code-add' : 'code-del'}`}>{pretty((a ?? b)!.request?.bodyExample)}</pre>
          )}
        </Row>
      )}

      <Row label="Status">
        <span className="mono">
          <Toks toks={diffTokens(...entries((e) => one('s', e.response.status)))} sep=" " />
          {show((e) => e.response.delayMs) && (
            <>
              <span className="tok-sep"> · delay </span>
              <Toks toks={diffTokens(...entries((e) => one('d', e.response.delayMs ? `${e.response.delayMs} ms` : '0 ms')))} sep=" " />
            </>
          )}
        </span>
      </Row>
      {show((e) => e.response.headers) && (
        <Row label="Headers">
          <span className="mono tok-lines">
            <Toks toks={diffTokens(...entries((e) => responseHeaderEntries(e.response.headers)))} sep="" />
          </span>
        </Row>
      )}
      {a && show((e) => e.response.body) && (
        <Row label="Body">
          {isUpdate ? (
            <JsonDiff before={b!.response.body} after={a.response.body} />
          ) : (
            <pre className="code">{pretty(a.response.body)}</pre>
          )}
        </Row>
      )}

      {show((e) => e.summary) && (
        <Row label="Summary">
          <Toks toks={diffTokens(...entries((e) => one('s', e.summary)))} sep=" " />
        </Row>
      )}
      {show((e) => e.tags) && (
        <Row label="Tags">
          <Toks toks={diffTokens(...entries((e) => e.tags.map((t) => [t, t])))} sep=" " />
        </Row>
      )}
      {show((e) => e.description) && (
        <Row label="Description">
          <span className="pre-wrap">
            <Toks toks={diffTokens(...entries((e) => one('d', e.description)))} sep=" " />
          </span>
        </Row>
      )}
      {!a && <p className="muted small" style={{ margin: '4px 0 0' }}>This endpoint will be removed.</p>}
    </div>
  );
}
