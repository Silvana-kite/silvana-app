<script setup lang="ts">
import { Check, Clipboard, Download, TerminalSquare } from 'lucide-vue-next';
import type { InstallPlan } from '@siilvana/shared';

defineProps<{ plan: InstallPlan; disabled: boolean; copied: boolean }>();
defineEmits<{ copy: []; download: [] }>();
</script>

<template>
  <div class="script-shell">
    <div class="script-shell__bar">
      <span>
        <TerminalSquare :size="17" />
        {{ plan.script.shell }}
        <small>{{ plan.steps.length }} STEPS</small>
      </span>
      <div>
        <button class="icon-button" type="button" :disabled="disabled" :title="copied ? '已复制' : '复制脚本'" @click="$emit('copy')">
          <Check v-if="copied" :size="17" />
          <Clipboard v-else :size="17" />
        </button>
        <button class="primary-button" type="button" :disabled="disabled" @click="$emit('download')">
          <Download :size="17" />下载脚本
        </button>
      </div>
    </div>
    <pre><code>{{ plan.script.content }}</code></pre>
  </div>
</template>
