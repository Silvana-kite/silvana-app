import { verifyAsync } from '@noble/ed25519';
import { canonicalJson, isHistoryRelease, unsigned, MAX_SHARD_BYTES, type HistorySnapshot, type HistoryRelease } from '@siilvana/shared';
import { historyDataset, historyKeys } from './history-trust';
const encode = (value: unknown) => new TextEncoder().encode(canonicalJson(value));
const digest = async (value: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value as BufferSource))].map(v => v.toString(16).padStart(2,'0')).join('');
const base64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function read(stream: ReadableStream<Uint8Array>, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected > MAX_SHARD_BYTES) throw new Error('Invalid shard size');
  const reader = stream.getReader(); const parts: Uint8Array[] = []; let length = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > expected) { await reader.cancel(); throw new Error('Shard size limit exceeded'); } parts.push(value); }
  if (length !== expected) throw new Error('Shard size mismatch'); const result = new Uint8Array(length); let offset = 0; for (const part of parts) { result.set(part,offset); offset += part.length; } return result;
}
self.onmessage = async (event: MessageEvent<{ snapshot: HistorySnapshot; records?: HistoryRelease[]; base?: string }>) => {
  try {
    const { snapshot, base } = event.data; let records = event.data.records;
    const key = historyKeys[snapshot.signature?.keyId];
    if (snapshot.schemaVersion !== 2 || snapshot.datasetId !== historyDataset || !key || snapshot.signature.algorithm !== 'Ed25519'
      || !await verifyAsync(base64(snapshot.signature.value), encode(unsigned(snapshot)), base64(key))) throw new Error('Snapshot signature failed');
    if (!records) {
      records = [];
      for (const shard of snapshot.shards) {
        if (!/^[a-f0-9]{64}$/.test(shard.hash)) throw new Error('Invalid blob hash');
        const response = await fetch(`${base}/blobs/${shard.hash}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok || !response.body) throw new Error('Snapshot blob unavailable');
        const compressed = await read(response.body,shard.bytes); if (await digest(compressed) !== shard.hash) throw new Error('Blob hash mismatch');
        const raw = await read(new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),shard.rawBytes);
        if (await digest(raw) !== shard.rawHash) throw new Error('Decoded hash mismatch');
        const rows = JSON.parse(new TextDecoder().decode(raw)); if (!Array.isArray(rows) || rows.length !== shard.count) throw new Error('Shard record count mismatch'); records.push(...rows);
      }
    }
    records.sort((a,b) => a.releaseId.localeCompare(b.releaseId));
    if (records.length !== snapshot.count || new Set(records.map(r=>r.releaseId)).size !== records.length || !records.every(r=>isHistoryRelease(r) && r.toolId===snapshot.toolId) || await digest(encode(records)) !== snapshot.rootHash) throw new Error('Snapshot records corrupted');
    self.postMessage({ records });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'History decode failed' }); }
};
