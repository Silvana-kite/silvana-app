import { catalog } from '@siilvana/catalog';
import { reactive } from 'vue';
import { verifyAsync } from '@noble/ed25519';
import { canonicalJson, isHistoryManifest, isHistorySnapshot, compareRevision, compareHistory, isHistoryRelease, MAX_SHARD_BYTES, unsigned,
  type HistoryManifest, type HistorySnapshot, type HistoryRelease, type Signature, type ToolReleasePage, type HistoryDiff } from '@siilvana/shared';
import { historyDataset, historyKeys } from './history-trust';

interface Stored { snapshot: HistorySnapshot; records: HistoryRelease[]; usedAt: number }
const memory = new Map<string, Stored>();
const requests = new Map<string, Promise<Stored | undefined>>();
let manifest: HistoryManifest | undefined; let manifestAt = 0; let manifestRemote = false;
let database: Promise<IDBDatabase> | undefined;
const bundle = '/history';
export const historyState = reactive({ message: '', persistent: true });
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(v => v.toString(16).padStart(2, '0')).join('');
const encode = (value: unknown) => new TextEncoder().encode(canonicalJson(value));
const unbase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function verify<T extends { signature: Signature; schemaVersion: number; datasetId: string }>(value: T): Promise<T> {
  if (!('toolRevision' in value ? isHistorySnapshot(value) : isHistoryManifest(value))) throw new Error('历史数据契约校验失败');
  if (value.schemaVersion !== 2 || value.datasetId !== historyDataset || value.signature?.algorithm !== 'Ed25519') throw new Error('历史数据格式或数据集不匹配');
  const key = historyKeys[value.signature.keyId];
  if (!key || !await verifyAsync(unbase64(value.signature.value), encode(unsigned(value)), unbase64(key))) throw new Error('历史数据签名校验失败');
  return value;
}
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(`siilvana-history-v2:${historyDataset}`, 1);
    request.onupgradeneeded = () => { for (const name of ['tools', 'watermarks', 'locks']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { historyState.message = '请关闭旧标签页后重试数据更新'; };
  });
}
async function read<T>(store: string, key: string): Promise<T | undefined> {
  const database = await db(); return new Promise((resolve, reject) => { const req = database.transaction(store).objectStore(store).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function checked(stored: Stored): Promise<Stored> {
  if (typeof Worker !== 'undefined') return { ...stored, records: await decodeInWorker(stored.snapshot, undefined, stored.records) };
  await verify(stored.snapshot);
  if (stored.records.length !== stored.snapshot.count || !stored.records.every(r => isHistoryRelease(r) && r.toolId === stored.snapshot.toolId)
    || new Set(stored.records.map(r => r.releaseId)).size !== stored.records.length || await digest(encode([...stored.records].sort((a,b) => a.releaseId.localeCompare(b.releaseId)))) !== stored.snapshot.rootHash) throw new Error('本地历史数据损坏');
  return stored;
}
async function save(toolId: string, value: Stored): Promise<boolean> {
  const estimate = await navigator.storage?.estimate?.();
  const needed = value.snapshot.shards.reduce((n, shard) => n + shard.rawBytes, 0) * 2; const budget = Math.min(200 * 1024 * 1024, (estimate?.quota ?? 1024 * 1024 * 1024) * .2);
  if (needed > budget) throw new Error('离线存储空间不足，继续使用已有数据');
  if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < needed) {
    await reclaim(toolId);
    const remaining = await navigator.storage.estimate();
    if (remaining.quota && remaining.quota - (remaining.usage ?? 0) < needed) throw new Error('离线存储空间不足，继续使用已有数据');
  }
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['tools', 'watermarks'], 'readwrite'); const watermarks = tx.objectStore('watermarks'); let accepted = false;
    const request = watermarks.get(toolId);
    request.onsuccess = () => {
      const previous = request.result as { revision: string; hash: string } | undefined;
      const compared = previous ? compareRevision(value.snapshot.toolRevision, previous.revision) : 1;
      if (compared < 0 || compared === 0 && previous!.hash !== value.snapshot.rootHash) return;
      watermarks.put({ revision: value.snapshot.toolRevision, hash: value.snapshot.rootHash, bytes: needed, usedAt: Date.now() }, toolId);
      tx.objectStore('tools').put(value, toolId); accepted = true;
    };
    tx.oncomplete = () => resolve(accepted); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
async function fetchLimited(url: string, maximum = MAX_SHARD_BYTES): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) throw new Error(`历史服务连接失败（${response.status}）`);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) { await reader.cancel(); throw new Error('历史数据超过大小限制'); } chunks.push(value); }
  const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
}
async function json<T>(url: string): Promise<T> { return JSON.parse(new TextDecoder().decode(await fetchLimited(url))); }
async function unpack(snapshot: HistorySnapshot, base: string): Promise<Stored> {
  if (typeof Worker !== 'undefined') return { snapshot, records: await decodeInWorker(snapshot, base), usedAt: Date.now() };
  await verify(snapshot);
  if (!Array.isArray(snapshot.shards) || snapshot.shards.length > 10000 || !Number.isSafeInteger(snapshot.count)) throw new Error('无效快照描述');
  const records: HistoryRelease[] = [];
  for (const shard of snapshot.shards) {
    if (!/^[a-f0-9]{64}$/.test(shard.hash) || shard.rawBytes > MAX_SHARD_BYTES || shard.bytes > MAX_SHARD_BYTES) throw new Error('无效数据分片');
    const compressed = await fetchLimited(`${base}/blobs/${shard.hash}`, shard.bytes);
    if (compressed.length !== shard.bytes || await digest(compressed) !== shard.hash) throw new Error('分片哈希校验失败');
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')); const reader = stream.getReader();
    const parts: Uint8Array[] = []; let length = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > shard.rawBytes) { await reader.cancel(); throw new Error('解压大小不匹配'); } parts.push(value); }
    const raw = new Uint8Array(length); let offset = 0; for (const part of parts) { raw.set(part, offset); offset += part.length; }
    if (length !== shard.rawBytes || await digest(raw) !== shard.rawHash) throw new Error('分片内容校验失败');
    const rows = JSON.parse(new TextDecoder().decode(raw)); if (!Array.isArray(rows) || rows.length !== shard.count) throw new Error('分片数量不匹配'); records.push(...rows);
  }
  return checked({ snapshot, records, usedAt: Date.now() });
}
function apiBase() {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  return (configured ?? (import.meta.env.DEV ? 'http://localhost:3000/v1' : '')).replace(/\/v1\/?$/, '').replace(/\/$/, '');
}
async function latestManifest(force: boolean): Promise<{ value: HistoryManifest; remote: boolean }> {
  if (!force && manifest && Date.now() - manifestAt < 300000) return { value: manifest, remote: manifestRemote };
  let next: HistoryManifest; let remote = false;
  try { if (!apiBase()) throw new Error('未配置更新服务'); next = await verify(await json<HistoryManifest>(`${apiBase()}/v2/release-history/manifest`)); remote = true; }
  catch (error) { historyState.message = error instanceof Error ? error.message : '更新暂不可用'; next = await verify(await json<HistoryManifest>(`${bundle}/manifest.json`)); }
  if (manifest && compareRevision(next.manifestRevision, manifest.manifestRevision) < 0) return { value: manifest, remote: false };
  manifest = next; manifestAt = Date.now(); manifestRemote = remote; if (remote) historyState.message = ''; return { value: next, remote };
}
async function loadTool(toolId: string, force: boolean): Promise<Stored | undefined> {
  let local = memory.get(toolId);
  if (!local) try { const cached = await read<Stored>('tools', toolId); if (cached) local = await checked(cached); } catch { historyState.message = '本地缓存不可用，尝试恢复随包数据'; }
  if (local && !force && Date.now() - local.usedAt < 300000) return local;
  try {
    const { value, remote } = await latestManifest(force); const entry = value.tools.find(t => t.toolId === toolId);
    if (!entry?.toolRevision) return local;
    if (local && compareRevision(entry.toolRevision, local.snapshot.toolRevision) <= 0) return local;
    let snapshot: HistorySnapshot; let loaded: Stored | undefined;
    if (remote) {
      snapshot = await verify(await json<HistorySnapshot>(`${apiBase()}/v2/tools/${encodeURIComponent(toolId)}/history-snapshot?revision=${entry.toolRevision}`));
      if (local) try {
        const delta = await json<HistoryDiff>(`${apiBase()}/v2/tools/${encodeURIComponent(toolId)}/history-diff?from=${local.snapshot.toolRevision}&to=${entry.toolRevision}`);
        if (delta.from === local.snapshot.toolRevision && delta.to === entry.toolRevision && encode(delta).length < snapshot.shards.reduce((n,s) => n+s.bytes, 0) / 2) {
          const rows = new Map(local.records.map(r => [r.releaseId, r])); for (const row of delta.upserts) rows.set(row.releaseId, row);
          loaded = await checked({ snapshot, records: [...rows.values()], usedAt: Date.now() });
        }
      } catch { /* The complete signed snapshot remains the fallback. */ }
    } else snapshot = await verify(await json<HistorySnapshot>(`${bundle}/tools/${toolId}/${entry.toolRevision}.json`));
    if (snapshot.toolId !== toolId || snapshot.toolRevision !== entry.toolRevision || await digest(encode(snapshot)) !== entry.snapshotHash) throw new Error('工具修订与清单不一致');
    loaded ??= await unpack(snapshot, remote ? `${apiBase()}/v2/release-history` : bundle);
    try { if (!await save(toolId, loaded)) { historyState.message = '已阻止旧修订覆盖；当前为恢复模式'; return local ?? loaded; } }
    catch (error) { historyState.persistent = false; historyState.message = error instanceof Error ? error.message : '只能在本次会话保存'; }
    memory.set(toolId, loaded); if (memory.size > 8) { const oldest = memory.keys().next().value; if (oldest && oldest !== toolId) memory.delete(oldest); } return loaded;
  } catch (error) { historyState.message = error instanceof Error ? error.message : '更新失败'; if (local) return local;
    // A remote failure must not prevent first-use offline access to a bundled tool.
    try { const bundled = await verify(await json<HistoryManifest>(`${bundle}/manifest.json`)); const entry = bundled.tools.find(t => t.toolId === toolId); if (!entry?.toolRevision) return;
      const snapshot = await json<HistorySnapshot>(`${bundle}/tools/${toolId}/${entry.toolRevision}.json`); if (snapshot.toolId !== toolId || await digest(encode(snapshot)) !== entry.snapshotHash) throw new Error('随包清单不匹配');
      const recovered = await unpack(snapshot, bundle); memory.set(toolId, recovered); return recovered;
    } catch { return; }
  }
}
export async function loadHistoryPage(toolId: string, query: { q?: string; page?: number; includePrerelease?: boolean }, refresh = false): Promise<{ data: ToolReleasePage; offline: boolean } | undefined> {
  let pending = requests.get(toolId);
  if (!pending) {
    const work = () => loadTool(toolId, refresh);
    pending = (async () => navigator.locks ? await navigator.locks.request(`history:${toolId}`, work) : await withLease(toolId, work))();
    requests.set(toolId, pending); pending.finally(() => requests.delete(toolId));
  }
  const stored = await pending;
  if (!stored) {
    if (!Object.keys(historyKeys).length) return;
    const quality = manifest?.tools.find(t => t.toolId === toolId)?.quality ?? { coverage: 'partial' as const, scope: '官方公开发布记录', sourceStatus: 'failed' as const, lastSuccessAt: null, missingReason: historyState.message || '尚无经过验证的历史快照' };
    return { offline: true, data: { toolId, revision: '', updatedAt: quality.lastSuccessAt, status: quality.sourceStatus === 'disabled' ? 'unsupported' : quality.sourceStatus === 'failed' ? 'unavailable' : 'pending', quality, notice: historyState.message, total: 0, page: query.page ?? 1, pageSize: 50, items: [] } };
  }
  const needle = query.q?.trim().toLowerCase() ?? ''; const page = query.page ?? 1;
  const result = await queryRecords(toolId, stored, query);
  const rows = result.items;
  const entry = manifest?.tools.find(t => t.toolId === toolId);
  return { offline: !!historyState.message, data: { toolId, revision: stored.snapshot.toolRevision, updatedAt: stored.snapshot.generatedAt,
    status: entry?.quality.sourceStatus === 'failed' ? 'stale' : 'ready', quality: entry?.quality ?? stored.snapshot.quality, notice: historyState.message,
    total: result.total, page, pageSize: 50, items: rows.map(r => ({ version: r.version, originalVersion: r.rawVersion, build: r.build,
      releaseTrack: r.releaseTrack, isPrerelease: r.isPrerelease, lifecycleKnown: r.eol !== null, withdrawn: r.withdrawn, withdrawnReason: r.withdrawnReason ?? undefined,
      channel: r.eol ? 'eol' : r.isLts ? 'lts' : 'stable', releaseDate: r.releaseDate ?? undefined, eolDate: r.eolDate, pageUrl: r.pageUrl, sourceUrl: r.sourceUrl, bundledNpm: r.bundledNpm,
      assets: r.assets.map(a => ({ name: a.name, url: a.url, kind: a.kind, platform: a.platform === 'unknown' ? undefined : a.platform,
        architecture: a.arch === 'unknown' ? undefined : a.arch, sha256: a.sha256, downloadStatus: a.downloadStatus })) })) } };
}

