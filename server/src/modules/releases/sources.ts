import { extendedSources, parseExtended } from './extended-sources.js';
import { load } from 'cheerio';
import type { ReleaseAsset, ToolRelease } from '@siilvana/shared';

export interface ReleaseSource { toolId: string; kind: string; urls: string[]; repository?: string; coverage?: 'full' | 'partial'; scope?: string }
const github: Record<string, string> = {
  volta: 'volta-cli/volta', fnm: 'Schniz/fnm', nvm: 'nvm-sh/nvm', 'nvm-windows': 'coreybutler/nvm-windows',
  bun: 'oven-sh/bun', deno: 'denoland/deno', 'github-cli': 'cli/cli', 'github-desktop': 'desktop/desktop',
  powershell: 'PowerShell/PowerShell', 'windows-terminal': 'microsoft/terminal', bruno: 'usebruno/bruno',
};
export const sources: ReleaseSource[] = [
  { toolId: 'node', kind: 'node', coverage: 'full', scope: 'Node.js ????????????', urls: ['https://nodejs.org/dist/index.json'] },
  ...['npm', 'pnpm'].map(toolId => ({ toolId, kind: 'registry', urls: [`https://registry.npmjs.org/${toolId}`] })),
  { toolId: 'yarn', kind: 'registry', urls: ['https://registry.npmjs.org/yarn', 'https://registry.npmjs.org/@yarnpkg%2fcli-dist'] },
  ...Object.entries(github).map(([toolId, repository]) => ({ toolId, repository, kind: 'github', urls: [`https://api.github.com/repos/${repository}/releases?per_page=${['powershell', 'deno'].includes(toolId) ? 30 : 100}`] })),
  { toolId: 'vscode', kind: 'vscode', urls: ['https://api.github.com/repos/microsoft/vscode/tags?per_page=100'] },
  { toolId: 'git', kind: 'git', urls: ['https://www.kernel.org/pub/software/scm/git/'] },
  { toolId: 'webstorm', kind: 'jetbrains', urls: ['https://data.services.jetbrains.com/products/releases?code=WS&type=release'] },
  { toolId: 'chrome', kind: 'chrome', urls: ['win', 'win64', 'mac', 'linux'].map(p => `https://versionhistory.googleapis.com/v1/chrome/platforms/${p}/channels/stable/versions?pageSize=1000`) },
  { toolId: 'edge', kind: 'edge', urls: ['https://edgeupdates.microsoft.com/api/products?view=enterprise', 'https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel', 'https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-archive-stable-channel'] },
  { toolId: 'firefox', kind: 'firefox', urls: ['https://product-details.mozilla.org/1.0/firefox_history_major_releases.json', 'https://product-details.mozilla.org/1.0/firefox_history_stability_releases.json', 'https://product-details.mozilla.org/1.0/firefox_history_development_releases.json'] },
  { toolId: 'postman', kind: 'postman-json', urls: ['https://mkt.cdn.postman.com/www-next/release-notes/app-release-notes.json'] },
  { toolId: 'docker', kind: 'docker-markdown', scope: 'Docker 官方文档仓库当前公开的 Desktop 发布记录', urls: ['https://api.github.com/repos/docker/docs/contents/content/manuals/desktop/release-notes.md'] },
  ...extendedSources,
];

export const NODE_SCHEDULE = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';
export const sourceHosts = new Set([...sources.flatMap(s => s.urls.map(url => new URL(url).hostname)), 'raw.githubusercontent.com']);
export function normalizeVersion(raw: string) { return raw.replace(/^release-/, '').replace(/^(?:bun-)?v(?=\d)/, ''); }
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/(\d)esr$/, '$1-esr').split(/[.\-+]/);
  const left = parts(a); const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i] ?? '0'; const r = right[i] ?? '0';
    const result = /^\d+$/.test(l) && /^\d+$/.test(r) ? Number(l) - Number(r) : l.localeCompare(r);
    if (result) return result;
  }
  return a.localeCompare(b);
}
function release(version: string, url: string, pageUrl = url): ToolRelease {
  return { version: normalizeVersion(version), originalVersion: version, channel: 'stable', sourceUrl: url, pageUrl, assets: [] };
}
function safeUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; }
}
export function asset(name: string, url: string, kind: ReleaseAsset['kind'] = 'binary'): ReleaseAsset {
  const key = name.toLowerCase();
  return { name, url, kind,
    platform: /(?:win|\.exe|\.msi|msix)/.test(key) && !key.includes('darwin') ? 'windows'
      : /(?:darwin|mac|osx|\.dmg|\.pkg)/.test(key) ? 'macos' : /(?:linux|\.deb|\.rpm|appimage)/.test(key) ? 'linux' : undefined,
    architecture: /(?:arm64|aarch64|m1)/.test(key) ? 'arm64' : /(?:x64|x86_64|amd64|intel|win64)/.test(key) ? 'x64'
      : /(?:ia32|i686|win32|x86)/.test(key) ? 'x86' : key.includes('universal') ? 'universal' : undefined };
}
export function mergeReleases(items: ToolRelease[]): ToolRelease[] {
  const merged = new Map<string, ToolRelease>();
  for (const item of items) {
    if (!/^\d+(?:\.\d+)+(?:esr|[ab]\d+|rc\d+)?(?:[-+][a-zA-Z0-9.+-]+)?$/.test(item.version) || !safeUrl(item.pageUrl)) continue;
    item.assets = item.assets.filter(a => safeUrl(a.url));
    const identity = JSON.stringify([item.originalVersion, item.build ?? '', item.releaseTrack ?? (item.isPrerelease ? 'preview' : 'stable')]);
    const existing = merged.get(identity);
    if (!existing) { merged.set(identity, { ...item, assets: [...item.assets] }); continue; }
    if (!existing.releaseDate) existing.releaseDate = item.releaseDate;
    existing.assets = [...new Map([...existing.assets, ...item.assets].map(a => [a.url, a])).values()];
  }
  return [...merged.values()].sort((a, b) => compareVersions(b.version, a.version));
}

