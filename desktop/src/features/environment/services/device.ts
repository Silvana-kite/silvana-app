import { invoke } from '@tauri-apps/api/core';
import type { Architecture, Platform } from '@siilvana/shared';

export interface DeviceInfo {
  platform: Platform | null;
  architecture: Architecture | null;
  cpuName: string | null;
  osName?: string | null;
}
export interface DiskInfo {
  id: string;
  label: string;
  totalBytes: number;
  availableBytes: number;
  installationTarget?: boolean;
}
export const installationDisks = (disks: DiskInfo[]) => disks.filter(disk => disk.installationTarget !== false);
export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
export const requiredBytes = (diskMb: number) => Math.ceil(diskMb * 1024 ** 2 * 1.2) + 2 * 1024 ** 3;

export async function detectDevice(): Promise<DeviceInfo> {
  if (isDesktop()) return invoke<DeviceInfo>('device_info');
  const ua = navigator.userAgent;
  const platform = /Android|iPhone|iPad/.test(ua) ? null
    : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'macos' : /Linux/.test(ua) ? 'linux' : null;
  const hints = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues: (keys: string[]) => Promise<{ architecture?: string; bitness?: string }> };
  }).userAgentData;
  try {
    const data = await hints?.getHighEntropyValues(['architecture', 'bitness']);
    const architecture = data?.bitness === '64'
      ? data.architecture === 'arm' ? 'arm64' : data.architecture === 'x86' ? 'x64' : null : null;
    return { platform, architecture, cpuName: null };
  } catch {
    return { platform, architecture: null, cpuName: null };
  }
}

export async function readDisks(consent: boolean): Promise<DiskInfo[]> {
  if (!consent) throw new Error('请先允许查询磁盘容量。');
  if (!isDesktop()) throw new Error('浏览器无法读取本地磁盘空间，请在桌面端扫描。');
  const disks = await invoke<DiskInfo[]>('scan_disks', { consent: true });
  if (!Array.isArray(disks) || !disks.length || disks.some((disk) => !disk || !Number.isSafeInteger(disk.totalBytes)
    || !Number.isSafeInteger(disk.availableBytes) || disk.totalBytes <= 0
    || disk.availableBytes < 0 || disk.availableBytes > disk.totalBytes
    || (disk.installationTarget !== undefined && typeof disk.installationTarget !== 'boolean'))) {
    throw new Error('磁盘容量读取不完整，请重新检测。');
  }
  return disks;
}
