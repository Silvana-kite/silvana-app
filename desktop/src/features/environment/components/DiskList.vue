<script setup lang="ts">
import { HardDrive } from 'lucide-vue-next';
import { gib, type DiskInfo } from '../services/device';
defineProps<{ disks: DiskInfo[]; budget: number }>();
const usedPercent = (disk: DiskInfo) => Math.round((1 - disk.availableBytes / disk.totalBytes) * 100);
</script>

<template>
  <section class="disk-inventory" aria-labelledby="disk-inventory-heading">
    <header><h2 id="disk-inventory-heading">磁盘扫描结果</h2><span>已扫描 {{ disks.length }} 个磁盘</span></header>
    <ul>
      <li v-for="disk in disks" :key="disk.id" class="disk-inventory__row">
        <HardDrive :size="22" :stroke-width="1.6" />
        <div class="disk-inventory__identity"><strong>{{ disk.label }}</strong><small>{{ disk.id }}</small></div>
        <span v-if="disk.installationTarget !== false" class="disk-inventory__target">安装相关</span>
        <div class="disk-inventory__capacity" :class="{ 'is-low': disk.availableBytes < budget }">
          <span>可用 <strong>{{ gib(disk.availableBytes) }}</strong><small> / {{ gib(disk.totalBytes) }}</small></span>
          <progress :value="usedPercent(disk)" max="100" :aria-label="`${disk.label} 已用 ${usedPercent(disk)}%`" />
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.disk-inventory { margin-top: 28px; padding: 24px 0 0; border-top: 1px solid #e3e9e5; }
.disk-inventory header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.disk-inventory h2 { margin: 0; font-size: 18px; font-weight: 600; }
.disk-inventory header > span { color: #73817f; font-size: 12px; }
.disk-inventory ul { list-style: none; margin: 0; padding: 0; }
.disk-inventory__row { display: grid; grid-template-columns: 26px minmax(0, 1fr) 70px minmax(180px, 280px); gap: 16px; align-items: center; padding: 18px 0; border-bottom: 1px solid #e6ebe8; }
.disk-inventory__row > svg { color: #638278; }
.disk-inventory__identity { min-width: 0; }
.disk-inventory__identity strong { display: block; font-size: 13px; overflow-wrap: anywhere; }
.disk-inventory__identity small { display: block; color: #7c8887; font: 11px/1.7 ui-monospace, Consolas, monospace; overflow-wrap: anywhere; }
.disk-inventory__target { color: #5e7b6e; font-size: 10px; }
.disk-inventory__capacity { grid-column: 4; color: #60766c; min-width: 0; }
.disk-inventory__capacity > span { display: block; font-size: 11px; }
.disk-inventory__capacity strong { font-weight: 600; font-size: 12px; }
.disk-inventory__capacity small { color: #87908d; font-size: 11px; }
.disk-inventory__capacity progress { display: block; width: 100%; height: 5px; margin-top: 9px; appearance: none; border: 0; border-radius: 4px; overflow: hidden; background: #e8eeeb; }
progress::-webkit-progress-bar { background: #e8eeeb; }
progress::-webkit-progress-value { background: #55a389; border-radius: 4px; }
progress::-moz-progress-bar { background: #55a389; }
.is-low progress::-webkit-progress-value { background: #cd9965; }
.is-low progress::-moz-progress-bar { background: #cd9965; }
@media (max-width: 680px) {
  .disk-inventory__row { grid-template-columns: 24px minmax(0, 1fr) auto; gap: 8px 12px; }
  .disk-inventory__capacity { grid-column: 2 / -1; }
  .disk-inventory h2 { font-size: 17px; }
}
</style>
