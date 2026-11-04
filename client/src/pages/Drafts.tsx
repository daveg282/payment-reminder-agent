import { useEffect, useState } from 'react';
import { api, Reminder } from '../api';
import { Empty, ErrorState, Loading, Money, ReminderStatusChip, RiskBadge, Spinner, ToneChip } from '../components/ui';
import { dateTime, plural, shortDate } from '../format';
import { useApi, useRefresh, useToast } from '../hooks';

const STAGE_TEXT: Record<number, string> = { 1: 'Before due', 2: 'Just overdue', 3: 'One week late', 4: 'Two weeks late' };

function DraftCard({ initial }: { initial: Reminder }) {
  const [r, setR] = useState(initial);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'save' | 'send' | 'skip'>();
  const [error, setError] = useState<string>();
  const toast = useToast();
  const { refresh } = useRefresh();

  useEffect(() => setR(initial), [initial]);
  // The edit/approve/skip endpoints return the bare reminder row; keep the customer, invoice and risk we already have.
  const merge = (updated: Partial<Reminder>) => setR((prev) => ({ ...prev, ...updated, customer: prev.customer, invoice: prev.invoice, risk: prev.risk }));
  const dirty = subject !== r.subject || body !== r.body;
  const editable = r.status === 'draft';

  async function save() {
    setBusy('save');
    setError(undefined);
    try {
      merge(await api.updateReminder(r.id, subject.trim(), body.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function send() {
    setBusy('send');
    setError(undefined);
    try {
      if (dirty && editable) await api.updateReminder(r.id, subject.trim(), body.trim());
      const sent = await api.approve(r.id);
      merge(sent);
      toast(`Sent to ${r.customer.email}.`);
      refresh();
    } catch (err) {
      const body = (err as { body?: Reminder }).body;
      if (body?.status === 'failed') merge(body); // the send failed; show Retry
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
      setConfirming(false);
    }
  }

  async function skip() {
    setBusy('skip');
    try {
      merge(await api.skip(r.id));
      toast(`Skipped stage ${r.stage} for ${r.invoice.invoice_ref}.`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <article className="panel">
      <header className="card-head">
        <div>
          <div className="card-title">{r.customer.name}</div>
          <div className="card-meta">
            <span className="muted small">
              {r.invoice.invoice_ref} · due {shortDate(r.invoice.due_date)}
            </span>
            <span className="badge badge-plain badge-neutral">
              Stage {r.stage} of 4 · {STAGE_TEXT[r.stage]}
            </span>
            <ToneChip tone={r.tone} />
            <RiskBadge label={r.risk.label} reason={r.risk.reason} />
            {r.status !== 'draft' && <ReminderStatusChip status={r.status} />}
          </div>
        </div>
        <div className="amount-big">
          <Money amount={r.invoice.amount} currency={r.invoice.currency} />
        </div>
      </header>

      {r.status === 'sent' || r.status === 'skipped' ? (
        <div className="card-body">
          <div className={r.status === 'sent' ? 'inline-ok' : 'small muted'}>
            {r.status === 'sent' ? `Sent to ${r.customer.email}${r.sent_at ? ` at ${dateTime(r.sent_at)}` : ''}. Replies will be read on the next check.` : 'Skipped — this stage will not be sent.'}
          </div>
        </div>
      ) : (
        <>
          <div className="card-body">
            <div className="envelope">
              To <b>{r.customer.name}</b> &lt;{r.customer.email}&gt;
            </div>
            <label className="field">
              <span>Subject</span>
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable || !!busy} />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable || !!busy} rows={10} />
            </label>
            {r.status === 'failed' && (
              <div className="inline-error" role="alert">
                Sending failed: {r.error ?? 'unknown error'}. Check the Gmail connection, then retry.
              </div>
            )}
            {error && r.status !== 'failed' && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
          </div>
          <footer className="card-foot">
            <span className="small faint">{r.drafted_by === 'ai' ? 'Drafted by Gemini' : 'Drafted from the standard template'} · review before sending</span>
            {confirming ? (
              <div className="confirm">
                Send this to {r.customer.email} now?
                <button className="btn btn-sm btn-primary" onClick={send} disabled={!!busy}>
                  {busy === 'send' ? (
                    <>
                      <Spinner /> Sending…
                    </>
                  ) : (
                    'Yes, send'
                  )}
                </button>
                <button className="btn btn-sm btn-quiet" onClick={() => setConfirming(false)} disabled={!!busy}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="btn-row">
                {dirty && editable && (
                  <button className="btn btn-quiet" onClick={save} disabled={!!busy || !subject.trim() || !body.trim()}>
                    {busy === 'save' ? <Spinner /> : null} Save changes
                  </button>
                )}
                <button className="btn" onClick={skip} disabled={!!busy}>
                  {busy === 'skip' ? <Spinner /> : null} Skip
                </button>
                <button className="btn btn-primary" onClick={() => setConfirming(true)} disabled={!!busy || r.status === 'approved' || !subject.trim() || !body.trim()}>
                  {r.status === 'failed' ? 'Retry send' : 'Approve & send'}
                </button>
              </div>
            )}
          </footer>
        </>
      )}
    </article>
  );
}

export function DraftsPage() {
  const reminders = useApi(api.reminders);
  // Keep cards that were just sent/skipped visible until the next visit, so the user sees the outcome.
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const queue = (reminders.data ?? []).filter((r) => ['draft', 'approved', 'failed'].includes(r.status) || seen.has(r.id));

  useEffect(() => {
    if (!reminders.data) return;
    setSeen((s) => new Set([...s, ...reminders.data!.filter((r) => ['draft', 'approved', 'failed'].includes(r.status)).map((r) => r.id)]));
  }, [reminders.data]);

  const recent = (reminders.data ?? [])
    .filter((r) => r.status === 'sent' && !queue.includes(r))
    .sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? ''))
    .slice(0, 5);
  const pending = queue.filter((r) => r.status !== 'sent' && r.status !== 'skipped').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Drafts</h1>
          <p>Every reminder waits here for you. Nothing is emailed until you approve it.</p>
        </div>
        {reminders.data && pending > 0 && <span className="badge badge-accent badge-plain">{plural(pending, 'draft')} waiting</span>}
      </div>
      {reminders.error && !reminders.data ? (
        <ErrorState error={reminders.error} onRetry={reminders.reload} />
      ) : !reminders.data ? (
        <Loading rows={6} label="Loading drafts" />
      ) : queue.length === 0 ? (
        <div className="panel">
          <Empty title="No drafts waiting">
            Drafts appear here when a reminder is due — 3 days before the due date, then 1, 7 and 14 days after. Use “Run checks now” to look right away.
          </Empty>
        </div>
      ) : (
        <div className="cards">
          {queue.map((r) => (
            <DraftCard key={r.id} initial={r} />
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Recently sent</h2>
          </div>
          <div className="panel table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Reminder</th>
                  <th>Subject</th>
                  <th className="right">Sent</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="strong">{r.customer.name}</td>
                    <td className="muted">{r.invoice.invoice_ref}</td>
                    <td>
                      <span className="history">
                        Stage {r.stage} <ToneChip tone={r.tone} />
                      </span>
                    </td>
                    <td className="muted">{r.subject}</td>
                    <td className="right num muted">{r.sent_at && dateTime(r.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
