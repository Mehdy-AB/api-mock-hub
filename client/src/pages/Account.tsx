import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useAuth, useUser } from '../auth';
import { ErrorBox, Field } from '../components/Common';
import { useToast } from '../toast';

export function AccountPage() {
  const user = useUser();
  const { logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      toast('Password changed');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 520 }}>
      <div className="page-head">
        <div>
          <h1>Account</h1>
          <p className="muted">
            Signed in as <strong>{user.username}</strong> ({user.role}).
          </p>
        </div>
        <button type="button" className="btn" onClick={logout}>
          Log out
        </button>
      </div>
      <form className="card stack" onSubmit={submit}>
        <h2 style={{ margin: 0 }}>Change password</h2>
        {error != null && <ErrorBox error={error} />}
        <Field label="Current password">
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 6 characters">
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Repeat new password" error={mismatch ? 'Passwords do not match' : undefined}>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy || !current || next.length < 6 || next !== confirm}>
            Change password
          </button>
        </div>
      </form>
    </div>
  );
}
