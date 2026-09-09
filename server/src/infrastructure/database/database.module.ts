import { Global, Inject, Module, type Provider } from '@nestjs/common';
import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

export const DATABASE = Symbol('DATABASE');
export type Database = NeonHttpDatabase<typeof schema>;

const databaseProvider: Provider = {
  provide: DATABASE,
  useFactory: (): Database | null => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return null;
    return drizzle(neon(databaseUrl), { schema });
  },
};

@Global()
@Module({ providers: [databaseProvider], exports: [databaseProvider] })
export class DatabaseModule {}

export const InjectDatabase = () => Inject(DATABASE);
