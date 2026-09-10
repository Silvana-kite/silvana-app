import { Global, Inject, Logger, Module, type Provider, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export const DATABASE = Symbol('DATABASE');
export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

const databaseProvider: Provider = {
  provide: DATABASE,
  useFactory: (): Database | null => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return null;
    const pool = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10_000 });
    pool.on('error', () => Logger.warn('An idle database connection was lost; subsequent requests will reconnect.', 'Database'));
    return drizzle(pool, { schema });
  },
};

@Global()
@Module({ providers: [databaseProvider], exports: [databaseProvider] })
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database | null) {}
  async onApplicationShutdown() { await this.database?.$client.end(); }
}

export const InjectDatabase = () => Inject(DATABASE);
