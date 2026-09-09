import type { Catalog, InstallPlan } from '@siilvana/shared';
import type { DiskInfo } from './device';
import { requiredBytes } from './device';

export const driveId = (value: string) => /^[a-z]:[\\/]$/i.test(value) ? `${value[0]!.toUpperCase()}:\\` : null;
export function bundledParent(catalog: Catalog, plan: InstallPlan, toolId: string) {
  return plan.selections.find(selection => catalog.tools.find(tool => tool.id === selection.toolId)?.versions
    .find(version => version.id === selection.versionId)?.bundledTools?.some(bundle => bundle.toolId === toolId))?.toolId;
}
export function effectiveTargets(catalog: Catalog, plan: InstallPlan, targets: Record<string, string>) {
  return Object.fromEntries(plan.selections.map(selection => {
    const parent = bundledParent(catalog, plan, selection.toolId);
    return [selection.toolId, targets[parent ?? selection.toolId] ?? ''];
  }));
}
export function locationRecipe(catalog: Catalog, plan: InstallPlan, toolId: string) {
  const step = plan.steps.find(step => step.toolId === toolId);
  return catalog.tools.find(tool => tool.id === toolId)?.recipes.find(recipe => recipe.id === step?.id);
}
export function locationLabel(catalog: Catalog, plan: InstallPlan, toolId: string, disk: string) {
  if (!disk) return '请选择安装磁盘';
  if (bundledParent(catalog, plan, toolId)) return '跟随主软件安装';
  return locationRecipe(catalog, plan, toolId)?.installationLocation?.kind === 'directory'
    ? `${disk}Siilvana\\Apps\\${toolId}` : `${disk} · 默认目录，安装前验证位置`;
}
/** Budget per volume: software + 20% headroom, and temporary cache + 2 GiB reserve. */
export function targetBudgets(catalog: Catalog, plan: InstallPlan, targets: Record<string, string>, disks: DiskInfo[]) {
  const result: Record<string, number> = {};
  const effective = effectiveTargets(catalog, plan, targets);
  for (const selection of plan.selections) {
    const disk = driveId(effective[selection.toolId] ?? '');
    if (!disk) continue;
    result[disk] = (result[disk] ?? 0) + (catalog.tools.find(tool => tool.id === selection.toolId)?.diskMb ?? 0);
  }
  for (const disk of Object.keys(result)) result[disk] = requiredBytes(result[disk]!);
  const caches = disks.filter(disk => disk.temporaryTarget);
  for (const disk of caches) {
    const id = driveId(disk.id);
    if (id) result[id] = (result[id] ?? requiredBytes(0)) + plan.estimatedDiskMb * 1024 ** 2;
  }
  return result;
}
export function locationErrors(catalog: Catalog, plan: InstallPlan, targets: Record<string, string>, disks: DiskInfo[]) {
  const effective = effectiveTargets(catalog, plan, targets);
  return plan.selections.flatMap(selection => {
    const id = driveId(effective[selection.toolId] ?? '');
    const name = catalog.tools.find(tool => tool.id === selection.toolId)?.name ?? selection.toolId;
    return !id ? [`请为 ${name} 选择安装磁盘。`]
      : !disks.some(disk => driveId(disk.id) === id) ? [`${name} 的目标盘 ${id} 不可用，请重新选择。`] : [];
  });
}
