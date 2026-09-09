import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { createInstallPlan, platformVersion, type Architecture, type Platform } from '@siilvana/shared';
import { detectDevice, gib, installationDisks, isDesktop, readDisks, requiredBytes, type DeviceInfo, type DiskInfo } from '../services/device';
import { useWizardStore } from './wizard';
import { driveId, effectiveTargets, locationErrors, targetBudgets } from '../services/installation-locations';

export const useEnvironmentStore = defineStore('environment', () => {
  const wizard = useWizardStore();
  const device = ref<DeviceInfo>({ platform: null, architecture: null, cpuName: null });
  const detected = ref(false);
  const targetPlatform = ref<Platform>('windows');
  const targetArchitecture = ref<Architecture>('x64');
  const candidate = ref<Record<string, string>>({});
  const installationTargets = ref<Record<string, string>>({});
  const status = ref<'idle' | 'permission' | 'scanning' | 'complete' | 'denied' | 'error' | 'unsupported'>('idle');
  const consent = computed({ get: () => wizard.diskScanConsent, set: (value: boolean) => { wizard.diskScanConsent = value; } });
  const disks = ref<DiskInfo[]>([]);
  const error = ref('');
  const scannedTarget = ref('');
  const checkedAt = ref('');
  let initialization: Promise<void> | undefined;
  let scanGeneration = 0;

  function managers(platform: Platform) {
    return platform === 'windows' ? ['winget', 'volta', 'npm', 'scoop', 'choco'] as const
      : platform === 'macos' ? ['brew', 'volta', 'npm'] as const : ['official', 'apt', 'volta', 'npm'] as const;
  }
  const plan = computed(() => createInstallPlan(wizard.catalog, {
    platform: targetPlatform.value, architecture: targetArchitecture.value,
    preferredManagers: [...managers(targetPlatform.value)],
    selections: Object.entries(candidate.value).map(([toolId, versionId]) => ({ toolId, versionId })),
  }));
  function matches(architecture: Architecture) {
    return wizard.catalog.tools.flatMap((tool) => {
      const version = platformVersion(tool, targetPlatform.value, architecture);
      if (!version) return [];
      const recipes = tool.recipes.filter((recipe) => recipe.approved && recipe.versionId === version.id
        && recipe.platform === targetPlatform.value && (recipe.architecture === 'any' || recipe.architecture === architecture));
      if (!recipes.length) return [];
      const resolved = createInstallPlan(wizard.catalog, {
        platform: targetPlatform.value, architecture, preferredManagers: [...managers(targetPlatform.value)],
        selections: [{ toolId: tool.id, versionId: version.id }],
      });
      return resolved.diagnostics.some((item) => item.severity === 'error') ? []
        : [{ tool, version, universal: recipes.some((recipe) => recipe.architecture === 'any') }];
    });
  }
  const matched = computed(() => matches(targetArchitecture.value));
  const choosingDisks = computed(() => targetPlatform.value === 'windows' && disks.value.some(disk => driveId(disk.id)));
  const diskBudgets = computed(() => choosingDisks.value ? targetBudgets(wizard.catalog, plan.value, installationTargets.value, disks.value) : {});
  const targetErrors = computed(() => choosingDisks.value ? locationErrors(wizard.catalog, plan.value, installationTargets.value, disks.value) : []);
  const installDisks = computed(() => choosingDisks.value ? disks.value.filter(disk => (driveId(disk.id) ?? '') in diskBudgets.value) : installationDisks(disks.value));
  const limitingDisk = computed(() => [...installDisks.value].sort((a, b) => (a.availableBytes - (diskBudgets.value[driveId(a.id) ?? ''] ?? budget.value)) - (b.availableBytes - (diskBudgets.value[driveId(b.id) ?? ''] ?? budget.value)))[0]);
  const budget = computed(() => requiredBytes(plan.value.estimatedDiskMb));
  const currentTarget = computed(() => `${targetPlatform.value}/${targetArchitecture.value}`);
  const validScan = computed(() => status.value === 'complete' && scannedTarget.value === currentTarget.value);
  const enoughSpace = computed(() => validScan.value && !targetErrors.value.length && installDisks.value.length > 0 && installDisks.value.every((disk) => disk.availableBytes >= (diskBudgets.value[driveId(disk.id) ?? ''] ?? budget.value)));
  const nativeTarget = computed(() => targetPlatform.value === device.value.platform && targetArchitecture.value === device.value.architecture);
  const canContinue = computed(() => enoughSpace.value && nativeTarget.value && plan.value.steps.length > 0
    && !plan.value.diagnostics.some((item) => item.severity === 'error'));

  function invalidate() {
    scanGeneration++;
    scannedTarget.value = '';
    disks.value = [];
    if (status.value !== 'scanning') status.value = 'idle';
  }
  watch([targetPlatform, targetArchitecture], invalidate, { flush: 'sync' });
  watch(consent, allowed => { if (!allowed) invalidate(); }, { flush: 'sync' });
  watch(() => [wizard.platform, wizard.architecture], () => {
    if (wizard.validationMode === 'smart') invalidate();
  }, { flush: 'sync' });

  async function initialize() {
    if (initialization) {
      await initialization;
      if (wizard.validationMode === 'smart') {
        targetPlatform.value = wizard.platform;
        targetArchitecture.value = wizard.architecture;
        candidate.value = { ...wizard.selected };
        installationTargets.value = { ...wizard.installationTargets };
      }
      if (consent.value && isDesktop() && !validScan.value) await scan();
      return;
    }
    initialization = (async () => {
      await wizard.initialize({ waitForCatalog: false });
      try { device.value = await detectDevice(); } catch { /* Unknown hardware remains explicitly unknown. */ }
      targetPlatform.value = device.value.platform ?? wizard.platform;
      targetArchitecture.value = device.value.architecture ?? wizard.architecture;
      candidate.value = { ...wizard.selected };
      installationTargets.value = { ...wizard.installationTargets };
      if (!Object.keys(candidate.value).length) {
        const preset = new Set(wizard.catalog.templates.find((item) => item.id === 'frontend-web')?.items.map((item) => item.toolId));
        candidate.value = Object.fromEntries(matched.value.filter((item) => preset.has(item.tool.id)).map((item) => [item.tool.id, item.version.id]));
      }
      detected.value = true;
    })();
    await initialization;
    if (consent.value && isDesktop() && !validScan.value) await scan();
  }
  function toggle(toolId: string, versionId: string) {
    const next = { ...candidate.value };
    if (next[toolId]) delete next[toolId]; else next[toolId] = versionId;
    candidate.value = next;
  }
  async function requestScan() {
    if (status.value === 'scanning') return false;
    if (consent.value) return scan();
    disks.value = [];
    error.value = '';
    status.value = 'permission';
    return false;
  }
  function deny() {
    consent.value = false;
    status.value = 'denied';
  }
  async function scan(allowed = false) {
    if (status.value === 'scanning') return false;
    if (allowed && status.value !== 'permission') return false;
    if (allowed) consent.value = true;
    if (!consent.value) return false;
    if (!isDesktop()) { status.value = 'unsupported'; return false; }
    const target = currentTarget.value;
    const generation = scanGeneration;
    status.value = 'scanning';
    disks.value = [];
    error.value = '';
    try {
      const result = await readDisks(consent.value);
      if (!consent.value || target !== currentTarget.value || generation !== scanGeneration) { status.value = 'idle'; return false; }
      disks.value = result;
      if (targetPlatform.value === 'windows') {
        const defaultDisk = result.find(disk => disk.systemTarget)?.id
          ?? result.find(disk => disk.installationTarget !== false && driveId(disk.id))?.id;
        if (defaultDisk) {
          for (const item of plan.value.selections) {
            if (!(item.toolId in installationTargets.value)) installationTargets.value[item.toolId] = driveId(defaultDisk)!;
          }
          installationTargets.value = effectiveTargets(wizard.catalog, plan.value, installationTargets.value);
        }
      }
      scannedTarget.value = target;
      checkedAt.value = new Date().toISOString();
      status.value = 'complete';
      const sufficient = enoughSpace.value;
      wizard.recordScan(sufficient ? 'success' : 'error', sufficient ? '设备扫描完成' : '磁盘空间不足',
        `${target} · ${matched.value.length} 款匹配 · 已扫描 ${disks.value.length} 个磁盘 · 安装盘剩余 ${gib(limitingDisk.value?.availableBytes ?? 0)} · 目录 ${wizard.catalog.revision}`);
      return true;
    } catch (cause) {
      if (!consent.value || generation !== scanGeneration) { status.value = 'idle'; return false; }
      error.value = cause instanceof Error ? cause.message : String(cause);
      status.value = 'error';
      wizard.recordScan('error', '设备扫描失败', error.value);
      return false;
    }
  }
  function commit() {
    if (!canContinue.value) return false;
    wizard.setValidationMode('manual');
    wizard.platform = targetPlatform.value;
    wizard.architecture = targetArchitecture.value;
    wizard.selected = { ...candidate.value };
    wizard.installationTargets = choosingDisks.value ? { ...installationTargets.value } : {};
    wizard.setValidationMode('smart');
    return true;
  }
  function wizardCanContinue() {
    if (wizard.hasInstallationTargets) {
      const budgets = targetBudgets(wizard.catalog, wizard.plan, wizard.installationTargets, disks.value);
      return consent.value && validScan.value && scannedTarget.value === `${wizard.platform}/${wizard.architecture}`
        && nativeTarget.value && wizard.plan.steps.length > 0 && !wizard.hasErrors
        && !locationErrors(wizard.catalog, wizard.plan, wizard.installationTargets, disks.value).length
        && Object.entries(budgets).every(([id, bytes]) => (disks.value.find(disk => driveId(disk.id) === id)?.availableBytes ?? -1) >= bytes);
    }
    return consent.value && status.value === 'complete' && scannedTarget.value === `${wizard.platform}/${wizard.architecture}`
      && wizard.platform === device.value.platform && wizard.architecture === device.value.architecture
      && wizard.plan.steps.length > 0 && !wizard.hasErrors && installDisks.value.length > 0
      && installDisks.value.every((disk) => disk.availableBytes >= requiredBytes(wizard.plan.estimatedDiskMb));
  }
  async function verifyExport() {
    if (wizard.hasInstallationTargets) return false;
    if (!wizardCanContinue()) return false;
    candidate.value = { ...wizard.selected };
    const fingerprint = JSON.stringify([wizard.platform, wizard.architecture, wizard.selected, wizard.catalog.revision]);
    await scan();
    return fingerprint === JSON.stringify([wizard.platform, wizard.architecture, wizard.selected, wizard.catalog.revision]) && wizardCanContinue();
  }
  return { device, detected, targetPlatform, targetArchitecture, candidate, status, consent, disks, error, checkedAt,
    plan, matches, matched, installDisks, limitingDisk, budget, validScan, enoughSpace, nativeTarget, canContinue,
    initialize, toggle, requestScan, deny, scan, commit, wizardCanContinue, verifyExport,
    installationTargets, choosingDisks, diskBudgets, targetErrors };
});
