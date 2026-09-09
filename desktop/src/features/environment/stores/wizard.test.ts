import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { saveWorkspaceState, type WorkspaceStateV1 } from '../../../shared/services/workspace-state';
import { useWizardStore } from './wizard';

function persistedState(overrides: Partial<WorkspaceStateV1> = {}): WorkspaceStateV1 {
  return {
    version: 1,
    wizard: { platform: 'macos', architecture: 'arm64', selected: { node: 'node-24.20.0' } },
    preferences: { syncOnLaunch: false, motion: 'reduced' },
    activities: [],
    ...overrides,
  };
}

describe('wizard store', () => {
  it('selects scenarios without advancing and supports an explicit blank scenario', () => {
    setActivePinia(createPinia());
    const store = useWizardStore();
    store.applyTemplate('frontend-web');
    expect(store.step).toBe(1);
    expect(store.templateId).toBe('frontend-web');
    store.applyTemplate('custom');
    expect(store.templateId).toBe('custom');
    expect(store.selected).toEqual({});
  });

  it('matches Linux templates to the distribution version', () => {
    setActivePinia(createPinia());
    const store = useWizardStore(); store.platform = 'linux';
    store.applyTemplate('data-science');
    expect(store.selected.python).toBe('python-system');
    expect(store.hasErrors).toBe(false);
  });
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('restores the persisted plan and preferences without startup sync', async () => {
    await saveWorkspaceState(persistedState());
    const store = useWizardStore();
    await store.initialize();

    expect(store.platform).toBe('macos');
    expect(store.architecture).toBe('arm64');
    expect(store.selected.node).toBe('node-24.20.0');
    expect(store.syncOnLaunch).toBe(false);
    expect(store.motion).toBe('reduced');
  });

  it('keeps only the 50 newest real activities', async () => {
    await saveWorkspaceState(persistedState({ wizard: { platform: 'windows', architecture: 'x64', selected: {} } }));
    const store = useWizardStore();
    await store.initialize();
    for (let index = 0; index < 55; index += 1) store.applyTemplate('frontend-web');

    expect(store.activities).toHaveLength(50);
    expect(store.unreadActivities).toBe(50);
    store.markAllActivitiesRead();
    expect(store.unreadActivities).toBe(0);
    store.clearActivities();
    expect(store.activities).toHaveLength(0);
  });

  it('combines category and text filtering', async () => {
    await saveWorkspaceState(persistedState());
    const store = useWizardStore();
    await store.initialize();
    store.category = 'runtime';
    store.search = 'node';
    expect(store.visibleTools.map((tool) => tool.id)).toEqual(['node']);
  });
});
