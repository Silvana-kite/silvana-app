import { describe, expect, it } from 'vitest';
import { asset, compareVersions, mergeReleases, parsePage, sources } from './sources.js';
const source = (id: string) => sources.find(s => s.toolId === id)!;
const parse = (id: string, body: unknown) => parsePage(source(id), typeof body === 'string' ? body : JSON.stringify(body), source(id).urls[0]);

describe('official release parsers', () => {
  it('preserves Node 12, its real npm version and platform declarations', () => {
    const result = parsePage(source('node'), JSON.stringify([{ version: 'v12.22.12', date: '2022-04-05', npm: '6.14.16', lts: 'Erbium', files: ['win-x64-zip', 'linux-x64', 'osx-x64-tar'] }]), source('node').urls[0], { v12: { end: '2022-04-30' } });
    expect(result.releases[0]).toMatchObject({ version: '12.22.12', bundledNpm: '6.14.16', channel: 'eol', pageUrl: 'https://nodejs.org/download/release/v12.22.12/' });
    expect(result.releases[0].assets.some(a => a.architecture === 'arm64')).toBe(false);
  });
  it.each(['npm', 'pnpm', 'yarn'])('reads registry history for %s while excluding prereleases', id => {
    const result = parse(id, { name: id, versions: { '1.0.0': { dist: { tarball: `https://registry.npmjs.org/${id}/-/a.tgz` } }, '2.0.0-beta.1': {} } });
    expect(result.releases.map(r => r.version)).toEqual(['1.0.0']);
    expect(result.releases[0].assets[0].kind).toBe('source');
  });
  it.each(['volta', 'fnm', 'nvm', 'nvm-windows', 'bun', 'deno', 'github-cli', 'github-desktop', 'powershell', 'windows-terminal', 'bruno'])('parses %s official release metadata and refuses drafts', id => {
    const tag = id === 'github-desktop' ? 'release-3.6.5' : id === 'bun' ? 'bun-v3.6.5' : 'v3.6.5';
    const release = { tag_name: tag, html_url: `https://github.com/${source(id).repository}/releases/tag/${tag}`, published_at: '2026-01-01', assets: [{ name: 'app-windows-arm64.zip', browser_download_url: 'https://github.com/vendor/app/releases/download/v3.6.5/app.zip' }] };
    const result = mergeReleases(parse(id, [release, { ...release, tag_name: 'v4.0.0-rc.1', prerelease: true }, { ...release, tag_name: 'v5.0.0', draft: true }]).releases);
    expect(result.filter(r => !r.isPrerelease).map(r => r.version)).toEqual(['3.6.5']);
    expect(result.find(r => r.version === '4.0.0-rc.1')?.isPrerelease).toBe(true);
    expect(result[0].assets[0]).toMatchObject({ platform: 'windows', architecture: 'arm64' });
  });
  it('normalizes VS Code tags independently of upstream ordering', () => {
    const result = mergeReleases(parse('vscode', [{ name: 'v1.9.0' }, { name: '1.100.0' }, { name: '1.101.0-insider' }]).releases);
    expect(result.map(r => r.version)).toEqual(['1.100.0', '1.9.0']);
    expect(result[0].assets[0].url).toContain('/1.100.0/');
  });
  it('retains very old Git versions and distinguishes source archives', () => {
    const result = mergeReleases(parse('git', '<a href="git-0.01.tar.gz">old</a><a href="git-2.51.0.tar.xz">new</a><a href="git-2.51.0.tar.gz">new</a>').releases);
    expect(result.map(r => r.version)).toEqual(['2.51.0', '0.01']);
    expect(result[0].assets).toHaveLength(2);
    expect(result[0].assets.every(a => a.kind === 'source')).toBe(true);
  });
  it('reads vendor-specific WebStorm and Edge formats', () => {
    expect(parse('webstorm', { WS: [{ version: '2024.1.2', type: 'release', downloads: { linuxARM64: { link: 'https://download.jetbrains.com/app.tar.gz' } } }] }).releases[0].assets[0].architecture).toBe('arm64');
    const edge = parse('edge', [{ Product: 'Stable', Releases: [{ ProductVersion: '130.0.1000.10', Platform: 'Windows', Architecture: 'x64', Artifacts: [{ Location: 'https://msedge.sf.dl.delivery.mp.microsoft.com/a.msi', ArtifactName: 'msi' }] }] }, { Product: 'Beta', Releases: [{ ProductVersion: '131.0.0.0' }] }]);
    expect(edge.releases.map(r => r.version)).toEqual(['130.0.1000.10']);
  });
  it('keeps Chrome pagination tokens and does not invent historical installers', () => {
    const result = parse('chrome', { versions: [{ version: '130.0.1000.9' }], nextPageToken: 'opaque/+' });
    expect(new URL(result.next[0]).searchParams.get('pageToken')).toBe('opaque/+');
    expect(result.releases[0].assets).toEqual([]);
    expect(compareVersions('130.0.1000.10', '130.0.1000.9')).toBeGreaterThan(0);
  });
  it('reads Firefox stable history without treating beta versions as stable', () => {
    expect(parse('firefox', { '1.0': '2004-11-09', '128.0esr': '2024-07-09', '130.0b1': '2024-08-01' }).releases.map(r => r.version)).toEqual(['1.0', '128.0esr']);
    expect(compareVersions('128.10esr', '128.2esr')).toBeGreaterThan(0);
  });
  it('uses the actual Postman official JSON structure', () => {
    const result = parse('postman', { notes: [{ version: '12.27.2', createdAt: '2026-09-09', content: 'Release notes' }] });
    expect(result.releases[0]).toMatchObject({ version: '12.27.2', assets: [] });
  });
  it('extracts Docker version sections, not versions mentioned in dependency notes', () => {
    const result = parsePage({ ...source('docker'), kind: 'docker' }, '<h2 id="4500">4.50.0</h2><p>Uses dependency 9.1.2</p><a href="https://desktop.docker.com/win/main/amd64/123/Docker.exe">Windows</a>', 'https://docs.docker.com/desktop/release-notes/');
    expect(result.releases.map(r => r.version)).toEqual(['4.50.0']);
    expect(result.releases[0].assets[0].url).toContain('Docker.exe');
  });
  it('reads Docker official Markdown headings without extracting dependency versions', () => {
    const result = parse('docker', '## 4.90.0\nUses dependency 9.1.2\n## 4.89.0\nPrevious release');
    expect(result.releases.map(r => r.version)).toEqual(['4.90.0','4.89.0']);
  });
  it('fails closed on malformed indexes and removes executable URLs', () => {
    expect(() => parse('node', { message: 'rate limited' })).toThrow();
    const item = parse('postman', { notes: [{ version: '1.2.3' }] }).releases[0];
    item.assets = [asset('bad', 'javascript:alert(1)')];
    expect(mergeReleases([item])[0].assets).toEqual([]);
  });
});
