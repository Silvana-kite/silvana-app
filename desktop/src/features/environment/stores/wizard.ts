import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { catalog as embeddedCatalog } from '@siilvana/catalog';
import {
  createInstallPlan,
  platformVersion,
  type Architecture,
  type Catalog,
  type Platform,
  type Selection,
  type ToolCategory,
} from '@siilvana/shared';
import { SiilvanaApiClient } from '@siilvana/api-client';
import { effectiveTargets } from '../services/installation-locations';
import { loadCatalogCache, saveCatalogCache } from '../services/catalog-cache';
import {
  loadWorkspaceState,
  saveWorkspaceState,
  type ActivityKind,
  type ActivityRecord,
  type ActivityStatus,
  type MotionPreference,
  type WorkspaceStateV1,
} from '../../../shared/services/workspace-state';

const categoryLabels: Record<ToolCategory | 'all', string> = {
  all: '全部', runtime: '语言运行时', 'package-manager': '包管理器', framework: '框架',
  database: '数据库', editor: '编辑器 / IDE', cli: '命令行', container: '容器', browser: '浏览器', terminal: '终端', 'api-client': '接口调试',
};

function detectedPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'windows';
  return navigator.userAgent.includes('Windows')
    ? 'windows'
    : navigator.userAgent.includes('Mac') ? 'macos' : 'linux';
}

