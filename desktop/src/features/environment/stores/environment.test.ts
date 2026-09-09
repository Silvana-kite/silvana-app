import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useEnvironmentStore } from './environment';
import { useWizardStore } from './wizard';
import { detectDevice, isDesktop, readDisks, requiredBytes } from '../services/device';

vi.mock('../services/device', async (original) => ({ ...await original<typeof import('../services/device')>(),
  detectDevice: vi.fn(), isDesktop: vi.fn(), readDisks: vi.fn(),
}));
const volume = (availableBytes = 80 * 1024 ** 3, id = 'system') => ({ id, label: id, totalBytes: 256 * 1024 ** 3, availableBytes });
async function ready() {
  const store = useEnvironmentStore();
  await store.initialize();
  return store;
}
async function scan() {
  const store = await ready();
  store.requestScan();
  await store.scan(true);
  return store;
}
describe('environment permission and installation gates', () => {
  beforeEach(() => {
    localStorage.clear(); setActivePinia(createPinia());
    useWizardStore().syncOnLaunch = false;
    vi.mocked(detectDevice).mockResolvedValue({ platform: 'windows', architecture: 'x64', cpuName: 'Test CPU' });
    vi.mocked(isDesktop).mockReturnValue(true);
    vi.mocked(readDisks).mockReset().mockResolvedValue([volume()]);
  });
  it('does not read disks on initialization, permission request, denial, or unprompted approval', async () => {
    const store = await ready();
    await store.scan(true);
    store.requestScan(); store.deny(); await store.scan();
    expect(readDisks).not.toHaveBeenCalled();
    expect(store.canContinue).toBe(false);
  });
  it('does not wait for a slow catalog request before detecting the device', async () => {
    useWizardStore().syncOnLaunch = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const store = await ready();
    expect(store.detected).toBe(true);
    expect(store.matched.length).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });
  it('keeps the real wizard unchanged until a successful commit', async () => {
    const store = await scan();
    expect(useWizardStore().selected).toEqual({});
    expect(store.canContinue).toBe(true);
    expect(store.commit()).toBe(true);
    expect(useWizardStore().validationMode).toBe('smart');
    expect(store.wizardCanContinue()).toBe(true);
  });
  it('checks all volumes and treats the exact budget as sufficient', async () => {
    const store = await ready();
    vi.mocked(readDisks).mockResolvedValue([volume(), volume(store.budget - 1, 'user')]);
    store.requestScan(); await store.scan(true);
    expect(store.limitingDisk?.id).toBe('user');
    expect(store.canContinue).toBe(false);
    vi.mocked(readDisks).mockResolvedValue([volume(store.budget)]);
    store.requestScan(); await store.scan(true);
    expect(store.canContinue).toBe(true);
  });
  it('includes resolved dependencies and reevaluates larger selections', async () => {
    const store = await ready(); store.candidate = { pnpm: 'pnpm-10.34.5' };
    expect(store.plan.selections.map((item) => item.toolId)).toEqual(expect.arrayContaining(['pnpm', 'node', 'volta']));
    expect(store.budget).toBe(requiredBytes(store.plan.estimatedDiskMb));
    vi.mocked(readDisks).mockResolvedValue([volume(store.budget)]);
    store.requestScan(); await store.scan(true); store.commit();
    useWizardStore().toggleTool('docker');
    expect(store.wizardCanContinue()).toBe(false);
  });
  it('shows every disk while a full data disk does not block system installation', async () => {
    const disks = [
      { ...volume(), installationTarget: true },
      { ...volume(0, 'data'), installationTarget: false },
      { ...volume(100, 'external'), installationTarget: false },
    ];
    vi.mocked(readDisks).mockResolvedValue(disks);
    const store = await scan();
    expect(store.disks).toHaveLength(3);
    expect(store.installDisks).toHaveLength(1);
    expect(store.limitingDisk?.id).toBe('system');
    expect(store.canContinue).toBe(true);
    store.commit();
    expect(store.wizardCanContinue()).toBe(true);
    expect(await store.verifyExport()).toBe(true);
  });
  it('does not treat an empty set of installation disks as sufficient', async () => {
    vi.mocked(readDisks).mockResolvedValue([{ ...volume(), installationTarget: false }]);
    const store = await scan();
    expect(store.canContinue).toBe(false);
    expect(store.wizardCanContinue()).toBe(false);
  });
  it('invalidates a scan even when the target is changed and then restored', async () => {
    const store = await scan(); store.targetArchitecture = 'arm64'; store.targetArchitecture = 'x64';
    expect(store.canContinue).toBe(false); expect(store.consent).toBe(false);
  });
  it('invalidates a committed scan when wizard architecture changes', async () => {
    const store = await scan(); store.commit();
    useWizardStore().architecture = 'arm64'; useWizardStore().architecture = 'x64';
    expect(store.wizardCanContinue()).toBe(false);
  });
  it('does not issue duplicate requests and discards a changed target in flight', async () => {
    let resolve!: (value: ReturnType<typeof volume>[]) => void;
    vi.mocked(readDisks).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const store = await ready(); store.requestScan(); const pending = store.scan(true);
    store.requestScan(); await store.scan(true);
    expect(readDisks).toHaveBeenCalledTimes(1);
    store.targetArchitecture = 'arm64'; resolve([volume()]); await pending;
    expect(store.validScan).toBe(false); expect(store.disks).toEqual([]);
  });
  it('drops stale capacity when a new read fails', async () => {
    const store = await scan(); vi.mocked(readDisks).mockRejectedValue(new Error('disk unavailable'));
    store.requestScan(); await store.scan(true);
    expect(store.disks).toEqual([]); expect(store.error).toBe('disk unavailable'); expect(store.canContinue).toBe(false);
  });
  it('keeps browsers unsupported without invoking disk access', async () => {
    vi.mocked(isDesktop).mockReturnValue(false);
    const store = await scan(); expect(store.status).toBe('unsupported'); expect(readDisks).not.toHaveBeenCalled();
  });
  it('does not identify unknown hardware or accept an empty plan', async () => {
    vi.mocked(detectDevice).mockResolvedValue({ platform: null, architecture: null, cpuName: null });
    const store = await scan(); expect(store.nativeTarget).toBe(false); expect(store.canContinue).toBe(false);
    store.candidate = {}; expect(store.canContinue).toBe(false);
  });
  it('rechecks before export and blocks a newly full disk', async () => {
    const store = await scan(); store.commit(); vi.mocked(readDisks).mockResolvedValue([volume(1)]);
    expect(await store.verifyExport()).toBe(false); expect(readDisks).toHaveBeenCalledTimes(2);
  });
  it('blocks export if the plan changes during verification', async () => {
    const store = await scan(); store.commit();
    vi.mocked(readDisks).mockImplementation(async () => { useWizardStore().toggleTool('python'); return [volume()]; });
    expect(await store.verifyExport()).toBe(false);
  });
  it('retains smart mode across reload without restoring consent', async () => {
    const store = await scan(); store.commit();
    await new Promise((resolve) => setTimeout(resolve, 20));
    setActivePinia(createPinia()); const restored = await ready();
    expect(useWizardStore().validationMode).toBe('smart'); expect(restored.wizardCanContinue()).toBe(false);
  });
  it('labels universal recipes and omits tools with unavailable dependencies', async () => {
    const store = await ready(); expect(store.matched.find((item) => item.tool.id === 'node')?.universal).toBe(true);
    useWizardStore().catalog = { ...useWizardStore().catalog, tools: useWizardStore().catalog.tools.filter((item) => item.id !== 'volta') };
    expect(store.matched.some((item) => item.tool.id === 'node')).toBe(false);
  });
});
