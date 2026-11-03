import { ReactNode, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { api, ApiError } from '../api';
import { plural } from '../format';
import { useApi, useRefresh, useToast } from '../hooks';
import { Spinner } from './ui';

function Badge({ n, alert }: { n?: number; alert?: boolean }) {
  if (!n) return null;
  return (
    <span className={`count ${alert ? 'alert' : ''}`} aria-label={`${n} waiting`}>
      {n}
    </span>
  );
}

function RunChecksButton() {
  const [running, setRunning] = useState(false);
  const toast = useToast();
  const { refresh } = useRefresh();

  async function run() {
    setRunning(true);
    try {
      const s = await api.runNow();
      const parts = [
        plural(s.draftsCreated, 'new draft'),
        plural(s.repliesProcessed, 'reply', 'replies') + ' read',
        s.recurringCreated ? plural(s.recurringCreated, 'recurring invoice') + ' created' : '',
        s.promisesCleared ? plural(s.promisesCleared, 'broken promise') : '',
      ].filter(Boolean);
      toast(`Checks done: ${parts.join(' · ')}.`);
      if (s.errors.length) toast(`Some checks paused: ${s.errors.join('; ')}`, 'error');
      refresh();
    } catch (err) {
      toast(err instanceof ApiError && err.status === 409 ? 'Checks are already running — try again in a minute.' : (err as Error).message, 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <button className="btn btn-sm" onClick={run} disabled={running} title="Generate recurring invoices, draft due reminders and read new replies. Nothing is sent.">
      {running ? (
        <>
          <Spinner /> Running checks…
        </>
      ) : (
        'Run checks now'
      )}
    </button>
  );
}

export function Layout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const counts = useApi(api.counts);
  const c = counts.data;
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="wordmark">
            <span className="wordmark-mark" aria-hidden="true">
              ¢
            </span>
            Payment Reminder
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end className={link}>
              Dashboard
            </NavLink>
            <NavLink to="/customers" className={link}>
              Customers
            </NavLink>
            <NavLink to="/import" className={link}>
              Import
            </NavLink>
            <NavLink to="/drafts" className={link}>
              Drafts <Badge n={c?.drafts} alert={!!c?.failed} />
            </NavLink>
            <NavLink to="/replies" className={link}>
              Replies <Badge n={c?.repliesNew} alert={!!c?.repliesNeedingAttention} />
            </NavLink>
          </nav>
          <div className="topbar-actions">
            <RunChecksButton />
            <button className="btn btn-sm btn-quiet" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
