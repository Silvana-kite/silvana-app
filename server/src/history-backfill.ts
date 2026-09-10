import './infrastructure/source-tls.js';
import { Pool } from 'pg';
import { toHistory, redactError } from './modules/releases/history-codec.js';
import { isHistoryRelease } from '@siilvana/shared';
import { catalog } from '@siilvana/catalog';

async function main() {
  const url = process.env.DATABASE_URL; if (!url || new URL(url).pathname.endsWith('_test')) throw new Error('Backfill requires an explicit non-test database');
  const pool = new Pool({ connectionString: url }); const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(2026090923)');
    const selected = process.argv.find(a => a.startsWith('--tools='))?.slice(8).split(',');
    const rows = (await client.query('SELECT tool_id,payload FROM release_history ORDER BY tool_id,version')).rows;
    let imported = 0; const counts = new Map<string,number>();
    for (const row of rows) {
      if (selected && !selected.includes(row.tool_id)) continue;
      if (!catalog.tools.some(t => t.id === row.tool_id)) throw new Error('Unknown legacy tool; migration stopped');
      const record = toHistory(row.tool_id, row.payload); if (!isHistoryRelease(record)) throw new Error('Invalid legacy record; migration stopped');
      const result = await client.query(`INSERT INTO history_releases(release_id,tool_id,raw_version,build,release_type,release_track,normalized_sort_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING release_id`,
        [record.releaseId,record.toolId,record.rawVersion,record.build,record.releaseType,record.releaseTrack,record.normalizedSortKey,JSON.stringify(record)]);
      if (!result.rowCount) continue;
      for (const asset of record.assets) await client.query('INSERT INTO history_assets(asset_id,release_id,platform,arch,installer_type,vendor_asset_key,download_status,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [asset.assetId,asset.releaseId,asset.platform,asset.arch,asset.installerType,asset.vendorAssetKey,asset.downloadStatus,JSON.stringify(asset)]);
      imported++; counts.set(row.tool_id,(counts.get(row.tool_id) ?? 0)+1);
    }
    for (const [tool,count] of counts) {
      await client.query("UPDATE release_sources SET coverage_override='partial' WHERE tool_id=$1",[tool]);
      await client.query('INSERT INTO history_reports(tool_id,status,payload) VALUES($1,$2,$3)', [tool,'legacy-backfill',JSON.stringify({ imported:count, coverage:'partial', reason:'Legacy provenance and coverage require revalidation; no executable recipes imported' })]);
    }
    await client.query('COMMIT'); console.log(JSON.stringify({ imported, tools: Object.fromEntries(counts), preservedLegacyRecords: rows.length }));
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(redactError(error)); process.exitCode=1; });
