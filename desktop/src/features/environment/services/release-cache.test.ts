import { vi as mockVi } from 'vitest';
mockVi.mock('./history-cache', () => ({ loadHistoryPage: mockVi.fn(async () => undefined) }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const payload = { toolId: 'node', items: [{ version: '12.22.12', originalVersion: 'v12.22.12', channel: 'eol', pageUrl: 'https://nodejs.org/download/release/v12.22.12/', sourceUrl: 'https://nodejs.org/dist/index.json', assets: [] }], total: 1, page: 1, pageSize: 50, revision: 'snapshot-1', updatedAt: '2026-09-09T00:00:00Z', status: 'ready' };
beforeEach(() => { vi.resetModules(); localStorage.clear(); vi.stubEnv('VITE_API_URL', 'http://catalog.test/v1'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('persistent historical queries', () => {
  it('deduplicates requests and recovers the correct query after reload and network failure', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { headers: { ETag: '"snapshot-1"' } }));
    vi.stubGlobal('fetch', fetcher);
    const first = await import('./release-cache');
    const query = { q: '12.22.12', page: 1 };
    const results = await Promise.all([first.loadReleases('node', query), first.loadReleases('node', query)]);
    expect(results[0].data.items[0]?.version).toBe('12.22.12'); expect(fetcher).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(localStorage.getItem('release-history-v1')).toContain('12.22.12');
    vi.resetModules();
    fetcher.mockRejectedValue(new Error('offline'));
    const restarted = await import('./release-cache');
    expect((await restarted.loadReleases('node', query, true)).offline).toBe(true);
    await expect(restarted.loadReleases('node', { q: '9.9.9', page: 1 }, true)).rejects.toThrow('offline');
  });
  it('retains a valid snapshot when a refresh returns unavailable or unsafe data', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetcher);
    const { loadReleases } = await import('./release-cache'); const query = { page: 1 };
    await loadReleases('node', query);
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ ...payload, status: 'unavailable', items: [], total: 0 })));
    expect((await loadReleases('node', query, true)).data.items).toHaveLength(1);
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ ...payload, items: [{ ...payload.items[0], pageUrl: 'javascript:alert(1)' }] })));
    const fallback = await loadReleases('node', query, true);
    expect(fallback.offline).toBe(true); expect(fallback.data.items[0]?.pageUrl).toContain('https://nodejs.org/');
  });
});
