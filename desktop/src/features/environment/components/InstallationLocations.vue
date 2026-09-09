<script setup lang="ts">
import { computed } from 'vue';
import type { Catalog, InstallPlan } from '@siilvana/shared';
import { bundledParent, driveId, effectiveTargets, locationErrors, locationLabel, locationRecipe, targetBudgets } from '../services/installation-locations';
import { gib, type DiskInfo } from '../services/device';

const props = defineProps<{ catalog: Catalog; plan: InstallPlan; disks: DiskInfo[]; modelValue: Record<string, string>; disabled?: boolean; readonly?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>();
const targets = computed(() => effectiveTargets(props.catalog, props.plan, props.modelValue));
const choices = computed(() => props.disks.filter(disk => driveId(disk.id)));
const budgets = computed(() => targetBudgets(props.catalog, props.plan, props.modelValue, props.disks));
const errors = computed(() => locationErrors(props.catalog, props.plan, props.modelValue, props.disks));
const name = (id: string) => props.catalog.tools.find(tool => tool.id === id)?.name ?? id;
function change(id: string, event: Event) {
  if (props.disabled || props.readonly) return;
  emit('update:modelValue', effectiveTargets(props.catalog, props.plan, { ...props.modelValue, [id]: (event.target as HTMLSelectElement).value }));
}
</script>

<template>
  <section class="installation-locations" aria-label="软件安装位置">
    <header><h2>软件安装位置</h2><p>为每款软件选择磁盘。仅软件本体使用目标盘，系统临时文件与用户配置仍可能使用系统盘。</p></header>
    <div v-for="item in plan.selections" :key="item.toolId" class="location-row">
      <div class="location-copy"><strong>{{ name(item.toolId) }}</strong><small v-if="bundledParent(catalog, plan, item.toolId)">跟随 {{ name(bundledParent(catalog, plan, item.toolId)!) }}</small><small v-else-if="item.reason === 'required'">必要依赖</small></div>
      <label><span class="location-label">{{ name(item.toolId) }} 安装磁盘</span>
        <select :aria-label="`${name(item.toolId)} 安装磁盘`" :value="targets[item.toolId]" :disabled="disabled || readonly || !!bundledParent(catalog, plan, item.toolId)" @change="change(item.toolId, $event)">
          <option value="" disabled>请选择磁盘</option>
          <option v-if="targets[item.toolId] && !choices.some(disk => driveId(disk.id) === targets[item.toolId])" :value="targets[item.toolId]">{{ targets[item.toolId] }}（需重新扫描验证）</option>
          <option v-for="disk in choices" :key="disk.id" :value="driveId(disk.id)!">{{ disk.label }} · 可用 {{ gib(disk.availableBytes) }}</option>
        </select>
      </label>
      <div class="location-path"><code>{{ locationLabel(catalog, plan, item.toolId, targets[item.toolId] ?? '') }}</code><small v-if="!bundledParent(catalog, plan, item.toolId) && locationRecipe(catalog, plan, item.toolId)?.installationLocation?.kind !== 'directory'">当前安装方式不支持自定义目录；所选盘与默认或已有位置不符时将阻止安装。</small></div>
    </div>
    <ul v-if="Object.keys(budgets).length" class="location-budgets" aria-label="各磁盘空间预算"><li v-for="(bytes, id) in budgets" :key="id" :class="{ 'is-low': (disks.find(disk => driveId(disk.id) === id)?.availableBytes ?? -1) < bytes }">{{ id }} 需预留 {{ gib(bytes) }}<span v-if="disks.find(disk => driveId(disk.id) === id)?.temporaryTarget">（含临时缓存）</span></li></ul>
    <p v-for="error in errors" :key="error" role="alert" class="location-error">{{ error }}</p>
    <p v-if="!disks.length" class="location-error"><RouterLink to="/environment">返回适配中心重新扫描磁盘</RouterLink></p>
  </section>
</template>

<style scoped>
.installation-locations { margin: 24px 0; border: 1px solid #dce7e2; border-radius: 10px; padding: 20px; background: #fbfdfc; }
header h2 { margin: 0 0 8px; font-size: 17px; } header p, .location-path small { color: #748187; font-size: 12px; line-height: 1.6; }
.location-row { display: grid; grid-template-columns: minmax(130px, 1fr) minmax(180px, 1.5fr); gap: 10px 18px; padding: 16px 0; border-bottom: 1px solid #e5ece8; }
.location-copy { display: flex; flex-direction: column; gap: 5px; } .location-copy small { color: #748187; font-size: 11px; }
.location-label { display: block; margin-bottom: 5px; font-size: 11px; color: #748187; }
select { width: 100%; border: 1px solid #cfddd5; border-radius: 6px; padding: 9px; background: white; color: inherit; font: inherit; font-size: 12px; } select:focus-visible { outline: 2px solid #228e78; outline-offset: 2px; }
.location-path { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 5px; overflow-wrap: anywhere; font-size: 12px; }
.location-budgets { display: flex; flex-wrap: wrap; gap: 10px 22px; padding: 0; margin: 16px 0 0; list-style: none; font-size: 12px; color: #357863; }
.location-error, .is-low { color: #b54749; font-size: 12px; }
@media (max-width: 600px) { .location-row { grid-template-columns: 1fr; } .installation-locations { padding: 15px; } }
</style>
