import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';

export async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString });
  try {
    const directory = new URL('../../../migrations/', import.meta.url);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(2026091001)');
      for (const name of (await readdir(directory)).filter(n => /^\d+.*\.sql$/.test(n)).sort()) await client.query(await readFile(new URL(name, directory), 'utf8'));
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}
