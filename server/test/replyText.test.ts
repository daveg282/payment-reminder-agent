import { describe, expect, it } from 'vitest';
import { nextWeekday, weekdayNextWeek, weekdayOf } from '../src/domain/dates';
import { addressOf, htmlToText, stripQuoted } from '../src/domain/replyText';
import { buildReplyPrompt, upcomingCalendar } from '../src/services/gemini';
import { payloadText } from '../src/services/gmail';

describe('date rule: "next <weekday>" = nearest upcoming occurrence after today', () => {
  it('Tue Nov 3 → "next Friday" = Fri Nov 6', () => {
    expect(weekdayOf('2026-11-03')).toBe('Tuesday');
    expect(nextWeekday('2026-11-03', 'Friday')).toBe('2026-11-06');
  });

  it.each([
    ['2026-11-03', 'Wednesday', '2026-11-04'],
    ['2026-11-03', 'Monday', '2026-11-09'],
    ['2026-11-03', 'Tuesday', '2026-11-10'], // never today
    ['2026-11-06', 'Friday', '2026-11-13'], // on a Friday, next Friday is a week later
    ['2026-12-29', 'Friday', '2027-01-01'], // across a year
  ] as const)('from %s, next %s → %s', (today, weekday, expected) => {
    expect(nextWeekday(today, weekday)).toBe(expected);
  });

  it('"<weekday> next week" is that weekday in the following Monday–Sunday week', () => {
    expect(weekdayNextWeek('2026-11-03', 'Friday')).toBe('2026-11-13');
    expect(weekdayNextWeek('2026-11-03', 'Monday')).toBe('2026-11-09');
    expect(weekdayNextWeek('2026-11-08', 'Monday')).toBe('2026-11-09'); // Sunday → tomorrow's week
  });

  it('the Gemini prompt states the rule with the resolved example, today, due date and a calendar', () => {
    const prompt = buildReplyPrompt({ text: "I'll pay next Friday", today: '2026-11-03', dueDate: '2026-10-24', invoiceRef: 'DEMO-001', amount: 500, currency: 'USD' });
    expect(prompt).toContain('Today is Tuesday 2026-11-03.');
    expect(prompt).toContain('due on Saturday 2026-10-24');
    expect(prompt).toContain('strictly after today (today "next Friday" = 2026-11-06)');
    expect(prompt).toContain('"Friday next week" = 2026-11-13');
    expect(prompt).toContain('- Friday 2026-11-06');
    expect(upcomingCalendar('2026-11-03', 3)).toEqual(['Wednesday 2026-11-04', 'Thursday 2026-11-05', 'Friday 2026-11-06']);
  });
});

describe('stripQuoted', () => {
  it('drops the Gmail "On … wrote:" block and everything after it', () => {
    const text = "Sorry, I'll pay next Friday.\n\nThanks\n\nOn Tue, Nov 3, 2026 at 12:47 PM Dawit Girma <dawitggtw@gmail.com> wrote:\n> Hi Demo Client,\n> invoice DEMO-001 is overdue";
    expect(stripQuoted(text)).toBe("Sorry, I'll pay next Friday.\n\nThanks");
  });

  it('handles the "wrote:" line wrapped onto the next line', () => {
    const text = 'Paid already.\r\n\r\nOn Tue, Nov 3, 2026 at 12:47 PM Dawit Girma <\r\ndawitggtw@gmail.com> wrote:\r\n\r\n> old text';
    expect(stripQuoted(text)).toBe('Paid already.');
  });

  it('removes ">" lines and Outlook headers', () => {
    expect(stripQuoted('ok\n> quoted\nmore')).toBe('ok\nmore');
    expect(stripQuoted('Will pay on the 15th.\n\n-----Original Message-----\nFrom: x')).toBe('Will pay on the 15th.');
    expect(stripQuoted('Done.\n\nFrom: Dawit <a@b.com>\nSent: Tuesday\nSubject: x')).toBe('Done.');
  });
});

describe('message helpers', () => {
  it('addressOf extracts the bare lower-case address', () => {
    expect(addressOf('"Demo Client" <DawitGirma282@Gmail.com>')).toBe('dawitgirma282@gmail.com');
    expect(addressOf('a@b.com')).toBe('a@b.com');
  });

  it('payloadText prefers text/plain and falls back to html', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    expect(payloadText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<p>hi</p>') } }, { mimeType: 'text/plain', body: { data: b64('hi plain') } }] })).toBe('hi plain');
    expect(payloadText({ mimeType: 'text/html', body: { data: b64('<div>Paid &amp; done<br>thanks</div><blockquote>old</blockquote>') } })).toBe('Paid & done\nthanks\n');
    expect(htmlToText('a&nbsp;b')).toBe('a b');
  });
});
