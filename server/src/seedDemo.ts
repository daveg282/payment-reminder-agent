// npm run seed:demo            → dry run: prints what would be written, writes nothing
// npm run seed:demo -- --yes   → replaces all customers/invoices/reminders/replies/job runs with the demo book
//                                (google_tokens is kept, so Gmail stays connected), then drafts due reminders
// Add --template-drafts to draft with the fixed templates instead of Gemini.
import 'dotenv/config';
import { getConfig, resetConfig } from './config';
import { closePool, getPool, withTransaction } from './db';
import { AgingInvoice, summarize } from './domain/aging';
import { todayIso } from './domain/dates';
import { firmerTone, scoreCustomer } from './domain/risk';
import { nextStageDue, STAGES } from './domain/stages';
import { buildDemoData, DEMO_CURRENCY, DemoCustomer, seededReminder } from './demo/demoData';
import { createDueDrafts } from './services/reminders';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: DEMO_CURRENCY }).format(n);

function plan(data: DemoCustomer[], today: string) {
  const invoices: AgingInvoice[] = data.flatMap((c) =>
    c.invoices.map((i) => ({ customer_id: c.email, invoice_ref: i.ref, amount: i.amount, currency: DEMO_CURRENCY, due_date: i.due_date, paid_date: i.paid_date, status: i.status, promise_date: i.promise_date })),
  );
  const replies = data.flatMap((c) => c.invoices.filter((i) => i.reply).map((i) => ({ status: 'new' as const, classification: i.reply!.classification })));
  const summary = summarize(invoices, data.map((c) => ({ id: c.email, name: c.name })), replies, today);
  const customers = data.map((c) => {
    const risk = scoreCustomer(c.invoices, today);
    const drafts = c.invoices
      .filter((i) => i.reply?.classification !== 'dispute') // an unreviewed dispute pauses drafts
      .map((i) => ({ i, next: nextStageDue(i, i.sentStages.map((stage) => ({ stage, status: 'sent' as const })), risk.label, today) }))
      .filter((x) => x.next)
      .map((x) => `${x.i.ref} stage ${x.next!.stage} ${x.next!.tone}`);
    return { c, risk, drafts };
  });
  return { summary, customers };
}

async function main() {
  const write = process.argv.includes('--yes');
  const liveEmail = process.env.DEMO_LIVE_EMAIL?.trim();
  if (!liveEmail) throw new Error('Set DEMO_LIVE_EMAIL in server/.env (the inbox you will reply from on camera).');
  const today = todayIso();
  const data = buildDemoData(today, liveEmail);
  const { summary, customers } = plan(data, today);
  const db = getPool();

  console.log(`\nDemo seed for ${today} — ${write ? 'WRITING' : 'DRY RUN (nothing is written)'}\n`);
  console.table(
    customers.map(({ c, risk, drafts }) => ({
      customer: c.name,
      type: c.kind === 'recurring' ? `recurring, day ${c.billing_day}` : 'one-off',
      invoices: `${c.invoices.filter((i) => i.status === 'open').length} open / ${c.invoices.length}`,
      open: money(c.invoices.filter((i) => i.status === 'open').reduce((s, i) => s + i.amount, 0)),
      risk: risk.label,
      reason: risk.reason,
      'drafts to create': drafts.join(', ') || '—',
    })),
  );
  console.log('Totals:', { owed: money(summary.totalOwed ?? 0), overdue: money(summary.totalOverdue ?? 0), currency: summary.currency });
  console.table(Object.fromEntries(Object.entries(summary.buckets).map(([k, v]) => [k, { count: v.count, amount: money(v.amount ?? 0) }])));
  console.log('Call first (top 3):', summary.callFirst.slice(0, 3).map((r) => `${r.name} ${r.invoiceRef} ${money(r.amount)} ${r.daysLate}d ${r.risk}`).join(' | '));
  console.log('Promises this week:', summary.promisesThisWeek.map((p) => `${p.name} ${p.invoiceRef} on ${p.promiseDate}`).join(' | ') || '—');
  console.log('Replies needing you:', summary.repliesNeedingAttention);
  console.log(`Live-demo customer: Juniper Events <${liveEmail}>`);

  const { rows: [now] } = await db.query(
    `select (select count(*) from customers)::int customers, (select count(*) from invoices)::int invoices, (select count(*) from reminders)::int reminders,
            (select count(*) from replies)::int replies, (select count(*) from job_runs)::int job_runs, (select email from google_tokens where id = 1) as google`,
  );
  console.log('\nCurrently in the database (will be REPLACED):', { customers: now.customers, invoices: now.invoices, reminders: now.reminders, replies: now.replies, job_runs: now.job_runs });
  console.log('Kept as-is: google_tokens', now.google ? `(connected as ${now.google})` : '(not connected)');

  if (!write) {
    console.log('\nDry run only. To write: npm run seed:demo -- --yes\n');
    return;
  }

  const senderName = getConfig().SENDER_NAME;
  await withTransaction(async (tx) => {
    await tx.query('delete from customers'); // cascades to invoices, reminders, replies
    await tx.query('delete from job_runs');
    for (const c of data) {
      const { rows: [cust] } = await tx.query(
        `insert into customers (name, email, kind, billing_day, amount_per_period, currency, recurring_start) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [c.name, c.email, c.kind, c.billing_day, c.amount_per_period, DEMO_CURRENCY, c.recurring_start],
      );
      const risk = scoreCustomer(c.invoices, today).label;
      for (const i of c.invoices) {
        const { rows: [inv] } = await tx.query(
          `insert into invoices (customer_id, invoice_ref, amount, currency, issue_date, due_date, paid_date, status, period, promise_date, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
          [cust.id, i.ref, i.amount, DEMO_CURRENCY, i.issue_date, i.due_date, i.paid_date, i.status, i.period, i.promise_date, i.source],
        );
        for (const stage of i.sentStages) {
          const tone = firmerTone(STAGES[stage - 1].tone, risk);
          const r = seededReminder(c, i, stage, tone, senderName);
          await tx.query(
            `insert into reminders (invoice_id, stage, tone, subject, body, status, sent_at, drafted_by) values ($1, $2, $3, $4, $5, 'sent', $6, 'template')`,
            [inv.id, stage, tone, r.subject, r.body, r.sent_at],
          );
        }
        if (i.reply) {
          await tx.query(
            `insert into replies (gmail_message_id, gmail_thread_id, invoice_id, customer_id, classification, extracted_date, snippet, received_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [`demo-${i.ref}-reply`, `demo-${i.ref}`, inv.id, cust.id, i.reply.classification, i.reply.extracted_date, i.reply.snippet, i.reply.received_at],
          );
        }
      }
    }
  });
  console.log('\nDemo book written. Drafting due reminders…');

  if (process.argv.includes('--template-drafts')) {
    process.env.GEMINI_API_KEY = '';
    resetConfig();
  }
  const drafts = await createDueDrafts(db, today);
  console.log('Drafts created:', drafts);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
