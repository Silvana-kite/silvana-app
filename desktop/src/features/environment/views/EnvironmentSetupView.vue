<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Braces, Code2, GitBranch, Layers3, X,
} from 'lucide-vue-next';
import ToolsStep from './ToolsStep.vue';
import ReviewStep from './ReviewStep.vue';
import ScenarioStep from './ScenarioStep.vue';
import InstallationPanel from '../components/InstallationPanel.vue';
import { useInstallerStore } from '../stores/installer';
import { isDesktop } from '../services/device';
import '../styles/setup.css';
import ScriptExport from '../components/ScriptExport.vue';
import SelectionSummary from '../components/SelectionSummary.vue';
import WizardStepper from '../components/WizardStepper.vue';
import { setupStepPaths, type SetupStepPath } from '../../../app/router';
import { useWizardStore } from '../stores/wizard';
import { useEnvironmentStore } from '../stores/environment';

const store = useWizardStore();
const installer = useInstallerStore();
const environment = useEnvironmentStore();
const route = useRoute();
const router = useRouter();
const copied = ref(false);
const summaryOpen = ref(false);
const summaryDialog = ref<HTMLElement>();
const summaryButton = ref<HTMLButtonElement>();
watch(summaryOpen, async (open) => {
  await nextTick();
  if (open) summaryDialog.value?.querySelector<HTMLButtonElement>('button')?.focus();
  else summaryButton.value?.focus();
});
function summaryKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') summaryOpen.value = false;
  if (event.key === 'Tab') {
    const controls = summaryDialog.value?.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]');
    if (!controls?.length) return;
    const first = controls[0]!, last = controls[controls.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}
const exporting = ref(false);
const exportError = ref('');
const scanBlocked = computed(() => store.validationMode === 'smart' && !environment.wizardCanContinue());
const exportDisabled = computed(() => store.hasInstallationTargets || store.hasErrors || scanBlocked.value || exporting.value || !store.plan.steps.length);
const labels = computed(() => store.activeScene === 'office' && !store.plan.steps.length ? ['使用场景', '选择软件'] : ['使用场景', '选择工具', '检查方案', isDesktop() ? '安装' : '导出']);
const nextDisabled = computed(() => installer.running || (store.hasInstallationTargets && store.step >= 2 && (scanBlocked.value || (store.step === 3 && !installer.canStart))) || (store.step === 1 ? !store.templateId && !store.plan.selections.length : !store.plan.steps.length || (store.step === 3 && store.hasErrors)));
onBeforeRouteLeave(() => !installer.running);
onBeforeRouteUpdate(() => !installer.running);
onMounted(() => installer.restore());

function stepFromPath(value: unknown) {
  const index = setupStepPaths.indexOf((value === 'export' ? 'install' : value) as SetupStepPath);
  return (index < 0 ? 1 : index + 1) as 1 | 2 | 3 | 4;
}

function navigate(step: number) {
  const bounded = Math.min(4, Math.max(1, step)) as 1 | 2 | 3 | 4;
  if (installer.running || (bounded > store.step && nextDisabled.value) || (bounded === 4 && store.hasErrors)) return;
  store.step = bounded;
  summaryOpen.value = false;
  void router.push({ name: 'environment-setup', params: { step: setupStepPaths[bounded - 1] } });
}

async function copyScript() {
  await exportScript(async () => {
    await navigator.clipboard.writeText(store.plan.script.content);
    copied.value = true;
    window.setTimeout(() => { copied.value = false; }, 1600);
  });
}

async function exportScript(action: () => void | Promise<void>) {
  if (exportDisabled.value) return;
  exporting.value = true;
  exportError.value = '';
  try {
    if (store.validationMode === 'smart' && !await environment.verifyExport()) {
      exportError.value = '磁盘校验未通过或方案已变化，请返回适配中心重新扫描。';
      return;
    }
    await action();
  } catch (error) { exportError.value = error instanceof Error ? error.message : String(error); }
  finally { exporting.value = false; }
}

