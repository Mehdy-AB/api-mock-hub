import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useUser } from '../auth';
import { Empty, ErrorBox, Field, Loading } from '../components/Common';
import { useAsync } from '../hooks';
import { useToast } from '../toast';
import { AuthUser, ProposalKind, Role, ROLES, Settings, User } from '../types';
import { errorText, formatDate } from '../util';

export function AdminPage() {
  const user = useUser();
  if (user.role !== 'admin') return <Empty title="Admins only" />;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="muted">Approval rules and team accounts.</p>
        </div>
      </div>
      <SettingsCard />
      <UsersCard me={user} />
    </div>
  );
}

function SettingsCard() {
  const s = useAsync(() => api.settings(), []);
  if (s.error) return <ErrorBox error={s.error} onRetry={s.reload} />;
  if (!s.data) return <Loading />;
  return <SettingsForm key={JSON.stringify(s.data)} initial={s.data} onSaved={s.setData} />;
}

function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: (s: Settings) => void }) {
  const toast = useToast();
  const [v, setV] = useState<Settings>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const setRole = (kind: ProposalKind, role: string) =>
    setV({ ...v, requiredApproverRole: { ...v.requiredApproverRole, [kind]: (role || null) as Role | null } });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await api.updateSettings(v);
      toast('Settings saved');
      onSaved(next);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>Approval rules</h2>
      {error != null && <ErrorBox error={error} />}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={v.allowDirectCommits}
          onChange={(e) => setV({ ...v, allowDirectCommits: e.target.checked })}
        />
        Save on the API page goes live at once (teammates can discard the commit)
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        Turn this off to make Save create a proposal that needs approval first. Imports always create proposals.
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={v.requireApproval} onChange={(e) => setV({ ...v, requireApproval: e.target.checked })} />
        Require approval before changes go live
      </label>
      <div className="form-row-3">
        <Field label="Approvals needed">
          <input
            type="number"
            min={1}
            max={20}
            disabled={!v.requireApproval}
            value={v.minApprovals}
            onChange={(e) => setV({ ...v, minApprovals: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
        <Field label="Contracts approved by" hint="Proposals of kind “contract”">
          <select value={v.requiredApproverRole.publish ?? ''} onChange={(e) => setRole('publish', e.target.value)}>
            <option value="">Anyone</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Requests approved by" hint="Proposals of kind “request”">
          <select value={v.requiredApproverRole.request ?? ''} onChange={(e) => setRole('request', e.target.value)}>
            <option value="">Anyone</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={v.approverMustDiffer}
          onChange={(e) => setV({ ...v, approverMustDiffer: e.target.checked })}
        />
        Authors cannot approve their own proposals (admins still can)
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        Admins can always approve, including their own proposals. A typical setup: contracts approved by frontend, requests approved by backend.
      </p>
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save rules
        </button>
      </div>
    </form>
  );
}

function UsersCard({ me }: { me: AuthUser }) {
  const toast = useToast();
  const users = useAsync(() => api.users(), []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('frontend');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await api.createUser(username.trim(), password, role);
      toast(`Created ${u.username}. Share the password with them privately.`);
      setUsername('');
      setPassword('');
      users.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (u: User, change: { role?: Role; password?: string; disabled?: boolean }, message: string) => {
    try {
      await api.updateUser(u.id, change);
      toast(message);
    } catch (err) {
      toast(errorText(err), 'error');
    }
    users.reload();
  };

  const resetPassword = (u: User) => {
    const pw = window.prompt(`New password for ${u.username} (at least 6 characters)`);
    if (pw) patch(u, { password: pw }, `Password changed for ${u.username}`);
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Team</h2>
      {users.error ? (
        <ErrorBox error={users.error} onRetry={users.reload} />
      ) : !users.data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    {u.id === me.id && <span className="muted"> (you)</span>}
                  </td>
                  <td>
                    <select
                      value={u.role}
                      aria-label={`Role of ${u.username}`}
                      onChange={(e) => patch(u, { role: e.target.value as Role }, `${u.username} is now ${e.target.value}`)}
                    >
                      {ROLES.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td>{u.disabled ? <span className="badge status-rejected">disabled</span> : <span className="badge badge-ok">active</span>}</td>
                  <td className="muted nowrap">{formatDate(u.createdAt)}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button type="button" className="btn btn-sm" onClick={() => resetPassword(u)}>
                        Reset password
                      </button>
                      {u.id !== me.id && (
                        <button
                          type="button"
                          className={`btn btn-sm${u.disabled ? '' : ' btn-danger'}`}
                          onClick={() =>
                            patch(u, { disabled: !u.disabled }, `${u.username} ${u.disabled ? 'enabled' : 'disabled'}`)
                          }
                        >
                          {u.disabled ? 'Enable' : 'Disable'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="stack" onSubmit={create}>
        <h3 style={{ margin: 0 }}>Add a team member</h3>
        {error != null && <ErrorBox error={error} />}
        <div className="form-row-3">
          <Field label="Username" hint="Letters, digits, dot, dash, underscore">
            <input type="text" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Password" hint="At least 6 characters">
            <input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy || username.trim().length < 2 || password.length < 6}>
            Create account
          </button>
        </div>
      </form>
    </div>
  );
}
