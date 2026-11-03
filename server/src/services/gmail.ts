import { gmail } from '@googleapis/gmail';
import { authorizedClient } from './google';

export interface GmailClient {
  /** Sends a base64url RFC 2822 message, optionally into an existing thread. */
  send(raw: string, threadId?: string | null): Promise<{ messageId: string; threadId: string }>;
  /** The RFC `Message-ID` header of a message we sent (needed for In-Reply-To). */
  messageIdHeader(gmailMessageId: string): Promise<string | null>;
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
  };
}
