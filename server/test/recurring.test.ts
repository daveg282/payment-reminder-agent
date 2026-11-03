import { describe, expect, it } from 'vitest';
import { duePeriods } from '../src/domain/recurring';

describe('duePeriods', () => {
  it('start Jan 15, today Apr 3 → Jan, Feb, Mar (Apr not yet due on the 15th)', () => {
    expect(duePeriods({ billing_day: 15, recurring_start: '2026-01-15' }, '2026-04-03')).toEqual([
      { period: '2026-01', issue_date: '2026-01-15', due_date: '2026-01-15' },
      { period: '2026-02', issue_date: '2026-02-01', due_date: '2026-02-15' },
      { period: '2026-03', issue_date: '2026-03-01', due_date: '2026-03-15' },
    ]);
  });

  it('includes the period whose billing day is today', () => {
    expect(duePeriods({ billing_day: 3, recurring_start: '2026-04-01' }, '2026-04-03').map((p) => p.period)).toEqual(['2026-04']);
  });

  it('skips the start month when its billing day is before the start date', () => {
    expect(duePeriods({ billing_day: 10, recurring_start: '2026-01-20' }, '2026-03-10').map((p) => p.period)).toEqual(['2026-02', '2026-03']);
  });

  it('crosses a year boundary', () => {
    expect(duePeriods({ billing_day: 1, recurring_start: '2025-11-01' }, '2026-01-31').map((p) => p.period)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('returns nothing when the start is in the future', () => {
    expect(duePeriods({ billing_day: 1, recurring_start: '2026-12-01' }, '2026-11-03')).toEqual([]);
  });
});
