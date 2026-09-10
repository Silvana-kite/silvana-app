import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { toHistory, redactError } from './history-codec.js';
import type { ToolRelease } from '@siilvana/shared';
import { InjectDatabase, type Database } from '../../infrastructure/database/database.module.js';

export interface Checkpoint { parserVersion: number; sourceFingerprint?: string; metadata?: { ltsFeatures?: number[] }; queue: string[]; visited: string[]; releases: ToolRelease[] }
export interface SourceState {
  tool_id: string; revision: string; updated_at: Date | null; next_run_at: Date;
  status: string; error: string | null; failures: number; checkpoint: Checkpoint | null;
}
export interface CachedPage {
  url: string; body: string; etag: string | null; last_modified: string | null; next_url: string | null;
}
export const PARSER_VERSION = 5;

@Injectable()
export class ReleaseRepository {
  constructor(@InjectDatabase() private readonly database: Database | null) {}
  get available() { return !!this.database; }
  get pool(): Pool {
    if (!this.database) throw new ServiceUnavailableException('历史版本服务需要配置 DATABASE_URL');
    return this.database.$client;
  }
  async state(tool: string): Promise<SourceState | undefined> {
    return (await this.pool.query('SELECT * FROM release_sources WHERE tool_id=$1', [tool])).rows[0];
  }
  async releases(tool: string): Promise<ToolRelease[]> {
    return (await this.pool.query('SELECT payload FROM release_history WHERE tool_id=$1', [tool])).rows.map(row => row.payload);
  }
  async claim(tool: string, force = false): Promise<string | undefined> {
    await this.pool.query('INSERT INTO release_sources(tool_id) VALUES($1) ON CONFLICT DO NOTHING', [tool]);
    const token = randomUUID();
    const result = await this.pool.query(`UPDATE release_sources SET lease_token=$2, lease_until=now()+interval '90 seconds', status='syncing',last_attempt_at=now(),first_attempt_at=COALESCE(first_attempt_at,now())
      WHERE tool_id=$1 AND (lease_until IS NULL OR lease_until<now()) AND ($3 OR next_run_at<=now()) RETURNING tool_id`, [tool, token, force]);
    return result.rowCount ? token : undefined;
  }
  async checkpoint(tool: string, token: string, checkpoint: Checkpoint) {
    const result = await this.pool.query(`UPDATE release_sources SET checkpoint=$3::jsonb,lease_until=now()+interval '90 seconds'
      WHERE tool_id=$1 AND lease_token=$2 RETURNING tool_id`, [tool, token, JSON.stringify(checkpoint)]);
    if (!result.rowCount) throw new Error('Sync lease was lost');
  }
  async pause(tool: string, token: string) {
    await this.pool.query(`UPDATE release_sources SET lease_token=NULL,lease_until=NULL,status='pending',next_run_at=now()
      WHERE tool_id=$1 AND lease_token=$2`, [tool, token]);
  }
  async publish(tool: string, token: string, releases: ToolRelease[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owner = await client.query('SELECT tool_id FROM release_sources WHERE tool_id=$1 AND lease_token=$2 FOR UPDATE', [tool, token]);
      if (!owner.rowCount) throw new Error('Sync lease was lost');
      const legacy = new Map<string, ToolRelease>();
      for (const release of releases.filter(r => !r.isPrerelease)) {
        const previous = legacy.get(release.version);
        legacy.set(release.version, previous ? { ...previous, assets: [...new Map([...previous.assets, ...release.assets].map(a => [a.url, a])).values()] } : release);
      }
      // Preserve older published records when a vendor shortens its public feed.
      await client.query(`INSERT INTO release_history(tool_id,version,payload)
        SELECT $1, item->>'version', item FROM jsonb_array_elements($2::jsonb) AS item
        ON CONFLICT(tool_id,version) DO UPDATE SET payload=EXCLUDED.payload`, [tool, JSON.stringify([...legacy.values()])]);
      for (const release of releases) {
        const record = toHistory(tool, release);
        const existing = (await client.query('SELECT payload FROM history_releases WHERE release_id=$1', [record.releaseId])).rows[0]?.payload;
        if (existing) for (const old of existing.assets) {
          if ((old.platform === 'unknown' || old.arch === 'unknown') && record.assets.some(next => next.assetId !== old.assetId && next.url === old.url && next.vendorAssetKey === old.vendorAssetKey)) { old.downloadStatus = 'unavailable'; old.missingReason = '平台信息已补全，请使用对应的新资源记录'; }
        }
        if (existing) record.assets = [...new Map([...existing.assets, ...record.assets.map(asset => { const old = existing.assets.find((a: { assetId: string }) => a.assetId === asset.assetId); return { ...old, ...asset, downloadStatus: old?.url === asset.url ? old.downloadStatus : asset.downloadStatus, checkedAt: old?.url === asset.url ? old.checkedAt : null, missingReason: old?.url === asset.url ? old.missingReason : null }; })].map(asset => [asset.assetId, asset])).values()] as typeof record.assets;
        await client.query(`INSERT INTO history_releases(release_id,tool_id,raw_version,build,release_type,release_track,normalized_sort_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(release_id) DO UPDATE SET normalized_sort_key=$7,payload=$8`, [record.releaseId, tool, record.rawVersion, record.build, record.releaseType, record.releaseTrack, record.normalizedSortKey, JSON.stringify(record)]);
        for (const asset of record.assets) await client.query(`INSERT INTO history_assets(asset_id,release_id,platform,arch,installer_type,vendor_asset_key,download_status,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(asset_id) DO UPDATE SET download_status=$7,payload=$8`, [asset.assetId, record.releaseId, asset.platform, asset.arch, asset.installerType, asset.vendorAssetKey, asset.downloadStatus, JSON.stringify(asset)]);
      }
      const previousCount = Number((await client.query('SELECT candidate_count FROM sync_runs WHERE source=$1 AND status=$2 ORDER BY completed_at DESC LIMIT 1', [tool, 'success'])).rows[0]?.candidate_count ?? 0);
      if (previousCount > 0 && releases.length < previousCount * .9) await client.query('INSERT INTO history_alerts(tool_id,rule,detail) VALUES($1,$2,$3) ON CONFLICT(tool_id,rule) WHERE resolved_at IS NULL DO NOTHING', [tool, 'source-count-drop', `Source count decreased from ${previousCount} to ${releases.length}; retained published history`]);
      await client.query('INSERT INTO history_reports(tool_id,status,payload) VALUES($1,$2,$3)', [tool, 'published', JSON.stringify({ parserVersion: PARSER_VERSION, pagesComplete: true, count: releases.length })]);
      const rows = await client.query('SELECT payload FROM release_history WHERE tool_id=$1 ORDER BY version', [tool]);
      const revision = createHash('sha256').update(JSON.stringify(rows.rows)).digest('hex').slice(0, 20);
      await client.query(`UPDATE release_sources SET revision=$3,updated_at=now(),next_run_at=now()+interval '24 hours',
        status='ready',error=NULL,failures=0,checkpoint=NULL,coverage_override=NULL,lease_token=NULL,lease_until=NULL WHERE tool_id=$1 AND lease_token=$2`, [tool, token, revision]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async fail(tool: string, token: string, error: string, retryMs?: number) {
    const state = await this.state(tool);
    const retryDelay = Number.isFinite(retryMs) && retryMs! > 0 ? retryMs! : 0;
    const delay = Math.max(retryDelay, Math.min(86400000, 60000 * 2 ** Math.min(state?.failures ?? 0, 10)));
    await this.pool.query(`UPDATE release_sources SET status='failed',error=$3,failures=failures+1,
      next_run_at=now()+($4 * interval '1 millisecond'),lease_token=NULL,lease_until=NULL WHERE tool_id=$1 AND lease_token=$2`, [tool, token, redactError(error), delay]);
  }
  async cache(url: string): Promise<CachedPage | undefined> {
    return (await this.pool.query('SELECT * FROM release_page_cache WHERE url=$1', [url])).rows[0];
  }
  async savePage(page: CachedPage) {
    const checksum = createHash('sha256').update(page.body).digest('hex');
    await this.pool.query(`INSERT INTO release_page_cache(url,body,etag,last_modified,next_url,checksum,parser_version)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(url) DO UPDATE SET body=$2,etag=$3,last_modified=$4,next_url=$5,checksum=$6,parser_version=$7,checked_at=now()`,
    [page.url, page.body, page.etag, page.last_modified, page.next_url, checksum, PARSER_VERSION]);
  }
  async log(tool: string, status: string, count: number, error?: string, startedAt = new Date()) {
    await this.pool.query('INSERT INTO sync_runs(source,status,candidate_count,error,started_at,completed_at) VALUES($1,$2,$3,$4,$5,now())', [tool, status, count, error ? redactError(error) : null, startedAt]);
  }
}
