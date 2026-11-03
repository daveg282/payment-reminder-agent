import { Pool, PoolClient, types } from 'pg';

// Return `date` columns as 'YYYY-MM-DD' strings (no time zone shifts) and numerics as numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => Number(v));

/** Anything that can run a query: the pool or a transaction client. */
export type Db = Pick<Pool | PoolClient, 'query'>;

let pool: Pool | undefined;

function needsSsl(url: string): boolean {
  const host = new URL(url).hostname;
  return !['localhost', '127.0.0.1', '::1'].includes(host);
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString,
      // Supabase requires TLS; its pooler certificate is not in Node's default CA bundle.
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
      max: 5,
      // Close idle connections before the Supabase pooler (or a network change) drops them.
      idleTimeoutMillis: 30_000,
    });
    // An idle connection that breaks emits 'error' on the pool; unhandled, that would crash the
    // process. pg already discards the broken client, so log it and carry on.
    pool.on('error', (err) => console.error('database connection dropped (will reconnect):', err.message));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Runs `fn` in one transaction; any thrown error rolls everything back. */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
