<script setup lang="ts">
import { CircleDot, HardDrive } from 'lucide-vue-next';
import type { Catalog, InstallPlan } from '@siilvana/shared';

defineProps<{ plan: InstallPlan; catalog: Catalog }>();
</script>

<template>
  <div class="selection-summary">
    <div class="selection-summary__metric">
      <HardDrive :size="16" />
      预计占用 {{ (plan.estimatedDiskMb / 1024).toFixed(1) }} GB
    </div>
    <ol>
      <li v-for="item in plan.selections" :key="item.toolId">
        <CircleDot :size="14" />
        <span>
          <strong>{{ catalog.tools.find(tool => tool.id === item.toolId)?.name }}</strong>
          <small>{{ item.reason === 'required' ? '自动依赖' : item.reason === 'bundled' ? '随运行时提供' : '用户选择' }}</small>
        </span>
      </li>
    </ol>
    <div v-if="!plan.selections.length" class="selection-summary__empty">尚未选择工具</div>
  </div>
</template>
