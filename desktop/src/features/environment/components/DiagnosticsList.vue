<script setup lang="ts">
import { AlertTriangle, Info } from 'lucide-vue-next';
import type { Diagnostic } from '@siilvana/shared';

defineProps<{ diagnostics: Diagnostic[] }>();
</script>

<template>
  <div v-if="diagnostics.length" class="diagnostic-list">
    <div
      v-for="item in diagnostics"
      :key="item.code + item.toolIds.join()"
      :class="['diagnostic-row', `is-${item.severity}`]"
      role="status"
    >
      <AlertTriangle v-if="item.severity !== 'info'" :size="18" />
      <Info v-else :size="18" />
      <span><strong>{{ item.severity === 'error' ? '需要处理' : item.severity === 'warning' ? '兼容性建议' : '提示' }}</strong>{{ item.message }}</span>
    </div>
  </div>
</template>
