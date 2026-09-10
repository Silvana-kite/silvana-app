import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useWizardStore } from './wizard';
describe('scenario discovery', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('shows five entries and preserves scene filtering when selections change', () => {
    const store = useWizardStore(); expect(store.visibleTemplates.map(t => t.id)).toEqual(['frontend-web','java-backend','data-science','office','custom']);
    store.applyTemplate('java-backend'); expect(store.visibleTools.some(t => t.id === 'jdk')).toBe(true); expect(store.visibleTools.some(t => t.id === 'python')).toBe(false);
    store.toggleTool('git'); expect(store.activeScene).toBe('java'); store.showAllTools = true; expect(store.visibleTools.some(t => t.id === 'python')).toBe(true);
  });
  it('office has no executable preselection and all entries use latest-only', () => {
    const store = useWizardStore(); store.applyTemplate('office'); expect(store.plan.selections).toEqual([]);
    expect(store.visibleTools).toHaveLength(10); expect(store.visibleTools.every(t => t.historyPolicy === 'latest-only')).toBe(true);
  });
});
