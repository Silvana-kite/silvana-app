import { isOfficialUrl } from '@siilvana/catalog';
import { createHash, createPrivateKey, sign, verify, createPublicKey } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { canonicalJson, sortKey, unsigned, validHttps, MAX_SHARD_BYTES, type HistoryRelease, type HistorySnapshot, type HistoryQuality, type Signature, type ToolRelease } from '@siilvana/shared';

export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function signed<T extends object>(payload: T, key: string, keyId: string): T & { signature: Signature } {
  const privateKey = createPrivateKey(key);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Snapshot signing requires Ed25519');
  return { ...payload, signature: { algorithm: 'Ed25519', keyId, value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') } };
}
export function verifySigned<T extends { signature: Signature }>(value: T, publicKey: string): boolean {
  return value.signature.algorithm === 'Ed25519' && verify(null, Buffer.from(canonicalJson(unsigned(value))), createPublicKey(publicKey), Buffer.from(value.signature.value, 'base64'));
}
export function toHistory(toolId: string, item: ToolRelease): HistoryRelease {
  if (!isOfficialUrl(item.sourceUrl) || !isOfficialUrl(item.pageUrl)) throw new Error('Unregistered release source or page');
  const build = item.build ?? ''; const releaseTrack = item.releaseTrack ?? (item.isPrerelease ? 'preview' : 'stable');
  const releaseType = 'release';
  const releaseId = hash(canonicalJson([toolId, item.originalVersion, build, releaseType, releaseTrack]));
  return { releaseId, toolId, rawVersion: item.originalVersion, version: item.version, build, releaseType, releaseTrack,
    normalizedSortKey: sortKey(`${item.version}+${build}`, item.isPrerelease), releaseDate: item.releaseDate ?? null,
    sourceUrl: item.sourceUrl, pageUrl: item.pageUrl, isLts: item.isLts ?? item.channel === 'lts', isPrerelease: !!item.isPrerelease,
    eol: item.eolDate ? Date.parse(item.eolDate) <= Date.now() : item.channel === 'eol' ? true : null, eolDate: item.eolDate, withdrawn: !!item.withdrawn, withdrawnReason: item.withdrawnReason ?? null, bundledNpm: item.bundledNpm,
    assets: item.assets.filter(a => validHttps(a.url)).map(a => {
      const platform = a.platform ?? 'unknown'; const arch = a.architecture ?? 'unknown';
      const installerType = /\.(tar\.(?:gz|xz|bz2)|[a-z0-9]+)(?:$|\?)/i.exec(new URL(a.url).pathname)?.[1] ?? a.kind;
      const vendorAssetKey = a.name;
      return { assetId: hash(canonicalJson([releaseId, platform, arch, installerType, vendorAssetKey])), releaseId, platform, arch, installerType, vendorAssetKey,
        name: a.name, url: a.url, kind: a.kind, sha256: a.sha256, downloadStatus: isOfficialUrl(a.url) ? 'unknown' as const : 'unavailable' as const, checkedAt: null, missingReason: isOfficialUrl(a.url) ? null : '下载来源尚未登记', yanked: a.yanked, yankedReason: a.yankedReason };
    }) };
}
export function makeSnapshot(datasetId: string, toolId: string, toolRevision: string, records: HistoryRelease[], quality: HistoryQuality, key: string, keyId: string) {
  const sorted = [...records].sort((a, b) => a.releaseId.localeCompare(b.releaseId));
  const blobs = new Map<string, Buffer>(); const shards: HistorySnapshot['shards'] = [];
  let batch: HistoryRelease[] = []; let bytes = 2;
  const flush = () => {
    if (!batch.length) return;
    const raw = Buffer.from(canonicalJson(batch));
    if (raw.length > MAX_SHARD_BYTES) throw new Error('Snapshot shard too large');
    const body = gzipSync(raw, { level: 9 }); const digest = hash(body); blobs.set(digest, body);
    shards.push({ hash: digest, rawHash: hash(raw), bytes: body.length, rawBytes: raw.length, count: batch.length }); batch = []; bytes = 2;
  };
  for (const record of sorted) { const length = Buffer.byteLength(canonicalJson(record)) + 1; if (bytes + length > 1024 * 1024) flush(); batch.push(record); bytes += length; }
  flush();
  const descriptor: HistorySnapshot = signed({ schemaVersion: 2 as const, datasetId, toolId, toolRevision, generatedAt: new Date().toISOString(), sortVersion: 1 as const,
    count: sorted.length, assetCount: sorted.reduce((n, r) => n + r.assets.length, 0), quality, rootHash: hash(canonicalJson(sorted)), shards }, key, keyId);
  return { descriptor, blobs, records: sorted };
}
export function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:postgres(?:ql)?|https?):\/\/[^\s)]+/gi, '[URL]').replace(/(?:Bearer\s+|token[=:]\s*)\S+/gi, '[credential]').replace(/[A-Za-z]:[\\/][^\s]+/g, '[path]').slice(0, 500);
}