let queryWorker: Worker | undefined; let sequence = 0;
const indexedRevisions = new Map<string,string>();
const responses = new Map<number, (value: { total: number; items: HistoryRelease[] }) => void>();
const queryTurns = new Map<string, Promise<{ total: number; items: HistoryRelease[] }>>();
function queryRecords(toolId: string, stored: Stored, query: { q?: string; page?: number; includePrerelease?: boolean }) {
  const result = (queryTurns.get(toolId) ?? Promise.resolve()).catch(() => undefined).then(() => runQueryRecords(toolId, stored, query));
  queryTurns.set(toolId, result);
  const cleanup = () => { if (queryTurns.get(toolId) === result) queryTurns.delete(toolId); };
  void result.then(cleanup, cleanup); return result;
}
async function runQueryRecords(toolId: string, stored: Stored, query: { q?: string; page?: number; includePrerelease?: boolean }): Promise<{ total: number; items: HistoryRelease[] }> {
  if (typeof Worker === 'undefined') {
    const rows = stored.records.filter(r => (query.includePrerelease || !r.isPrerelease) && `${r.rawVersion} ${r.version} ${r.build}`.toLowerCase().includes(query.q?.toLowerCase() ?? '')).sort(compareHistory);
    return { total: rows.length, items: rows.slice(((query.page ?? 1)-1)*50,(query.page ?? 1)*50) };
  }
  if (!queryWorker) { queryWorker = new Worker(new URL('./history-query.worker.ts', import.meta.url), { type: 'module' }); queryWorker.onmessage = event => { responses.get(event.data.id)?.(event.data); responses.delete(event.data.id); }; }
  const send = (message: object) => new Promise<{total: number; items: HistoryRelease[]}>((resolve, reject) => {
    const id = ++sequence; const timeout = setTimeout(() => { responses.delete(id); reject(new Error('历史搜索超时')); },30000);
    responses.set(id, value => { clearTimeout(timeout); resolve(value); }); queryWorker!.postMessage({ id, toolId, ...message });
  });
  if (indexedRevisions.get(toolId) !== stored.snapshot.rootHash) {
    await send({ phase: 'reset' });
    for (let start = 0; start < stored.records.length; start += 1000) await send({ phase: 'append', records: stored.records.slice(start,start+1000), final: start+1000>=stored.records.length });
    indexedRevisions.set(toolId,stored.snapshot.rootHash);
  }
  return send(query);
}
export async function syncHistory() {
  if (import.meta.env.MODE === 'test') return;
  try {
    const { value } = await latestManifest(true); const queue = value.tools.filter(t => t.toolRevision).map(t => t.toolId);
    const worker = async () => { while(queue.length) { const id = queue.shift()!; await loadTool(id, false); } };
    await Promise.all([worker(), worker()]);
  } catch { /* UI retains built-in catalog and the last valid snapshots. */ }
}

