import { parseCatalog, type Catalog, type InstallPlan, type InstallPlanRequest, type ToolReleasePage } from '@siilvana/shared';

export class SiilvanaApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async catalog(etag?: string): Promise<{ catalog?: Catalog; etag?: string; unchanged: boolean }> {
    const response = await fetch(`${this.baseUrl}/catalog`, { headers: etag ? { 'If-None-Match': etag } : {} });
    if (response.status === 304) return { unchanged: true, etag };
    if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
    return { catalog: parseCatalog(await response.json()), etag: response.headers.get('etag') ?? undefined, unchanged: false };
  }

  async createInstallPlan(request: InstallPlanRequest): Promise<InstallPlan> {
    const response = await fetch(`${this.baseUrl}/install-plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`Install plan request failed: ${response.status}`);
    return response.json() as Promise<InstallPlan>;
  }

  async releases(toolId: string, query: { q?: string; page?: number; platform?: string; architecture?: string } = {}, etag?: string, signal?: AbortSignal): Promise<{ data?: ToolReleasePage; etag?: string; unchanged: boolean }> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
    const response = await fetch(`${this.baseUrl}/tools/${encodeURIComponent(toolId)}/versions?${params}`, { headers: etag ? { 'If-None-Match': etag } : {}, signal });
    if (response.status === 304) return { unchanged: true, etag };
    if (!response.ok) throw new Error(`Release request failed: ${response.status}`);
    const data = await response.json();
    if (!isReleasePage(data) || data.toolId !== toolId) throw new Error('Invalid release response');
    return { data, unchanged: false, etag: response.headers.get('etag') ?? undefined };
  }
}

export function isReleasePage(data: any): data is ToolReleasePage {
  const https = (value: unknown) => { try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
  return !!data && typeof data.toolId === 'string' && typeof data.revision === 'string' && Number.isInteger(data.total) && data.total >= 0
    && Number.isInteger(data.page) && data.page > 0 && Number.isInteger(data.pageSize) && data.pageSize > 0 && data.pageSize <= 100
    && (data.updatedAt === null || typeof data.updatedAt === 'string') && ['ready', 'stale', 'pending', 'unavailable', 'unsupported'].includes(data.status)
    && Array.isArray(data.items) && data.items.every((item: any) => typeof item.version === 'string' && typeof item.originalVersion === 'string'
      && ['releaseDate', 'eolDate', 'bundledNpm'].every(key => item[key] === undefined || typeof item[key] === 'string')
      && ['stable', 'lts', 'current', 'eol'].includes(item.channel) && https(item.pageUrl) && https(item.sourceUrl) && Array.isArray(item.assets)
      && item.assets.every((a: any) => typeof a.name === 'string' && https(a.url) && ['binary', 'source'].includes(a.kind)
        && (a.platform === undefined || ['windows', 'macos', 'linux'].includes(a.platform))
        && (a.architecture === undefined || ['x64', 'arm64', 'x86', 'universal'].includes(a.architecture))));
}
