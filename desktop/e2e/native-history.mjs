import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = new URL('../../artifacts/release-history/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.SIILVANA_NATIVE_CDP ?? 'http://127.0.0.1:9388');
try {
  const main = browser.contexts().flatMap(c => c.pages()).find(p => /localhost:1422|127\.0\.0\.1:1422/.test(p.url()));
  assert.ok(main, 'Native main WebView must be present');
  main.setDefaultTimeout(60000);
  const errors = []; main.on('pageerror', e => errors.push(e.message));
  await main.goto(`${new URL(main.url()).origin}/environment/setup/tools`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await main.getByRole('button', { name: 'Node.js 版本', exact: true }).click();
  await main.getByRole('textbox', { name: '搜索 Node.js 历史版本' }).fill('12.22.12');
  const row = main.locator('.release-list .release-row').filter({ hasText: '12.22.12' });
  await row.locator('a').first().click();
  await main.getByRole('dialog', { name: '应用内官方网站浏览器' }).waitFor();
  await main.waitForFunction(() => document.querySelector('.official-browser__status')?.textContent.includes('官网页面'), { timeout: 60000 });
  assert.equal(await main.getByRole('textbox', { name: '当前网页地址' }).inputValue(), 'https://nodejs.org/download/release/v12.22.12/');
  const targets = browser.contexts().flatMap(c => c.pages()).map(p => p.url());
  const remote = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://nodejs.org/'));
  assert.ok(remote, 'The official site must be a native child WebView');
  const remoteIpcDenied = await remote.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__) return true;
    try { await window.__TAURI_INTERNALS__.invoke('device_info'); return false; } catch { return true; }
  });
  assert.equal(remoteIpcDenied, true);
  await remote.evaluate(() => { window.open('https://nodejs.org/download/release/v12.22.12/SHASUMS256.txt', '_blank'); });
  await remote.waitForURL('**/SHASUMS256.txt');
  assert.equal(browser.contexts().flatMap(c => c.pages()).length, 2, 'Popup must reuse the child view');
  await main.getByRole('button', { name: '网页后退' }).click();
  await remote.waitForURL('https://nodejs.org/download/release/v12.22.12/');
  await remote.screenshot({ path: new URL('native-official-page.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await main.screenshot({ path: new URL('native-main.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await writeFile(new URL('native-verification.json', output), JSON.stringify({ checkedAt: new Date().toISOString(), nativeBrowser: await browser.version(), targets, historyUrl: 'https://nodejs.org/download/release/v12.22.12/', remoteIpcDenied, popupStayedInside: true, backNavigation: true, errors }, null, 2));
  console.log(JSON.stringify({ targets, errors }));
  await main.getByRole('button', { name: '关闭内置浏览器' }).click();
  assert.equal(await main.getByRole('dialog', { name: 'Node.js 版本', exact: true }).count(), 1);
} finally { await browser.close(); }
