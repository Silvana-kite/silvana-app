import { readFile } from 'node:fs/promises';
import { createHash, verify } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { canonicalJson, unsigned, isHistoryRelease } from '../../packages/shared/dist/index.js';
const root = new URL('../../', import.meta.url); const directory = new URL('desktop/public/history/', root);
const lock = JSON.parse(await readFile(new URL('history-snapshot.lock.json', root), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const checkSignature = value => {
  if (value.datasetId !== lock.datasetId || value.schemaVersion !== 2 || !(lock.publicKeys?.[value.signature.keyId] ?? (value.signature.keyId === lock.keyId && lock.publicKey)) || !verify(null, Buffer.from(canonicalJson(unsigned(value))), lock.publicKeys?.[value.signature.keyId] ?? lock.publicKey, Buffer.from(value.signature.value, 'base64'))) throw new Error('Snapshot signature or dataset mismatch');
};
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')); checkSignature(manifest);
if (hash(canonicalJson(manifest)) !== lock.manifestHash || manifest.manifestRevision !== lock.manifestRevision) throw new Error('Unlocked manifest');
let total = 0; let count = 0;
for (const entry of manifest.tools) {
  if (!entry.toolRevision) { if (entry.quality.coverage === 'full') throw new Error('Missing snapshot declared complete'); continue; }
  const snapshot = JSON.parse(await readFile(new URL(`tools/${entry.toolId}/${entry.toolRevision}.json`, directory), 'utf8')); checkSignature(snapshot);
  if (hash(canonicalJson(snapshot)) !== entry.snapshotHash) throw new Error('Snapshot hash mismatch');
  const records = [];
  for (const shard of snapshot.shards) { const body = await readFile(new URL(`blobs/${shard.hash}`, directory)); total += body.length;
    if (body.length !== shard.bytes || hash(body) !== shard.hash) throw new Error('Compressed blob mismatch');
    const raw = gunzipSync(body, { maxOutputLength: 16 * 1024 * 1024 }); if (raw.length !== shard.rawBytes || hash(raw) !== shard.rawHash) throw new Error('Uncompressed blob mismatch');
    const rows = JSON.parse(raw.toString()); if (rows.length !== shard.count) throw new Error('Shard count mismatch'); records.push(...rows);
  }
  if (records.length !== snapshot.count || records.length !== entry.count || !records.every(isHistoryRelease) || new Set(records.map(r => r.releaseId)).size !== records.length || hash(canonicalJson(records)) !== snapshot.rootHash) throw new Error('Invalid snapshot records');
  count += records.length;
}
if (total > 50 * 1024 * 1024) throw new Error('Offline bundle exceeds budget');
console.log(JSON.stringify({ verified: true, records: count, bytes: total }));
