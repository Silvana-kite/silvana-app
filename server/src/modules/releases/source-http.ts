import { officialDispatcher } from './network-policy.js';
import { Injectable } from '@nestjs/common';
import { ReleaseRepository, type CachedPage } from './release.repository.js';
import { sourceHosts } from './sources.js';

export class SourceHttpError extends Error {
  constructor(message: string, public readonly retryMs?: number) { super(message); }
}
@Injectable()
export class SourceHttp {
  private readonly hosts = new Map<string, Promise<void>>();
  requestCount = 0;
  constructor(private readonly repository: ReleaseRepository) {}
  async read(url: string): Promise<CachedPage> {
    const host = new URL(url).hostname;
    if (!sourceHosts.has(host) || new URL(url).protocol !== 'https:' || new URL(url).username || new URL(url).password || !['', '443'].includes(new URL(url).port)) throw new Error('Unregistered source URL');
    const previous = this.hosts.get(host) ?? Promise.resolve();
    let unlock!: () => void;
    this.hosts.set(host, new Promise<void>(resolve => { unlock = resolve; }));
    await previous;
    try {
      return await this.fetchPage(url);
    } finally {
      // Cooldown is shared by adapters using the same host.
      setTimeout(unlock, 1000);
    }
  }
  private async fetchPage(url: string): Promise<CachedPage> {
    const cached = await this.repository.cache(url);
    const headers: Record<string, string> = { 'User-Agent': 'siilvana-catalog-sync/1.0', Accept: new URL(url).hostname === 'registry.npmjs.org' ? 'application/vnd.npm.install-v1+json' : 'application/json,text/html;q=0.9,*/*;q=0.8' };
    if (new URL(url).hostname === 'api.github.com' && new URL(url).pathname.includes('/contents/')) headers.Accept = 'application/vnd.github.raw+json';
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.last_modified) headers['If-Modified-Since'] = cached.last_modified;
    if (new URL(url).hostname === 'api.github.com' && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    let response!: Response;
    let target = url;
    const signal = AbortSignal.timeout(10_000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      this.requestCount++;
      response = await fetch(target, { headers, signal, redirect: 'manual', dispatcher: officialDispatcher } as RequestInit);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const next = new URL(response.headers.get('location') ?? '', target);
      if (next.protocol !== 'https:' || !sourceHosts.has(next.hostname) || next.username || next.password || !['', '443'].includes(next.port)) throw new Error('Source redirected outside registered hosts');
      if (next.origin !== new URL(target).origin) delete headers.Authorization;
      target = next.href;
    }
    if (response.status === 304 && cached) { await this.repository.savePage(cached); return cached; }
    if (!response.ok) {
      await response.body?.cancel();
      const retry = response.headers.get('retry-after');
      const reset = response.headers.get('x-ratelimit-reset');
      const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : reset ? Number(reset) * 1000 - Date.now() : undefined;
      throw new SourceHttpError(`${new URL(url).hostname}: HTTP ${response.status}`, delay);
    }
    if (!response.body) throw new Error('Source response has no body');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('Source response exceeds 32 MiB'); }
      chunks.push(value);
    }
    const page: CachedPage = { url, body: Buffer.concat(chunks).toString('utf8'), etag: response.headers.get('etag'), last_modified: response.headers.get('last-modified'), next_url: /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1] ?? null };
    await this.repository.savePage(page); return page;
  }
}
