<script setup lang="ts">
import { computed } from 'vue';
import { HardDrive } from 'lucide-vue-next';
import { gib, type DiskInfo } from '../services/device';
import { driveId } from '../services/installation-locations';

const props = defineProps<{
  disks: DiskInfo[];
  budgets: Record<string, number>;
  installationDiskIds: string[];
  ready: boolean;
  statusText: string;
}>();
const required = (disk: DiskInfo) => props.budgets[disk.id] ?? 0;
const isLow = (disk: DiskInfo) => required(disk) > disk.availableBytes;
const lowSpace = computed(() => props.ready && props.disks.some(isLow));
const isInstallationDisk = (disk: DiskInfo) => props.installationDiskIds.includes(driveId(disk.id) ?? disk.id);
const name = (disk: DiskInfo) => driveId(disk.id) ? `${driveId(disk.id)![0]} 盘` : disk.label;
const usedPercent = (disk: DiskInfo) => Math.round((1 - disk.availableBytes / disk.totalBytes) * 100);
</script>

<template>
  <article :class="['adapt-metric adapt-metric--disk disk-overview', { 'is-ready': ready, 'is-low': lowSpace }]" aria-label="本地磁盘空间">
    <div class="adapt-metric__label"><span><HardDrive :size="17" />本地磁盘空间</span><span v-if="ready">共 {{ disks.length }} 个磁盘</span><span v-else class="adapt-index">04</span></div>
    <ul v-if="ready" class="disk-overview__grid">
      <li v-for="disk in disks" :key="disk.id" :data-disk-id="disk.id" :class="['disk-overview__item', { 'is-low': isLow(disk) }]">
        <strong class="disk-overview__name">{{ name(disk) }}可用空间</strong>
        <small class="disk-overview__path">{{ disk.label }}<template v-if="!driveId(disk.id)"> · {{ disk.id }}</template></small>
        <div class="disk-overview__capacity"><strong>{{ gib(disk.availableBytes) }}</strong><span> / {{ gib(disk.totalBytes) }}</span></div>
        <progress :value="usedPercent(disk)" max="100" :aria-label="`${name(disk)}已用 ${usedPercent(disk)}%`" />
        <div class="disk-overview__roles"><span v-if="disk.systemTarget">系统盘</span><span v-if="isInstallationDisk(disk)">安装目标</span><span v-if="disk.temporaryTarget">临时缓存</span><small v-if="!isInstallationDisk(disk) && !disk.temporaryTarget">未用于本次安装</small></div>
        <small v-if="required(disk) > 0" class="disk-overview__budget">{{ isLow(disk) ? '空间不足' : '空间充足' }} · 需预留 {{ gib(required(disk)) }}</small>
      </li>
    </ul>
    <template v-else><strong class="adapt-metric__value">--<span>GiB 可用</span></strong><small>{{ statusText }}</small></template>
  </article>
</template>

<style scoped>
.disk-overview.is-ready { grid-column: 1 / -1; }
.disk-overview__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr)); gap: 12px; margin: 16px 0 0; padding: 0; list-style: none; }
.disk-overview__item { min-width: 0; padding: 16px; border: 1px solid #e0e9e5; border-radius: 7px; background: #fff; }
.disk-overview__item.is-low { border-color: #e8b9bb; background: #fffafa; }
.disk-overview__name { display: block; color: #33443d; font-size: 13px; overflow-wrap: anywhere; }
.disk-overview__path { display: block; margin-top: 5px; color: #7c8887; font-size: 10px; overflow-wrap: anywhere; }
.disk-overview__capacity { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px; margin-top: 15px; font-variant-numeric: tabular-nums; }
.disk-overview__capacity strong { font-size: 22px; font-weight: 600; }
.disk-overview__capacity > span { color: #7c8887; font-size: 10px; }
progress { display: block; width: 100%; height: 5px; margin-top: 10px; appearance: none; border: 0; border-radius: 4px; overflow: hidden; background: #e8eeeb; }
progress::-webkit-progress-bar { background: #e8eeeb; }
progress::-webkit-progress-value { background: #86a99c; }
progress::-moz-progress-bar { background: #86a99c; }
.disk-overview__item.is-low progress::-webkit-progress-value { background: #d96569; }
.disk-overview__item.is-low progress::-moz-progress-bar { background: #d96569; }
.disk-overview__roles { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
.disk-overview__roles > span { padding: 3px 6px; border-radius: 3px; color: #397c68; background: #eef6f2; font-size: 10px; }
.disk-overview__roles > small { padding-block: 3px; color: #7c8887; font-size: 10px; }
.disk-overview__budget { display: block; margin-top: 9px; color: #527e67; font-size: 10px; }
.disk-overview__item.is-low .disk-overview__budget { color: #b54749; }
</style>
