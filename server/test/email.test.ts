import { describe, expect, it } from 'vitest';
import { buildRawMessage } from '../src/domain/email';

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const bodyOf = (msg: string) => Buffer.from(msg.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

describe('buildRawMessage', () => {
  const base = { fromName: 'Sam Sender', fromAddress: 'sam@example.com', to: 'aster@example.com', subject: 'Invoice INV-1 is overdue', body: 'Hi,\nplease pay.' };

  it('builds an RFC 2822 plain-text message', () => {
    const msg = decode(buildRawMessage(base));
    expect(msg).toContain('From: "Sam Sender" <sam@example.com>\r\n');
    expect(msg).toContain('To: aster@example.com\r\n');
    expect(msg).toContain('Subject: Invoice INV-1 is overdue\r\n');
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(msg).not.toContain('In-Reply-To');
    expect(bodyOf(msg)).toBe('Hi,\r\nplease pay.');
  });

  it('adds In-Reply-To and References when replying', () => {
    const msg = decode(buildRawMessage({ ...base, inReplyTo: '<abc@mail.gmail.com>' }));
    expect(msg).toContain('In-Reply-To: <abc@mail.gmail.com>\r\n');
    expect(msg).toContain('References: <abc@mail.gmail.com>\r\n');
  });

  it('strips line breaks from headers (no header injection)', () => {
    const msg = decode(buildRawMessage({ ...base, subject: 'Hi\r\nBcc: evil@example.com' }));
    expect(msg).toContain('Subject: Hi Bcc: evil@example.com\r\n');
    expect(msg).not.toMatch(/^Bcc:/m);
  });

  it('encodes non-ASCII subjects', () => {
    const msg = decode(buildRawMessage({ ...base, subject: 'Facture déjà due' }));
    expect(msg).toContain(`Subject: =?UTF-8?B?${Buffer.from('Facture déjà due').toString('base64')}?=`);
  });
});
