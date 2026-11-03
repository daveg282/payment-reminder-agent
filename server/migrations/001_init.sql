create extension if not exists pgcrypto;

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  kind text not null check (kind in ('one_off','recurring')),
  billing_day int check (billing_day between 1 and 28),
  amount_per_period numeric(12,2),
  currency text not null default 'USD',
  recurring_start date,
  created_at timestamptz not null default now(),
  unique (email)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  invoice_ref text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'USD',
  issue_date date not null,
  due_date date not null,
  paid_date date,
  status text not null default 'open' check (status in ('open','paid','void')),
  period text,                         -- 'YYYY-MM' for recurring, null for one-off
  promise_date date,                   -- set by promise-to-pay
  source text not null default 'import' check (source in ('import','recurring','sheet','manual')),
  created_at timestamptz not null default now(),
  unique (customer_id, invoice_ref),
  unique (customer_id, period)
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  stage int not null check (stage between 1 and 4),
  tone text not null check (tone in ('friendly','firm','final')),
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft','approved','sent','skipped','failed')),
  gmail_message_id text,
  gmail_thread_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (invoice_id, stage)
);

create table replies (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  invoice_id uuid references invoices(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  classification text not null check (classification in ('promise_to_pay','dispute','already_paid','other','needs_review')),
  extracted_date date,
  snippet text not null,
  status text not null default 'new' check (status in ('new','reviewed')),
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table google_tokens (
  id int primary key default 1 check (id = 1),
  refresh_token text not null,
  email text not null,
  updated_at timestamptz not null default now()
);

create table job_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb,
  error text
);
