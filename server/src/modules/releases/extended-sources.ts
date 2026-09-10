import { load } from 'cheerio';
import type { ToolRelease, ReleaseAsset } from '@siilvana/shared';
import type { ParsedPage, ReleaseSource } from './sources.js';

export const extendedSources: ReleaseSource[] = [
  { toolId: 'jdk', kind: 'adoptium', coverage: 'full', scope: 'Adoptium 可用版本索引列出的所有 Temurin JDK GA 构建，包含非 LTS 版本', urls: ['https://api.adoptium.net/v3/info/available_releases'] },
  { toolId: 'gradle', kind: 'gradle', coverage: 'full', scope: 'Gradle 官方版本索引中的正式及预发布记录', urls: ['https://services.gradle.org/versions/all'] },
  { toolId: 'maven', kind: 'maven', scope: 'Apache 当前公开的 Maven 归档', urls: ['https://archive.apache.org/dist/maven/'] },
  { toolId: 'python', kind: 'python', scope: 'Python 官方 FTP 归档中的发布文件', urls: ['https://www.python.org/ftp/python/'] },
  { toolId: 'postgresql', kind: 'postgresql', scope: 'PostgreSQL 官方源码归档', urls: ['https://ftp.postgresql.org/pub/source/'] },
  ...['pip', 'poetry'].map(toolId => ({ toolId, kind: 'pypi', coverage: 'full' as const, scope: 'PyPI 当前公开发布元数据，包含 yanked 和预发布', urls: [`https://pypi.org/pypi/${toolId}/json`] })),
  { toolId: 'uv', kind: 'github', urls: ['https://api.github.com/repos/astral-sh/uv/releases?per_page=30'] },
  { toolId: 'conda', kind: 'github', urls: ['https://api.github.com/repos/conda/conda/releases?per_page=100'] },
  { toolId: 'idea', kind: 'jetbrains', urls: ['https://data.services.jetbrains.com/products/releases?code=IIU,IIC&latest=false'] },
  { toolId: 'pycharm', kind: 'jetbrains', urls: ['https://data.services.jetbrains.com/products/releases?code=PY,PC&latest=false'] },
];
export function parseExtended(source: ReleaseSource, body: string, url: string, asset: (name: string, url: string, kind?: ReleaseAsset['kind']) => ReleaseAsset, metadata?: ParsedPage['metadata']): ParsedPage | undefined {
  if (source.kind === 'docker-markdown') {
    const sections = [...body.matchAll(/^##\s+(\d+\.\d+\.\d+)\s*$/gm)];
    return { next: [], releases: sections.map((match,index) => {
      const version = match[1]!; const section = body.slice(match.index, sections[index+1]?.index ?? body.length);
      const links = [...new Set([...section.matchAll(/https:\/\/desktop\.docker\.com\/[^\s)<>"']+/g)].map(m=>m[0]))];
      return { version, originalVersion: version, channel: 'stable' as const, sourceUrl: url,
        pageUrl: `https://docs.docker.com/desktop/release-notes/#${version.replaceAll('.', '')}`,
        assets: links.filter(link=>/\.(?:exe|dmg|deb|rpm|zip|tgz)(?:$|\?)/i.test(link)).map(link=>asset(decodeURIComponent(new URL(link).pathname),link)) };
    }) };
  }
  if (!['adoptium', 'gradle', 'pypi', 'maven', 'python', 'postgresql'].includes(source.kind)) return;
  const result: ParsedPage = { releases: [], next: [] };
  const make = (version: string, pageUrl = url): ToolRelease => ({ version, originalVersion: version, channel: 'stable', sourceUrl: url, pageUrl, assets: [], isPrerelease: /(?:alpha|beta|preview|rc|\d[a-b]\d|dev)/i.test(version) });
  if (source.kind === 'adoptium') {
    const data = JSON.parse(body);
    if (url.includes('/info/available_releases')) {
      if (!Array.isArray(data.available_releases) || !Array.isArray(data.available_lts_releases) || !Number.isInteger(data.most_recent_feature_release)) throw new Error('Adoptium feature index changed');
      result.metadata = { ltsFeatures: data.available_lts_releases.filter(Number.isInteger) };
      result.next = data.available_releases.filter((v: unknown) => Number.isInteger(v) && Number(v)>0 && Number(v)<=data.most_recent_feature_release).map((v: number) => `https://api.adoptium.net/v3/assets/feature_releases/${v}/ga?image_type=jdk&page_size=50&page=0`);
      return result;
    }
    if (!Array.isArray(data)) throw new Error('Adoptium schema changed');
    for (const row of data) {
      const item = make(row.version_data?.semver ?? row.release_name.replace(/^jdk-?/, '')); item.originalVersion = row.release_name;
      item.build = String(row.version_data?.build ?? ''); item.releaseDate = row.timestamp; item.isLts = (metadata?.ltsFeatures ?? [8,11,17,21,25]).includes(row.version_data?.major); item.channel = item.isLts ? 'lts' : 'stable';
      item.pageUrl = row.release_link ?? 'https://adoptium.net/temurin/releases/';
      for (const binary of row.binaries ?? []) { const pkg = binary.package; if (!pkg?.link) continue;
        item.assets.push({ ...asset(pkg.name, pkg.link), platform: binary.os === 'mac' ? 'macos' : binary.os,
          architecture: binary.architecture === 'aarch64' ? 'arm64' : binary.architecture, sha256: pkg.checksum }); }
      result.releases.push(item);
    }
    if (data.length === 50) { const next = new URL(url); next.searchParams.set('page', String(Number(next.searchParams.get('page')) + 1)); result.next.push(next.href); }
  } else if (source.kind === 'gradle') {
    const data = JSON.parse(body); if (!Array.isArray(data)) throw new Error('Gradle schema changed');
    for (const row of data) { if (row.snapshot || !row.version) continue; const item = make(row.version, `https://docs.gradle.org/${row.version}/release-notes.html`); item.isPrerelease = !!row.rcFor || !!row.milestoneFor || !!item.isPrerelease; if (row.downloadUrl) item.assets.push(asset(`gradle-${row.version}-bin.zip`, row.downloadUrl)); result.releases.push(item); }
  } else if (source.kind === 'pypi') {
    const data = JSON.parse(body); if (!data.releases || !data.info?.name) throw new Error('PyPI schema changed');
    for (const [version, files] of Object.entries(data.releases) as Array<[string, any[]]>) {
      const item = make(version, `https://pypi.org/project/${data.info.name}/${version}/`); item.releaseDate = files[0]?.upload_time_iso_8601;
      item.withdrawn = files.length > 0 && files.every(f => f.yanked); item.withdrawnReason = item.withdrawn ? files.find(f => f.yanked_reason)?.yanked_reason ?? 'PyPI yanked' : undefined;
      item.assets = files.map(f => ({ ...asset(f.filename, f.url, f.packagetype === 'sdist' ? 'source' : 'binary'), sha256: f.digests?.sha256, yanked: !!f.yanked, yankedReason: f.yanked_reason ?? undefined })); result.releases.push(item);
    }
  } else {
    const $ = load(body); const records = new Map<string, ToolRelease>();
    $('a[href]').each((_, el) => {
      const target = new URL($(el).attr('href')!, url); const current = new URL(url);
      if (target.origin !== current.origin || !target.pathname.startsWith(current.pathname) || target.pathname === current.pathname) return;
      const leaf = target.pathname.slice(current.pathname.length).replace(/\/$/, '');
      if (target.pathname.endsWith('/')) {
        const allowed = source.kind === 'maven' ? /^(?:maven-[1234]|\d+(?:\.\d+)+(?:-[A-Za-z0-9.]+)?|binaries|source)$/ : source.kind === 'python' ? /^(?:\d+\.\d+(?:\.\d+)?|amd64|arm64)$/ : /^v\d+(?:\.\d+)+$/;
        if (allowed.test(leaf)) result.next.push(target.href); return;
      }
      const regex = source.kind === 'maven' ? /(?:apache-maven|maven)-(\d+(?:\.\d+)+(?:-[A-Za-z]+-?\d+)?)\b/i : source.kind === 'python' ? /python-?(\d+\.\d+(?:\.\d+)?(?:[ab]|rc)?\d*)/i : /postgresql-(\d+(?:\.\d+)+)/i;
      const version = regex.exec(leaf)?.[1]; if (!version || !/\.(?:gz|xz|bz2|zip|exe|msi|pkg|dmg)$/.test(leaf)) return;
      const item = records.get(version) ?? make(version, url);
      item.assets.push(asset(leaf, target.href, source.kind === 'postgresql' || /(?:source|src|Python-)/.test(leaf) || source.kind === 'python' && /\.tar\./.test(leaf) ? 'source' : 'binary')); records.set(version, item);
    }); result.releases.push(...records.values());
  }
  return result;
}
