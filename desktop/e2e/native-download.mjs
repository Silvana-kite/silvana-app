import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const verifyOnly = process.argv.includes('--verify-only');
const browser = verifyOnly ? undefined : await chromium.connectOverCDP(process.env.SIILVANA_NATIVE_CDP ?? 'http://127.0.0.1:9388');
const destination = new URL('../../artifacts/release-history/node-v12.22.12-headers.tar.gz', import.meta.url);
let disconnected = false;
try {
  const checksumText = await (await fetch('https://nodejs.org/download/release/v12.22.12/SHASUMS256.txt')).text();
  const expected = checksumText.split('\n').find(line => line.trim().endsWith('node-v12.22.12-headers.tar.gz'))?.split(/\s+/)[0];
  assert.ok(expected);
  if (browser) {
  const main = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(':1422'));
  assert.ok(main);
  await main.evaluate(async () => {
    const { openOfficialUrl } = await import('/src/shared/services/official-browser.ts');
    setTimeout(() => openOfficialUrl('https://nodejs.org/download/release/v12.22.12/node-v12.22.12-headers.tar.gz'), 1500);
  });
  // Detach before the download so automation cannot intercept the native download delegate.
  await browser.close(); disconnected = true;
  console.log('Native download scheduled; automation detached before the save dialog.');
  }
  const deadline = Date.now() + 90000;
  let bytes; let actual;
  while (Date.now() < deadline) {
    bytes = await readFile(destination).catch(() => undefined);
    actual = bytes && createHash('sha256').update(bytes).digest('hex');
    if (actual === expected) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(actual, expected, 'Saved archive must match the official SHA-256');
  await writeFile(new URL('../../artifacts/release-history/native-download-verification.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), file: 'node-v12.22.12-headers.tar.gz', bytes: bytes.length, sha256: actual, officialChecksumMatched: true, nativeSaveDialog: true, executed: false }, null, 2));
  console.log(`Native save passed: ${bytes.length} bytes; official SHA-256 matched.`);
} finally { if (browser && !disconnected) await browser.close(); }
