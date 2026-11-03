import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { isValidIsoDate } from './dates';

export const IMPORT_COLUMNS = [
  'kind',
  'customer_name',
  'customer_email',
  'invoice_ref',
  'amount',
  'currency',
  'issue_date',
  'due_date',
  'billing_day',
  'amount_per_period',
  'recurring_start',
] as const;

export type ImportRecord = Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>;

export interface RowError {
  row: number;
  field: string;
  message: string;
}

/** Thrown for problems with the file as a whole (not a single row). */
export class CsvFileError extends Error {}

// ---------- field schemas (all messages are shown to the user as-is) ----------

const blankToUndefined = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return t === '' ? undefined : t;
};

const requiredText = (label: string) =>
  z.preprocess(blankToUndefined, z.string({ error: `${label} is missing` }));

const email = z.preprocess(
  blankToUndefined,
  z
    .string({ error: 'customer email is missing' })
    .pipe(z.email({ error: 'customer email is not a valid email' }))
    .transform((s) => s.toLowerCase()),
);

const currency = z.preprocess(
  (v) => blankToUndefined(v) ?? 'USD',
  z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code like USD')
    .transform((s) => s.toUpperCase()),
);

const date = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z.string({ error: `${label} is missing` }).refine(isValidIsoDate, `${label} is not a valid date`),
  );

const money = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: `${label} is missing` })
      .regex(/^-?\d+(\.\d+)?$/, `${label} must be a number`)
      .refine((s) => !/\.\d{3,}$/.test(s), `${label} can have at most 2 decimal places`)
      .transform(Number)
      .pipe(
        z
          .number()
          .gt(0, `${label} must be greater than 0`)
          .lt(1e10, `${label} is too large`),
      ),
  );

const billingDay = z.preprocess(
  blankToUndefined,
  z
    .string({ error: 'billing day is missing' })
    .regex(/^-?\d+$/, 'billing day must be a whole number')
    .transform(Number)
    .pipe(z.number().min(1, 'billing day must be between 1 and 28').max(28, 'billing day must be between 1 and 28')),
);

const oneOffRow = z.object({
  kind: z.literal('one_off'),
  customer_name: requiredText('customer name'),
  customer_email: email,
  currency,
  invoice_ref: requiredText('invoice ref'),
  amount: money('amount'),
  issue_date: date('issue date'),
  due_date: date('due date'),
});

// Recurring rows ignore invoice_ref / amount / dates (zod strips unknown keys).
const recurringRow = z.object({
  kind: z.literal('recurring'),
  customer_name: requiredText('customer name'),
  customer_email: email,
  currency,
  billing_day: billingDay,
  amount_per_period: money('amount per period'),
  recurring_start: date('recurring start'),
});

export const importRowSchema = z.discriminatedUnion('kind', [oneOffRow, recurringRow], {
  error: 'kind must be one_off or recurring',
});

export type OneOffRow = z.infer<typeof oneOffRow> & { row: number };
export type RecurringRow = z.infer<typeof recurringRow> & { row: number };
export type ParsedRow = OneOffRow | RecurringRow;

// ---------- validation ----------

/**
 * Validates CSV records (objects keyed by lower-case column name).
 * Row numbers are 1-based including the header, so records[0] is row 2 — what the user sees in Excel.
 */
export function validateRows(records: ImportRecord[]): { valid: ParsedRow[]; errors: RowError[] } {
  const valid: ParsedRow[] = [];
  const errors: RowError[] = [];
  const firstSeen = new Map<string, number>(); // "email|ref" -> row number

  records.forEach((record, index) => {
    const row = index + 2;
    const kind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : record.kind;
    const result = importRowSchema.safeParse({ ...record, kind });

    if (!result.success) {
      // One message per field: the first problem is the useful one.
      const fields = new Set<string>();
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? 'kind');
        if (fields.has(field)) continue;
        fields.add(field);
        errors.push({ row, field, message: issue.message });
      }
      return;
    }

    const data = result.data;
    if (data.kind === 'one_off') {
      if (data.due_date < data.issue_date) {
        errors.push({ row, field: 'due_date', message: 'due date is before issue date' });
        return;
      }
      const key = `${data.customer_email}|${data.invoice_ref}`;
      const original = firstSeen.get(key);
      if (original !== undefined) {
        errors.push({ row, field: 'invoice_ref', message: `duplicate of row ${original}` });
        return;
      }
      firstSeen.set(key, row);
    }
    valid.push({ ...data, row });
  });

  return { valid, errors };
}

// ---------- CSV parsing ----------

/** Parses the uploaded CSV into records keyed by column name. Throws CsvFileError for file-level problems. */
export function parseImportCsv(content: Buffer | string): ImportRecord[] {
  let rows: string[][];
  try {
    rows = parse(content, { bom: true, relax_column_count: true, skip_empty_lines: true });
  } catch (err) {
    throw new CsvFileError(`could not read the CSV file: ${(err as Error).message}`);
  }
  if (rows.length === 0) throw new CsvFileError('the file is empty');

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const expected = new Set<string>(IMPORT_COLUMNS);
  const missing = IMPORT_COLUMNS.filter((c) => !header.includes(c));
  const unexpected = header.filter((h) => !expected.has(h));
  const repeated = header.filter((h, i) => header.indexOf(h) !== i);
  if (missing.length || unexpected.length || repeated.length) {
    const parts = [
      missing.length && `missing columns: ${missing.join(', ')}`,
      unexpected.length && `unexpected columns: ${unexpected.join(', ')}`,
      repeated.length && `repeated columns: ${repeated.join(', ')}`,
    ].filter(Boolean);
    throw new CsvFileError(`the header row is wrong (${parts.join('; ')}). Expected: ${IMPORT_COLUMNS.join(',')}`);
  }

  // Drop trailing rows that are only commas (Excel likes to add them); keeps row numbers stable.
  let end = rows.length;
  while (end > 1 && rows[end - 1].every((cell) => cell.trim() === '')) end--;

  const records = rows.slice(1, end).map((cells) => {
    const record: ImportRecord = {};
    header.forEach((column, i) => {
      record[column as keyof ImportRecord] = cells[i] ?? '';
    });
    return record;
  });
  if (records.length === 0) throw new CsvFileError('the file has a header but no data rows');
  return records;
}
