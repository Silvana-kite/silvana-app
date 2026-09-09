import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { catalog } from '@siilvana/catalog';
import { createInstallPlan } from '@siilvana/shared';
import InstallationLocations from './InstallationLocations.vue';

const plan = createInstallPlan(catalog, { platform: 'windows', architecture: 'x64', preferredManagers: ['volta', 'npm'], selections: [{ toolId: 'pnpm', versionId: 'pnpm-10.34.5' }] });
function render(disabled = false) {
  return mount(InstallationLocations, { global: { stubs: { RouterLink: true } }, props: { catalog, plan, disabled,
    modelValue: { node: 'C:\\', npm: 'C:\\', pnpm: 'C:\\', volta: 'C:\\' },
    disks: ['C:\\', 'D:\\'].map(id => ({ id, label: id, totalBytes: 100 * 1024 ** 3, availableBytes: 80 * 1024 ** 3 })),
  } });
}
describe('installation disk controls', () => {
  it('changes one software target and its bundled component without moving independent dependencies', async () => {
    const wrapper = render();
    await wrapper.get('select[aria-label="Node.js 安装磁盘"]').setValue('D:\\');
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({ node: 'D:\\', npm: 'D:\\', pnpm: 'C:\\', volta: 'C:\\' });
    expect(wrapper.get('select[aria-label="npm 安装磁盘"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('跟随 Node.js');
  });
  it('locks all destinations during native operations', () => {
    expect(render(true).findAll('select').every(select => select.attributes('disabled') !== undefined)).toBe(true);
  });
});
