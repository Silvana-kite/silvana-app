import { parseCatalog, type Catalog, type InstallPlan, type InstallPlanRequest } from '@siilvana/shared';

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
}
