import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.SIILVANA_PREVIEW_URL || 'http://127.0.0.1:1421';
const output = fileURLToPath(new URL('../../artifacts/scenario/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
try {
  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 960 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { if (!localStorage.getItem('workspace-state-v1')) localStorage.setItem('workspace-state-v1', JSON.stringify({ version: 1, wizard: { platform: 'windows', architecture: 'x64', selected: {}, targetMode: 'auto' }, preferences: { syncOnLaunch: false, motion: 'reduced' }, activities: [] })); });
    await page.goto(base + '/environment/setup/scenario');
    await page.getByRole('heading', { name: '选择开发场景' }).waitFor();
    const next = page.getByRole('button', { name: '下一步', exact: true });
    assert.equal(await next.isDisabled(), true);
    const frontend = page.getByRole('radio', { name: /前端 Web/ });
    await frontend.click();
    assert.match(page.url(), /\/scenario$/);
    assert.equal(await frontend.getAttribute('aria-checked'), 'true');
    assert.equal(await next.isDisabled(), false);
    assert.match(await page.locator('.plan-summary-button').innerText(), /6 项工具/);
    await page.locator('.plan-summary-button').click();
    await page.getByRole('dialog', { name: '当前方案' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: '当前方案' }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}`);
    await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
    await next.click();
    await page.waitForURL('**/tools');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.waitForURL('**/review');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.waitForURL('**/install');
    assert.equal(await page.getByRole('button', { name: '开始安装', exact: true }).count(), 0);
    await page.goto(base + '/environment/setup/scenario');
    await page.getByRole('radio', { name: /前端 Web/ }).waitFor();
    await page.waitForFunction(() => document.querySelector('.scenario-card--frontend-web')?.getAttribute('aria-checked') === 'true');
    await page.getByRole('radio', { name: /自定义/ }).click();
    await next.click();
    await page.waitForURL('**/tools');
    assert.equal(await page.getByRole('button', { name: '下一步', exact: true }).isDisabled(), true);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Scenario workflow and responsive screenshots passed at 5 widths.');
} finally { await browser.close(); }