async function withLease<T>(toolId: string, work: () => Promise<T>): Promise<T> {
  let database: IDBDatabase;
  try { database = await db(); } catch { return work(); }
  const owner = crypto.randomUUID();
  const claim = () => new Promise<boolean>((resolve, reject) => {
    const tx = database.transaction('locks', 'readwrite'); const store = tx.objectStore('locks'); const req = store.get(toolId); let acquired = false;
    req.onsuccess = () => { if (!req.result || req.result.until < Date.now() || req.result.owner === owner) { store.put({ owner, until: Date.now()+30000 }, toolId); acquired = true; } };
    tx.oncomplete = () => resolve(acquired); tx.onerror = () => reject(tx.error);
  });
  if (!await claim()) throw new Error('另一个标签页正在同步，请稍后重试');
  const timer = setInterval(() => { void claim().catch(() => undefined); }, 10000);
  try { return await work(); } finally {
    clearInterval(timer);
    const tx = database.transaction('locks','readwrite'); const store = tx.objectStore('locks'); const req = store.get(toolId);
    req.onsuccess = () => { if (req.result?.owner === owner) store.delete(toolId); };
  }
}

function decodeInWorker(snapshot: HistorySnapshot, base?: string, records?: HistoryRelease[]): Promise<HistoryRelease[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./history-decode.worker.ts', import.meta.url), { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('历史快照校验超时')); }, 120000);
    const close = () => { clearTimeout(timeout); worker.terminate(); };
    worker.onmessage = event => { close(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.records); };
    worker.onerror = () => { close(); reject(new Error('历史快照校验失败')); }; worker.postMessage({ snapshot, base, records });
  });
}

