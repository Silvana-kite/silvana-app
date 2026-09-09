import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { Channel, invoke } from '@tauri-apps/api/core';
import { useWizardStore } from './wizard';
import { isDesktop } from '../services/device';
import { useEnvironmentStore } from './environment';

export interface InstallationStep {
  toolId: string;
  name: string;
  version: string;
  installedVersion: string | null;
  executablePath: string | null;
  status: 'pending' | 'skipped' | 'running' | 'success' | 'failed';
  message: string;
  targetDisk?: string | null;
  installDirectory?: string | null;
}
export interface InstallationSession {
  sequence?: number;
  id: string;
  status: 'prepared' | 'running' | 'cancelling' | 'success' | 'failed' | 'cancelled' | 'interrupted';
  steps: InstallationStep[];
  blockers: Array<{ message: string; url: string | null }>;
  logs: string[];
  fingerprint: string;
}

export const useInstallerStore = defineStore('installer', () => {
  const wizard = useWizardStore();
  const session = ref<InstallationSession | null>(null);
  const busy = ref(false);
  const error = ref('');
  const running = computed(() => ['running', 'cancelling'].includes(session.value?.status ?? ''));
  const fingerprint = computed(() => JSON.stringify([wizard.platform, wizard.architecture, wizard.selected, wizard.catalog.revision,
    ...(wizard.hasInstallationTargets ? [wizard.resolvedInstallationTargets] : [])]));
  const current = computed(() => session.value?.fingerprint === fingerprint.value);
  const completed = computed(() => session.value?.steps.filter(s => ['success', 'skipped'].includes(s.status)).length ?? 0);
  const canStart = computed(() => useEnvironmentStore().consent && current.value && session.value?.status === 'prepared' && !session.value.blockers.length && !busy.value);
  let channel: Channel<InstallationSession> | undefined;
  function accept(update: InstallationSession) {
    if (session.value?.id === update.id && (update.sequence ?? 0) < (session.value.sequence ?? 0)) return;
    session.value = update;
  }

  async function prepare(consent: boolean) {
    if (!isDesktop() || running.value || busy.value) return;
    if (wizard.hasInstallationTargets && !useEnvironmentStore().wizardCanContinue()) {
      error.value = '安装磁盘尚未验证或空间不足，请返回适配中心扫描并检查每款软件的目标盘。';
      session.value = null;
      return;
    }
    busy.value = true; error.value = ''; session.value = null;
    try {
      const request = {
        platform: wizard.platform, architecture: wizard.architecture,
        selections: wizard.explicitSelections,
        catalogRevision: wizard.catalog.revision,
        fingerprint: fingerprint.value,
        ...(wizard.hasInstallationTargets ? { installationTargets: wizard.resolvedInstallationTargets } : {}),
      };
      session.value = await invoke<InstallationSession>('prepare_install', { request, consent });
    } catch (cause) { error.value = String(cause); }
    finally { busy.value = false; }
  }
  async function start(retry = false) {
    if (!session.value || busy.value || running.value || !current.value) return;
    if (!useEnvironmentStore().consent) { error.value = '磁盘扫描授权已关闭，请重新检测并允许后再安装。'; return; }
    if (!retry && !canStart.value) return;
    busy.value = true; error.value = '';
    channel = new Channel<InstallationSession>();
    channel.onmessage = accept;
    try {
      accept(await invoke<InstallationSession>(retry ? 'retry_install' : 'start_install', { sessionId: session.value.id, onEvent: channel }));
    } catch (cause) { error.value = String(cause); }
    finally { busy.value = false; }
  }
  async function cancel() {
    if (!session.value) return;
    try { accept(await invoke<InstallationSession>('cancel_install', { sessionId: session.value.id })); }
    catch (cause) { error.value = String(cause); }
  }
  async function restore() {
    if (!isDesktop() || session.value) return;
    try { session.value = await invoke<InstallationSession | null>('get_install_session'); }
    catch (cause) { error.value = String(cause); }
  }
  return { session, busy, error, running, current, completed, canStart, prepare, start, cancel, restore };
});
