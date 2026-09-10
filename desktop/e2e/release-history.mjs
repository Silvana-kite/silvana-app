import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.SIILVANA_PREVIEW_URL ?? 'http://127.0.0.1:1422';
const api = process.env.SIILVANA_API_URL ?? 'http://127.0.0.1:3100/v1';
const output = fileURLToPath(new URL('../../artifacts/release-history/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
try {
  const initial = await fetch(`${api}/tools/node/versions?q=12.22.12`);
  assert.equal(initial.status, 200);
  const data = await initial.json();
  assert.equal(data.items[0].bundledNpm, '6.14.16');
  const etag = initial.headers.get('etag');
  assert.equal((await fetch(`${api}/tools/node/versions?q=12.22.12`, { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await fetch(`${api}/tools/node/versions?page=0`)).status, 400);
  assert.equal((await fetch(`${api}/tools/unknown/versions`)).status, 404);
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/environment/setup/tools`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Node.js 版本', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索 Node.js 历史版本' }).fill('12.22.12');
    const row = page.locator('.release-list .release-row').filter({ hasText: '12.22.12' });
    await row.waitFor();
    assert.match(await row.innerText(), /6\.14\.16/);
    assert.equal(await row.getByRole('button', { name: '选择此版本' }).count(), 0);
    assert.equal(await row.locator('a').first().getAttribute('href'), 'https://nodejs.org/download/release/v12.22.12/');
    await page.screenshot({ path: `${output}/history-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Node.js 版本', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索 Node.js 历史版本' }).fill('12.22.12');
    await row.waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Google Chrome 版本', exact: true }).click();
    assert.match(await page.getByRole('dialog', { name: 'Google Chrome 版本', exact: true }).innerText(), /Google Chrome/);
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/web-verification.json`, JSON.stringify({ checkedAt: new Date().toISOString(), api, nodeVersion: data.items[0], etag, widths: [390, 1280], errors }, null, 2));
  console.log('Live PostgreSQL/API history, HTTP caching, historical selection and responsive UI passed.');
} finally { await browser.close(); }
