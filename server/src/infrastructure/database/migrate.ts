import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';

export async function migrate(connectionString = process.env.DATABASE_URL, transport: 'tcp' | 'neon' = 'tcp') {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const options = { connectionString, connectionTimeoutMillis: 15_000 };
  const pool = await (async () => {
    if (transport === 'tcp') return new Pool(options);
    if (!new URL(connectionString).hostname.endsWith('.neon.tech')) {
      throw new Error('--neon requires a Neon DATABASE_URL (*.neon.tech)');
    }
    const { Pool: NeonPool, neonConfig } = await import('@neondatabase/serverless');
    neonConfig.webSocketConstructor = WebSocket;
    return new NeonPool(options);
  })();
  let stage = 'connecting to PostgreSQL';
  try {
    const directory = new URL('../../../migrations/', import.meta.url);
    const client: { query(sql: string): Promise<unknown>; release(): void } = await pool.connect();
    try {
      stage = 'starting migration transaction';
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(2026091001)');
      stage = 'reading migration files';
      for (const name of (await readdir(directory)).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
        stage = `applying ${name}`;
        await client.query(await readFile(new URL(name, directory), 'utf8'));
      }
      stage = 'committing migration transaction';
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Migration and rollback failed'); }
      throw error;
    }
    finally { client.release(); }
  } catch (error) {
    const hint = stage === 'connecting to PostgreSQL'
      ? transport === 'neon'
        ? ' Check DATABASE_URL and secure WebSocket access to Neon (TCP 443).'
        : ' Check DATABASE_URL and network access to the database (normally TCP 5432). For Neon, try db:migrate --neon to connect over secure WebSocket (TCP 443).'
      : '';
    throw new Error(`Database migration failed while ${stage}.${hint}`, { cause: error });
  } finally { await pool.end(); }
}
