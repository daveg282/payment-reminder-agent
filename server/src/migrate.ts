import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { closePool, getPool } from './db';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/** Applies every not-yet-applied `migrations/*.sql` file in filename order. Returns the files applied. */
export async function migrate(log: (msg: string) => void = console.log): Promise<string[]> {
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    // Serialize concurrent runs (e.g. two deploys starting at once).
    await client.query('select pg_advisory_lock(727001)');
    await client.query(`create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`);
    const done = new Set((await client.query<{ name: string }>('select name from _migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into _migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    if (applied.length === 0) log('migrations up to date');
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => closePool())
    .catch(async (err) => {
      console.error(err.message);
      await closePool();
      process.exit(1);
    });
}
