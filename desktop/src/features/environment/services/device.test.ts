import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { detectDevice, readDisks } from './device';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
describe('device boundary', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.mocked(invoke).mockReset();
  });
  it('refuses permissionless disk reads before invoking the host', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    await expect(readDisks(false)).rejects.toThrow('允许');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('never substitutes website quota for disk capacity', async () => {
    await expect(readDisks(true)).rejects.toThrow('浏览器');
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([undefined, [], [{ totalBytes: 0, availableBytes: 0 }], [{ totalBytes: 100, availableBytes: 101 }], [{ totalBytes: 100, availableBytes: -1 }], [{ totalBytes: 100, availableBytes: NaN }]].map((result) => [result]))('rejects incomplete capacity %j', async (result) => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValue(result);
    await expect(readDisks(true)).rejects.toThrow('不完整');
  });
  it('keeps unavailable browser architecture unknown', async () => {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
    expect((await detectDevice()).architecture).toBeNull();
  });
});
