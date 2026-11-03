import { Db } from '../db';
import { duePeriods, recurringInvoiceRef } from '../domain/recurring';
import { listRecurringCustomers } from '../repos/customers';
import { insertInvoiceIfNew } from '../repos/invoices';

/** Creates any missing recurring invoices up to `today`. Safe to rerun: existing periods are skipped. */
export async function generateRecurringInvoices(db: Db, today: string): Promise<{ customers: number; invoicesCreated: number }> {
  const customers = await listRecurringCustomers(db);
  let invoicesCreated = 0;
  for (const c of customers) {
    for (const p of duePeriods({ billing_day: c.billing_day!, recurring_start: c.recurring_start! }, today)) {
      const inserted = await insertInvoiceIfNew(db, {
        customer_id: c.id,
        invoice_ref: recurringInvoiceRef(p.period),
        amount: c.amount_per_period!,
        currency: c.currency,
        issue_date: p.issue_date,
        due_date: p.due_date,
        period: p.period,
        source: 'recurring',
      });
      if (inserted) invoicesCreated++;
    }
  }
  return { customers: customers.length, invoicesCreated };
}
