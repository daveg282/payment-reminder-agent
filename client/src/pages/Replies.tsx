import { useState } from 'react';
import { Link } from 'react-router';
import { api, Reply, ReplyClass } from '../api';
import { ClassChip, CLASS_TEXT, Empty, ErrorState, Loading, Money, NEEDS_YOU, Spinner } from '../components/ui';
import { dateTime, localToday, plural, shortDate } from '../format';
import { useApi, useRefresh, useToast } from '../hooks';

type Choice = Exclude<ReplyClass, 'needs_review'>;
const CHOICES: Choice[] = ['promise_to_pay', 'dispute', 'already_paid', 'other'];

function ReplyCard({ reply }: { reply: Reply }) {
  const needsYou = NEEDS_YOU.includes(reply.classification);
  const [editing, setEditing] = useState(reply.classification === 'needs_review');
  const [cls, setCls] = useState<Choice>(reply.classification === 'needs_review' ? (reply.extracted_date ? 'promise_to_pay' : 'other') : (reply.classification as Choice));
  const [date, setDate] = useState(reply.extracted_date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();
  const { refresh } = useRefresh();

  async function submit(body: Parameters<typeof api.review>[1]) {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.review(reply.id, body);
      toast(r.promiseSet ? `Reminders paused until ${shortDate(r.reply.extracted_date!)}.` : 'Reply reviewed.');
      refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const effect: Record<ReplyClass, string> = {
    promise_to_pay: reply.promise_date ? `Reminders paused until ${shortDate(reply.promise_date)}.` : 'Reminders paused until the promised date.',
    dispute: 'Pending reminders were stopped. Sort it out with the customer; the agent will not reply.',
    already_paid: 'Pending reminders were stopped. Check your account, then mark the invoice paid.',
    needs_review: "The agent wasn't sure what this means, so nothing changed. Tell it what the reply says.",
    other: 'No change to the schedule.',
  };

  return (
    <article className={`panel ${needsYou ? 'needs-you' : ''}`}>
      <header className="card-head">
        <div>
          <div className="card-title">
            {reply.customer_id ? (
              <Link to={`/customers/${reply.customer_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {reply.customer_name}
              </Link>
            ) : (
              'Unknown sender'
            )}
          </div>
          <div className="card-meta">
            <span className="small muted">
              {reply.invoice_ref} · received {dateTime(reply.received_at)}
            </span>
            <ClassChip value={reply.classification} />
            {reply.extracted_date && <span className="badge badge-plain badge-accent">Date: {shortDate(reply.extracted_date)}</span>}
          </div>
        </div>
        {reply.amount != null && (
          <div className="amount-big">
            <Money amount={reply.amount} currency={reply.currency ?? 'USD'} />
          </div>
        )}
      </header>
      <div className="card-body">
        {needsYou && <span className="needs-you-label">● Needs you, the agent won't reply</span>}
        <blockquote className="quote">{reply.snippet}</blockquote>
        <span className="small muted">{effect[reply.classification]}</span>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="card-foot">
        {editing ? (
          <div className="review-form">
            <label className="field">
              <span>This reply is a…</span>
              <select className="select" value={cls} onChange={(e) => setCls(e.target.value as Choice)} disabled={busy}>
                {CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {CLASS_TEXT[c]}
                  </option>
                ))}
              </select>
            </label>
            {cls === 'promise_to_pay' && (
              <label className="field">
                <span>Promised payment date</span>
                <input className="input" type="date" min={localToday()} value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
              </label>
            )}
            <div className="btn-row">
              <button className="btn btn-primary" disabled={busy || (cls === 'promise_to_pay' && !date)} onClick={() => submit({ classification: cls, promise_date: cls === 'promise_to_pay' ? date : null })}>
                {busy ? <Spinner /> : null} Save
              </button>
              {reply.classification !== 'needs_review' && (
                <button className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <span className="small faint">Classified by Gemini · check it's right</span>
            <div className="btn-row">
              <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
                Change
              </button>
              <button className="btn btn-primary" onClick={() => submit({})} disabled={busy}>
                {busy ? <Spinner /> : null} Confirm
              </button>
            </div>
          </>
        )}
      </footer>
    </article>
  );
}

export function RepliesPage() {
  const [tab, setTab] = useState<'new' | 'reviewed'>('new');
  const replies = useApi(() => api.replies(tab), [tab]);
  const list = replies.data ?? [];
  const attention = list.filter((r) => NEEDS_YOU.includes(r.classification));
  const ordered = tab === 'new' ? [...attention, ...list.filter((r) => !NEEDS_YOU.includes(r.classification))] : list;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Replies</h1>
          <p>Customer replies to your reminders, read and classified. The agent never answers them for you.</p>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>
            New
          </button>
          <button role="tab" aria-selected={tab === 'reviewed'} className={tab === 'reviewed' ? 'on' : ''} onClick={() => setTab('reviewed')}>
            Reviewed
          </button>
        </div>
      </div>
      {tab === 'new' && attention.length > 0 && (
        <div className="banner error">
          <div>
            <strong>{plural(attention.length, 'reply needs', 'replies need')} you</strong>
            <span className="small">Disputes, “already paid” claims and unclear replies are never answered automatically.</span>
          </div>
        </div>
      )}
      {replies.error && !replies.data ? (
        <ErrorState error={replies.error} onRetry={replies.reload} />
      ) : !replies.data || replies.loading ? (
        <Loading rows={5} label="Loading replies" />
      ) : ordered.length === 0 ? (
        <div className="panel">
          <Empty title={tab === 'new' ? 'No new replies' : 'Nothing reviewed yet'}>
            {tab === 'new' ? 'When a customer answers a reminder, their reply shows up here after the next check.' : 'Replies you confirm or correct move here.'}
          </Empty>
        </div>
      ) : (
        <div className="cards">
          {ordered.map((r) => (
            <ReplyCard key={r.id} reply={r} />
          ))}
        </div>
      )}
    </>
  );
}
