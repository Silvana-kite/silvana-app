import { readFile, writeFile } from 'node:fs/promises';
import { createPublicKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
const root = new URL('../../', import.meta.url);
try { loadEnvFile(new URL('server/.env', root)); } catch { /* CI provides the signing key directly. */ }
const key = process.env.HISTORY_SIGNING_KEY ?? (process.env.HISTORY_SIGNING_KEY_FILE ? await readFile(process.env.HISTORY_SIGNING_KEY_FILE, 'utf8') : undefined);
if (!key) throw new Error('Signing key required; unsigned native recipes cannot be published');
const publicKey = createPublicKey(key).export({ format: 'jwk' });
const payload = execFileSync(process.execPath, [new URL('tools/catalog/native-manifest.mjs', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')]);
const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') };
await writeFile(new URL('packages/catalog/native-catalog.signed.json', root), JSON.stringify(envelope));
await writeFile(new URL('packages/catalog/native-catalog.public-key', root), Buffer.from(publicKey.x, 'base64url').toString('base64'));
console.log('Native recipes signed; public key fingerprint must be reviewed with snapshot trust root');
