import './infrastructure/source-tls.js';
import { Pool } from 'pg';
import { isOfficialUrl } from '@siilvana/catalog';
import { officialDispatcher } from './modules/releases/network-policy.js';
import { redactError } from './modules/releases/history-codec.js';

async function main() {
  const url = process.env.DATABASE_URL; if (!url || new URL(url).pathname.endsWith('_test')) throw new Error('Resource checks require a non-test database');
  const limit = Number(process.argv.find(a=>a.startsWith('--limit='))?.slice(8) ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Probe limit must be 1–100');
  const tool = process.argv.find(a=>a.startsWith('--tool='))?.slice(7);
  const pool = new Pool({connectionString:url});
  try {
    const rows = (await pool.query(`SELECT a.* FROM history_assets a JOIN history_releases r USING(release_id) WHERE ($1::text IS NULL OR r.tool_id=$1)
      AND (a.payload->>'checkedAt' IS NULL OR (a.payload->>'checkedAt')::timestamptz<now()-interval '1 day') ORDER BY a.payload->>'checkedAt' NULLS FIRST LIMIT $2`,[tool ?? null,limit])).rows;
    let checked = 0;
    for (const row of rows) {
      const asset = row.payload; let target = asset.url; let status: number | undefined;
      if (!isOfficialUrl(target)) continue;
      try {
        for (let hop=0;hop<=5;hop++) {
          if (!isOfficialUrl(target)) throw new Error('Unregistered redirect');
          const response = await fetch(target,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(10000),dispatcher:officialDispatcher} as RequestInit);
          if (![301,302,303,307,308].includes(response.status)) { status=response.status; break; }
          target=new URL(response.headers.get('location') ?? '',target).href;
        }
      } catch { /* Network failure is not proof that a vendor deleted a resource. */ }
      asset.checkedAt=new Date().toISOString();
      let firstMissing = row.first_missing_at;
      if (status && status>=200 && status<300) { asset.downloadStatus='available'; asset.missingReason=null; firstMissing=null; }
      else if (status===404 || status===410) {
        if (firstMissing && Date.now()-new Date(firstMissing).getTime()>=86400000) { asset.downloadStatus='unavailable';asset.missingReason=`Official resource returned HTTP ${status} on two checks at least 24 hours apart`; }
        else firstMissing ??= new Date();
      }
      const client=await pool.connect();
      try { await client.query('BEGIN');
        await client.query('SELECT release_id FROM history_releases WHERE release_id=$1 FOR UPDATE',[row.release_id]);
        await client.query('UPDATE history_assets SET payload=$2,download_status=$3,first_missing_at=$4 WHERE asset_id=$1',[row.asset_id,JSON.stringify(asset),asset.downloadStatus,firstMissing]);
        await client.query(`UPDATE history_releases SET payload=jsonb_set(payload,'{assets}',(SELECT jsonb_agg(CASE WHEN entry->>'assetId'=$2 THEN $3::jsonb ELSE entry END ORDER BY ordinal) FROM jsonb_array_elements(payload->'assets') WITH ORDINALITY AS elements(entry,ordinal))) WHERE release_id=$1`,[row.release_id,row.asset_id,JSON.stringify(asset)]);
        await client.query('COMMIT');checked++;
      } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    console.log(JSON.stringify({checked,downloadedBinaries:0}));
  } finally {await pool.end();await officialDispatcher.close();}
}
main().catch(error=>{console.error(redactError(error));process.exitCode=1;});
