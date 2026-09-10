import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.SIILVANA_PREVIEW_URL ?? 'http://127.0.0.1:1422';
const api = process.env.SIILVANA_API_URL ?? 'http://127.0.0.1:3311';
const output = new URL('../../artifacts/history-v2/', import.meta.url); await mkdir(output, { recursive: true });
const manifestResponse = await fetch(`${api}/v2/release-history/manifest`); assert.equal(manifestResponse.status, 200);
const manifest = await manifestResponse.json(); const node = manifest.tools.find(t => t.toolId === 'node'); assert.ok(node.count >= 865);
const snapshotResponse = await fetch(`${api}/v2/tools/node/history-snapshot?revision=${node.toolRevision}`); assert.equal(snapshotResponse.status, 200);
assert.equal((await fetch(`${api}/v2/tools/node/history-snapshot?revision=${node.toolRevision}`, { headers: { 'If-None-Match': snapshotResponse.headers.get('etag') } })).status, 304);
assert.equal((await fetch(`${api}/v2/tools/node/history-snapshot?revision=999999999`)).status, 409);
assert.equal((await fetch(`${api}/v2/tools/node/history-snapshot?revision=${node.toolRevision}`, { headers: { 'If-Match': '"invalid"' } })).status, 412);
assert.equal((await fetch(`${api}/ops/history/status`)).status, 401);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage();
  page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/environment/setup/scenario`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole('radiogroup').waitFor();
  assert.equal(await page.getByRole('radio').count(), 5);
  await page.getByRole('radio').filter({ hasText: 'Java' }).click(); await page.getByRole('button', { name: '下一步', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Eclipse Temurin JDK 版本', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Python 版本', exact: true }).count(), 0);
  await page.getByLabel('全部软件', { exact: true }).check();
  assert.equal(await page.getByRole('button', { name: 'Python 版本', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Node.js 版本', exact: true }).click();
  const search = page.getByRole('textbox', { name: '搜索 Node.js 历史版本' }); await search.fill('12.22.12');
  const row = page.locator('.release-list .release-row').filter({ hasText: '12.22.12' }); await row.waitFor();
  assert.match(await row.innerText(), /6\.14\.16/); assert.equal(await row.getByRole('button', { name: '选择此版本' }).count(), 0);
  await page.screenshot({ path: new URL('node-online.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.keyboard.press('Escape');
  // This version has never been searched; it must be searchable from a complete local snapshot.
  await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: 'Node.js 版本', exact: true }).click(); await search.fill('14.21.3');
  await page.locator('.release-list .release-row').filter({ hasText: '14.21.3' }).waitFor();
  await page.keyboard.press('Escape');
  // Corrupt the stored records while keeping the signed descriptor: recovery must reject them.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('siilvana-history-v2:siilvana-local'); request.onsuccess = () => { const db = request.result; const tx = db.transaction('tools','readwrite'); const store = tx.objectStore('tools'); const read = store.get('node');
      read.onsuccess = () => { const value = read.result; if (value) { value.records[0].version = '999.0.0'; store.put(value,'node'); } }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    }; request.onerror = () => reject(request.error);
  }));
  await page.reload(); await page.getByRole('button', { name: 'Node.js 版本', exact: true }).click(); await search.fill('12.22.12'); await row.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: new URL('node-offline-390.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.keyboard.press('Escape'); await page.goto(`${base}/environment/setup/scenario`);
  await page.getByRole('radio').filter({ hasText: '办公' }).click(); await page.getByRole('button', { name: '下一步', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '下载最新版' }).count(), 10);
  assert.equal(await page.locator('[aria-haspopup="dialog"]').count(), 0);
  await page.screenshot({ path: new URL('office-390.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(new URL('verification.json', output), JSON.stringify({ checkedAt: new Date().toISOString(), nodeCount: node.count, signedTools: manifest.tools.filter(t => t.toolRevision).length,
    checks: ['five-scenes','scene-filter','official-old-version','etag-304','revision-409','precondition-412','ops-auth','offline-unvisited-version','corrupt-cache-recovery','office-latest-only','responsive-390'], errors }, null, 2));
  console.log('Signed history API, scene selection, offline reopening and corrupted-cache recovery passed.');
} finally { await browser.close(); }
