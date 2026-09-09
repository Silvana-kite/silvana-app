import { Store } from '@tauri-apps/plugin-store';
import { isCatalog, type Catalog } from '@siilvana/shared';

interface CatalogCache {
  catalog: Catalog;
  etag?: string;
}

const CACHE_KEY = 'catalog-cache-v1';

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function loadCatalogCache(): Promise<CatalogCache | undefined> {
  try {
    if (isTauri()) {
      const store = await Store.load('catalog.json', { autoSave: false });
      const cached = await store.get<CatalogCache>(CACHE_KEY) ?? undefined;
      return cached && isCatalog(cached.catalog) ? cached : undefined;
    }
    const value = localStorage.getItem(CACHE_KEY);
    const cached = value ? JSON.parse(value) as CatalogCache : undefined;
    return cached && isCatalog(cached.catalog) ? cached : undefined;
  } catch {
    return undefined;
  }
}

export async function saveCatalogCache(value: CatalogCache): Promise<void> {
  if (isTauri()) {
    const store = await Store.load('catalog.json', { autoSave: false });
    await store.set(CACHE_KEY, value);
    await store.save();
    return;
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(value));
}
