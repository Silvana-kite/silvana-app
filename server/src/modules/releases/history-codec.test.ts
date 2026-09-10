import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { canonicalJson, compareRevision, compareHistory } from '@siilvana/shared';
import { makeSnapshot, toHistory, verifySigned, hash } from './history-codec.js';
import { parsePage, sources, mergeReleases } from './sources.js';
import { publicAddress } from './network-policy.js';
const pair = generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const base = { version: '21.0.1', originalVersion: 'jdk-21.0.1+12', build: '12', channel: 'lts' as const, pageUrl: 'https://adoptium.net/temurin/releases/', sourceUrl: 'https://api.adoptium.net/v3/assets', assets: [
  { name: 'jdk-win-x64.zip', url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk/jdk-win-x64.zip', platform: 'windows' as const, architecture: 'x64' as const, kind: 'binary' as const },
  { name: 'jdk-win-x64.msi', url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk/jdk-win-x64.msi', platform: 'windows' as const, architecture: 'x64' as const, kind: 'binary' as const },
] };
describe('signed history contracts', () => {
  it('keeps builds and installer types distinct without multiplying releases', () => {
    const first = toHistory('jdk', base); const next = toHistory('jdk', { ...base, build: '13' });
    expect(first.releaseId).not.toBe(next.releaseId); expect(new Set(first.assets.map(a => a.assetId)).size).toBe(2);
    expect(toHistory('jdk', { ...base, channel: 'eol' }).releaseId).toBe(first.releaseId);
    expect(mergeReleases([base, { ...base, build: '13' }])).toHaveLength(2);
  });
  it('signs deterministic shards and detects metadata/content tampering', () => {
    const result = makeSnapshot('test', 'jdk', '1', [toHistory('jdk', base)], { coverage: 'full', scope: 'fixture', sourceStatus: 'ready', lastSuccessAt: null, missingReason: null }, privateKey, 'test');
    expect(verifySigned(result.descriptor, publicKey)).toBe(true);
    expect(verifySigned({ ...result.descriptor, toolRevision: '2' }, publicKey)).toBe(false);
    const shard = result.descriptor.shards[0]!; const body = result.blobs.get(shard.hash)!; const raw = gunzipSync(body);
    expect(hash(raw)).toBe(shard.rawHash); expect(hash(canonicalJson(JSON.parse(raw.toString())))).toBe(result.descriptor.rootHash);
    body[0] = body[0]! ^ 1; expect(hash(body)).not.toBe(shard.hash);
  });
  it('compares arbitrary-sized numeric revisions without timestamps or lexicographic mistakes', () => {
    expect(compareRevision('10', '9')).toBeGreaterThan(0); expect(compareRevision('10000000000000000001', '10000000000000000000')).toBeGreaterThan(0);
    expect(() => compareRevision('01', '1')).toThrow();
    const releases = [toHistory('jdk', { ...base, version: '21.0.1-rc.2', isPrerelease: true }), toHistory('jdk', base)];
    expect(releases.sort(compareHistory)[0]?.isPrerelease).toBe(false);
  });
  it('rejects private, mapped, documentation and loopback socket destinations', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '169.254.169.254', '198.18.0.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', '2001:0000:1::1', '2001::1', '3fff::1']) expect(publicAddress(address)).toBe(false);
    expect(publicAddress('1.1.1.1')).toBe(true); expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('discovers non-LTS Java GA versions without requesting unreleased tip versions', () => {
    const source = sources.find(s => s.toolId === 'jdk')!;
    const result = parsePage(source, JSON.stringify({ available_releases: [8,21,26,28], available_lts_releases: [8,21], most_recent_feature_release: 26 }), source.urls[0]!);
    expect(result.next).toHaveLength(3); expect(result.next[2]).toContain('/26/ga'); expect(result.metadata?.ltsFeatures).toEqual([8,21]);
  });
  it('preserves yanked and preview metadata from PyPI', () => {
    const source = sources.find(s => s.toolId === 'pip')!;
    const result = parsePage(source, JSON.stringify({ info: { name: 'pip' }, releases: { '25.0.0': [{ filename: 'pip.tar.gz', url: 'https://files.pythonhosted.org/pip.tar.gz', yanked: true, yanked_reason: 'broken', digests: { sha256: 'a'.repeat(64) } }], '26.0rc1': [] } }), source.urls[0]!);
    expect(result.releases[0]).toMatchObject({ withdrawn: true, withdrawnReason: 'broken' }); expect(result.releases[1]?.isPrerelease).toBe(true);
  });
});
