import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { catalog } from '@siilvana/catalog';
import type { ToolRelease, ToolReleasePage } from '@siilvana/shared';
import { PARSER_VERSION, ReleaseRepository, type Checkpoint, type SourceState } from './release.repository.js';
import { SourceHttp, SourceHttpError } from './source-http.js';
import { sources, NODE_SCHEDULE, mergeReleases, parsePage, compareVersions, type ReleaseSource } from './sources.js';

@Injectable()
export class ReleasesService {
  constructor(private readonly repository: ReleaseRepository, private readonly http: SourceHttp) {}
  async list(toolId: string, query: { q?: string; page?: string; pageSize?: string; platform?: string; architecture?: string }): Promise<ToolReleasePage> {
    if (!catalog.tools.some(tool => tool.id === toolId)) throw new NotFoundException('Unknown tool');
    if ([query.q, query.page, query.pageSize, query.platform, query.architecture].some(value => value !== undefined && typeof value !== 'string')) throw new BadRequestException('Query values must be strings');
    const page = Number(query.page ?? 1); const pageSize = Number(query.pageSize ?? 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || (query.q?.length ?? 0) > 80
      || (query.platform && !['windows', 'macos', 'linux'].includes(query.platform)) || (query.architecture && !['x64', 'arm64'].includes(query.architecture))) throw new BadRequestException('Invalid release query');
    const empty: ToolReleasePage = { toolId, items: [], total: 0, page, pageSize, revision: '', updatedAt: null, status: 'pending' };
    if (!sources.some(s => s.toolId === toolId)) return { ...empty, status: 'unsupported' };
    if (!this.repository.available) return { ...empty, status: 'unavailable' };
    const result = await this.repository.pool.query(`SELECT s.*, COALESCE((SELECT jsonb_agg(payload) FROM release_history WHERE tool_id=$1),'[]'::jsonb) AS items FROM release_sources s WHERE s.tool_id=$1`, [toolId]);
    const row = result.rows[0] as (SourceState & { items: ToolRelease[] }) | undefined;
    if (!row) return empty;
    const needle = query.q?.trim().toLowerCase() ?? '';
    let items = row.items.filter(item => !item.isPrerelease && item.version.toLowerCase().includes(needle));
    if (query.platform) items = items.filter(item => !item.assets.length || item.assets.some(a => !a.platform || (a.platform === query.platform && (!query.architecture || !a.architecture || a.architecture === 'universal' || a.architecture === query.architecture))));
    items.sort((a, b) => compareVersions(b.version, a.version));
    const status = row.updated_at ? (row.status === 'failed' || Date.now() - new Date(row.updated_at).getTime() > 2 * 86400000 ? 'stale' : 'ready') : row.status === 'failed' ? 'unavailable' : 'pending';
    return { ...empty, items: items.slice((page - 1) * pageSize, page * pageSize).map(item => ({ ...item, assets: item.assets.map(asset => ({ ...asset, platform: asset.platform && ['windows','macos','linux'].includes(asset.platform) ? asset.platform : undefined, architecture: asset.architecture && ['x64','arm64','x86','universal'].includes(asset.architecture) ? asset.architecture : undefined })) })), total: items.length, revision: row.revision, updatedAt: row.updated_at?.toISOString() ?? null, status };
  }
  async sync(toolIds?: string[], options: { force?: boolean; budgetMs?: number } = {}) {
    const chosen = toolIds?.length ? sources.filter(s => toolIds.includes(s.toolId)) : sources;
    if (toolIds?.some(id => !sources.some(s => s.toolId === id))) throw new BadRequestException('Unknown release source');
    const lock = await this.repository.pool.connect();
    const results: Array<{ toolId: string; status: string; count?: number; error?: string }> = [];
    try {
      const acquired = await lock.query('SELECT pg_try_advisory_lock(2026090923) AS acquired');
      if (!acquired.rows[0].acquired) return { status: 'busy', results, requests: 0 };
      const startRequests = this.http.requestCount;
      const deadline = Date.now() + (options.budgetMs ?? 45_000);
      const scheduled = await lock.query<{ tool_id: string; next_run_at: Date }>('SELECT tool_id,next_run_at FROM release_sources');
      const dueTimes = new Map(scheduled.rows.map(row => [row.tool_id, row.next_run_at.getTime()]));
      // A short cron budget must not repeatedly favor the beginning of the catalog.
      const queue = [...chosen].sort((a, b) => (dueTimes.get(a.toolId) ?? 0) - (dueTimes.get(b.toolId) ?? 0));
      const worker = async () => {
        while (queue.length && Date.now() < deadline) results.push(await this.syncSource(queue.shift()!, deadline, options.force));
      };
      const workers = await Promise.allSettled([worker(), worker()]);
      // Keep the coordinator lock until every in-flight worker has stopped,
      // including when a database operation fails outside the source handler.
      const failure = workers.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) throw failure.reason;
      return { status: results.some(r => ['failed', 'deferred'].includes(r.status)) ? 'partial' : queue.length || results.some(r => r.status === 'pending') ? 'pending' : 'complete', results, requests: this.http.requestCount - startRequests };
    } finally { try { await lock.query('SELECT pg_advisory_unlock(2026090923)'); } finally { lock.release(); } }
  }
  private async syncSource(source: ReleaseSource, deadline: number, force?: boolean) {
    const startedAt = new Date();
    const toolId = source.toolId; const token = await this.repository.claim(toolId, force);
    if (!token) {
      const state = await this.repository.state(toolId);
      return { toolId, status: state?.status === 'failed' ? 'deferred' : 'skipped', error: state?.error ?? undefined };
    }
    try {
      const state = await this.repository.state(toolId);
      const sourceFingerprint = JSON.stringify([source.kind, source.urls]);
      const checkpoint: Checkpoint = state?.checkpoint?.parserVersion === PARSER_VERSION && (!state.checkpoint.sourceFingerprint || state.checkpoint.sourceFingerprint === sourceFingerprint) && (state.checkpoint.queue.length || state.checkpoint.releases.length) ? state.checkpoint : { parserVersion: PARSER_VERSION, sourceFingerprint, queue: [...source.urls], visited: [], releases: [] };
      let schedule: Record<string, { end?: string }> = {};
      if (source.kind === 'node') {
        try { schedule = JSON.parse((await this.http.read(NODE_SCHEDULE)).body); }
        catch { const cached = await this.repository.cache(NODE_SCHEDULE); if (cached) schedule = JSON.parse(cached.body);
          await this.repository.pool.query('INSERT INTO history_reports(tool_id,status,payload) VALUES($1,$2,$3)', [toolId, 'metadata-unavailable', JSON.stringify({ field: 'eolDate', reason: 'Lifecycle schedule unavailable; release index remains authoritative' })]); }
      }
      while (checkpoint.queue.length && Date.now() < deadline) {
        const url = checkpoint.queue[0];
        const page = await this.http.read(url);
        const parsed = parsePage(source, page.body, url, schedule, checkpoint.metadata);
        if (parsed.metadata) checkpoint.metadata = { ...checkpoint.metadata, ...parsed.metadata };
        checkpoint.queue.shift(); checkpoint.visited.push(url);
        checkpoint.releases = mergeReleases([...checkpoint.releases, ...parsed.releases]);
        for (const next of [...parsed.next, ...(page.next_url ? [page.next_url] : [])]) {
          if (!checkpoint.visited.includes(next) && !checkpoint.queue.includes(next)) checkpoint.queue.push(next);
        }
        await this.repository.checkpoint(toolId, token, checkpoint);
      }
      if (checkpoint.queue.length) { await this.repository.pause(toolId, token); await this.repository.log(toolId, 'pending', checkpoint.releases.length, undefined, startedAt); return { toolId, status: 'pending', count: checkpoint.releases.length }; }
      if (!checkpoint.releases.length) throw new Error('Source returned no recognized stable releases; publication cancelled');
      await this.repository.publish(toolId, token, checkpoint.releases);
      await this.repository.log(toolId, 'success', checkpoint.releases.length, undefined, startedAt);
      return { toolId, status: 'ready', count: checkpoint.releases.length };
    } catch (error) {
      const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
      const message = error instanceof Error ? `${error.message}${cause instanceof Error ? `: ${cause.message}` : ''}` : 'Unknown source error';
      await this.repository.fail(toolId, token, message, error instanceof SourceHttpError ? error.retryMs : undefined);
      await this.repository.log(toolId, 'failed', 0, message, startedAt);
      return { toolId, status: 'failed', error: message };
    }
  }
}
