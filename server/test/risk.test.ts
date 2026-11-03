import { describe, expect, it } from 'vitest';
import { firmerTone, scoreCustomer } from '../src/domain/risk';
import { riskCustomers, TODAY } from './fixtures/risk-customers';

describe('scoreCustomer on 20 invented customers', () => {
  it('has 20 cases', () => {
    expect(riskCustomers).toHaveLength(20);
  });

  it.each(riskCustomers.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const score = scoreCustomer(c.invoices, TODAY);
    expect({ label: score.label, points: score.points }).toEqual({ label: c.expected, points: c.points });
    if (c.reason) expect(score.reason).toBe(c.reason);
  });

  it('checks reason strings for at least 5 cases', () => {
    expect(riskCustomers.filter((c) => c.reason).length).toBeGreaterThanOrEqual(5);
  });

  it('reports late count, average days late and overdue amount', () => {
    const rowan = riskCustomers.find((c) => c.name.startsWith('Rowan'))!;
    expect(scoreCustomer(rowan.invoices, TODAY)).toMatchObject({ lateCount: 5, avgDaysLate: 30, overdueAmount: 100 });
    const hazel = riskCustomers.find((c) => c.name.startsWith('Hazel'))!;
    expect(scoreCustomer(hazel.invoices, TODAY)).toMatchObject({ lateCount: 0, avgDaysLate: 0, overdueAmount: 25_000 });
  });
});

describe('firmerTone', () => {
  it('shifts one step firmer only for high risk', () => {
    expect(firmerTone('friendly', 'high')).toBe('firm');
    expect(firmerTone('firm', 'high')).toBe('final');
    expect(firmerTone('final', 'high')).toBe('final');
    expect(firmerTone('friendly', 'medium')).toBe('friendly');
  });
});
