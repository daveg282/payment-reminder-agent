import { FormEvent, useState } from 'react';
import { api } from '../api';
import { Spinner } from '../components/ui';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.login(password);
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message === 'wrong password' ? 'That password is not right.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <aside className="login-aside">
        <span className="wordmark">
          <span className="wordmark-mark" aria-hidden="true">
            ¢
          </span>
          Payment Reminder
        </span>
        <div>
          <h1>Get paid without the awkward follow-ups.</h1>
          <ul className="login-points">
            <li>Drafts each reminder at the right firmness</li>
            <li>Nothing is sent until you approve it</li>
            <li>Reads replies and pauses when a customer promises to pay</li>
          </ul>
        </div>
        <p className="small">Single-user workspace.</p>
      </aside>
      <main className="login-main">
        <form className="login-form" onSubmit={submit}>
          <div>
            <h2>Sign in</h2>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Enter your workspace password.
            </p>
          </div>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy || !password}>
            {busy ? (
              <>
                <Spinner /> Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
