import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.ENVIRONMENT_TEST_URL || 'http://127.0.0.1:1420';
const output = new URL('../../artifacts/environment/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function pageFor(viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('workspace-state-v1', JSON.stringify({
    version: 1, wizard: { platform: 'windows', architecture: 'x64', selected: {} },
    preferences: { syncOnLaunch: false, motion: 'system' }, activities: [],
  })));
  await page.goto(base + '/environment');
  await page.getByRole('button', { name: '开始智能扫描', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.adapt-hero__actions button').disabled);
  return page;
}
async function pixels(page) {
  return page.locator('.scan-scene canvas').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const buffer = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
    let visible = 0;
    let hash = 0;
    for (let i = 0; i < buffer.length; i += 4) {
      if (buffer[i + 3] > 10) visible++;
      hash = (hash + buffer[i] * (i + 1) + buffer[i + 1]) % 1000000007;
    }
    return { visible, hash, width: canvas.width, height: canvas.height };
  });
}
async function installMock(page, available = 58.2 * 1024 ** 3) {
  // This IPC fixture exists only in the test browser; production has no demo mode.
  await page.evaluate(async ({ available }) => {
    const { useEnvironmentStore } = await import('/src/features/environment/stores/environment.ts');
    const store = useEnvironmentStore();
    store.device = { platform: 'macos', architecture: 'arm64', cpuName: 'Apple Silicon M3 Max' };
    store.targetPlatform = 'macos'; store.targetArchitecture = 'arm64';
    window.diskReads = 0;
    window.diskAvailable = Math.floor(available);
    window.diskFail = false;
    window.__TAURI_INTERNALS__ = { invoke: async (command) => {
      if (command === 'scan_disks') {
        window.diskReads++;
        await new Promise((resolve) => setTimeout(resolve, 900));
        if (window.diskFail) throw new Error('测试：磁盘不可用');
        return [
          { id: '/', label: 'Macintosh HD (/)', totalBytes: 512 * 1024 ** 3, availableBytes: window.diskAvailable, installationTarget: true },
          { id: '/Volumes/Data', label: 'Data', totalBytes: 1024 ** 4, availableBytes: 0, installationTarget: false },
          { id: '/Volumes/External', label: 'External SSD', totalBytes: 512 * 1024 ** 3, availableBytes: 200 * 1024 ** 3, installationTarget: false },
        ];
      }
      if (command === 'plugin:store|load') return 1;
      return null;
    } };
  }, { available });
}
try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, tablet: { width: 834, height: 1112 }, mobile: { width: 390, height: 844 }, narrow: { width: 320, height: 740 }, '8k': { width: 7680, height: 4320 } })) {
    const page = await pageFor(viewport);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' horizontal overflow');
    const rendered = await pixels(page);
    assert.ok(rendered.visible > 2000, name + ' canvas is blank');
    await page.screenshot({ path: output + name + '.png', fullPage: true });
    console.log(name, rendered);
    if (name === 'mobile' || name === 'desktop') {
      await page.getByRole('button', { name: '开始智能扫描', exact: true }).click();
      await page.locator('dialog[open]').waitFor();
      const modal = await page.locator('dialog').boundingBox();
      assert.ok(modal.x >= 0 && modal.x + modal.width <= viewport.width);
      assert.ok(Math.abs(modal.x + modal.width / 2 - viewport.width / 2) < 2, 'dialog must be horizontally centered');
      assert.ok(Math.abs(modal.y + modal.height / 2 - viewport.height / 2) < 2, 'dialog must be vertically centered');
      await page.screenshot({ path: output + name + '-permission.png' });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog').count(), 0);
      assert.equal(await page.getByRole('button', { name: '下一步', exact: true }).isEnabled(), false);
    }
    await page.close();
  }

  const web = await pageFor({ width: 1440, height: 1000 });
  await web.getByRole('button', { name: '开始智能扫描', exact: true }).click();
  await web.getByRole('button', { name: '允许并扫描' }).click();
  await web.getByText('当前浏览器无法读取本地磁盘空间。', { exact: false }).waitFor();
  assert.equal(await web.getByRole('button', { name: '下一步', exact: true }).isEnabled(), false);
  await web.getByRole('button', { name: /手动配置/ }).click();
  await web.getByText('磁盘空间未验证', { exact: true }).waitFor();
  await web.close();

  const page = await pageFor({ width: 1440, height: 1000 });
  await installMock(page);
  await page.getByRole('button', { name: '开始智能扫描', exact: true }).click();
  assert.equal(await page.evaluate(() => window.diskReads), 0);
  await page.getByRole('button', { name: '暂不允许' }).click();
  assert.equal(await page.evaluate(() => window.diskReads), 0);
  await page.getByRole('button', { name: '开始智能扫描', exact: true }).click();
  await page.getByRole('button', { name: '允许并扫描' }).click();
  await page.getByRole('button', { name: '正在智能扫描', exact: true }).waitFor();
  const first = await pixels(page);
  await page.waitForTimeout(180);
  const second = await pixels(page);
  assert.notEqual(first.hash, second.hash, 'scanning canvas is static');
  await page.locator('.adapt-metric--disk.is-ready').waitFor();
  assert.equal(await page.locator('.disk-inventory__row').count(), 3);
  assert.equal(await page.locator('.disk-overview__item').count(), 3);
  await page.locator('.disk-overview').getByText('External SSD可用空间', { exact: true }).waitFor();
  await page.getByText('已扫描 3 个磁盘', { exact: true }).waitFor();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.disk-inventory').screenshot({ path: output + `disks-${width}.png` });
  }
  assert.equal(await page.getByRole('button', { name: '下一步', exact: true }).isEnabled(), true);
  await page.screenshot({ path: output + 'scan-success.png', fullPage: true });
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.waitForURL('**/environment/setup/tools');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.waitForURL('**/environment/setup/install');
  await page.locator('.export-disclosure > summary').click();
  await page.evaluate(() => { window.diskAvailable = 1024; });
  await page.getByRole('button', { name: '下载脚本' }).click();
  await page.getByText('磁盘校验未通过或方案已变化', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: '下载脚本' }).isEnabled(), false);
  await page.getByRole('link', { name: '返回适配中心' }).click();
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  assert.equal(await page.locator('dialog').count(), 0);
  await page.locator('.adapt-metric--disk.is-low').waitFor();
  await page.getByRole('button', { name: '释放空间', exact: true }).click();
  await page.locator('.adapt-cleanup').waitFor();
  await page.screenshot({ path: output + 'scan-low-space.png', fullPage: true });
  await page.evaluate(() => { window.diskFail = true; });
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  assert.equal(await page.locator('dialog').count(), 0);
  await page.getByText('测试：磁盘不可用', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.adapt-metric--disk.is-ready').count(), 0);
  assert.equal(await page.getByRole('button', { name: '下一步', exact: true }).isEnabled(), false);
  await page.close();
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log('Environment UI and permission flow checks passed.');
} finally { await browser.close(); }
