import { Injectable, NotFoundException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { catalog } from '@siilvana/catalog';
import { canonicalJson, type HistoryManifest, type HistoryQuality, type HistoryRelease, type HistorySnapshot, type HistoryDiff } from '@siilvana/shared';
import { InjectDatabase, type Database } from '../../infrastructure/database/database.module.js';
import { hash, makeSnapshot, signed, redactError } from './history-codec.js';
import { sourceQuality } from './source-quality.js';

@Injectable()
export class HistoryService {
  constructor(@InjectDatabase() private readonly database: Database | null) {}
  get datasetId() { return process.env.HISTORY_DATASET_ID ?? 'siilvana-local'; }
  private get pool() { if (!this.database) throw new ServiceUnavailableException('History database is not configured'); return this.database.$client; }
  async manifest(): Promise<HistoryManifest> {
    const row = (await this.pool.query('SELECT payload FROM history_manifests WHERE dataset_id=$1 ORDER BY history_manifests.manifest_revision DESC LIMIT 1', [this.datasetId])).rows[0];
    if (!row) throw new ServiceUnavailableException('No signed history has been published'); return row.payload;
  }
  async snapshot(toolId: string, revision?: string): Promise<HistorySnapshot> {
    if (!catalog.tools.some(t => t.id === toolId)) throw new NotFoundException('Unknown tool');
    if (revision !== undefined && (typeof revision !== 'string' || !/^[1-9]\d{0,18}$/.test(revision))) throw new ConflictException('Invalid tool revision');
    const row = (await this.pool.query('SELECT descriptor FROM history_snapshots WHERE dataset_id=$1 AND tool_id=$2 AND ($3::bigint IS NULL OR tool_revision=$3) ORDER BY history_snapshots.tool_revision DESC LIMIT 1', [this.datasetId, toolId, revision ?? null])).rows[0];
    if (!row) throw new ConflictException('Requested revision is unavailable; reload manifest'); return row.descriptor;
  }
  async blob(digest: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new NotFoundException();
    const row = (await this.pool.query('SELECT body FROM history_blobs WHERE hash=$1', [digest])).rows[0];
    if (!row) throw new NotFoundException();
    if (hash(row.body) !== digest) { await this.pool.query('INSERT INTO history_alerts(tool_id,rule,detail) VALUES($1,$2,$3) ON CONFLICT(tool_id,rule) WHERE resolved_at IS NULL DO NOTHING', ['catalog','snapshot-integrity','Published blob hash mismatch']); throw new ServiceUnavailableException('Snapshot integrity failure'); }
    return row.body;
  }
  async diff(toolId: string, from: string, to: string): Promise<HistoryDiff> {
    if (typeof from !== 'string' || typeof to !== 'string') throw new ConflictException('A precise baseline and target revision are required');
    const target = await this.snapshot(toolId, to); await this.snapshot(toolId, from);
    const rows = (await this.pool.query('SELECT tool_revision::text,records FROM history_snapshots WHERE dataset_id=$1 AND tool_id=$2 AND tool_revision IN ($3,$4)', [this.datasetId, toolId, from, to])).rows;
    const baseline: HistoryRelease[] = rows.find(r => r.tool_revision === from)?.records ?? [];
    const records: HistoryRelease[] = rows.find(r => r.tool_revision === to)?.records ?? [];
    const old = new Map(baseline.map(r => [r.releaseId, canonicalJson(r)]));
    return { schemaVersion: 2, datasetId: this.datasetId, toolId, from, to, target, upserts: records.filter(r => old.get(r.releaseId) !== canonicalJson(r)) };
  }
  async publish(): Promise<HistoryManifest> {
    const key = process.env.HISTORY_SIGNING_KEY?.replace(/\\n/g, '\n'); const keyId = process.env.HISTORY_SIGNING_KEY_ID;
    if (!key || !keyId) throw new Error('HISTORY_SIGNING_KEY and HISTORY_SIGNING_KEY_ID are required to publish');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(2026091002)');
      const entries: HistoryManifest['tools'] = [];
      for (const tool of catalog.tools) {
        const state = (await client.query('SELECT * FROM release_sources WHERE tool_id=$1', [tool.id])).rows[0];
        const quality = sourceQuality(tool, state);
        const records: HistoryRelease[] = (await client.query('SELECT payload FROM history_releases WHERE tool_id=$1 ORDER BY release_id', [tool.id])).rows.map(r => r.payload);
        let previous = (await client.query('SELECT tool_revision::text,descriptor,content_hash FROM history_snapshots WHERE dataset_id=$1 AND tool_id=$2 ORDER BY history_snapshots.tool_revision DESC LIMIT 1', [this.datasetId, tool.id])).rows[0];
        // A failed attempt changes source health, never the published record set or its coverage.
        if (records.length && state?.updated_at) {
          const publicationQuality = previous && state.status === 'failed' ? previous.descriptor.quality as HistoryQuality : quality;
          const stableQuality = { ...publicationQuality, sourceStatus: 'ready' as const, lastSuccessAt: null };
          const contentHash = hash(canonicalJson({ records, quality: stableQuality }));
          if (previous?.content_hash !== contentHash || previous?.descriptor.signature.keyId !== keyId) {
            const revision = (BigInt(previous?.tool_revision ?? '0') + 1n).toString();
            const result = makeSnapshot(this.datasetId, tool.id, revision, records, publicationQuality, key, keyId);
            for (const [digest, body] of result.blobs) await client.query('INSERT INTO history_blobs(hash,body) VALUES($1,$2) ON CONFLICT DO NOTHING', [digest, body]);
            await client.query('INSERT INTO history_snapshots(dataset_id,tool_id,tool_revision,content_hash,descriptor,records) VALUES($1,$2,$3,$4,$5,$6)', [this.datasetId, tool.id, revision, contentHash, JSON.stringify(result.descriptor), JSON.stringify(result.records)]);
            previous = { tool_revision: revision, descriptor: result.descriptor, content_hash: contentHash };
          }
        }
        entries.push({ toolId: tool.id, toolRevision: previous?.tool_revision ?? null, snapshotHash: previous ? hash(canonicalJson(previous.descriptor)) : null,
          count: previous?.descriptor.count ?? null, quality: previous && state?.status === 'failed' ? { ...previous.descriptor.quality, sourceStatus: 'failed', missingReason: quality.missingReason } : quality });
      }
      const last = (await client.query('SELECT manifest_revision::text,content_hash,payload FROM history_manifests WHERE dataset_id=$1 ORDER BY history_manifests.manifest_revision DESC LIMIT 1', [this.datasetId])).rows[0];
      const contentHash = hash(canonicalJson(entries));
      let manifest: HistoryManifest = last?.payload;
      if (last?.content_hash !== contentHash) {
        manifest = signed({ schemaVersion: 2 as const, datasetId: this.datasetId, manifestRevision: (BigInt(last?.manifest_revision ?? '0') + 1n).toString(), generatedAt: new Date().toISOString(), tools: entries }, key, keyId);
        await client.query('INSERT INTO history_manifests(dataset_id,manifest_revision,content_hash,payload) VALUES($1,$2,$3,$4)', [this.datasetId, manifest.manifestRevision, contentHash, JSON.stringify(manifest)]);
      }
      await client.query("UPDATE history_alerts SET resolved_at=now(),delivered_at=NULL,attempts=0 WHERE tool_id='catalog' AND rule='snapshot-publication-failed' AND resolved_at IS NULL");
      await client.query('COMMIT'); return manifest;
    } catch (error) { await client.query('ROLLBACK');
      await client.query('INSERT INTO history_alerts(tool_id,rule,detail) VALUES($1,$2,$3) ON CONFLICT(tool_id,rule) WHERE resolved_at IS NULL DO NOTHING', ['catalog','snapshot-publication-failed',redactError(error)]).catch(() => undefined);
      throw error; }
    finally { client.release(); }
  }
}
