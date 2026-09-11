import { Global, Inject, Logger, Module, type Provider, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabasePool, databaseTransport, type DatabasePool } from './database-pool.js';

export const DATABASE = Symbol('DATABASE');
export interface Database { $client: DatabasePool }

const databaseProvider: Provider = {
  provide: DATABASE,
  useFactory: async (): Promise<Database | null> => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return null;
    const pool = await createDatabasePool(databaseUrl, databaseTransport(), { max: 3, connectionTimeoutMillis: 10_000 });
    pool.on('error', () => Logger.warn('An idle database connection was lost; subsequent requests will reconnect.', 'Database'));
    return { $client: pool };
  },
};

@Global()
@Module({ providers: [databaseProvider], exports: [databaseProvider] })
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database | null) {}
  async onApplicationShutdown() { await this.database?.$client.end(); }
}

export const InjectDatabase = () => Inject(DATABASE);
