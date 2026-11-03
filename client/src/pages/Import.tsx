import { DragEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, ImportPreview, ImportResult } from '../api';
import { Money, Spinner } from '../components/ui';
import { plural, sentence, shortDate } from '../format';
import { useRefresh } from '../hooks';

const FIELD_LABEL: Record<string, string> = {
  kind: 'kind',
  customer_name: 'customer name',
  customer_email: 'customer email',
  invoice_ref: 'invoice ref',
  amount: 'amount',
  currency: 'currency',
  issue_date: 'issue date',
  due_date: 'due date',
  billing_day: 'billing day',
  amount_per_period: 'amount per period',
  recurring_start: 'recurring start',
};

export function ImportPage() {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'preview' | 'all' | 'valid_only'>();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { refresh } = useRefresh();

  async function choose(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    setBusy('preview');
    try {
      setPreview(await api.importPreview(f));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function commit(mode: 'all' | 'valid_only') {
    if (!file) return;
    setBusy(mode);
    setError(undefined);
    try {
      setResult(await api.importCommit(file, mode));
      setPreview(undefined);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  function reset() {
    setFile(undefined);
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    if (input.current) input.current.value = '';
    input.current?.click();
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    choose(e.dataTransfer.files[0]);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Import</h1>
          <p>Upload a CSV of invoices and recurring customers. You'll see every problem before anything is saved.</p>
        </div>
        <a className="btn" href={api.sampleCsvUrl}>
          Download sample CSV
        </a>
      </div>

      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => choose(e.target.files?.[0])} />

      {!preview && !result && (
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {busy === 'preview' ? (
            <div className="state-loading">
              <Spinner /> Checking {file?.name}…
            </div>
          ) : (
            <>
              <h3>Drop a CSV here, or click to choose a file</h3>
              <p className="muted small" style={{ margin: 0 }}>
                One row per invoice or recurring customer · up to 2 MB
              </p>
            </>
          )}
        </div>
      )}

      {!preview && !result && (
        <div className="panel panel-pad" style={{ marginTop: 16 }}>
          <span className="label">Expected columns</span>
          <p className="small chips" style={{ margin: '10px 0 10px' }}>
            {['kind', 'customer_name', 'customer_email', 'invoice_ref', 'amount', 'currency', 'issue_date', 'due_date', 'billing_day', 'amount_per_period', 'recurring_start'].map((c) => (
              <span key={c} className="code">
                {c}
              </span>
            ))}
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            <b>one_off</b> rows need an invoice ref, amount and issue/due dates. <b>recurring</b> rows need a billing day (1–28), amount per period and start date. Dates are YYYY-MM-DD.{' '}
            <a href={api.sampleCsvUrl}>Start from the sample</a>.
          </p>
        </div>
      )}

      {error && (
        <div className="inline-error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {preview && file && (
        <div className="cards">
          <div className="panel panel-pad">
            <div className="summary-row" style={{ justifyContent: 'space-between' }}>
              <div className="summary-row">
                <span className="result-line ok">✓ {plural(preview.validCount, 'row')} ready</span>
                {preview.errorCount > 0 && <span className="result-line bad">✕ {plural(preview.errorCount, 'row')} need fixing</span>}
                <span className="small muted">{file.name} · nothing saved yet</span>
              </div>
              <div className="btn-row">
                <button className="btn btn-quiet" onClick={reset} disabled={!!busy}>
                  Re-upload
                </button>
                <button className="btn" onClick={() => commit('valid_only')} disabled={!!busy || preview.validCount === 0 || preview.errorCount === 0}>
                  {busy === 'valid_only' ? <Spinner /> : null} Import valid rows only
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => commit('all')}
                  disabled={!!busy || preview.errorCount > 0 || preview.validCount === 0}
                  title={preview.errorCount > 0 ? 'Fix the rows below, or import the valid rows only' : undefined}
                >
                  {busy === 'all' ? <Spinner /> : null} Import all
                </button>
              </div>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <section>
              <div className="section-head">
                <h2>Rows that need fixing</h2>
                <span className="small muted">Row numbers match your spreadsheet (the header is row 1)</span>
              </div>
              <div className="panel table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="right" style={{ width: 80 }}>
                        Row
                      </th>
                      <th style={{ width: 200 }}>Field</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((e, i) => (
                      <tr key={`${e.row}-${e.field}-${i}`}>
                        <td className="right num strong">{e.row}</td>
                        <td>
                          <span className="code">{FIELD_LABEL[e.field] ?? e.field}</span>
                        </td>
                        <td style={{ color: 'var(--high-ink)' }}>{sentence(e.message)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {preview.valid.length > 0 && (
            <section>
              <div className="section-head">
                <h2>Ready to import</h2>
              </div>
              <div className="panel table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="right" style={{ width: 80 }}>
                        Row
                      </th>
                      <th>Customer</th>
                      <th>Type</th>
                      <th>Details</th>
                      <th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.valid.map((r) => (
                      <tr key={r.row}>
                        <td className="right num faint">{r.row}</td>
                        <td>
                          <div className="strong">{r.customer_name}</div>
                          <div className="small muted">{r.customer_email}</div>
                        </td>
                        <td>{r.kind === 'recurring' ? 'Recurring' : 'Invoice'}</td>
                        <td className="muted">
                          {r.kind === 'recurring'
                            ? `Day ${r.billing_day} each month, from ${shortDate(String(r.recurring_start))}`
                            : `${r.invoice_ref} · due ${shortDate(String(r.due_date))}`}
                        </td>
                        <td className="right">
                          <Money amount={Number(r.kind === 'recurring' ? r.amount_per_period : r.amount)} currency={String(r.currency)} />
                          {r.kind === 'recurring' && <span className="small faint"> /mo</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {result && (
        <div className="panel panel-pad">
          <div className="inline-ok" style={{ marginBottom: 16 }}>
            Imported {plural(result.rowsImported, 'row')} in one go{result.rowsSkipped ? `, skipped ${plural(result.rowsSkipped, 'row')} with errors` : ''}.
          </div>
          <div className="facts" style={{ marginTop: 0 }}>
            <div>
              <span className="label">New customers</span>
              <span className="stat-value" style={{ fontSize: 26 }}>
                {result.customersCreated}
              </span>
            </div>
            <div>
              <span className="label">Updated customers</span>
              <span className="stat-value" style={{ fontSize: 26 }}>
                {result.customersUpdated}
              </span>
            </div>
            <div>
              <span className="label">New invoices</span>
              <span className="stat-value" style={{ fontSize: 26 }}>
                {result.invoicesCreated}
              </span>
            </div>
            <div>
              <span className="label">Recurring set up</span>
              <span className="stat-value" style={{ fontSize: 26 }}>
                {result.recurringCustomers}
              </span>
            </div>
          </div>
          {result.invoicesAlreadyExisting > 0 && <p className="small muted">{plural(result.invoicesAlreadyExisting, 'invoice was', 'invoices were')} already there and left unchanged.</p>}
          <div className="btn-row" style={{ marginTop: 18 }}>
            <Link className="btn btn-primary" to="/">
              Go to dashboard
            </Link>
            <button className="btn" onClick={reset}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </>
  );
}
