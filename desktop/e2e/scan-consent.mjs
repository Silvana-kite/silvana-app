import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.ENVIRONMENT_TEST_URL || 'http://127.0.0.1:1420';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const stateKey = 'native-test:workspace-state-v1';
    if (!localStorage.getItem(stateKey)) localStorage.setItem(stateKey, JSON.stringify({
      version: 1, wizard: { platform: 'windows', architecture: 'x64', selected: { git: 'git-stable' } },
      preferences: { syncOnLaunch: false, motion: 'reduced' }, activities: [],
    }));
    window.diskReads = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === 'plugin:store|load') return 1;
        if (command === 'plugin:store|get') {
          const value = localStorage.getItem('native-test:' + args.key);
          return [value ? JSON.parse(value) : null, value !== null];
        }
        if (command === 'plugin:store|set') { localStorage.setItem('native-test:' + args.key, JSON.stringify(args.value)); return; }
        if (command === 'device_info') return { platform: 'windows', architecture: 'x64', cpuName: 'Test CPU' };
        if (command === 'scan_disks') {
          window.diskReads++;
          if (localStorage.getItem('scan-test-failure')) throw new Error('测试：磁盘读取失败');
          return [{ id: 'C:\\', label: 'C:\\', availableBytes: 80 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, systemTarget: true, temporaryTarget: true }];
        }
        return null;
      },
    };
  });
  await page.goto(base + '/environment', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '开始智能扫描', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.diskReads), 0);
  await page.getByRole('button', { name: '开始智能扫描', exact: true }).click();
  await page.getByRole('button', { name: '允许并扫描', exact: true }).click();
  await page.getByRole('region', { name: '软件安装位置' }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('native-test:workspace-state-v1')).preferences.diskScanConsent === true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('region', { name: '软件安装位置' }).waitFor();
  assert.equal(await page.evaluate(() => window.diskReads), 1);
  assert.equal(await page.locator('dialog').count(), 0);
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  assert.equal(await page.evaluate(() => window.diskReads), 2);
  assert.equal(await page.locator('dialog').count(), 0);

  await page.evaluate(() => localStorage.setItem('scan-test-failure', 'true'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('测试：磁盘读取失败', { exact: true }).first().waitFor();
  assert.equal(await page.getByRole('region', { name: '软件安装位置' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '下一步', exact: true }).isDisabled(), true);
  await page.evaluate(() => localStorage.removeItem('scan-test-failure'));
  await page.locator('.adapt-hero__actions > .primary-button').click();
  await page.getByRole('region', { name: '软件安装位置' }).waitFor();
  assert.equal(await page.locator('dialog').count(), 0);

  await page.goto(base + '/settings', { waitUntil: 'domcontentloaded' });
  const permission = page.getByRole('switch', { name: '记住磁盘扫描授权', exact: true });
  await permission.waitFor();
  assert.equal(await permission.isChecked(), true);
  await permission.uncheck();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('native-test:workspace-state-v1')).preferences.diskScanConsent === false);
  await page.goto(base + '/environment', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '开始智能扫描', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.diskReads), 0);
  await page.getByRole('button', { name: '开始智能扫描', exact: true }).click();
  await page.getByRole('button', { name: '允许并扫描', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.diskReads), 0);
  assert.deepEqual(errors, []);
  console.log('Remembered scan consent: automatic refresh after reload, refresh without prompts, failure recovery and revocation passed.');
} finally { await browser.close(); }