let protectedScene: 'frontend' | 'java' | 'python' | 'office' | null = null;
export function setHistoryScene(scene: 'frontend' | 'java' | 'python' | 'office' | null) { protectedScene = scene; }
async function reclaim(currentTool: string) {
  const bundled = await verify(await json<HistoryManifest>(`${bundle}/manifest.json`));
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['tools','watermarks'],'readwrite'); const store = tx.objectStore('watermarks');
    const entries: Array<{ key: IDBValidKey; value: { revision: string; hash: string; usedAt?: number; bytes?: number } }> = [];
    const cursor = store.openCursor(); cursor.onsuccess = () => {
      const row = cursor.result;
      if (row) { entries.push({ key: row.key, value: row.value }); row.continue(); return; }
      for (const entry of entries.sort((a,b) => (a.value.usedAt ?? 0) - (b.value.usedAt ?? 0))) {
        const toolId = String(entry.key); const fallback = bundled.tools.find(t => t.toolId === toolId);
        if (toolId === currentTool || protectedScene && catalog.tools.find(t => t.id === toolId)?.scenes?.includes(protectedScene) || !fallback?.toolRevision || compareRevision(fallback.toolRevision, entry.value.revision) < 0) continue;
        tx.objectStore('tools').delete(entry.key); store.put({ ...entry.value, bytes: 0 },entry.key); memory.delete(toolId);
      }
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
