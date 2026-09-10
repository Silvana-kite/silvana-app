import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const secretDir = resolve(root, '.runtime/history');
await mkdir(secretDir, { recursive: true });
const keyFile = resolve(secretDir, 'signing.pem');
try { await access(keyFile); } catch {
  const pair = generateKeyPairSync('ed25519'); await writeFile(keyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const file = resolve(root, 'server/.env');
try { await access(file); console.log('Existing server/.env preserved'); } catch {
  const database = process.env.DATABASE_URL;
  if (!database || /(?:test|template|postgres)$/.test(new URL(database).pathname)) throw new Error('Set DATABASE_URL to an isolated daily database before initialization');
  await writeFile(file, `DATABASE_URL=${database}\nAUTO_MIGRATE=1\nHISTORY_DATASET_ID=siilvana-local\nHISTORY_SIGNING_KEY_ID=local-2026-09\nHISTORY_SIGNING_KEY_FILE=${keyFile.replaceAll('\\','/')}\nOPS_READ_TOKEN=${randomBytes(32).toString('hex')}\nCRON_SECRET=${randomBytes(32).toString('hex')}\nDESKTOP_ORIGIN=tauri://localhost,http://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420\n`, { mode: 0o600 });
  console.log('Local history configuration created; secrets omitted');
}
