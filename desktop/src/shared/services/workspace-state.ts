import { Store } from '@tauri-apps/plugin-store';
import type { Architecture, Platform } from '@siilvana/shared';

export type MotionPreference = 'system' | 'reduced';
export type ActivityKind = 'catalog-sync' | 'template-applied' | 'script-exported' | 'environment-scan';
export type ActivityStatus = 'success' | 'error' | 'info';

export interface ActivityRecord {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  title: string;
  detail: string;
  createdAt: string;
  read: boolean;
}

export interface WorkspaceStateV1 {
  version: 1;
  wizard: {
    platform: Platform;
    architecture: Architecture;
    selected: Record<string, string>;
    installationTargets?: Record<string, string>;
    validationMode?: 'smart' | 'manual';
    templateId?: string | null;
    activeScene?: 'frontend' | 'java' | 'python' | 'office' | null;
    showAllTools?: boolean;
    targetMode?: 'auto' | 'manual';
  };
  preferences: {
    syncOnLaunch: boolean;
    diskScanConsent?: boolean;
    motion: MotionPreference;
  };
  activities: ActivityRecord[];
}

const STATE_KEY = 'workspace-state-v1';
const STATE_FILE = 'workspace.json';
const platforms = new Set<Platform>(['windows', 'macos', 'linux']);
const architectures = new Set<Architecture>(['x64', 'arm64']);
const motions = new Set<MotionPreference>(['system', 'reduced']);
const activityKinds = new Set<ActivityKind>(['catalog-sync', 'template-applied', 'script-exported', 'environment-scan']);
const activityStatuses = new Set<ActivityStatus>(['success', 'error', 'info']);

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object'
    && Object.entries(value).every(([key, item]) => key.length > 0 && typeof item === 'string');
}

function isActivity(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ActivityRecord>;
  return typeof item.id === 'string'
    && activityKinds.has(item.kind as ActivityKind)
    && activityStatuses.has(item.status as ActivityStatus)
    && typeof item.title === 'string'
    && typeof item.detail === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.read === 'boolean';
}

export function isWorkspaceState(value: unknown): value is WorkspaceStateV1 {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<WorkspaceStateV1>;
  return state.version === 1
    && !!state.wizard
    && platforms.has(state.wizard.platform)
    && architectures.has(state.wizard.architecture)
    && isStringRecord(state.wizard.selected)
    && (state.wizard.installationTargets === undefined || isStringRecord(state.wizard.installationTargets))
    && (state.wizard.validationMode === undefined || ['smart', 'manual'].includes(state.wizard.validationMode))
    && (state.wizard.templateId == null || typeof state.wizard.templateId === 'string')
    && (state.wizard.targetMode === undefined || ['auto', 'manual'].includes(state.wizard.targetMode))
    && (state.wizard.activeScene == null || ['frontend', 'java', 'python', 'office'].includes(state.wizard.activeScene))
    && (state.wizard.showAllTools === undefined || typeof state.wizard.showAllTools === 'boolean')
    && !!state.preferences
    && typeof state.preferences.syncOnLaunch === 'boolean'
    && (state.preferences.diskScanConsent === undefined || typeof state.preferences.diskScanConsent === 'boolean')
    && motions.has(state.preferences.motion)
    && Array.isArray(state.activities)
    && state.activities.every(isActivity);
}

export async function loadWorkspaceState(): Promise<WorkspaceStateV1 | undefined> {
  try {
    const value = isTauri()
      ? await (await Store.load(STATE_FILE, { autoSave: false })).get<unknown>(STATE_KEY)
      : JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    return isWorkspaceState(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function saveWorkspaceState(value: WorkspaceStateV1): Promise<void> {
  if (isTauri()) {
    const store = await Store.load(STATE_FILE, { autoSave: false });
    await store.set(STATE_KEY, value);
    await store.save();
    return;
  }
  localStorage.setItem(STATE_KEY, JSON.stringify(value));
}
