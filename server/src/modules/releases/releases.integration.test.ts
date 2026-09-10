import { generateKeyPairSync } from 'node:crypto';
import { HistoryService } from './history.service.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from '../../infrastructure/database/migrate.js';
import * as schema from '../../infrastructure/database/schema.js';
import { ReleaseRepository } from './release.repository.js';
import { SourceHttp } from './source-http.js';
import { ReleasesService } from './releases.service.js';

const connectionString = process.env.RELEASE_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('release history with PostgreSQL', () => {
  let pool: Pool; let repository: ReleaseRepository; let http: SourceHttp; let service: ReleasesService;
  const index = [{ version: 'v12.22.12', date: '2022-04-05', npm: '6.14.16', lts: 'Erbium', files: ['win-x64-zip'] }];
  beforeAll(async () => {
    if (!new URL(connectionString!).pathname.endsWith('/siilvana_release_test')) throw new Error('Tests require the dedicated siilvana_release_test database');
    await migrate(connectionString);
    pool = new Pool({ connectionString, max: 5 });
    repository = new ReleaseRepository(drizzle(pool, { schema })); http = new SourceHttp(repository); service = new ReleasesService(repository, http);
  });
  beforeEach(async () => { await pool.query('TRUNCATE history_assets,history_releases,history_snapshots,history_manifests,history_blobs,history_reports,history_alerts,release_history,release_sources,release_page_cache,sync_runs'); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  afterAll(async () => { await pool?.end(); });
  function mockSource() {
    const fetcher = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('schedule.json') ? { v12: { end: '2022-04-30' } } : index), { headers: { ETag: '"official-v1"' } }));
    vi.stubGlobal('fetch', fetcher); return fetcher;
  }
  it('publishes, survives a new service instance, and serves searches without new source requests', async () => {
    const fetcher = mockSource();
    const result = await service.sync(['node'], { budgetMs: 20000 });
    expect(result.results[0]).toMatchObject({ status: 'ready', count: 1 });
    const restarted = new ReleasesService(new ReleaseRepository(drizzle(pool, { schema })), http);
    const page = await restarted.list('node', { q: '12.22.12' });
    expect(page.items[0]).toMatchObject({ version: '12.22.12', bundledNpm: '6.14.16' });
    const count = fetcher.mock.calls.length;
    await Promise.all(Array.from({ length: 10 }, () => restarted.list('node', {})));
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect((await restarted.sync(['node'])).requests).toBe(0);
  }, 20000);
  it('reuses conditional responses and keeps prior data on malformed/failed source updates', async () => {
    const fetcher = mockSource(); await service.sync(['node']);
    const original = await service.list('node', {});
    fetcher.mockImplementation(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"official-v1"');
      return new Response(null, { status: 304 });
    });
    expect((await service.sync(['node'], { force: true })).results[0].status).toBe('ready');
    expect((await service.list('node', {})).revision).toBe(original.revision);
    fetcher.mockResolvedValue(new Response('not a valid index', { status: 200 }));
    expect((await service.sync(['node'], { force: true })).results[0].status).toBe('failed');
    const stale = await service.list('node', {});
    expect(stale.status).toBe('stale'); expect(stale.items).toEqual(original.items);
  });
  it('persists pagination across budget boundaries and excludes prereleases', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const row = { tag_name: 'v1.0.0', html_url: 'https://github.com/volta-cli/volta/releases/tag/v1.0.0', assets: [] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const next = url.includes('page=2');
      now += 100;
      return new Response(JSON.stringify(next ? [{ ...row, tag_name: 'v0.9.0' }, { ...row, tag_name: 'v2.0.0-beta', prerelease: true }] : [row]), { headers: next ? {} : { Link: '<https://api.github.com/repos/volta-cli/volta/releases?per_page=100&page=2>; rel="next"' } });
    }));
    const first = await service.sync(['volta'], { budgetMs: 20 });
    expect(first.status).toBe('pending');
    expect((await repository.state('volta'))?.checkpoint?.queue).toHaveLength(1);
    expect((await service.list('volta', {})).items).toEqual([]);
    expect((await service.sync(['volta'], { budgetMs: 20000 })).results[0].status).toBe('ready');
    expect((await service.list('volta', {})).items.map(r => r.version)).toEqual(['1.0.0', '0.9.0']);
  });
  it('excludes duplicate workers, recovers expired leases, and honors Retry-After', async () => {
    const token = await repository.claim('node'); expect(token).toBeTruthy(); expect(await repository.claim('node', true)).toBeUndefined();
    await pool.query("UPDATE release_sources SET lease_until=now()-interval '1 second' WHERE tool_id='node'");
    expect(await repository.claim('node')).toBeTruthy();
    await pool.query('TRUNCATE release_sources');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('limited', { status: 429, headers: { 'Retry-After': '3600' } })));
    expect((await service.sync(['node'])).results[0].status).toBe('failed');
    const state = await repository.state('node'); expect(state!.next_run_at.getTime() - Date.now()).toBeGreaterThan(3500000);
    expect((await service.sync(['node'])).requests).toBe(0);
    const lock = await pool.connect(); await lock.query('SELECT pg_advisory_lock(2026090923)');
    try { expect((await service.sync(['node'])).status).toBe('busy'); }
    finally { await lock.query('SELECT pg_advisory_unlock(2026090923)'); lock.release(); }
  });
  it('keeps the coordinator lock while a surviving worker finishes after a sibling fails', async () => {
    const claim = repository.claim.bind(repository);
    vi.spyOn(repository, 'claim').mockImplementation(async (tool, force) => {
      if (tool === 'volta') throw new Error('simulated claim failure');
      return claim(tool, force);
    });
    let started!: () => void; let finish!: () => void;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    const responseReady = new Promise<void>(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      started(); await responseReady;
      return new Response(JSON.stringify([{ tag_name: 'v1.0.0', html_url: 'https://github.com/Schniz/fnm/releases/tag/v1.0.0', assets: [] }]));
    }));
    const result = service.sync(['volta', 'fnm']).catch(error => error as Error);
    await requestStarted;
    const observer = await pool.connect();
    try {
      expect((await observer.query('SELECT pg_try_advisory_lock(2026090923) AS acquired')).rows[0].acquired).toBe(false);
    } finally {
      finish();
      await observer.query('SELECT pg_advisory_unlock(2026090923)'); observer.release();
    }
    expect(await result).toMatchObject({ message: 'simulated claim failure' });
    expect((await service.list('fnm', {})).items[0]?.version).toBe('1.0.0');
  });
  it('serves the oldest due source within a short cron budget', async () => {
    await pool.query(`INSERT INTO release_sources(tool_id,next_run_at) VALUES
      ('node',now()-interval '1 hour'),('volta',now()-interval '2 hours'),('fnm',now()-interval '3 hours')`);
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.stubGlobal('fetch', vi.fn(async () => {
      now += 100;
      return new Response(JSON.stringify([{ tag_name: 'v1.0.0', html_url: 'https://github.com/Schniz/fnm/releases/tag/v1.0.0', assets: [] }]));
    }));
    await service.sync(['node', 'volta', 'fnm'], { budgetMs: 50 });
    expect((await service.list('fnm', {})).items[0]?.version).toBe('1.0.0');
    expect((await service.list('node', {})).items).toEqual([]);
  });
  it('publishes immutable per-tool revisions and preserves them on collection failure', async () => {
    const pair = generateKeyPairSync('ed25519');
    vi.stubEnv('HISTORY_SIGNING_KEY', pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
    vi.stubEnv('HISTORY_SIGNING_KEY_ID', 'test'); vi.stubEnv('HISTORY_DATASET_ID', 'integration-only');
    try {
      const history = new HistoryService(drizzle(pool, { schema })); mockSource(); await service.sync(['node']);
      const first = await history.publish(); const node = first.tools.find(t => t.toolId === 'node')!;
      expect(node.toolRevision).toBe('1'); expect(node.count).toBe(1);
      const descriptor = await history.snapshot('node', '1'); expect(descriptor.count).toBe(1);
      expect((await history.publish()).manifestRevision).toBe(first.manifestRevision);
      await pool.query("UPDATE release_sources SET status='failed',error='offline' WHERE tool_id='node'");
      const failed = await history.publish(); expect(failed.tools.find(t => t.toolId === 'node')?.toolRevision).toBe('1');
      expect(failed.tools.find(t => t.toolId === 'node')?.quality.sourceStatus).toBe('failed');
      expect(await history.snapshot('node','1')).toEqual(descriptor);
      await expect(history.snapshot('node','999')).rejects.toThrow();
      for (let i=0;i<12;i++) {
        await pool.query("UPDATE history_releases SET payload=jsonb_set(payload,'{bundledNpm}',to_jsonb($1::text)) WHERE tool_id='node'", [`6.14.${i}`]);
        await history.publish();
      }
      expect((await history.snapshot('node')).toolRevision).toBe('13');
      expect(BigInt((await history.manifest()).manifestRevision)).toBeGreaterThan(12n);
    } finally { vi.unstubAllEnvs(); }
  }, 30000);

});
