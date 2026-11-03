import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { Empty, ErrorState, Loading, Money, RiskCell } from '../components/ui';
import { plural } from '../format';
import { useApi } from '../hooks';

export function CustomersPage() {
  const customers = useApi(api.customers);
  const navigate = useNavigate();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>{customers.data ? `${plural(customers.data.length, 'customer')}, sorted by name. Click one for invoices and reminder history.` : 'Everyone who owes you money.'}</p>
        </div>
        <Link className="btn" to="/import">
          Import CSV
        </Link>
      </div>
      {customers.error && !customers.data ? (
        <ErrorState error={customers.error} onRetry={customers.reload} />
      ) : !customers.data ? (
        <Loading rows={5} label="Loading customers" />
      ) : customers.data.length === 0 ? (
        <div className="panel">
          <Empty title="No customers yet" action={<Link className="btn btn-primary" to="/import">Import a CSV</Link>}>
            Import your invoices and recurring customers to get started.
          </Empty>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Type</th>
                <th className="right">Open amount</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {customers.data.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                  <td className="strong">
                    <Link to={`/customers/${c.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {c.name}
                    </Link>
                  </td>
                  <td className="muted">{c.email}</td>
                  <td>{c.kind === 'recurring' ? `Recurring · day ${c.billing_day}` : 'One-off'}</td>
                  <td className="right">
                    {c.open_amount > 0 ? <Money amount={c.open_amount} currency={c.currency} /> : <span className="faint">—</span>}
                    {c.open_count > 1 && <div className="small faint">{c.open_count} invoices</div>}
                  </td>
                  <td>
                    <RiskCell label={c.risk.label} reason={c.risk.reason} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