function activityId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const useWizardStore = defineStore('wizard', () => {
  const step = ref<1 | 2 | 3 | 4>(1);
  const catalog = ref<Catalog>(embeddedCatalog);
  const platform = ref<Platform>(detectedPlatform());
  const architecture = ref<Architecture>('x64');
  const selected = ref<Record<string, string>>({});
  const installationTargets = ref<Record<string, string>>({});
  const templateId = ref<string | null>(null);
  const targetMode = ref<'auto' | 'manual'>('auto');
  const validationMode = ref<'smart' | 'manual'>('manual');
  const search = ref('');
  const category = ref<ToolCategory | 'all'>('all');
  const syncing = ref(false);
  const online = ref<boolean | null>(null);
  const initialized = ref(false);
  const syncOnLaunch = ref(true);
  const diskScanConsent = ref(false);
  const motion = ref<MotionPreference>('system');
  const activities = ref<ActivityRecord[]>([]);
  let saveChain = Promise.resolve();

  const preferredManagers = computed(() => platform.value === 'windows'
    ? ['winget', 'volta', 'npm', 'scoop', 'choco'] as const
    : platform.value === 'macos'
      ? ['brew', 'volta', 'npm'] as const
      : ['official', 'apt', 'volta', 'npm'] as const);

  const explicitSelections = computed<Selection[]>(() => Object.entries(selected.value).map(([toolId, versionId]) => ({ toolId, versionId })));
  const plan = computed(() => createInstallPlan(catalog.value, {
    platform: platform.value,
    architecture: architecture.value,
    preferredManagers: [...preferredManagers.value],
    selections: explicitSelections.value,
  }));
  const visibleTools = computed(() => catalog.value.tools.filter((tool) => {
    const term = search.value.trim().toLocaleLowerCase();
    return (category.value === 'all' || tool.category === category.value)
      && (!term || `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(term));
  }));
  const hasErrors = computed(() => plan.value.diagnostics.some((item) => item.severity === 'error'));
  const hasInstallationTargets = computed(() => platform.value === 'windows' && Object.keys(installationTargets.value).length > 0);
  const resolvedInstallationTargets = computed(() => hasInstallationTargets.value
    ? effectiveTargets(catalog.value, plan.value, installationTargets.value) : {});
  const unreadActivities = computed(() => activities.value.filter((item) => !item.read).length);

  function snapshot(): WorkspaceStateV1 {
    return {
      version: 1,
      wizard: {
        platform: platform.value,
        architecture: architecture.value,
        selected: { ...selected.value },
        installationTargets: { ...installationTargets.value },
        validationMode: validationMode.value,
        templateId: templateId.value,
        targetMode: targetMode.value,
      },
      preferences: { syncOnLaunch: syncOnLaunch.value, diskScanConsent: diskScanConsent.value, motion: motion.value },
      activities: activities.value.slice(0, 50).map((item) => ({ ...item })),
    };
  }

  function persist() {
    if (!initialized.value) return;
    const value = snapshot();
    saveChain = saveChain.then(() => saveWorkspaceState(value)).catch(() => undefined);
  }

  function addActivity(kind: ActivityKind, status: ActivityStatus, title: string, detail: string) {
    activities.value = [{
      id: activityId(), kind, status, title, detail,
      createdAt: new Date().toISOString(), read: false,
    }, ...activities.value].slice(0, 50);
  }

  function applyTemplate(id: string) {
    const template = catalog.value.templates.find((candidate) => candidate.id === id);
    if (!template) return;
    selected.value = Object.fromEntries(template.items.map((item) => {
      const tool = catalog.value.tools.find((candidate) => candidate.id === item.toolId)!;
      const version = item.versionId
        ? tool.versions.find((candidate) => candidate.id === item.versionId)
        : platformVersion(tool, platform.value, architecture.value);
      return [tool.id, version!.id];
    }));
    templateId.value = template.id;
    addActivity('template-applied', 'info', `已应用“${template.name}”模板`, `${template.items.length} 项基础工具已加入当前方案。`);
  }

  function startBlankPlan() {
    selected.value = {};
    installationTargets.value = {};
    templateId.value = null;
    search.value = '';
    category.value = 'all';
    step.value = 1;
  }

  function toggleTool(toolId: string) {
    templateId.value = 'custom';
    if (selected.value[toolId]) {
      const copy = { ...selected.value };
      delete copy[toolId];
      selected.value = copy;
      return;
    }
    const tool = catalog.value.tools.find((candidate) => candidate.id === toolId);
    const version = tool && platformVersion(tool, platform.value, architecture.value);
    if (version) selected.value = { ...selected.value, [toolId]: version.id };
  }

  function setVersion(toolId: string, versionId: string) {
    const tool = catalog.value.tools.find(candidate => candidate.id === toolId);
    if (!tool?.recipes.some(recipe => recipe.approved && recipe.versionId === versionId && recipe.platform === platform.value && (recipe.architecture === 'any' || recipe.architecture === architecture.value))) return;
    templateId.value = 'custom';
    selected.value = { ...selected.value, [toolId]: versionId };
  }

  function focusTool(toolId: string) {
    const tool = catalog.value.tools.find((candidate) => candidate.id === toolId);
    search.value = tool?.name ?? '';
    category.value = 'all';
  }

  function recordExport() {
    addActivity(
      'script-exported',
      'success',
      '安装脚本已导出',
      `${plan.value.script.shell === 'powershell' ? 'PowerShell' : 'Bash'} · ${plan.value.steps.length} 个安装步骤`,
    );
  }

  function setValidationMode(mode: 'smart' | 'manual') {
    validationMode.value = mode;
  }

  function recordScan(status: ActivityStatus, title: string, detail: string) {
    addActivity('environment-scan', status, title, detail);
  }

  function markActivityRead(id: string) {
    activities.value = activities.value.map((item) => item.id === id ? { ...item, read: true } : item);
  }

  function markAllActivitiesRead() {
    activities.value = activities.value.map((item) => ({ ...item, read: true }));
  }

  function clearActivities() {
    activities.value = [];
  }

  async function syncCatalog(options: { record?: boolean } = {}) {
    const shouldRecord = options.record ?? true;
    const baseUrl = (import.meta.env.VITE_API_URL as string | undefined)
      ?? (import.meta.env.DEV ? 'http://localhost:3000/v1' : undefined);
    if (!baseUrl) {
      online.value = null;
      if (shouldRecord) addActivity('catalog-sync', 'info', '正在使用内置目录', `目录版本 ${catalog.value.revision}`);
      return;
    }
    syncing.value = true;
    try {
      const client = new SiilvanaApiClient(baseUrl);
      const cached = await loadCatalogCache();
      const result = await client.catalog(cached?.etag);
      if (result.catalog) {
        catalog.value = result.catalog;
        await saveCatalogCache({ catalog: result.catalog, etag: result.etag });
      }
      online.value = true;
      if (shouldRecord) addActivity('catalog-sync', 'success', '工具目录已同步', `当前版本 ${catalog.value.revision}`);
    } catch {
      online.value = false;
      const cached = await loadCatalogCache();
      catalog.value = cached?.catalog ?? embeddedCatalog;
      if (shouldRecord) addActivity('catalog-sync', 'error', '工具目录同步失败', `已回退到可用目录 ${catalog.value.revision}`);
    } finally {
      syncing.value = false;
    }
  }

  let initialization: Promise<void> | undefined;
  let catalogSynchronization: Promise<void> | undefined;
  async function initialize(options: { waitForCatalog?: boolean } = {}) {
    initialization ??= initializeState();
    await initialization;
    if (options.waitForCatalog !== false) await catalogSynchronization;
  }
  async function initializeState() {
    if (initialized.value) return;
    const saved = await loadWorkspaceState();
    if (saved) {
      platform.value = saved.wizard.platform;
      architecture.value = saved.wizard.architecture;
      selected.value = { ...saved.wizard.selected };
      installationTargets.value = { ...saved.wizard.installationTargets };
      validationMode.value = saved.wizard.validationMode ?? 'manual';
      templateId.value = saved.wizard.templateId ?? (Object.keys(saved.wizard.selected).length ? 'custom' : null);
      targetMode.value = saved.wizard.targetMode ?? 'manual';
      syncOnLaunch.value = saved.preferences.syncOnLaunch;
      diskScanConsent.value = saved.preferences.diskScanConsent ?? false;
      motion.value = saved.preferences.motion;
      activities.value = saved.activities.slice(0, 50);
    }
    initialized.value = true;
    if (syncOnLaunch.value) {
      catalogSynchronization = syncCatalog();
    }
  }

  watch([platform, architecture, selected, installationTargets, templateId, targetMode, validationMode, syncOnLaunch, diskScanConsent, motion, activities], persist, { deep: true });

  return {
    step, catalog, platform, architecture, selected, templateId, targetMode, search, category, syncing, online,
    initialized, syncOnLaunch, diskScanConsent, motion, activities, categoryLabels, explicitSelections,
    plan, visibleTools, hasErrors, unreadActivities, applyTemplate, startBlankPlan,
    toggleTool, setVersion, focusTool, recordExport, markActivityRead,
    markAllActivitiesRead, clearActivities, syncCatalog, initialize,
    validationMode, setValidationMode, recordScan,
    installationTargets, hasInstallationTargets, resolvedInstallationTargets,
  };
});
