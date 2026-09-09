import { beforeEach, describe, expect, it } from 'vitest';
import { isWorkspaceState, loadWorkspaceState, saveWorkspaceState, type WorkspaceStateV1 } from './workspace-state';

const validState: WorkspaceStateV1 = {
  version: 1,
  wizard: { platform: 'windows', architecture: 'x64', selected: { node: 'node-24.20.0' } },
  preferences: { syncOnLaunch: false, motion: 'system' },
  activities: [{
    id: 'activity-1', kind: 'catalog-sync', status: 'success', title: '目录已同步',
    detail: '当前版本 test', createdAt: '2026-09-07T00:00:00.000Z', read: false,
  }],
};

describe('workspace state persistence', () => {
  beforeEach(() => localStorage.clear());

  it('accepts the current schema and rejects damaged data', () => {
    expect(isWorkspaceState(validState)).toBe(true);
    expect(isWorkspaceState({ ...validState, version: 2 })).toBe(false);
    expect(isWorkspaceState({ ...validState, wizard: { ...validState.wizard, selected: { node: 24 } } })).toBe(false);
  });

  it('round-trips browser state through localStorage', async () => {
    await saveWorkspaceState(validState);
    await expect(loadWorkspaceState()).resolves.toEqual(validState);
  });

  it('falls back when stored JSON is invalid', async () => {
    localStorage.setItem('workspace-state-v1', '{broken');
    await expect(loadWorkspaceState()).resolves.toBeUndefined();
  });
});
