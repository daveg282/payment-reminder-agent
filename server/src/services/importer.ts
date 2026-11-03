import { withTransaction } from '../db';
import { ParsedRow } from '../domain/importSchema';
import { setRecurring, upsertCustomer } from '../repos/customers';
import { insertInvoiceIfNew } from '../repos/invoices';

export interface ImportResult {
  customersCreated: number;
  customersUpdated: number;
  invoicesCreated: number;
  invoicesAlreadyExisting: number;
  recurringCustomers: number;
}

/** Writes validated rows in a single transaction: all of them or none. */
export async function commitImport(rows: ParsedRow[]): Promise<ImportResult> {
  return withTransaction(async (tx) => {
    const result: ImportResult = {
      customersCreated: 0,
      customersUpdated: 0,
      invoicesCreated: 0,
      invoicesAlreadyExisting: 0,
      recurringCustomers: 0,
    };
    const created = new Set<string>();
    const touched = new Set<string>();

    for (const row of rows) {
      const customer = await upsertCustomer(tx, {
        name: row.customer_name,
        email: row.customer_email,
        kind: row.kind,
        currency: row.currency,
      });
      if (customer.inserted) created.add(customer.id);
      touched.add(customer.id);

      if (row.kind === 'one_off') {
        const inserted = await insertInvoiceIfNew(tx, {
          customer_id: customer.id,
          invoice_ref: row.invoice_ref,
          amount: row.amount,
          currency: row.currency,
          issue_date: row.issue_date,
          due_date: row.due_date,
          source: 'import',
        });
        if (inserted) result.invoicesCreated++;
        else result.invoicesAlreadyExisting++;
      } else {
        await setRecurring(tx, customer.id, row);
        result.recurringCustomers++;
      }
    }

    result.customersCreated = created.size;
    result.customersUpdated = touched.size - created.size;
    return result;
  });
}
