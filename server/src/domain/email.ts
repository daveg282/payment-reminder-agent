// Builds plain-text RFC 2822 messages for the Gmail API.

/** Header values must never contain line breaks (header injection). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** RFC 2047 encoding for non-ASCII header text. */
function encodeHeader(s: string): string {
  const v = oneLine(s);
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

function mailbox(name: string, address: string): string {
  const addr = oneLine(address);
  if (!name.trim()) return addr;
  const safeName = /^[\x20-\x7e]*$/.test(oneLine(name)) ? `"${oneLine(name).replace(/["\\]/g, '\\$&')}"` : encodeHeader(name);
  return `${safeName} <${addr}>`;
}

export interface OutgoingEmail {
  fromName: string;
  fromAddress: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null; // RFC Message-ID of the message being replied to
}

/** RFC 2822 message, base64url-encoded as Gmail's `raw` field expects. */
export function buildRawMessage(m: OutgoingEmail): string {
  const headers = [
    `From: ${mailbox(m.fromName, m.fromAddress)}`,
    `To: ${oneLine(m.to)}`,
    `Subject: ${encodeHeader(m.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (m.inReplyTo) headers.push(`In-Reply-To: ${oneLine(m.inReplyTo)}`, `References: ${oneLine(m.inReplyTo)}`);
  const body = Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}