async function downloadScript() {
  await exportScript(() => {
  const blob = new Blob([store.plan.script.content], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = store.plan.script.shell === 'powershell' ? 'siilvana-setup.ps1' : 'siilvana-setup.sh';
  link.click();
  URL.revokeObjectURL(link.href);
  store.recordExport();
  });
}

watch(() => route.params.step, (value) => {
  store.step = stepFromPath(value);
}, { immediate: true });

watch(() => route.query.tool, (value) => {
  if (typeof value === 'string') store.focusTool(value);
}, { immediate: true });
</script>

<template>
  <div class="setup-page">
    <WizardStepper :labels="labels" :current="store.step" @navigate="navigate" />
    <div v-if="exportError || exporting" class="setup-section" style="padding-block: 16px 0" aria-live="polite">
      <div v-if="scanBlocked || exportError" class="diagnostic-row is-error"><AlertTriangle :size="18" /><span>{{ exportError || '当前方案的磁盘空间尚未验证，导出前需要重新扫描。' }} <RouterLink to="/environment">返回适配中心</RouterLink></span></div>
      <div v-else-if="store.validationMode === 'manual'" class="diagnostic-row"><Layers3 :size="18" /><span>手动配置 · 磁盘空间未验证</span></div>
      <div v-else-if="exporting" class="diagnostic-row"><Layers3 :size="18" /><span>正在重新检查磁盘空间…</span></div>
    </div>

    <ScenarioStep v-if="store.step === 1" />

    <ToolsStep v-else-if="store.step === 2" />
    <ReviewStep v-else-if="store.step === 3" />

    <section v-else class="setup-section">
      <header class="page-heading setup-heading"><span class="page-kicker">04 / {{ isDesktop() ? '安装' : '导出' }}</span><h1>{{ isDesktop() ? '安装开发环境' : '导出安装脚本' }}</h1><p>{{ store.plan.script.shell === 'powershell' ? 'PowerShell' : 'Bash' }} · {{ store.plan.steps.length }} 个安装步骤</p></header>
      <div v-if="store.hasErrors" class="diagnostic-row is-error" role="alert"><AlertTriangle :size="18" /><span><strong>暂不能导出</strong>返回检查步骤处理不兼容或缺少安装方式的工具。</span></div>
      <InstallationPanel />
      <p v-if="store.hasInstallationTargets" class="diagnostic-row">此方案包含逐款磁盘配置，需要在桌面端执行，暂不支持导出脚本。</p>
      <details v-else class="export-disclosure" :open="!isDesktop() || route.params.step === 'export'"><summary>导出安装脚本</summary><ScriptExport :plan="store.plan" :disabled="exportDisabled" :copied="copied" @copy="copyScript" @download="downloadScript" /></details>
    </section>

    <footer class="setup-actionbar">
      <button v-if="store.step > 1" class="secondary-button action-back" type="button" :disabled="installer.running" title="上一步" @click="navigate(store.step - 1)"><ArrowLeft :size="17" /><span>上一步</span></button>
      <span v-if="store.activeScene === 'office' && !store.plan.steps.length">{{ store.sceneTools.length }} 款办公软件 · 官网下载</span>
      <button v-else ref="summaryButton" class="plan-summary-button" type="button" :aria-expanded="summaryOpen" @click="summaryOpen = true"><div class="summary-thumbnails" aria-hidden="true"><span v-for="(icon, index) in [Braces, GitBranch, Code2].slice(0, store.plan.selections.length)" :key="index" class="summary-thumbnail"><component :is="icon" :size="15" /></span></div><span><strong>{{ store.plan.selections.length }} 项工具</strong><small>{{ (store.plan.estimatedDiskMb / 1024).toFixed(1) }} GB</small></span></button>
      <button v-if="store.activeScene === 'office' && store.step === 2 && !store.plan.steps.length" class="primary-button" type="button" @click="router.push('/environment')">完成浏览</button>
      <button v-else-if="store.step < 4" class="primary-button" type="button" :disabled="nextDisabled" @click="navigate(store.step + 1)">下一步<ArrowRight :size="17" /></button>
      <button v-else class="secondary-button" type="button" :disabled="installer.running" @click="router.push('/environment')">返回主页</button>
    </footer>

    <Teleport to="body">
      <div v-if="summaryOpen" class="drawer-backdrop" role="presentation" @mousedown.self="summaryOpen = false">
        <aside ref="summaryDialog" class="summary-drawer" role="dialog" aria-modal="true" aria-label="当前方案" @keydown="summaryKeydown">
          <div class="summary-drawer__head"><div><small>Environment plan</small><h2>当前方案</h2></div><button class="icon-button is-quiet" type="button" title="关闭方案" @click="summaryOpen = false"><X :size="19" /></button></div>
          <SelectionSummary :plan="store.plan" :catalog="store.catalog" />
        </aside>
      </div>
    </Teleport>
  </div>
</template>
