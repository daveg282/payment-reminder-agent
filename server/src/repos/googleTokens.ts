import { Db } from '../db';

export interface GoogleToken {
  refresh_token: string;
  email: string;
}

export async function getGoogleToken(db: Db): Promise<GoogleToken | undefined> {
  const { rows } = await db.query<GoogleToken>('select refresh_token, email from google_tokens where id = 1');
  return rows[0];
}

export async function saveGoogleToken(db: Db, t: GoogleToken): Promise<void> {
  await db.query(
    `insert into google_tokens (id, refresh_token, email) values (1, $1, $2)
     on conflict (id) do update set refresh_token = excluded.refresh_token, email = excluded.email, updated_at = now()`,
    [t.refresh_token, t.email],
  );
}