export interface ParsedPage { releases: ToolRelease[]; next: string[]; metadata?: { ltsFeatures?: number[] } }
// Vendor response types are checked at the parser boundary; optional metadata stays optional.
export function parsePage(source: ReleaseSource, body: string, url: string, schedule: Record<string, { end?: string }> = {}, metadata?: ParsedPage['metadata']): ParsedPage {
  const extended = parseExtended(source, body, url, asset, metadata); if (extended) return extended;
  const result: ParsedPage = { releases: [], next: [] };
  const add = (item: ToolRelease) => result.releases.push(item);
  const data = ['git', 'postman', 'docker'].includes(source.kind) || (source.kind === 'edge' && !url.includes('edgeupdates.')) ? undefined : JSON.parse(body);
  switch (source.kind) {
    case 'node': {
      if (!Array.isArray(data) || !data.length || typeof data[0].version !== 'string') throw new Error('Node index schema changed');
      for (const row of data) {
        if (!/^v\d+\.\d+\.\d+$/.test(row.version) || !Array.isArray(row.files)) continue;
        const item = release(row.version, url, `https://nodejs.org/download/release/${row.version}/`);
        item.releaseDate = row.date; item.bundledNpm = row.npm; item.isLts = !!row.lts;
        item.eolDate = schedule[`v${item.version.split('.')[0]}`]?.end;
        item.channel = item.eolDate && item.eolDate < new Date().toISOString().slice(0, 10) ? 'eol' : row.lts ? 'lts' : 'current';
        // Only create exact filenames for formats declared by the index.
        for (const file of row.files as string[]) {
          if (/^(linux|win)-(x64|arm64|x86)(-zip)?$/.test(file) && !file.startsWith('win-'))
            item.assets.push(asset(file, `${item.pageUrl}node-${row.version}-${file}.tar.gz`));
          if (/^win-(x64|arm64|x86)-zip$/.test(file)) item.assets.push(asset(file, `${item.pageUrl}node-${row.version}-${file.replace(/-zip$/, '')}.zip`));
          if (/^osx-(x64|arm64)-tar$/.test(file)) item.assets.push(asset(file, `${item.pageUrl}node-${row.version}-darwin-${file.split('-')[1]}.tar.gz`));
        }
        add(item);
      }
      break;
    }
    case 'registry': {
      if (!data?.versions || typeof data.name !== 'string') throw new Error('Registry schema changed');
      for (const [version, row] of Object.entries(data.versions) as Array<[string, any]>) {
        if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
        const item = release(version, url, `https://www.npmjs.com/package/${data.name}/v/${version}`);
        item.releaseDate = data.time?.[version];
        if (safeUrl(row.dist?.tarball)) item.assets.push(asset(`${data.name}-${version}.tgz`, row.dist.tarball, 'source'));
        add(item);
      }
      break;
    }
    case 'github': {
      if (!Array.isArray(data)) throw new Error('GitHub releases schema changed');
      for (const row of data) {
        if (row.draft || typeof row.tag_name !== 'string') continue;
        const item = release(row.tag_name, url, row.html_url);
        item.releaseDate = row.published_at; item.isPrerelease = !!row.prerelease;
        item.assets = (row.assets ?? []).filter((a: any) => safeUrl(a.browser_download_url) && !/\.(?:sha\w*|txt|json|sig|asc|map)$/.test(a.name)).map((a: any) => asset(a.name, a.browser_download_url));
        if (safeUrl(row.tarball_url)) item.assets.push(asset('Source code', row.tarball_url, 'source'));
        add(item);
      }
      break;
    }
    case 'vscode': {
      if (!Array.isArray(data)) throw new Error('VS Code tags schema changed');
      for (const row of data) {
        const version = normalizeVersion(row.name ?? '');
        if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
        const [major, minor] = version.split('.');
        const item = release(version, url, `https://code.visualstudio.com/updates/v${major}_${minor}`);
        // Official documented exact-version endpoints; old architectures may be unavailable.
        for (const [name, target] of [['windows-x64', 'win32-x64-archive'], ['macos-x64', 'darwin'], ['linux-x64', 'linux-x64']])
          item.assets.push(asset(name, `https://update.code.visualstudio.com/${version}/${target}/stable`));
        add(item);
      }
      break;
    }
    case 'git': {
      const $ = load(body);
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href')!;
        const match = /^git-(\d+(?:\.\d+)+)\.tar\.(?:gz|xz)$/.exec(href);
        if (!match) return;
        const item = release(match[1], url, `${url}#git-${match[1]}`);
        item.assets.push(asset(href, new URL(href, url).href, 'source')); add(item);
      });
      break;
    }
    case 'jetbrains': {
      if (!data || !Object.values(data).some(Array.isArray)) throw new Error('JetBrains schema changed');
      for (const [product, rows] of Object.entries(data)) for (const row of rows as any[]) {
        const productName = source.toolId === 'idea' ? 'idea' : source.toolId === 'pycharm' ? 'pycharm' : 'webstorm';
        const item = release(row.version, url, `https://www.jetbrains.com/${productName}/download/other.html`);
        item.build = row.build ?? ''; item.releaseTrack = `${product}:${row.type}`; item.isPrerelease = row.type !== 'release';
        item.releaseDate = row.date;
        item.assets = Object.entries(row.downloads ?? {}).filter(([name, value]) => !name.includes('thirdParty') && safeUrl((value as any).link)).map(([name, value]) => asset(name, (value as any).link));
        add(item);
      }
      break;
    }
    case 'chrome': {
      if (!Array.isArray(data?.versions)) throw new Error('Chrome schema changed');
      for (const row of data.versions) add(release(row.version, url, `https://chromereleases.googleblog.com/search?q=${encodeURIComponent(row.version)}`));
      if (data.nextPageToken) { const next = new URL(url); next.searchParams.set('pageToken', data.nextPageToken); result.next.push(next.href); }
      break;
    }
    case 'edge': {
      if (data) {
        if (!Array.isArray(data)) throw new Error('Edge schema changed');
        for (const product of data.filter((p: any) => p.Product === 'Stable')) for (const row of product.Releases ?? []) {
          const item = release(row.ProductVersion, url, 'https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel');
          item.releaseDate = row.PublishedTime;
          item.assets = (row.Artifacts ?? []).filter((a: any) => safeUrl(a.Location)).map((a: any) => asset(`${row.Platform}-${row.Architecture}.${a.ArtifactName}`, a.Location)); add(item);
        }
      } else {
        const $ = load(body);
        $('h2,h3').each((_, el) => { const text = $(el).text(); const version = /\b(\d+\.\d+\.\d+\.\d+)\b/.exec(text)?.[1]; if (version) add(release(version, url, `${url}#${$(el).attr('id') ?? ''}`)); });
        $('a[href]').each((_, el) => { const target = new URL($(el).attr('href')!, url); if (target.hostname === 'learn.microsoft.com' && /microsoft-edge-relnote-archive-stable-channel/.test(target.pathname)) { target.hash = ''; result.next.push(target.href); } });
      }
      break;
    }
    case 'firefox': {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Firefox schema changed');
      for (const [version, date] of Object.entries(data)) {
        if (!/^\d+(?:\.\d+)+(?:esr)?$/.test(version)) continue;
        const item = release(version, url, `https://archive.mozilla.org/pub/firefox/releases/${version}/`);
        item.releaseDate = String(date); add(item);
      }
      break;
    }
    case 'postman-json': {
      if (!Array.isArray(data?.notes) || !data.notes.length) throw new Error('Postman release notes schema changed');
      for (const row of data.notes) {
        if (!/^\d+\.\d+\.\d+$/.test(row.version)) continue;
        const item = release(row.version, url, `https://www.postman.com/release-notes/postman-app/#${row.version}`);
        item.releaseDate = row.createdAt; add(item);
      }
      break;
    }
    case 'postman': case 'docker': {
      const $ = load(body);
      $('h2,h3,h4').each((_, el) => {
        const text = $(el).text();
        if (/alpha|beta|preview|release candidate/i.test(text)) return;
        const version = /\b(\d+\.\d+\.\d+)\b/.exec(text)?.[1];
        if (!version) return;
        const item = release(version, url, `${url}#${$(el).attr('id') ?? ''}`);
        const section = $(el).nextUntil('h2,h3,h4');
        section.find('a[href]').add(section.filter('a[href]')).each((_, link) => {
          const target = new URL($(link).attr('href')!, url);
          if (/^(?:desktop\.docker\.com|dl\.pstmn\.io)$/.test(target.hostname) && /\.(exe|dmg|deb|rpm|zip|tgz)(?:$|\?)/i.test(target.href)) item.assets.push(asset(`${$(link).text()} ${target.pathname}`, target.href));
        }); add(item);
      });
      $('a[href]').each((_, el) => {
        const next = new URL($(el).attr('href')!, url); next.hash = '';
        if (next.origin === new URL(url).origin && (source.kind === 'docker' ? /^\/desktop\/(?:previous-versions|release-notes)(?:\/|$)/.test(next.pathname) : /^\/release-notes\/postman-app(?:\/|$)/.test(next.pathname))) result.next.push(next.href);
      });
      break;
    }
    default: throw new Error(`Unknown source kind ${source.kind}`);
  }
  return result;
}
