<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check, Circle, Download, LoaderCircle, RefreshCw, Square, TriangleAlert } from 'lucide-vue-next';
import { useInstallerStore } from '../stores/installer';
import { useEnvironmentStore } from '../stores/environment';
import ScanPermissionDialog from './ScanPermissionDialog.vue';
import { isDesktop } from '../services/device';
const props = defineProps<{ review?: boolean }>();
const installer = useInstallerStore();
const environment = useEnvironmentStore();
const permission = ref(false);
const labels = { prepared: '方案已检查', running: '正在安装', cancelling: '当前步骤结束后停止', success: '安装完成', failed: '安装未完成', cancelled: '已停止', interrupted: '上次安装已中断' };
const stepLabels = { pending: '待安装', skipped: '已满足', running: '安装中', success: '已验证', failed: '失败' };
const visible = computed(() => installer.current || installer.running || installer.session?.status === 'interrupted');
async function prepare() {
  if (environment.consent) { await environment.initialize(); await installer.prepare(true); }
  else permission.value = true;
}
async function allow() { permission.value = false; environment.consent = true; await prepare(); }
onMounted(async () => {
  await installer.restore();
  if (props.review && environment.consent && !installer.running) await prepare();
});
</script>

<template>
  <div v-if="isDesktop()" class="install-progress" aria-live="polite">
    <div class="install-session-head"><h2>{{ visible && installer.session ? labels[installer.session.status] : '本机安装检查' }}</h2><span v-if="visible && installer.session">{{ installer.completed }} / {{ installer.session.steps.length }}</span></div>
    <div v-if="installer.error" class="install-blocker" role="alert">{{ installer.error }}</div>
    <template v-if="visible && installer.session">
      <progress v-if="!review" :value="installer.completed" :max="Math.max(1, installer.session.steps.length)" aria-label="已完成安装步骤" />
      <div v-for="blocker in installer.session.blockers" :key="blocker.message" class="install-blocker"><TriangleAlert :size="14" /> {{ blocker.message }}<a v-if="blocker.url" :href="blocker.url" target="_blank" rel="noopener noreferrer">官方安装入口</a></div>
      <div v-for="step in installer.session.steps" :key="step.toolId" class="execution-row">
        <Check v-if="['skipped','success'].includes(step.status)" :size="18" class="text-success" /><LoaderCircle v-else-if="step.status === 'running'" :size="18" class="spin" /><TriangleAlert v-else-if="step.status === 'failed'" :size="18" /><Circle v-else :size="16" />
        <div><strong>{{ step.name }} <span>{{ step.version }}</span></strong><small v-if="step.installedVersion">本机 {{ step.installedVersion }}<template v-if="step.status === 'pending'"> → {{ step.version }}</template></small><small v-if="step.targetDisk">目标磁盘 {{ step.targetDisk }}<template v-if="step.installDirectory"> · {{ step.installDirectory }}</template></small><small v-if="step.message">{{ step.message }}</small><small v-if="step.executablePath">{{ step.executablePath }}</small></div>
        <span :class="['execution-state', { 'is-success': ['success','skipped'].includes(step.status), 'is-error': step.status === 'failed' }]">{{ stepLabels[step.status] }}</span>
      </div>
      <details v-if="!review && installer.session.logs.length"><summary>安装日志</summary><pre class="install-log">{{ installer.session.logs.join('\n') }}</pre></details>
    </template>
    <div class="installation-actions">
      <button v-if="!installer.running" class="secondary-button" :disabled="installer.busy" @click="prepare"><RefreshCw :size="16" :class="{ spin: installer.busy }" />{{ installer.busy ? '正在检查' : '重新检测' }}</button>
      <button v-if="!review && installer.canStart" class="primary-button" @click="installer.start()"><Download :size="16" />开始安装</button>
      <button v-if="!review && installer.current && ['failed','cancelled','interrupted'].includes(installer.session?.status || '')" class="primary-button" :disabled="installer.busy" @click="installer.start(true)"><RefreshCw :size="16" />重新检测并重试</button>
      <button v-if="installer.running" class="secondary-button" :disabled="installer.session?.status === 'cancelling'" @click="installer.cancel"><Square :size="14" />停止后续安装</button>
    </div>
    <ScanPermissionDialog v-if="permission" @allow="allow" @deny="permission = false" />
  </div>
</template>
