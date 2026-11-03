import { describe, expect, it } from 'vitest';
import { addDays } from '../src/domain/dates';
import { nextStageDue, ReminderStatus } from '../src/domain/stages';

const DUE = '2026-11-10';
const open = (promise_date: string | null = null) => ({ status: 'open' as const, due_date: DUE, promise_date });
const on = (offset: number) => addDays(DUE, offset);
const sent = (...stages: number[]) => stages.map((stage) => ({ stage, status: 'sent' as ReminderStatus }));

describe('nextStageDue — stage boundaries', () => {
  it.each([
    [-4, null],
    [-3, { stage: 1, tone: 'friendly' }], // 3 days before
    [0, { stage: 1, tone: 'friendly' }],
    [1, { stage: 2, tone: 'friendly' }], // 1 day after
    [6, { stage: 2, tone: 'friendly' }],
    [7, { stage: 3, tone: 'firm' }], // 7 days after
    [13, { stage: 3, tone: 'firm' }],
    [14, { stage: 4, tone: 'final' }], // 14 days after
    [60, { stage: 4, tone: 'final' }],
  ])('day %i relative to due, nothing sent yet → %o', (offset, expected) => {
    expect(nextStageDue(open(), [], 'low', on(offset))).toEqual(expected);
  });

  it('moves to the next stage only when its date arrives', () => {
    expect(nextStageDue(open(), sent(1), 'low', on(0))).toBeNull();
    expect(nextStageDue(open(), sent(1), 'low', on(1))).toEqual({ stage: 2, tone: 'friendly' });
    expect(nextStageDue(open(), sent(1, 2), 'low', on(6))).toBeNull();
    expect(nextStageDue(open(), sent(1, 2), 'low', on(7))).toEqual({ stage: 3, tone: 'firm' });
    expect(nextStageDue(open(), sent(1, 2, 3), 'low', on(14))).toEqual({ stage: 4, tone: 'final' });
  });

  it('stops after stage 4', () => {
    expect(nextStageDue(open(), sent(1, 2, 3, 4), 'low', on(90))).toBeNull();
  });

  it('treats a skipped stage as done', () => {
    expect(nextStageDue(open(), [{ stage: 1, status: 'skipped' }], 'low', on(1))).toEqual({ stage: 2, tone: 'friendly' });
  });
});

describe('nextStageDue — risk, status and promises', () => {
  it('high risk shifts the tone one step firmer', () => {
    expect(nextStageDue(open(), [], 'high', on(-3))).toEqual({ stage: 1, tone: 'firm' });
    expect(nextStageDue(open(), sent(1), 'high', on(1))).toEqual({ stage: 2, tone: 'firm' });
    expect(nextStageDue(open(), sent(1, 2), 'high', on(7))).toEqual({ stage: 3, tone: 'final' });
    expect(nextStageDue(open(), sent(1, 2, 3), 'high', on(14))).toEqual({ stage: 4, tone: 'final' });
    expect(nextStageDue(open(), sent(1, 2), 'medium', on(7))).toEqual({ stage: 3, tone: 'firm' });
  });

  it('skips invoices that are not open', () => {
    expect(nextStageDue({ ...open(), status: 'paid' }, [], 'low', on(20))).toBeNull();
    expect(nextStageDue({ ...open(), status: 'void' }, [], 'low', on(20))).toBeNull();
  });

  it('is paused while promise_date >= today', () => {
    expect(nextStageDue(open(on(25)), sent(1, 2), 'low', on(20))).toBeNull();
    expect(nextStageDue(open(on(20)), sent(1, 2), 'low', on(20))).toBeNull(); // promise is today
  });

  it('a broken promise makes the next stage due immediately', () => {
    // Stage 2 sent on day 1; promised day 3; on day 4 stage 3 is normally not due until day 7.
    expect(nextStageDue(open(), sent(1, 2), 'low', on(4))).toBeNull();
    expect(nextStageDue(open(on(3)), sent(1, 2), 'low', on(4))).toEqual({ stage: 3, tone: 'firm' });
    // Before the due date: stage 1 sent, promise broken → stage 2 right away.
    expect(nextStageDue(open(on(-2)), sent(1), 'low', on(-1))).toEqual({ stage: 2, tone: 'friendly' });
  });

  it.each(['draft', 'approved', 'failed'] as ReminderStatus[])('never creates stage N+1 while stage N is %s', (status) => {
    expect(nextStageDue(open(), [{ stage: 1, status }], 'low', on(30))).toBeNull();
    expect(nextStageDue(open(on(1)), [{ stage: 2, status }], 'low', on(30))).toBeNull(); // not even for a broken promise
  });
});
