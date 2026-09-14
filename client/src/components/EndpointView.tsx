import type { EndpointContent, MockResponse, ParamDoc, RequestDoc } from '../types';
import { exampleText, pretty } from '../util';
import { RequestLine } from './ReadableDiff';

export function HttpStatus({ status }: { status: number }) {
  return <span className={`http-status http-${String(status)[0]}`}>{status}</span>;
}

function ParamTable({ title, params }: { title: string; params?: ParamDoc[] }) {
  if (!params?.length) return null;
  return (
    <div>
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Example</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name}>
                <td className="mono">
                  {p.name}
                  {p.required && <span className="error-text" title="required"> *</span>}
                </td>
                <td className="mono">{exampleText(p.example)}</td>
                <td>{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ResponseView({ response }: { response: MockResponse }) {
  const headers = Object.entries(response.headers ?? {});
  return (
    <div className="stack">
      <div className="row">
        <span className="label">Status</span>
        <HttpStatus status={response.status} />
        {response.delayMs ? <span className="badge">delay {response.delayMs} ms</span> : null}
      </div>
      {headers.length > 0 && (
        <table className="table-plain mono">
          <tbody>
            {headers.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {response.body === undefined || response.body === null ? (
        <p className="muted">Empty body</p>
      ) : (
        <pre className="code">{pretty(response.body)}</pre>
      )}
    </div>
  );
}

/** The request written like the real call, with notes for documented params. */
export function RequestView({ method, path, request }: { method: string; path: string; request?: RequestDoc }) {
  const headers = request?.headers ?? [];
  const notes = [...(request?.params ?? []), ...(request?.query ?? []), ...headers].filter((p) => p.description);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <RequestLine method={method} path={path} query={request?.query} />
      {headers.length > 0 && (
        <div className="mono small tok-lines">
          {headers.map((h) => (
            <span key={h.name}>
              {h.name}
              {h.example !== undefined && (
                <>
                  : <span className="tok tok-plain">{exampleText(h.example)}</span>
                </>
              )}
              {h.required && <span className="error-text"> *</span>}
            </span>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="param-notes small">
          {notes.map((p) => (
            <li key={p.name}>
              <code>{p.name}</code> <span className="muted">{p.description}</span>
            </li>
          ))}
        </ul>
      )}
      {request?.bodyExample !== undefined && <pre className="code">{pretty(request.bodyExample)}</pre>}
    </div>
  );
}

/** Full-detail tables, kept for places that need every field. */
export function RequestTables({ request }: { request?: RequestDoc }) {
  if (!request) return null;
  return (
    <div className="stack">
      <ParamTable title="Path params" params={request.params} />
      <ParamTable title="Query params" params={request.query} />
      <ParamTable title="Headers" params={request.headers} />
    </div>
  );
}

export function EndpointSummary({ content }: { content: EndpointContent }) {
  return (
    <div className="stack">
      {(content.summary || content.tags.length > 0) && (
        <div className="row">
          {content.summary && <span>{content.summary}</span>}
          {content.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      )}
      {content.description && <p className="muted pre-wrap">{content.description}</p>}
      <ResponseView response={content.response} />
      <RequestView method={content.method} path={content.path} request={content.request} />
    </div>
  );
}
