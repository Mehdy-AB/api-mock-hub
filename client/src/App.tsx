import { lazy, Suspense, useEffect } from 'react';
import { useAuth, useUser } from './auth';
import { ActivityPanel } from './components/ActivityPanel';
import { Loading, NotFound } from './components/Common';
import { hubStore, useHubData } from './data';
import { draftStore, useDraft } from './draft';
import { ApiPage } from './pages/Api';
import { DraftPage } from './pages/Draft';
import { LoginPage } from './pages/Login';
import { ProposalDetailPage } from './pages/ProposalDetail';
import { needsMyReview, ProposalsPage } from './pages/Proposals';
import { href, Route, useRoute } from './router';

// Loaded on demand; the API page loads the code editor itself when a row opens.
const EndpointEditorPage = lazy(() => import('./pages/EndpointEditor').then((m) => ({ default: m.EndpointEditorPage })));
const CommitPage = lazy(() => import('./pages/Commit').then((m) => ({ default: m.CommitPage })));
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })));
const AdminPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })));
const HistoryPage = lazy(() => import('./pages/History').then((m) => ({ default: m.HistoryPage })));
const AccountPage = lazy(() => import('./pages/Account').then((m) => ({ default: m.AccountPage })));

const REFRESH_MS = 15000;

function Header({ section }: { section?: string }) {
  const user = useUser();
  const draft = useDraft();
  const hub = useHubData();
  const n = draft.changes.length;
  // Everything happens on the API page; this jumps to the first proposal waiting for you.
  const toReview = hub.openProposals.filter((p) => needsMyReview(p, user));
  const onApi = section === undefined || section === 'endpoints';

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <a className="brand" href={href('/')}>
          🧩 Mock Hub
        </a>
        {!onApi && (
          <a className="btn btn-sm btn-ghost" href={href('/')}>
            ← Back to API
          </a>
        )}
        {toReview.length > 0 && (
          <a className="btn btn-sm btn-primary" href={href(`/?proposal=${toReview[toReview.length - 1].id}`)}>
            {toReview.length} to review
          </a>
        )}
        <span className="spacer" />
        <nav className="header-right" aria-label="More">
          <a className="btn btn-sm btn-ghost" href={href('/import')}>
            Import
          </a>
          {user.role === 'admin' && (
            <a className="btn btn-sm btn-ghost" href={href('/admin')}>
              Admin
            </a>
          )}
          <a className="btn btn-sm btn-ghost" href="/_hub/docs/" target="_blank" rel="noreferrer">
            Swagger
          </a>
          {n > 0 && (
            <a className="btn btn-sm btn-primary" href={href('/draft')}>
              Draft ({n})
            </a>
          )}
          <a className="btn btn-sm btn-ghost" href={href('/account')} title="Account">
            {user.username}
          </a>
        </nav>
      </div>
    </header>
  );
}

function Page({ route }: { route: Route }) {
  const [section, a, b] = route.segments;
  const q = route.query;
  switch (section) {
    case undefined:
      return <ApiPage key="api" focusProposal={Number(q.get('proposal')) || undefined} />;
    case 'endpoints':
      if (a === 'new') return <ApiPage key={`new?${q.toString()}`} newDefaults={{ method: q.get('method'), path: q.get('path') }} />;
      return a ? <ApiPage key={`focus:${a}`} focusId={a} /> : <ApiPage key="api" />;
    case 'commits':
      return a ? <CommitPage key={a} id={Number(a)} /> : <HistoryPage focus={null} />;
    case 'draft':
      if (a === 'edit' && b) return <EndpointEditorPage key={b} draftKey={b} />;
      return <DraftPage />;
    case 'proposals':
      return a ? <ProposalDetailPage key={a} id={Number(a)} /> : <ProposalsPage tab={q.get('tab')} />;
    case 'history':
      return <HistoryPage focus={Number(q.get('commit')) || null} />;
    case 'import':
      return <ImportPage />;
    case 'admin':
      return <AdminPage />;
    case 'account':
      return <AccountPage />;
    default:
      return <NotFound />;
  }
}

export function App() {
  const { user } = useAuth();
  const route = useRoute();

  if (user) draftStore.setOwner(user.username);

  useEffect(() => {
    if (!route.segments[1] || route.segments[0] !== 'endpoints') window.scrollTo(0, 0);
  }, [route.path]);

  // Keep the shared cache fresh while the tab is visible.
  useEffect(() => {
    if (!user) {
      hubStore.reset();
      return;
    }
    hubStore.refresh();
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') hubStore.refresh();
    };
    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [user?.id]);

  if (!user) return <LoginPage />;

  const [section, a] = route.segments;
  const endpointId = section === 'endpoints' && a && a !== 'new' ? a : undefined;
  const showActivity = section === undefined || section === 'endpoints' || section === 'commits';

  return (
    <>
      <Header section={section} />
      <div className={`shell${showActivity ? '' : ' no-activity'}`}>
        <main className="content">
          <div className="content-inner">
            <Suspense fallback={<Loading />}>
              <Page route={route} />
            </Suspense>
          </div>
        </main>
        {showActivity && (
          <aside className="sidebar sidebar-right" aria-label="Activity">
            <ActivityPanel endpointId={endpointId} />
          </aside>
        )}
      </div>
    </>
  );
}
