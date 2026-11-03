import { Db } from '../db';

export async function startJobRun(db: Db): Promise<string> {
  const { rows } = await db.query<{ id: string }>('insert into job_runs default values returning id');
  return rows[0].id;
}

export async function finishJobRun(db: Db, id: string, summary: unknown, error: string | null): Promise<void> {
  await db.query('update job_runs set finished_at = now(), summary = $2, error = $3 where id = $1', [id, JSON.stringify(summary), error]);
}
