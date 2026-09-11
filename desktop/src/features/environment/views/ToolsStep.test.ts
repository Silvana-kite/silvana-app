import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ToolsStep from './ToolsStep.vue';
import { useWizardStore } from '../stores/wizard';
import { openOfficialUrl } from '../../../shared/services/official-browser';

vi.mock('../../../shared/services/official-browser', () => ({ openOfficialUrl: vi.fn() }));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

function render() {
  const store = useWizardStore();
  store.platform = 'windows';
  return { store, wrapper: mount(ToolsStep, { global: { stubs: { VersionPanel: true } } }) };
}

describe('tool selection guidance', () => {
  it('allows adding a fourth tool to the Python preset and removing it again', async () => {
    const { store, wrapper } = render();
    store.applyTemplate('data-science');
    await nextTick();
    expect(wrapper.get('[role="status"]').text()).toContain('已选 3 项');
    expect(wrapper.text()).toContain('打开“全部软件”');
    await wrapper.get('[aria-label="选择 PostgreSQL"]').trigger('click');
    expect(wrapper.get('[role="status"]').text()).toContain('已选 4 项');
    expect(store.plan.selections.map(item => item.toolId)).toContain('postgresql');
    await wrapper.get('[aria-label="取消选择 PostgreSQL"]').trigger('click');
    expect(wrapper.get('[role="status"]').text()).toContain('已选 3 项');
    wrapper.unmount();
  });

  it('explains dependencies and releases their controls when the parent is removed', async () => {
    const { wrapper } = render();
    await wrapper.get('[aria-label="选择 pnpm"]').trigger('click');
    const node = () => wrapper.findAll('.tool-card').find(card => card.get('h2').text().startsWith('Node.js'))!;
    const npm = () => wrapper.findAll('.tool-card').find(card => card.get('h2').text().startsWith('npm'))!;
    expect(node().text()).toContain('pnpm 需要此工具');
    expect(node().find('.check-button').exists()).toBe(false);
    expect(npm().text()).toContain('随 Node.js 提供');
    expect(npm().find('.check-button').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('已选 3 项（含 2 项自动依赖）');
    await wrapper.get('[aria-label="取消选择 pnpm"]').trigger('click');
    expect(wrapper.get('[role="status"]').text()).toContain('已选 0 项');
    expect(node().find('[aria-label="选择 Node.js"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('only requires Volta after choosing a managed Node version', async () => {
    const { store, wrapper } = render();
    await wrapper.get('[aria-label="选择 Node.js"]').trigger('click');
    expect(store.plan.selections.map(item => item.toolId)).toEqual(['node', 'npm']);
    expect(wrapper.find('[aria-label="选择 Volta"]').exists()).toBe(true);
    store.setVersion('node', 'node-24.20.0');
    await nextTick();
    expect(store.plan.selections.map(item => item.toolId)).toContain('volta');
    expect(wrapper.find('[aria-label="选择 Volta"]').exists()).toBe(false);
    store.setVersion('node', 'node-24-system');
    await nextTick();
    expect(store.plan.selections.map(item => item.toolId)).not.toContain('volta');
    expect(wrapper.find('[aria-label="选择 Volta"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('provides working manual download actions and distinguishes unsupported systems', async () => {
    const { store, wrapper } = render();
    const pycharm = wrapper.findAll('.tool-card').find(card => card.get('h2').text().startsWith('PyCharm'))!;
    expect(pycharm.find('.check-button').exists()).toBe(false);
    expect(pycharm.text()).toContain('需手动安装');
    await pycharm.get('.tool-download-button').trigger('click');
    expect(openOfficialUrl).toHaveBeenCalledWith('https://www.jetbrains.com/pycharm/download/');
    expect(store.plan.selections).toHaveLength(0);
    store.platform = 'linux';
    await nextTick();
    const office = wrapper.findAll('.tool-card').find(card => card.get('h2').text().startsWith('Microsoft 365'))!;
    expect(office.text()).toContain('适用于其他系统');
    expect(office.get('.tool-download-button').text()).toContain('查看官网');
    wrapper.unmount();
  });
});
