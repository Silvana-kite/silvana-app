<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowRight, Boxes, ClipboardCheck, Download, Grid2X2,
  List, MonitorCog, Moon, Route, Sun, Wrench,
} from 'lucide-vue-next';
import MistralScene from '../components/MistralScene.vue';
import { setupStepPaths } from '../../../app/router';
import { useWizardStore } from '../../environment/stores/wizard';

type PortalTheme = 'light' | 'dark' | 'system';
type ViewMode = 'overview' | 'navigation' | 'list';
type CameraView = 'front' | 'side' | 'rear';

const store = useWizardStore();
const router = useRouter();
const theme = ref<PortalTheme>('system');
const viewMode = ref<ViewMode>('overview');
const systemDark = ref(false);
const progress = ref(0);
const ready = ref(false);
const errorMessage = ref('');
let mediaQuery: MediaQueryList | null = null;

const steps = computed(() => [
  { id: 1, title: '开发场景', status: `${store.catalog.templates.length} 个模板`, icon: Boxes },
  { id: 2, title: '选择工具', status: `${store.plan.selections.length} 项已选`, icon: Wrench },
  { id: 3, title: '检查方案', status: store.hasErrors ? '存在阻塞项' : '没有阻塞项', icon: ClipboardCheck },
  { id: 4, title: '导出脚本', status: `${store.plan.steps.length} 个步骤`, icon: Download },
]);

const themes: { id: PortalTheme; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: '浅色模式', icon: Sun },
  { id: 'dark', label: '深色模式', icon: Moon },
  { id: 'system', label: '跟随系统', icon: MonitorCog },
];

const views: { id: ViewMode; label: string; icon: typeof Grid2X2 }[] = [
  { id: 'overview', label: '全景总览', icon: Grid2X2 },
  { id: 'navigation', label: '功能导航', icon: Route },
  { id: 'list', label: '清单模式', icon: List },
];

const resolvedTheme = computed<'light' | 'dark'>(() => theme.value === 'system'
  ? (systemDark.value ? 'dark' : 'light')
  : theme.value);
const cameraView = computed<CameraView>(() => viewMode.value === 'overview'
  ? 'front'
  : viewMode.value === 'navigation' ? 'side' : 'rear');
const nextStep = computed(() => store.plan.selections.length ? Math.max(2, store.step) : 1);
const platformLabel = computed(() => `${store.platform === 'windows' ? 'Windows' : store.platform === 'macos' ? 'macOS' : 'Linux'} ${store.architecture}`);

function goToStep(step: number) {
  const target = Math.min(4, Math.max(1, step)) as 1 | 2 | 3 | 4;
  store.step = target;
  void router.push({ name: 'environment-setup', params: { step: setupStepPaths[target - 1] } });
}

function syncSystemTheme(event?: MediaQueryListEvent) {
  systemDark.value = event?.matches ?? mediaQuery?.matches ?? false;
}

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  syncSystemTheme();
  mediaQuery.addEventListener('change', syncSystemTheme);
});

onBeforeUnmount(() => mediaQuery?.removeEventListener('change', syncSystemTheme));
</script>

<template>
  <section :class="['showroom-page', 'portal-home', `theme-${resolvedTheme}`, `view-${viewMode}`]" aria-label="环境中心">
    <MistralScene
      paint-color="#123f67"
      :theme="resolvedTheme"
      :auto-rotate="viewMode === 'overview'"
      :camera-view="cameraView"
      @progress="progress = $event"
      @ready="ready = true"
      @error="errorMessage = $event"
    />

    <header class="showroom-identity portal-home__identity">
      <span>SIILVANA WORKSPACE</span>
      <h1>本地开发环境</h1>
      <p>Siilvana App · v0.1.0 · {{ platformLabel }}</p>
    </header>

    <div v-if="!ready && !errorMessage" class="showroom-loading" role="status" aria-live="polite">
      <span>正在准备环境</span>
      <strong>{{ progress || '—' }}%</strong>
      <i><b :style="{ width: `${progress}%` }" /></i>
    </div>

    <div v-if="errorMessage" class="showroom-error" role="alert">
      <strong>无法打开环境中心</strong>
      <span>{{ errorMessage }}</span>
    </div>

    <aside v-if="viewMode !== 'overview'" :class="['portal-mode-panel', `is-${viewMode}`]" aria-label="配置流程">
      <button v-for="step in steps" :key="step.id" type="button" @click="goToStep(step.id)">
        <span><component :is="step.icon" :size="18" /></span>
        <span><strong>0{{ step.id }} · {{ step.title }}</strong><small>{{ step.status }}</small></span>
        <ArrowRight :size="16" />
      </button>
    </aside>

    <div class="showroom-meta environment-monitor" aria-label="环境状态">
      <span><small>RUNTIME</small><strong>Node 24.x</strong></span>
      <i />
      <span><small>TOOLCHAIN</small><strong>{{ store.plan.selections.length }} 项</strong></span>
      <i />
      <span><small>EST. SPACE</small><strong>{{ (store.plan.estimatedDiskMb / 1024).toFixed(1) }} GB</strong></span>
      <i />
      <span><small>PROGRESS</small><strong>{{ store.step }} / 4</strong></span>
    </div>

    <div class="showroom-toolbar portal-home__toolbar">
      <div class="portal-control-group" aria-label="主题模式">
        <button
          v-for="item in themes"
          :key="item.id"
          type="button"
          :class="['showroom-icon-button', { 'is-active': theme === item.id }]"
          :title="item.label"
          :aria-label="item.label"
          @click="theme = item.id"
        ><component :is="item.icon" :size="17" /></button>
      </div>

      <div class="view-control portal-view-control" aria-label="视图模式">
        <button
          v-for="item in views"
          :key="item.id"
          type="button"
          :class="{ 'is-active': viewMode === item.id }"
          :title="item.label"
          @click="viewMode = item.id"
        ><component :is="item.icon" :size="15" /><span>{{ item.label }}</span></button>
      </div>

      <button class="portal-main-cta" type="button" @click="goToStep(nextStep)">
        <span>{{ store.plan.selections.length ? '继续配置' : '开始配置' }}</span>
        <ArrowRight :size="17" />
      </button>
    </div>
  </section>
</template>
