import { OAuth2Client } from 'google-auth-library';
import { getConfig } from '../config';
import { HttpError } from '../http';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'openid',
  'email',
];

function oauthSettings() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = getConfig();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new HttpError(503, 'Google sign-in is not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)');
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_REDIRECT_URI };
}

const newClient = () => new OAuth2Client(oauthSettings());

/** Google consent screen URL; `state` is checked on the callback. */
export function consentUrl(state: string): string {
  return newClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES, state });
}

/** Exchanges the callback code for a refresh token and the verified account email. */
export async function exchangeCode(code: string): Promise<{ refreshToken: string; email: string }> {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new HttpError(400, 'Google did not return a refresh token; try connecting again');
  if (!tokens.id_token) throw new HttpError(400, 'Google did not return the account email');
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: oauthSettings().clientId });
  const email = ticket.getPayload()?.email;
  if (!email) throw new HttpError(400, 'Google did not return the account email');
  return { refreshToken: tokens.refresh_token, email };
}

/** An OAuth client that refreshes access tokens from the stored refresh token. */
export function authorizedClient(refreshToken: string): OAuth2Client {
  const client = newClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
