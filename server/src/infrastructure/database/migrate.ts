import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

export async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString });
  try {
    const sql = await readFile(new URL('../../../migrations/0001_release_history.sql', import.meta.url), 'utf8');
    await pool.query(`BEGIN; ${sql}; COMMIT;`);
  } finally { await pool.end(); }
}
