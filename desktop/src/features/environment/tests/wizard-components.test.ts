import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { catalog } from '@siilvana/catalog';
import GlobalSearch from '../../../shared/components/GlobalSearch.vue';
import MessagesView from '../../messages/views/MessagesView.vue';
import { appRoutes } from '../../../app/router';
import { useWizardStore } from '../stores/wizard';
import ToolCard from '../components/ToolCard.vue';
import WizardStepper from '../components/WizardStepper.vue';
vi.mock('../services/release-cache', () => ({ loadReleases: vi.fn().mockRejectedValue(new Error('Offline test fixture')) }));

describe('wizard interface', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    setActivePinia(createPinia());
  });

  it('emits navigation from the stepper', async () => {
    const wrapper = mount(WizardStepper, { props: { labels: ['场景', '工具', '检查', '导出'], current: 1 } });
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.emitted('navigate')).toEqual([[2]]);
  });

  it('emits selection and version changes from a tool card', async () => {
    const tool = catalog.tools.find((item) => item.id === 'node')!;
    const wrapper = mount(ToolCard, { props: { tool, selected: false }, global: { stubs: { teleport: true } } });
    await wrapper.find('.check-button').trigger('click');
    await wrapper.get('.tool-version-trigger').trigger('click');
    await wrapper.findAll('.release-local .release-row').find(row => row.text().includes('26.8.1'))!.get('button').trigger('click');
    expect(wrapper.emitted('toggle')).toHaveLength(1);
    expect(wrapper.emitted('version')).toEqual([['node-26.8.1']]);
    wrapper.unmount();
  });

  it('marks a message as read when opened', async () => {
    const store = useWizardStore();
    store.applyTemplate('frontend-web');
    const wrapper = mount(MessagesView);
    expect(store.unreadActivities).toBe(1);
    await wrapper.find('.activity-feed__item').trigger('click');
    expect(store.unreadActivities).toBe(0);
  });

  it('redirects the root route to the portal square', async () => {
    const testRouter = createRouter({ history: createMemoryHistory(), routes: appRoutes });
    await testRouter.push('/');
    await testRouter.isReady();
    expect(testRouter.currentRoute.value.path).toBe('/portals');
  });

  it('searches tools and routes to the focused tool', async () => {
    const testRouter = createRouter({ history: createMemoryHistory(), routes: appRoutes });
    await testRouter.push('/portals');
    await testRouter.isReady();
    const wrapper = mount(GlobalSearch, { attachTo: document.body, global: { plugins: [testRouter] } });
    await wrapper.find('.global-search-trigger').trigger('click');
    const searchInput = document.querySelector<HTMLInputElement>('.search-dialog__input input')!;
    searchInput.value = 'Node.js';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wrapper.vm.$nextTick();
    const toolResult = [...document.querySelectorAll<HTMLButtonElement>('.search-result')]
      .find((item) => item.querySelector('.search-result__type')?.textContent === '工具'
        && item.querySelector('strong')?.textContent === 'Node.js')!;
    toolResult.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(testRouter.currentRoute.value.path).toBe('/environment/setup/tools');
    expect(useWizardStore().search).toBe('Node.js');
    wrapper.unmount();
  });
});
