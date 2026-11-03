import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, CustomerDetail } from '../api';
import { ClassChip, Empty, ErrorState, Loading, Money, ReminderStatusChip, RiskBadge, Spinner, ToneChip } from '../components/ui';
import { dateTime, daysBetween, localToday, money, sentence, shortDate } from '../format';
import { useApi, useRefresh, useToast } from '../hooks';

type Inv = CustomerDetail['invoices'][number];

function InvoiceStatus({ inv }: { inv: Inv }) {
  if (inv.status === 'paid') return <span className="badge badge-low">Paid {inv.paid_date ? shortDate(inv.paid_date) : ''}</span>;
  if (inv.status === 'void') return <span className="badge badge-neutral">Void</span>;
  const late = daysBetween(inv.due_date, localToday());
  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
      {late > 0 ? <span className="badge badge-high">{late} days overdue</span> : <span className="badge badge-accent">Open</span>}
      {inv.promise_date && <span className="small muted">Promised {shortDate(inv.promise_date)}</span>}
    </div>
  );
}

function MarkPaid({ inv }: { inv: Inv }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { refresh } = useRefresh();

  if (inv.status !== 'open') return null;
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Mark paid
      </button>
    );

  async function save() {
    setBusy(true);
    try {
      const r = await api.markPaid(inv.id, date);
      toast(`${inv.invoice_ref} marked paid${r.remindersSkipped ? ` · ${r.remindersSkipped} pending reminder${r.remindersSkipped > 1 ? 's' : ''} cancelled` : ''}.`);
      refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
      <input className="input" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} style={{ width: 150, height: 30, padding: '2px 8px' }} aria-label="Paid on" />
      <button className="btn btn-sm btn-primary" onClick={save} disabled={busy || !date}>
        {busy ? <Spinner /> : 'Confirm'}
      </button>
      <button className="btn btn-sm btn-quiet" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const customer = useApi(() => api.customer(id), [id]);

  if (customer.error && !customer.data) {
    if (customer.error.status === 404)
      return (
        <div className="panel">
          <Empty title="Customer not found" action={<Link className="btn" to="/customers">Back to customers</Link>} />
        </div>
      );
    return <ErrorState error={customer.error} onRetry={customer.reload} />;
  }
  if (!customer.data) return <Loading rows={6} label="Loading customer" />;
  const c = customer.data;
  const open = c.invoices.filter((i) => i.status === 'open');
  const openTotal = open.reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <Link to="/customers" className="back">
        ← Customers
      </Link>
      <div className="panel panel-pad">
        <div className="detail-head">
          <div>
            <h1>{c.name}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {c.email}
            </p>
          </div>
          <div style={{ display: 'grid', gap: 6, justifyItems: 'end', maxWidth: 420 }}>
            <RiskBadge label={c.risk.label} reason={c.risk.reason} />
            <span className="small muted" style={{ textAlign: 'right' }}>
              {sentence(c.risk.reason)}
            </span>
          </div>
        </div>
        <div className="facts">
          <div>
            <span className="label">Open</span>
            <span className="num" style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600 }}>
              {money(openTotal, c.currency)}
            </span>
          </div>
          <div>
            <span className="label">Type</span>
            <span>{c.kind === 'recurring' ? 'Recurring' : 'One-off'}</span>
          </div>
          {c.kind === 'recurring' && (
            <div>
              <span className="label">Billing</span>
              <span className="num">
                {money(c.amount_per_period ?? 0, c.currency)} on day {c.billing_day}, since {c.recurring_start && shortDate(c.recurring_start)}
              </span>
            </div>
          )}
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Invoices</h2>
          <span className="small muted">With the reminders sent for each</span>
        </div>
        <div className="panel table-wrap">
          {c.invoices.length === 0 ? (
            <Empty title="No invoices yet">{c.kind === 'recurring' ? 'Recurring invoices are created on each billing day when checks run.' : ''}</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th className="right">Amount</th>
                  <th>Status</th>
                  <th className="right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.invoices.map((inv) => (
                  <Fragment key={inv.id}>
                    <tr>
                      <td className="strong">{inv.invoice_ref}</td>
                      <td className="muted num">{shortDate(inv.issue_date)}</td>
                      <td className="num">{shortDate(inv.due_date)}</td>
                      <td className="right">
                        <Money amount={inv.amount} currency={inv.currency} />
                      </td>
                      <td>
                        <InvoiceStatus inv={inv} />
                      </td>
                      <td className="right">
                        <MarkPaid inv={inv} />
                      </td>
                    </tr>
                    {inv.reminders.length > 0 && (
                      <tr className="sub">
                        <td colSpan={6}>
                          <div className="history">
                            <span className="label" style={{ marginRight: 4 }}>
                              Reminders
                            </span>
                            {inv.reminders.map((r) => (
                              <span key={r.id} className="history" style={{ gap: 6, marginRight: 14 }}>
                                <span className="strong">Stage {r.stage}</span>
                                <ToneChip tone={r.tone} />
                                <ReminderStatusChip status={r.status} />
                                {r.sent_at && <span className="muted">{dateTime(r.sent_at)}</span>}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Replies</h2>
          <Link to="/replies" className="small">
            Review replies →
          </Link>
        </div>
        <div className="panel">
          {c.replies.length === 0 ? (
            <Empty title="No replies yet">Replies to the reminders you send appear here.</Empty>
          ) : (
            <ul className="list">
              {c.replies.map((r) => (
                <li key={r.id} style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div className="history">
                      <ClassChip value={r.classification} />
                      {r.extracted_date && <span className="small">for {shortDate(r.extracted_date)}</span>}
                      <span className="small faint">
                        {r.invoice_ref} · {dateTime(r.received_at)}
                      </span>
                    </div>
                    <span className="muted">“{r.snippet}”</span>
                  </div>
                  {r.status === 'reviewed' ? <span className="small faint">Reviewed</span> : <span className="small">New</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
