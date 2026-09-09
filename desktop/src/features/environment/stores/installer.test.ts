import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { useInstallerStore, type InstallationSession } from './installer';
import { useWizardStore } from './wizard';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage?: (value: unknown) => void; } }));
describe('installation session boundary', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); vi.mocked(invoke).mockReset(); Object.assign(window, { __TAURI_INTERNALS__: {} }); });
  function prepared(): InstallationSession {
    const wizard = useWizardStore();
    return { id: 'native-session', status: 'prepared', steps: [{ toolId: 'git', name: 'Git', version: 'stable', installedVersion: null, executablePath: null, status: 'pending', message: '' }], blockers: [], logs: [], fingerprint: JSON.stringify([wizard.platform, wizard.architecture, wizard.selected, wizard.catalog.revision]) };
  }
  it('never invokes native installation in a browser', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    await useInstallerStore().prepare(true);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('only sends a native session identifier when starting', async () => {
    const store = useInstallerStore(); store.session = prepared();
    vi.mocked(invoke).mockResolvedValue({ ...store.session, status: 'running' });
    await store.start();
    expect(invoke).toHaveBeenCalledWith('start_install', expect.objectContaining({ sessionId: 'native-session' }));
    expect(Object.keys(vi.mocked(invoke).mock.calls[0]![1]!)).toEqual(['sessionId', 'onEvent']);
    expect(store.running).toBe(true);
  });
  it('invalidates preparation when selections or target change', async () => {
    const store = useInstallerStore(); store.session = prepared();
    expect(store.canStart).toBe(true);
    useWizardStore().architecture = 'arm64';
    expect(store.canStart).toBe(false);
    await store.start(); expect(invoke).not.toHaveBeenCalled();
  });
  it('blocks prerequisites and duplicate starts', async () => {
    const store = useInstallerStore(); store.session = { ...prepared(), blockers: [{ message: 'Missing manager', url: null }] };
    await store.start(); expect(invoke).not.toHaveBeenCalled();
    store.session = { ...prepared(), status: 'running' };
    await store.start(); expect(invoke).not.toHaveBeenCalled();
  });
  it('does not replace a completed channel update with an older command response', async () => {
    const store = useInstallerStore(); store.session = prepared();
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      (args as { onEvent: { onmessage: (value: InstallationSession) => void } }).onEvent.onmessage({ ...prepared(), sequence: 5, status: 'success' });
      return { ...prepared(), sequence: 2, status: 'running' };
    });
    await store.start();
    expect(store.session.status).toBe('success');
    expect(store.running).toBe(false);
  });
  it('retains the failure and exposes native errors for retry', async () => {
    const store = useInstallerStore(); store.session = { ...prepared(), status: 'failed' };
    vi.mocked(invoke).mockRejectedValue(new Error('Permission denied'));
    await store.start(true);
    expect(invoke).toHaveBeenCalledWith('retry_install', expect.anything());
    expect(store.session.status).toBe('failed'); expect(store.error).toContain('Permission denied'); expect(store.busy).toBe(false);
  });
});
