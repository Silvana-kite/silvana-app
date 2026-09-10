import { loadHistoryPage } from './history-cache';
import { Store } from '@tauri-apps/plugin-store';
import { SiilvanaApiClient, isReleasePage } from '@siilvana/api-client';
import type { ToolReleasePage } from '@siilvana/shared';

interface Entry { data: ToolReleasePage; etag?: string; checkedAt: number }
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<{ data: ToolReleasePage; offline: boolean }>>();
const storageKey = 'release-history-v1';
let initialized: Promise<void> | undefined;
let saveChain = Promise.resolve();
const desktop = () => '__TAURI_INTERNALS__' in window;
async function initialize() {
  try {
    const raw = desktop() ? await (await Store.load('release-history.json')).get<EntryMap>(storageKey) : JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    for (const [key, entry] of Object.entries(raw ?? {}) as Array<[string, Entry]>) if (isReleasePage(entry.data) && typeof entry.checkedAt === 'number') memory.set(key, entry);
  } catch { /* A damaged cache never replaces a valid server response. */ }
}
type EntryMap = Record<string, Entry>;
function persist() {
  // Leave room for workspace state within browser storage quotas. Large asset
  // indexes must not prevent every subsequent history snapshot from persisting.
  const retained: Array<[string, Entry]> = []; let bytes = 0;
  for (const pair of [...memory.entries()].reverse()) {
    const cost = JSON.stringify(pair).length * 2;
    if (retained.length >= 100 || bytes + cost > 2 * 1024 * 1024) continue;
    retained.push(pair); bytes += cost;
  }
  memory.clear();
  for (const [key, entry] of retained.reverse()) memory.set(key, entry);
  const snapshot = Object.fromEntries(memory);
  saveChain = saveChain.then(async () => {
    if (desktop()) { const store = await Store.load('release-history.json'); await store.set(storageKey, snapshot); await store.save(); }
    else localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }).catch(() => undefined);
}
export function releaseApiUrl() {
  return (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:3000/v1' : undefined);
}
async function loadLegacyReleases(toolId: string, query: { q?: string; page?: number; platform?: string; architecture?: string }, refresh = false) {
  initialized ??= initialize(); await initialized;
  const base = releaseApiUrl();
  const key = JSON.stringify([base, toolId, query]);
  const cached = memory.get(key);
  if (!refresh && cached && Date.now() - cached.checkedAt < 300000) return { data: cached.data, offline: false };
  const inFlight = pending.get(key); if (inFlight) return inFlight;
  const work = (async () => {
    try {
      if (!base) throw new Error('尚未配置历史版本服务');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const result = await new SiilvanaApiClient(base).releases(toolId, query, cached?.etag, controller.signal).finally(() => clearTimeout(timeout));
      const data = result.data ?? cached?.data;
      if (!data) throw new Error('版本缓存不可用');
      // A temporarily unavailable backend must not erase previously cached releases.
      if (cached && ['unavailable', 'pending'].includes(data.status)) return { data: cached.data, offline: true };
      if (data.status === 'ready' || data.status === 'stale') { memory.delete(key); memory.set(key, { data, etag: result.etag, checkedAt: Date.now() }); persist(); }
      return { data, offline: false };
    } catch (error) { if (cached) return { data: cached.data, offline: true }; throw error; }
    finally { pending.delete(key); }
  })();
  pending.set(key, work); return work;
}

export async function loadReleases(toolId: string, query: { q?: string; page?: number; platform?: string; architecture?: string; includePrerelease?: boolean }, refresh = false) {
  return await loadHistoryPage(toolId, query, refresh) ?? loadLegacyReleases(toolId, query, refresh);
}
