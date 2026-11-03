import { Db } from '../db';

export interface Customer {
  id: string;
  name: string;
  email: string;
  kind: 'one_off' | 'recurring';
  billing_day: number | null;
  amount_per_period: number | null;
  currency: string;
  recurring_start: string | null;
  created_at: string;
}

export interface CustomerSummary extends Customer {
  open_count: number;
  open_amount: number;
}

/**
 * Inserts or updates a customer by email. A customer never goes from recurring back to one_off,
 * and a one-off row never overwrites recurring settings.
 */
export async function upsertCustomer(
  db: Db,
  c: { name: string; email: string; kind: 'one_off' | 'recurring'; currency: string },
): Promise<{ id: string; inserted: boolean }> {
  const { rows } = await db.query<{ id: string; inserted: boolean }>(
    `insert into customers (name, email, kind, currency)
     values ($1, $2, $3, $4)
     on conflict (email) do update set
       name = excluded.name,
       kind = case when customers.kind = 'recurring' or excluded.kind = 'recurring' then 'recurring' else 'one_off' end
     returning id, (xmax = 0) as inserted`,
    [c.name, c.email, c.kind, c.currency],
  );
  return rows[0];
}

export async function setRecurring(
  db: Db,
  id: string,
  r: { billing_day: number; amount_per_period: number; currency: string; recurring_start: string },
): Promise<void> {
  await db.query(
    `update customers
     set kind = 'recurring', billing_day = $2, amount_per_period = $3, currency = $4, recurring_start = $5
     where id = $1`,
    [id, r.billing_day, r.amount_per_period, r.currency, r.recurring_start],
  );
}

export async function listCustomers(db: Db): Promise<CustomerSummary[]> {
  const { rows } = await db.query<CustomerSummary>(
    `select c.*,
            count(i.id) filter (where i.status = 'open')::int as open_count,
            coalesce(sum(i.amount) filter (where i.status = 'open'), 0)::numeric(12,2) as open_amount
     from customers c
     left join invoices i on i.customer_id = c.id
     group by c.id
     order by c.name`,
  );
  return rows;
}

export async function getCustomer(db: Db, id: string): Promise<Customer | undefined> {
  const { rows } = await db.query<Customer>('select * from customers where id = $1', [id]);
  return rows[0];
}

export async function listRecurringCustomers(db: Db): Promise<Customer[]> {
  const { rows } = await db.query<Customer>(
    `select * from customers
     where kind = 'recurring' and billing_day is not null and recurring_start is not null and amount_per_period is not null`,
  );
  return rows;
}
