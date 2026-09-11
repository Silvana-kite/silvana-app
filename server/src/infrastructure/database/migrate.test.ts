import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(), query: vi.fn(), release: vi.fn(), end: vi.fn(),
  neonPool: vi.fn(), neonConfig: {} as { webSocketConstructor?: unknown },
}));
vi.mock('pg', () => ({ Pool: class {
  connect = mocks.connect;
  end = mocks.end;
} }));
vi.mock('@neondatabase/serverless', () => ({
  neonConfig: mocks.neonConfig,
  Pool: class {
    constructor(options: unknown) { mocks.neonPool(options); }
    connect = mocks.connect;
    end = mocks.end;
  },
}));
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue(['0002_second.sql', 'notes.txt', '0001_first.sql']),
  readFile: vi.fn().mockImplementation(async (url: URL) => url.pathname.split('/').pop()),
}));
import { migrate } from './migrate.js';
import { formatDatabaseError } from './errors.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReset().mockResolvedValue({ rows: [] });
  mocks.connect.mockReset().mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.end.mockResolvedValue(undefined);
});

describe('database migration', () => {
  it('uses the Neon WebSocket driver with the same transaction for --neon', async () => {
    const url = 'postgresql://user:password@ep-example.neon.tech/test';
    await migrate(url, 'neon');
    expect(mocks.neonPool).toHaveBeenCalledWith({ connectionString: url, connectionTimeoutMillis: 15_000 });
    expect(mocks.neonConfig.webSocketConstructor).toBe(WebSocket);
    expect(mocks.query).toHaveBeenCalledWith('BEGIN');
    expect(mocks.query).toHaveBeenCalledWith('0001_first.sql');
    expect(mocks.query).toHaveBeenCalledWith('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('rejects non-Neon endpoints before opening a WebSocket connection', async () => {
    await expect(migrate('postgresql://localhost/test', 'neon')).rejects.toThrow('Neon transport requires a Neon DATABASE_URL');
    expect(mocks.neonPool).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('applies SQL files in order in one transaction and releases the connection', async () => {
    await migrate('postgresql://localhost/test');
    expect(mocks.query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN', 'SELECT pg_advisory_xact_lock(2026091001)', '0001_first.sql', '0002_second.sql', 'COMMIT',
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('retains nested errors when connection establishment fails', async () => {
    const cause = new AggregateError([Object.assign(new Error('connect failed'), { code: 'ETIMEDOUT' })]);
    mocks.connect.mockRejectedValueOnce(cause);
    await expect(migrate('postgresql://localhost/test')).rejects.toMatchObject({
      message: expect.stringContaining('connecting to PostgreSQL'), cause,
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('reports the failed SQL file even if rollback also fails', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql === '0001_first.sql') throw new Error('SQL rejected');
      if (sql === 'ROLLBACK') throw new Error('connection lost');
      return { rows: [] };
    });
    const error = await migrate('postgresql://localhost/test').catch(error => error);
    expect(formatDatabaseError(error)).toContain('applying 0001_first.sql');
    expect(formatDatabaseError(error)).toContain('SQL rejected');
    expect(formatDatabaseError(error)).toContain('connection lost');
    expect(mocks.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
