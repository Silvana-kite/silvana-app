import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.SIILVANA_PREVIEW_URL || 'http://127.0.0.1:1421';
const output = fileURLToPath(new URL('../../artifacts/installation/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('workspace-state-v1', JSON.stringify({ version: 1, wizard: { platform: 'windows', architecture: 'x64', selected: {} }, preferences: { syncOnLaunch: false, motion: 'reduced' }, activities: [] })));
    await page.goto(base + '/environment/setup/scenario');
    await page.getByRole('radio', { name: /前端 Web/ }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    // Native fixtures are confined to this browser test; no software is installed.
    await page.evaluate(async () => {
      const { useWizardStore } = await import('/src/features/environment/stores/wizard.ts');
      const { useEnvironmentStore } = await import('/src/features/environment/stores/environment.ts');
      const wizard = useWizardStore(); useEnvironmentStore().consent = true;
      let sequence = 0; let snapshot;
      const copy = value => JSON.parse(JSON.stringify(value));
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command, args) => {
          if (command === 'plugin:store|load') return 1;
          if (command === 'get_install_session') return snapshot || null;
          if (command === 'prepare_install') {
            snapshot = { sequence: ++sequence, id: 'browser-test', status: 'prepared', fingerprint: args.request.fingerprint, blockers: [], logs: [], steps: wizard.plan.selections.map(item => ({ toolId: item.toolId, name: wizard.catalog.tools.find(tool => tool.id === item.toolId).name, version: 'stable', installedVersion: null, executablePath: null, status: item.toolId === 'git' ? 'skipped' : 'pending', message: '' })) };
            return copy(snapshot);
          }
          if (command === 'start_install' || command === 'retry_install') {
            snapshot.status = 'running'; snapshot.sequence = ++sequence;
            snapshot.steps[0].status = 'running';
            const initial = copy(snapshot);
            setTimeout(() => {
              snapshot.sequence = ++sequence;
              if (command === 'start_install') { snapshot.status = 'failed'; snapshot.steps[0].status = 'failed'; snapshot.steps[0].message = '测试：下载失败'; }
              else { snapshot.status = 'success'; snapshot.steps.forEach(step => { step.status = 'success'; step.message = '安装与版本验证通过'; step.installedVersion = '24.20.0'; step.executablePath = 'C:/Tools/' + step.toolId; }); }
              snapshot.logs.push('Test process output'); args.onEvent.onmessage(copy(snapshot));
            }, 1200);
            return initial;
          }
          return null;
        },
      };
    });
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('heading', { name: '方案已检查' }).waitFor();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '开始安装', exact: true }).click();
    await page.getByRole('heading', { name: '正在安装' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '返回主页', exact: true }).isDisabled(), true);
    await page.getByRole('heading', { name: '安装未完成' }).waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${width}-failed.png`, fullPage: true });
    await page.getByRole('button', { name: '重新检测并重试', exact: true }).click();
    await page.getByRole('heading', { name: '安装完成', exact: true }).waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/${width}-success.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Native IPC fixture: preflight, failure, retry, progress and responsive views passed.');
} finally { await browser.close(); }
