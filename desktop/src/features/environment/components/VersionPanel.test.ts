import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { catalog } from '@siilvana/catalog';
import VersionPanel from './VersionPanel.vue';
import ToolCard from './ToolCard.vue';
import { loadReleases } from '../services/release-cache';
import { openOfficialUrl } from '../../../shared/services/official-browser';

vi.mock('../services/release-cache', () => ({ loadReleases: vi.fn() }));
vi.mock('../../../shared/services/official-browser', () => ({ openOfficialUrl: vi.fn() }));
const tool = catalog.tools.find(t => t.id === 'node')!;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadReleases).mockResolvedValue({ offline: false, data: { toolId: 'node', revision: 'real-snapshot', total: 1, page: 1, pageSize: 50, updatedAt: '2026-09-09', status: 'ready', items: [{ version: '12.22.12', originalVersion: 'v12.22.12', bundledNpm: '6.14.16', channel: 'eol', pageUrl: 'https://nodejs.org/download/release/v12.22.12/', sourceUrl: 'https://nodejs.org/dist/index.json', assets: [] }] } });
});
describe('historical version interaction', () => {
  it('shows old versions without making them executable and opens their exact official page', async () => {
    const wrapper = mount(VersionPanel, { props: { tool, platform: 'windows', architecture: 'x64' }, global: { stubs: { teleport: true } } });
    await flushPromises();
    const row = wrapper.get('.release-list .release-row');
    expect(row.text()).toContain('12.22.12'); expect(row.text()).toContain('6.14.16'); expect(row.find('button').exists()).toBe(false);
    await row.get('a').trigger('click');
    expect(openOfficialUrl).toHaveBeenCalledWith('https://nodejs.org/download/release/v12.22.12/');
    expect(wrapper.emitted('select')).toBeUndefined(); wrapper.unmount();
  });
  it('retains reviewed choices when the history service fails', async () => {
    vi.mocked(loadReleases).mockRejectedValue(new Error('offline'));
    const wrapper = mount(VersionPanel, { props: { tool, platform: 'windows', architecture: 'x64' }, global: { stubs: { teleport: true } } });
    await flushPromises(); expect(wrapper.get('[role="alert"]').text()).toContain('offline');
    expect(wrapper.get('.release-local').text()).toContain('独立安装');
    expect(wrapper.get('.release-local').text()).toContain('通过 Volta 管理');
    await wrapper.get('.release-local button').trigger('click'); expect(wrapper.emitted('select')).toEqual([['node-24-system']]); wrapper.unmount();
  });
  it('keeps manual software visible without allowing an empty installation selection', () => {
    const wrapper = mount(ToolCard, { props: { tool: catalog.tools.find(t => t.id === 'chrome')!, selected: false, platform: 'windows', architecture: 'x64' } });
    expect(wrapper.find('.check-button').exists()).toBe(false);
    expect(wrapper.get('.tool-status').text()).toBe('需手动安装');
    expect(wrapper.get('.tool-download-button').text()).toContain('前往官网下载');
    expect(wrapper.get('.tool-version-trigger').text()).toContain('历史版本'); wrapper.unmount();
  });
});
