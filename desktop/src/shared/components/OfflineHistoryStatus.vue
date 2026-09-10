<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useInstallerStore } from '../../features/environment/stores/installer';
import { officialBrowser } from '../services/official-browser';
import { syncHistory, historyState } from '../../features/environment/services/history-cache';
const installer = useInstallerStore();
const ready = ref(false); const waiting = ref<ServiceWorker>(); const error = ref('');
const busy = computed(() => installer.running || installer.busy || officialBrowser.open);
onMounted(async () => {
  void syncHistory();
  if (import.meta.env.DEV || '__TAURI_INTERNALS__' in window || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    void navigator.serviceWorker.ready.then(() => { ready.value = true; });
    ready.value = !!registration.active; waiting.value = registration.waiting ?? undefined;
    registration.addEventListener('updatefound', () => { const worker = registration.installing; worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') { if (navigator.serviceWorker.controller) waiting.value = worker; else ready.value = true; }
    }); });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!busy.value) window.location.reload(); });
  } catch { error.value = '浏览器无法保存离线页面，当前会话仍可查询'; }
});
function update() { if (!busy.value) waiting.value?.postMessage({ type: 'ACTIVATE' }); }
</script>
<template>
  <div class="offline-history-status" role="status">
    <span v-if="ready">离线数据已就绪</span>
    <span v-if="error || !historyState.persistent">{{ error || historyState.message }}</span>
    <button v-if="waiting" type="button" :disabled="busy" @click="update">{{ busy ? '任务结束后可更新' : '新版已就绪，重新加载' }}</button>
  </div>
</template>
<style scoped>.offline-history-status{font-size:11px;color:#68788d;padding:4px 20px;display:flex;gap:12px;justify-content:flex-end}.offline-history-status:empty{display:none}button{color:inherit;background:white;border:1px solid #ced9e3;border-radius:5px;padding:5px;cursor:pointer}</style>
