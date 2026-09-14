import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { Field } from '../components/Common';
import { errorText } from '../util';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login stack" onSubmit={submit}>
        <div>
          <h1>🧩 API Mock Hub</h1>
          <p className="muted">Shared mock API for frontend and backend teams.</p>
        </div>
        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}
        <Field label="Username">
          <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </Field>
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || !username || !password}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="muted small">
          No account? Ask your admin. Live mocks are open at <a href="/_hub/docs/">Swagger</a>.
        </p>
      </form>
    </div>
  );
}
