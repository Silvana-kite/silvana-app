import { Pool as PgPool } from 'pg';

export type DatabaseTransport = 'tcp' | 'neon';

interface DatabaseQueryResult<Row = any> {
  rows: Row[];
  rowCount: number | null;
}

export interface DatabaseConnection {
  query<Row = any>(text: string, values?: any[]): Promise<DatabaseQueryResult<Row>>;
  release(): void;
}

export interface DatabasePool {
  query<Row = any>(text: string, values?: any[]): Promise<DatabaseQueryResult<Row>>;
  connect(): Promise<DatabaseConnection>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export function databaseTransport(value = process.env.DATABASE_TRANSPORT): DatabaseTransport {
  if (!value || value === 'tcp') return 'tcp';
  if (value === 'neon') return 'neon';
  throw new Error(`Unsupported DATABASE_TRANSPORT: ${value}`);
}

export async function createDatabasePool(
  connectionString: string,
  transport: DatabaseTransport,
  options: { max?: number; connectionTimeoutMillis?: number } = {},
): Promise<DatabasePool> {
  const config = { connectionString, ...options };
  if (transport === 'tcp') return new PgPool(config) as unknown as DatabasePool;
  if (!new URL(connectionString).hostname.endsWith('.neon.tech')) {
    throw new Error('Neon transport requires a Neon DATABASE_URL (*.neon.tech)');
  }
  const { Pool: NeonPool, neonConfig } = await import('@neondatabase/serverless');
  neonConfig.webSocketConstructor = WebSocket;
  return new NeonPool(config) as unknown as DatabasePool;
}
