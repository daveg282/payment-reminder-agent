import { gmail, gmail_v1 } from '@googleapis/gmail';
import { htmlToText } from '../domain/replyText';
import { authorizedClient } from './google';

export interface ThreadMessage {
  id: string;
  internalDate: number; // ms since epoch, as Gmail received it
  from: string;
}

export interface GmailClient {
  /** Sends a base64url RFC 2822 message, optionally into an existing thread. */
  send(raw: string, threadId?: string | null): Promise<{ messageId: string; threadId: string }>;
  /** The RFC `Message-ID` header of a message we sent (needed for In-Reply-To). */
  messageIdHeader(gmailMessageId: string): Promise<string | null>;
  /** Messages in one thread we created (metadata only). Never used to search the mailbox. */
  threadMessages(threadId: string): Promise<ThreadMessage[]>;
  /** Plain-text body of one message. */
  messageText(gmailMessageId: string): Promise<string>;
}

const decode = (data?: string | null) => (data ? Buffer.from(data, 'base64url').toString('utf8') : '');

/** Finds the text/plain part (or falls back to text/html) in a Gmail message payload. */
export function payloadText(payload?: gmail_v1.Schema$MessagePart): string {
  const parts: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p?: gmail_v1.Schema$MessagePart) => {
    if (!p) return;
    parts.push(p);
    p.parts?.forEach(walk);
  };
  walk(payload);
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return decode(plain.body!.data);
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  return html ? htmlToText(decode(html.body!.data)) : '';
}

/** Gmail API access for the connected account. Only services/reminders.ts may call `send`. */
export function gmailFor(refreshToken: string): GmailClient {
  // @googleapis/gmail bundles its own google-auth-library typing; the client is runtime-compatible.
  const api = gmail({ version: 'v1', auth: authorizedClient(refreshToken) as never });
  return {
    async send(raw, threadId) {
      const res = await api.users.messages.send({ userId: 'me', requestBody: { raw, threadId: threadId ?? undefined } });
      if (!res.data.id || !res.data.threadId) throw new Error('Gmail did not return a message id');
      return { messageId: res.data.id, threadId: res.data.threadId };
    },
    async messageIdHeader(gmailMessageId) {
      const res = await api.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'metadata', metadataHeaders: ['Message-ID'] });
      return res.data.payload?.headers?.find((h) => h.name?.toLowerCase() === 'message-id')?.value ?? null;
    },
    async threadMessages(threadId) {
      const res = await api.users.threads.get({ userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['From'] });
      return (res.data.messages ?? []).map((m) => ({
        id: m.id!,
        internalDate: Number(m.internalDate ?? 0),
        from: m.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '',
      }));
    },
    async messageText(gmailMessageId) {
      const res = await api.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'full' });
      return payloadText(res.data.payload);
    },
  };
}
