<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check, ChevronDown, Cpu, HardDrive, Monitor, RotateCcw } from 'lucide-vue-next';
import { createInstallPlan, platformVersion } from '@siilvana/shared';
import ScenarioCard from '../components/ScenarioCard.vue';
import ScanPermissionDialog from '../components/ScanPermissionDialog.vue';
import { useWizardStore } from '../stores/wizard';
import { useEnvironmentStore } from '../stores/environment';
import { isDesktop, requiredBytes } from '../services/device';

const wizard = useWizardStore();
const environment = useEnvironmentStore();
const expanded = ref(false);
const platformNames = { windows: 'Windows', macos: 'macOS', linux: 'Ubuntu / Debian' };
const detectedTarget = computed(() => wizard.platform === environment.device.platform && wizard.architecture === environment.device.architecture);
const verifiedDisk = computed(() => environment.validScan && detectedTarget.value && environment.installDisks.length > 0);
const enough = computed(() => wizard.hasInstallationTargets ? environment.wizardCanContinue() : verifiedDisk.value && environment.installDisks.every(d => d.availableBytes >= requiredBytes(wizard.plan.estimatedDiskMb)));
const diskLabel = computed(() => !isDesktop() ? '磁盘空间未验证' : !detectedTarget.value ? '目标预览' : environment.status === 'scanning' ? '正在检测磁盘' : verifiedDisk.value ? enough.value ? '磁盘空间充足' : '磁盘空间不足' : '磁盘空间待检测');
const counts = computed(() => Object.fromEntries(wizard.visibleTemplates.map(t => [t.id, wizard.catalog.tools.filter(tool => !t.scene || tool.scenes?.includes(t.scene)).length])));

function automatic() {
  wizard.targetMode = 'auto';
  if (environment.device.platform) wizard.platform = environment.device.platform;
  if (environment.device.architecture) wizard.architecture = environment.device.architecture;
  environment.targetPlatform = wizard.platform;
  environment.targetArchitecture = wizard.architecture;
  if (wizard.templateId && wizard.templateId !== 'custom') wizard.applyTemplate(wizard.templateId);
  expanded.value = false;
}
function manual() {
  wizard.targetMode = 'manual';
  wizard.setValidationMode('manual');
  environment.targetPlatform = wizard.platform;
  environment.targetArchitecture = wizard.architecture;
  if (wizard.templateId && wizard.templateId !== 'custom') wizard.applyTemplate(wizard.templateId);
}
async function requestScan() {
  environment.targetPlatform = wizard.platform;
  environment.targetArchitecture = wizard.architecture;
  environment.candidate = { ...wizard.selected };
  if (wizard.hasInstallationTargets) environment.installationTargets = { ...wizard.installationTargets };
  if (await environment.requestScan()) acceptScan();
}
function acceptScan() {
  if (environment.choosingDisks) wizard.installationTargets = { ...environment.installationTargets };
  wizard.setValidationMode('smart');
}
async function scan() {
  if (await environment.scan(true)) acceptScan();
}
function moveSelection(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const cards = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const current = cards.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : (current + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + cards.length) % cards.length;
  cards[next]?.focus(); cards[next]?.click();
}
onMounted(async () => {
  await environment.initialize();
  if (wizard.targetMode === 'auto') automatic();
});
</script>

<template>
  <section class="setup-section setup-section--wide scenario-step">
    <header class="setup-heading"><span class="page-kicker">01 / 使用场景</span><h1>选择使用场景</h1></header>
    <div class="device-strip" aria-live="polite">
      <button class="device-target" type="button" :aria-expanded="expanded" aria-controls="target-settings" @click="expanded = !expanded">
        <Monitor :size="18" /><span><small>目标系统</small><strong>{{ wizard.targetMode === 'auto' && detectedTarget ? environment.device.osName || platformNames[wizard.platform] : platformNames[wizard.platform] }}</strong></span>
        <span v-if="environment.detected && wizard.targetMode === 'auto' && environment.device.platform === wizard.platform" class="verified-badge"><Check :size="12" />已自动识别</span>
        <span v-else class="device-note">{{ environment.detected ? '手动目标' : '识别中' }}</span><ChevronDown :size="14" />
      </button>
      <button class="device-target" type="button" :aria-expanded="expanded" aria-controls="target-settings" @click="expanded = !expanded"><Cpu :size="18" /><span><small>处理器</small><strong>{{ wizard.targetMode === 'auto' && !environment.device.architecture ? '待确认' : wizard.architecture }}</strong></span><span v-if="detectedTarget && environment.detected" class="verified-badge"><Check :size="12" />{{ isDesktop() ? '已验证' : '已识别' }}</span><ChevronDown :size="14" /></button>
      <button v-if="isDesktop() && detectedTarget" type="button" :class="['device-disk', { 'is-ready': enough, 'is-low': verifiedDisk && !enough }]" :disabled="environment.status === 'scanning'" @click="requestScan"><HardDrive :size="16" />{{ diskLabel }}<Check v-if="enough" :size="14" /></button>
      <span v-else class="device-disk"><HardDrive :size="16" />{{ diskLabel }}</span>
    </div>
    <div v-if="expanded" id="target-settings" class="target-settings">
      <label>目标系统<select v-model="wizard.platform" @change="manual"><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Ubuntu / Debian</option></select></label>
      <label>处理器<select v-model="wizard.architecture" @change="manual"><option value="x64">x64</option><option value="arm64">ARM64</option></select></label>
      <button class="text-button" type="button" @click="automatic"><RotateCcw :size="14" />自动识别</button>
    </div>
    <div class="scenario-grid" role="radiogroup" aria-label="使用场景" @keydown="moveSelection">
      <ScenarioCard v-for="template in wizard.visibleTemplates" :key="template.id" :template="template" :selected="template.scene ? wizard.activeScene === template.scene : !wizard.activeScene && wizard.templateId === template.id" :count="counts[template.id]" @select="wizard.applyTemplate(template.id)" />
    </div>
    <div class="scenario-meta"><span>{{ wizard.visibleTemplates.length }} 个使用场景</span><span>目录 {{ wizard.catalog.revision }}</span></div>
    <ScanPermissionDialog v-if="environment.status === 'permission'" @allow="scan" @deny="environment.deny" />
  </section>
</template>
