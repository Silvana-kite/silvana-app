/** Versioned discovery contracts. No record in this module authorizes execution. */
export type Coverage = 'full' | 'partial' | 'latest-only' | 'undisclosed';
export type SourceStatus = 'pending' | 'syncing' | 'ready' | 'failed' | 'disabled';
export interface HistoryQuality {
  coverage: Coverage;
  scope: string;
  sourceStatus: SourceStatus;
  lastSuccessAt: string | null;
  missingReason: string | null;
  reportId?: string;
}
export interface HistoryAsset {
  assetId: string; releaseId: string; platform: string; arch: string;
  installerType: string; vendorAssetKey: string; name: string; url: string;
  kind: 'binary' | 'source'; sha256?: string; signatureUrl?: string;
  downloadStatus: 'unknown' | 'available' | 'unavailable';
  checkedAt: string | null; missingReason: string | null;
  yanked?: boolean; yankedReason?: string;
}
export interface HistoryRelease {
  releaseId: string; toolId: string; rawVersion: string; version: string;
  build: string; releaseType: string; releaseTrack: string; normalizedSortKey: string;
  releaseDate: string | null; sourceUrl: string; pageUrl: string;
  isLts: boolean; isPrerelease: boolean; eol: boolean | null; eolDate?: string;
  withdrawn: boolean; withdrawnReason: string | null; bundledNpm?: string;
  assets: HistoryAsset[];
}
export interface SnapshotShard {
  hash: string; rawHash: string; bytes: number; rawBytes: number; count: number;
}
export interface Signature { keyId: string; algorithm: 'Ed25519'; value: string }
export interface HistorySnapshot {
  schemaVersion: 2; datasetId: string; toolId: string; toolRevision: string;
  generatedAt: string; sortVersion: 1; count: number; assetCount: number;
  quality: HistoryQuality; rootHash: string; shards: SnapshotShard[]; signature: Signature;
}
export interface HistoryManifest {
  schemaVersion: 2; datasetId: string; manifestRevision: string; generatedAt: string;
  tools: Array<{ toolId: string; toolRevision: string | null; snapshotHash: string | null; count: number | null; quality: HistoryQuality }>;
  signature: Signature;
}
export interface HistoryDiff {
  schemaVersion: 2; datasetId: string; toolId: string; from: string; to: string;
  upserts: HistoryRelease[]; target: HistorySnapshot;
}
export const HISTORY_SCHEMA = 2;
export const MAX_SHARD_BYTES = 16 * 1024 * 1024;
const revisionString = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d*$/.test(v);
const checksum = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function isHistoryQuality(v: any): v is HistoryQuality {
  return !!v && ['full','partial','latest-only','undisclosed'].includes(v.coverage) && ['pending','syncing','ready','failed','disabled'].includes(v.sourceStatus)
    && typeof v.scope === 'string' && (v.lastSuccessAt === null || typeof v.lastSuccessAt === 'string') && (v.missingReason === null || typeof v.missingReason === 'string');
}
function signedShape(v: any): boolean {
  return !!v && v.schemaVersion === 2 && typeof v.datasetId === 'string' && typeof v.generatedAt === 'string'
    && !!v.signature && v.signature.algorithm === 'Ed25519' && typeof v.signature.keyId === 'string' && typeof v.signature.value === 'string';
}
export function isHistorySnapshot(v: any): v is HistorySnapshot {
  return signedShape(v) && typeof v.toolId === 'string' && revisionString(v.toolRevision) && v.sortVersion === 1 && Number.isSafeInteger(v.count) && v.count >= 0
    && Number.isSafeInteger(v.assetCount) && v.assetCount >= 0 && checksum(v.rootHash) && isHistoryQuality(v.quality) && Array.isArray(v.shards)
    && v.shards.every((s: any) => checksum(s.hash) && checksum(s.rawHash) && [s.bytes,s.rawBytes,s.count].every(n => Number.isSafeInteger(n) && n > 0) && s.bytes <= MAX_SHARD_BYTES && s.rawBytes <= MAX_SHARD_BYTES);
}
export function isHistoryManifest(v: any): v is HistoryManifest {
  return signedShape(v) && revisionString(v.manifestRevision) && Array.isArray(v.tools) && new Set(v.tools.map((t: any) => t?.toolId)).size === v.tools.length
    && v.tools.every((t: any) => typeof t.toolId === 'string' && /^[a-z0-9-]+$/.test(t.toolId) && isHistoryQuality(t.quality)
      && (t.toolRevision === null ? t.snapshotHash === null && t.count === null : revisionString(t.toolRevision) && checksum(t.snapshotHash) && Number.isSafeInteger(t.count) && t.count >= 0));
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  throw new Error('Non-JSON snapshot value');
}
export function unsigned<T extends { signature: Signature }>(value: T): Omit<T, 'signature'> {
  const { signature: _, ...payload } = value; return payload;
}
export function compareRevision(left: string, right: string): number {
  if (!/^(0|[1-9]\d*)$/.test(left) || !/^(0|[1-9]\d*)$/.test(right)) throw new Error('Invalid revision');
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}
export function sortKey(version: string, prerelease = false): string {
  return version.toLowerCase().replace(/\d+/g, n => n.padStart(16, '0')) + (prerelease ? ':0' : ':1');
}
export function compareHistory(a: HistoryRelease, b: HistoryRelease): number {
  const numeric = (v: string) => v.match(/\d+/g)?.map(Number) ?? [];
  const left = numeric(a.version.match(/^\d+(?:\.\d+)*/)?.[0] ?? ''); const right = numeric(b.version.match(/^\d+(?:\.\d+)*/)?.[0] ?? '');
  for (let i = 0; i < Math.max(left.length, right.length); i++) if ((right[i] ?? 0) !== (left[i] ?? 0)) return (right[i] ?? 0) - (left[i] ?? 0);
  return Number(a.isPrerelease) - Number(b.isPrerelease) || b.normalizedSortKey.localeCompare(a.normalizedSortKey) || a.releaseId.localeCompare(b.releaseId);
}
export function validHttps(value: unknown): value is string {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'); } catch { return false; }
}
export function isHistoryRelease(value: unknown): value is HistoryRelease {
  if (!value || typeof value !== 'object') return false;
  const r = value as HistoryRelease;
  return ['releaseId', 'toolId', 'rawVersion', 'version', 'build', 'releaseType', 'releaseTrack', 'normalizedSortKey'].every(k => typeof (r as unknown as Record<string, unknown>)[k] === 'string')
    && ['isLts', 'isPrerelease', 'withdrawn'].every(k => typeof (r as unknown as Record<string, unknown>)[k] === 'boolean')
    && (r.eol === null || typeof r.eol === 'boolean')
    && validHttps(r.sourceUrl) && validHttps(r.pageUrl) && Array.isArray(r.assets)
    && r.assets.every(a => a.releaseId === r.releaseId && typeof a.assetId === 'string' && typeof a.name === 'string' && validHttps(a.url)
      && ['unknown', 'available', 'unavailable'].includes(a.downloadStatus) && ['binary', 'source'].includes(a.kind));
}
