// Typed client for the server API. Every request sends the session cookie.

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(method: string, path: string, body?: unknown | FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Can't reach the server at ${API_URL}. Is it running?`);
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => undefined) : undefined;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    const message = (data as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);

// ---------- types ----------

export type RiskLabel = 'low' | 'medium' | 'high';
export interface Risk {
  label: RiskLabel;
  reason: string;
}
export type BucketName = 'due_soon' | 'late_1_7' | 'late_8_30' | 'late_30_plus';
export type Buckets<A = number> = Record<BucketName, { count: number; amount: A }>;

export interface Dashboard {
  today: string;
  currency: string | null;
  totalOwed: number | null;
  totalOverdue: number | null;
  buckets: Buckets<number | null>;
  byCurrency: Array<{ currency: string; totalOwed: number; totalOverdue: number; buckets: Buckets }>;
  callFirst: Array<{ customerId: string; name: string; invoiceRef: string; amount: number; currency: string; daysLate: number; risk: RiskLabel; reason: string }>;
  promisesThisWeek: Array<{ customerId: string; name: string; invoiceRef: string; amount: number; currency: string; promiseDate: string }>;
  repliesNeedingAttention: number;
}

export interface Counts {
  drafts: number;
  failed: number;
  repliesNew: number;
  repliesNeedingAttention: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  kind: 'one_off' | 'recurring';
  billing_day: number | null;
  amount_per_period: number | null;
  currency: string;
  recurring_start: string | null;
  open_count: number;
  open_amount: number;
  risk: Risk;
}

export type ReminderStatus = 'draft' | 'approved' | 'sent' | 'skipped' | 'failed';
export type Tone = 'friendly' | 'firm' | 'final';

export interface Invoice {
  id: string;
  invoice_ref: string;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  paid_date: string | null;
  status: 'open' | 'paid' | 'void';
  period: string | null;
  promise_date: string | null;
  source: string;
}

export type ReplyClass = 'promise_to_pay' | 'dispute' | 'already_paid' | 'other' | 'needs_review';

export interface CustomerDetail extends Omit<Customer, 'open_count' | 'open_amount'> {
  invoices: Array<Invoice & { reminders: Array<{ id: string; stage: number; tone: Tone; status: ReminderStatus; sent_at: string | null; created_at: string; error: string | null }> }>;
  replies: Array<{ id: string; invoice_ref: string | null; classification: ReplyClass; extracted_date: string | null; snippet: string; status: 'new' | 'reviewed'; received_at: string }>;
}

export interface Reminder {
  id: string;
  invoice_id: string;
  stage: number;
  tone: Tone;
  subject: string;
  body: string;
  status: ReminderStatus;
  drafted_by: 'ai' | 'template';
  error: string | null;
  sent_at: string | null;
  created_at: string;
  invoice: { id: string; invoice_ref: string; amount: number; currency: string; due_date: string; status: string; promise_date: string | null };
  customer: { id: string; name: string; email: string };
  risk: Risk;
}

export interface Reply {
  id: string;
  classification: ReplyClass;
  extracted_date: string | null;
  snippet: string;
  status: 'new' | 'reviewed';
  received_at: string;
  invoice_id: string | null;
  invoice_ref: string | null;
  amount: number | null;
  currency: string | null;
  promise_date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
}

export interface ImportPreview {
  validCount: number;
  errorCount: number;
  valid: Array<Record<string, string | number> & { row: number; kind: 'one_off' | 'recurring'; customer_name: string; customer_email: string }>;
  errors: Array<{ row: number; field: string; message: string }>;
}

export interface ImportResult {
  customersCreated: number;
  customersUpdated: number;
  invoicesCreated: number;
  invoicesAlreadyExisting: number;
  recurringCustomers: number;
  rowsImported: number;
  rowsSkipped: number;
}

export interface JobSummary {
  recurringCreated: number;
  promisesCleared: number;
  draftsCreated: number;
  draftsByAi: number;
  draftsByTemplate: number;
  repliesProcessed: number;
  errors: string[];
}

// ---------- endpoints ----------

const file = (f: File) => {
  const form = new FormData();
  form.append('file', f);
  return form;
};

export const api = {
  me: () => get<{ authed: boolean }>('/auth/me'),
  login: (password: string) => post<{ ok: true }>('/auth/login', { password }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  googleStatus: () => get<{ connected: boolean; email: string | null }>('/auth/google/status'),
  googleConnectUrl: `${API_URL}/auth/google`,

  dashboard: () => get<Dashboard>('/dashboard'),
  counts: () => get<Counts>('/dashboard/counts'),

  customers: () => get<Customer[]>('/customers'),
  customer: (id: string) => get<CustomerDetail>(`/customers/${id}`),
  markPaid: (invoiceId: string, paid_date: string) => post<{ invoice: Invoice; remindersSkipped: number }>(`/invoices/${invoiceId}/mark-paid`, { paid_date }),

  importPreview: (f: File) => post<ImportPreview>('/import/preview', file(f)),
  importCommit: (f: File, mode: 'all' | 'valid_only') => post<ImportResult>(`/import/commit?mode=${mode}`, file(f)),
  sampleCsvUrl: `${API_URL}/import/sample.csv`,

  reminders: () => get<Reminder[]>('/reminders'),
  updateReminder: (id: string, subject: string, body: string) => request<Reminder>('PATCH', `/reminders/${id}`, { subject, body }),
  approve: (id: string) => post<Reminder>(`/reminders/${id}/approve`),
  skip: (id: string) => post<Reminder>(`/reminders/${id}/skip`),

  replies: (status: 'new' | 'reviewed') => get<Reply[]>(`/replies?status=${status}`),
  review: (id: string, body: { classification?: Exclude<ReplyClass, 'needs_review'>; promise_date?: string | null }) =>
    post<{ reply: Reply; promiseSet: boolean }>(`/replies/${id}/review`, body),

  runNow: () => post<JobSummary>('/jobs/run-now'),
};
