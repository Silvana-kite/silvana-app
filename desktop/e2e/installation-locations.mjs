import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.SIILVANA_PREVIEW_URL || 'http://127.0.0.1:1420';
const output = fileURLToPath(new URL('../../artifacts/installation-locations/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('workspace-state-v1', JSON.stringify({
      version: 1, wizard: { platform: 'windows', architecture: 'x64', selected: { git: 'git-stable', vscode: 'vscode-stable' } },
      preferences: { syncOnLaunch: false, motion: 'reduced' }, activities: [],
    })));
    await page.goto(base + '/environment');
    await page.waitForFunction(() => !document.querySelector('.adapt-hero__actions button').disabled);
    await page.evaluate(async () => {
      const { useWizardStore } = await import('/src/features/environment/stores/wizard.ts');
      const { useEnvironmentStore } = await import('/src/features/environment/stores/environment.ts');
      const wizard = useWizardStore(), environment = useEnvironmentStore();
      environment.device = { platform: 'windows', architecture: 'x64', cpuName: 'Test CPU' };
      environment.targetPlatform = 'windows'; environment.targetArchitecture = 'x64';
      let snapshot; let sequence = 0;
      window.offline = false; window.conflict = false; window.wrongLocation = true;
      const clone = value => JSON.parse(JSON.stringify(value));
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args) => {
          if (command === 'plugin:store|load') return 1;
          if (command === 'get_install_session') return snapshot || null;
          if (command === 'scan_disks') return ['C:\\', 'D:\\', 'E:\\', 'F:\\'].filter(id => !window.offline || id !== 'D:\\').map(id => ({
            id, label: id, totalBytes: 100 * 1024 ** 3, availableBytes: id === 'F:\\' ? 0 : 80 * 1024 ** 3,
            systemTarget: id === 'C:\\', temporaryTarget: id === 'C:\\', installationTarget: id === 'C:\\',
          }));
          if (command === 'prepare_install') {
            window.lastRequest = clone(args.request);
            snapshot = {
              id: 'disk-test', sequence: ++sequence, status: 'prepared', fingerprint: args.request.fingerprint,
              blockers: window.conflict ? [{ message: 'Git 已安装在 C 盘，与所选 D 盘冲突。', url: null }] : [], logs: [],
              steps: wizard.plan.selections.map(item => ({
                toolId: item.toolId, name: wizard.catalog.tools.find(tool => tool.id === item.toolId).name, version: 'stable',
                installedVersion: null, executablePath: null, status: 'pending', message: '',
                targetDisk: args.request.installationTargets[item.toolId],
                installDirectory: args.request.installationTargets[item.toolId] + 'Siilvana\\Apps\\' + item.toolId,
              })),
            };
            return clone(snapshot);
          }
          if (command === 'start_install' || command === 'retry_install') {
            snapshot.status = 'running'; snapshot.sequence = ++sequence;
            const initial = clone(snapshot);
            setTimeout(() => {
              snapshot.sequence = ++sequence;
              snapshot.status = window.wrongLocation ? 'failed' : 'success';
              snapshot.steps.forEach(step => {
                step.status = window.wrongLocation ? 'failed' : 'success';
                step.message = window.wrongLocation ? '测试：安装器忽略目标目录，真实位置不符。' : '安装位置与版本验证通过';
                step.executablePath = window.wrongLocation ? 'C:\\Unexpected\\tool.exe' : step.installDirectory + '\\tool.exe';
              });
              args.onEvent.onmessage(clone(snapshot));
            }, 200);
            return initial;
          }
          return null;
        },
      };
    });
    let consentGranted = false;
    async function scan() {
      await page.locator('.adapt-hero__actions > .primary-button').click();
      if (!consentGranted) { await page.getByRole('button', { name: '允许并扫描' }).click(); consentGranted = true; }
      else assert.equal(await page.locator('dialog').count(), 0);
      await page.getByRole('region', { name: '软件安装位置' }).waitFor();
    }
    await scan();
    await page.getByRole('combobox', { name: 'Git 安装磁盘', exact: true }).selectOption('D:\\');
    await page.getByRole('combobox', { name: 'Visual Studio Code 安装磁盘', exact: true }).selectOption('E:\\');
    const overview = page.locator('.disk-overview');
    assert.equal(await overview.locator('.disk-overview__item').count(), 4);
    for (const letter of ['C', 'D', 'E', 'F']) await overview.getByText(letter + ' 盘可用空间', { exact: true }).waitFor();
    const volume = letter => overview.locator('.disk-overview__item').filter({ hasText: letter + ' 盘可用空间' });
    assert.equal(await volume('C').getByText('临时缓存', { exact: true }).count(), 1);
    assert.equal(await volume('C').getByText('安装目标', { exact: true }).count(), 0);
    for (const letter of ['D', 'E']) assert.equal(await volume(letter).getByText('安装目标', { exact: true }).count(), 1);
    assert.equal(await volume('F').getByText('未用于本次安装', { exact: true }).count(), 1);
    assert.equal(await volume('F').getByText('0.0 GiB', { exact: true }).count(), 1);
    assert.equal(await page.locator('.disk-overview.is-low').count(), 0);
    if (width === 390) {
      await page.setViewportSize({ width: 320, height: 960 });
      await page.screenshot({ path: output + '320-page.png', fullPage: true });
      const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, JSON.stringify(overflow));
      await page.locator('.adapt-metrics').screenshot({ path: output + '320-overview.png' });
      await page.setViewportSize({ width, height: 960 });
    }
    await page.locator('.adapt-metrics').screenshot({ path: output + width + '-overview.png' });
    assert.equal(await page.getByRole('button', { name: '下一步', exact: true }).isEnabled(), true);
    await page.evaluate(() => { window.offline = true; });
    await scan();
    assert.equal(await page.getByRole('combobox', { name: 'Git 安装磁盘', exact: true }).inputValue(), 'D:\\');
    assert.equal(await page.getByRole('button', { name: '下一步', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.offline = false; });
    await scan();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('region', { name: '软件安装位置' }).screenshot({ path: output + width + '-choices.png' });
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.waitForURL('**/environment/setup/tools');
    assert.equal(await page.getByRole('combobox', { name: 'Git 安装磁盘', exact: true }).inputValue(), 'D:\\');
    await page.evaluate(() => { window.conflict = true; });
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByText('Git 已安装在 C 盘，与所选 D 盘冲突。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '下一步', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.conflict = false; });
    await page.getByRole('button', { name: '重新检测', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.setup-actionbar .primary-button').disabled);
    assert.deepEqual(await page.evaluate(() => window.lastRequest.installationTargets), { git: 'D:\\', vscode: 'E:\\' });
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '开始安装', exact: true }).click();
    await page.getByRole('heading', { name: '安装未完成', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '下载脚本', exact: true }).count(), 0);
    await page.evaluate(() => { window.wrongLocation = false; });
    await page.getByRole('button', { name: '重新检测并重试', exact: true }).click();
    await page.getByRole('heading', { name: '安装完成', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: output + width + '-complete.png', fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Per-tool disk workflow: independent targets, offline volumes, conflicts, verification failures, retry and responsive layouts passed.');
} finally { await browser.close(); }
