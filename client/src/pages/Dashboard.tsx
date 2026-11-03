import { Link, useNavigate } from 'react-router';
import { api, BucketName, Buckets, Dashboard } from '../api';
import { Empty, ErrorState, Loading, Money, RiskBadge } from '../components/ui';
import { dayOfMonth, longDate, money, monthShort, plural, weekdayDate } from '../format';
import { useApi } from '../hooks';

const BUCKETS: Array<{ key: BucketName; label: string; color: string }> = [
  { key: 'due_soon', label: 'Due within 7 days', color: '#a9c6d3' },
  { key: 'late_1_7', label: '1–7 days late', color: '#5b8ea5' },
  { key: 'late_8_30', label: '8–30 days late', color: '#1f5f7a' },
  { key: 'late_30_plus', label: '30+ days late', color: '#a1302a' },
];

function GoogleBanner() {
  const status = useApi(api.googleStatus);
  if (!status.data || status.data.connected) return null;
  return (
    <div className="banner warn">
      <div>
        <strong>Gmail isn't connected</strong>
        <span className="muted small">Connect the account reminders are sent from. Nothing is sent until you approve a draft.</span>
      </div>
      <a className="btn btn-primary" href={api.googleConnectUrl}>
        Connect Gmail
      </a>
    </div>
  );
}

/** One money figure, or one line per currency when they are mixed. */
function Figure({ d, pick }: { d: Dashboard; pick: (t: Dashboard['byCurrency'][number]) => number }) {
  if (d.byCurrency.length <= 1) return <div className="stat-value">{money(d.byCurrency[0] ? pick(d.byCurrency[0]) : 0, d.currency ?? 'USD')}</div>;
  return (
    <div className="stat-value multi">
      {d.byCurrency.map((t) => (
        <span key={t.currency}>{money(pick(t), t.currency)}</span>
      ))}
    </div>
  );
}

function AgingBar({ buckets, currency }: { buckets: Buckets; currency: string }) {
  const total = BUCKETS.reduce((sum, b) => sum + buckets[b.key].amount, 0);
  return (
    <div className="aging-currency">
      <div className="aging-bar" role="img" aria-label="Open invoices by age">
        {total > 0 &&
          BUCKETS.filter((b) => buckets[b.key].amount > 0).map((b) => (
            <span key={b.key} style={{ width: `${(buckets[b.key].amount / total) * 100}%`, background: b.color }} title={`${b.label}: ${money(buckets[b.key].amount, currency)}`} />
          ))}
      </div>
      <div className="aging-legend">
        {BUCKETS.map((b) => (
          <div className="aging-item" key={b.key}>
            <span className="label">
              <span className="swatch" style={{ background: b.color }} />
              {b.label}
            </span>
            <span className="amount">{money(buckets[b.key].amount, currency)}</span>
            <span className="small muted">{plural(buckets[b.key].count, 'invoice')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const dash = useApi(api.dashboard);
  const navigate = useNavigate();

  if (dash.error && !dash.data) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return <Loading rows={6} label="Loading dashboard" />;
  const d = dash.data;
  const hasOpen = d.byCurrency.length > 0;
  const mixed = d.byCurrency.length > 1;

  return (
    <>
      <GoogleBanner />
      <div className="page-head">
        <div>
          <span className="label">{longDate(d.today)}</span>
          <h1 style={{ marginTop: 6 }}>Overview</h1>
        </div>
        {mixed && <span className="badge badge-neutral badge-plain">Totals shown per currency</span>}
      </div>

      <div className="stats">
        <div className="panel stat">
          <span className="label">Total owed</span>
          <Figure d={d} pick={(t) => t.totalOwed} />
          <span className="stat-note">All open invoices</span>
        </div>
        <div className="panel stat">
          <span className="label">Overdue</span>
          <Figure d={d} pick={(t) => t.totalOverdue} />
          <span className="stat-note">Past the due date</span>
        </div>
        <div className="panel stat">
          <span className="label">Promises this week</span>
          <div className="stat-value">{d.promisesThisWeek.length}</div>
          <span className="stat-note">{d.promisesThisWeek.length ? 'Reminders paused until then' : 'None due in the next 7 days'}</span>
        </div>
        <Link to="/replies" className={`panel stat ${d.repliesNeedingAttention ? 'attention' : ''}`}>
          <span className="label">Replies needing you</span>
          <div className="stat-value">{d.repliesNeedingAttention}</div>
          <span className="stat-note">{d.repliesNeedingAttention ? 'Disputes or unclear replies →' : 'Nothing to review'}</span>
        </Link>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Aging</h2>
          <span className="small muted">Open invoices by how late they are</span>
        </div>
        <div className="panel panel-pad">
          {hasOpen ? (
            d.byCurrency.map((t) => (
              <div key={t.currency}>
                {mixed && <div className="label" style={{ marginBottom: 6 }}>{t.currency}</div>}
                <AgingBar buckets={t.buckets} currency={t.currency} />
              </div>
            ))
          ) : (
            <Empty title="Nothing owed right now" action={<Link className="btn" to="/import">Import invoices</Link>}>
              Import a CSV of invoices and the dashboard fills in.
            </Empty>
          )}
        </div>
      </section>

      <div className="grid-2 section">
        <section>
          <div className="section-head">
            <h2>Call first</h2>
            <span className="small muted">Largest overdue amounts</span>
          </div>
          <div className="panel">
            {d.callFirst.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Invoice</th>
                      <th className="right">Amount</th>
                      <th className="right">Days late</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.callFirst.map((r) => (
                      <tr key={`${r.customerId}-${r.invoiceRef}`} className="clickable" onClick={() => navigate(`/customers/${r.customerId}`)}>
                        <td className="strong">{r.name}</td>
                        <td className="muted">{r.invoiceRef}</td>
                        <td className="right">
                          <Money amount={r.amount} currency={r.currency} />
                        </td>
                        <td className="right num">{r.daysLate}</td>
                        <td>
                          <RiskBadge label={r.risk} reason={r.reason} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No overdue invoices">Everyone is paid up or not yet due.</Empty>
            )}
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2>Promises due this week</h2>
          </div>
          <div className="panel">
            {d.promisesThisWeek.length ? (
              <ul className="list">
                {d.promisesThisWeek.map((p) => (
                  <li key={`${p.customerId}-${p.invoiceRef}`}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                      <div className="date-tile" aria-label={weekdayDate(p.promiseDate)}>
                        <span className="m">{monthShort(p.promiseDate)}</span>
                        <span className="d">{dayOfMonth(p.promiseDate)}</span>
                      </div>
                      <div>
                        <Link to={`/customers/${p.customerId}`} className="strong" style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 600 }}>
                          {p.name}
                        </Link>
                        <div className="small muted">
                          {p.invoiceRef} · promised {weekdayDate(p.promiseDate)}
                        </div>
                      </div>
                    </div>
                    <Money amount={p.amount} currency={p.currency} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No promises this week">When a customer replies with a payment date, it shows up here.</Empty>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
