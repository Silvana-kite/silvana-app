import 'reflect-metadata';
import './infrastructure/source-tls.js';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, isAbsolute } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { canonicalJson } from '@siilvana/shared';
import { AppModule } from './app.module.js';
import { HistoryService } from './modules/releases/history.service.js';
import { verifySigned, hash, redactError } from './modules/releases/history-codec.js';

async function pruneExport(directory: URL, retained: Set<string>) {
  const root = fileURLToPath(directory);
  const visit = async (folder: URL, prefix = '') => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`; const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), folder);
      if (entry.isSymbolicLink()) throw new Error('Snapshot export cannot contain symbolic links');
      if (entry.isDirectory()) { await visit(url, `${name}/`); continue; }
      if (retained.has(name) || !/^(?:blobs\/[a-f0-9]{64}|tools\/[a-z0-9-]+\/[1-9]\d*\.json)$/.test(name)) continue;
      const target = fileURLToPath(url); const within = relative(root, target);
      if (within.startsWith('..') || isAbsolute(within)) throw new Error('Export cleanup escaped its directory');
      await unlink(target);
    }
  };
  await visit(directory);
}

async function main() {
  if (process.env.HISTORY_SIGNING_KEY_FILE) process.env.HISTORY_SIGNING_KEY = await readFile(process.env.HISTORY_SIGNING_KEY_FILE, 'utf8');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const service = app.get(HistoryService); const manifest = await service.publish();
    if (process.argv.includes('--export')) {
      const directory = new URL('../../desktop/public/history/', import.meta.url);
      const key = createPublicKey(process.env.HISTORY_SIGNING_KEY!); const pem = key.export({ type: 'spki', format: 'pem' }).toString();
      const jwk = key.export({ format: 'jwk' });
      let previousLock: { datasetId?: string; publicKeys?: Record<string,string>; keyId?: string; publicKey?: string } = {};
      try { previousLock = JSON.parse(await readFile(new URL('../../history-snapshot.lock.json', import.meta.url),'utf8')); } catch { /* Initial export has no prior trust roots. */ }
      const publicKeys: Record<string,string> = previousLock.datasetId === manifest.datasetId ? previousLock.publicKeys ?? (previousLock.keyId && previousLock.publicKey ? { [previousLock.keyId]: previousLock.publicKey } : {}) : {};
      if (publicKeys[manifest.signature.keyId] && publicKeys[manifest.signature.keyId] !== pem) throw new Error('Signing key ID must not be reused for different key material');
      publicKeys[manifest.signature.keyId] = pem;
      if (!verifySigned(manifest, pem)) throw new Error('Manifest verification failed');
      await mkdir(new URL('blobs/', directory), { recursive: true }); let total = 0;
      const retained = new Set<string>(['manifest.json']);
      for (const entry of manifest.tools) {
        if (!entry.toolRevision) continue;
        const snapshot = await service.snapshot(entry.toolId, entry.toolRevision);
        if (!verifySigned(snapshot, publicKeys[snapshot.signature.keyId] ?? pem) || hash(canonicalJson(snapshot)) !== entry.snapshotHash || snapshot.count !== entry.count) throw new Error('Snapshot validation failed');
        const toolDir = new URL(`tools/${entry.toolId}/`, directory); await mkdir(toolDir, { recursive: true });
        await writeFile(new URL(`${entry.toolRevision}.json`, toolDir), canonicalJson(snapshot));
        retained.add(`tools/${entry.toolId}/${entry.toolRevision}.json`);
        for (const shard of snapshot.shards) retained.add(`blobs/${shard.hash}`);
        for (const shard of snapshot.shards) { const body = await service.blob(shard.hash); if (hash(body) !== shard.hash) throw new Error('Blob corrupted'); total += body.length; if (total > 50 * 1024 * 1024) throw new Error('Snapshot bundle exceeds 50 MiB'); await writeFile(new URL(`blobs/${shard.hash}`, directory), body); }
      }
      await writeFile(new URL('manifest.json', directory), canonicalJson(manifest));
      const trusted = Object.fromEntries(Object.entries(publicKeys).map(([id,pem]) => [id, Buffer.from(createPublicKey(pem).export({format:'jwk'}).x!, 'base64url').toString('base64')]));
      await writeFile(new URL('../../desktop/src/features/environment/services/history-trust.ts', import.meta.url), `// Reviewed offline history trust root. Private key is never bundled.\nexport const historyDataset = ${JSON.stringify(manifest.datasetId)};\nexport const historyKeys: Record<string, string> = ${JSON.stringify(trusted)};\n`);
      await writeFile(new URL('../../history-snapshot.lock.json', import.meta.url), JSON.stringify({ schemaVersion: 2, datasetId: manifest.datasetId, manifestRevision: manifest.manifestRevision, manifestHash: hash(canonicalJson(manifest)), publicKey: pem, publicKeys, keyId: manifest.signature.keyId, compressedBytes: total }, null, 2));
      await pruneExport(directory, retained);
      console.log(JSON.stringify({ exported: true, datasetId: manifest.datasetId, tools: manifest.tools.filter(t => t.toolRevision).length, bytes: total }));
    } else console.log(JSON.stringify({ revision: manifest.manifestRevision, tools: manifest.tools.length }));
  } finally { await app.close(); }
}
main().catch(error => { console.error(redactError(error)); process.exitCode = 1; });
