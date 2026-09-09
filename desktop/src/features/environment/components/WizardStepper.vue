<script setup lang="ts">
import { Check } from 'lucide-vue-next';

defineProps<{ labels: string[]; current: number }>();
defineEmits<{ navigate: [step: number] }>();

const shortLabels = ['场景', '工具', '检查'];
</script>

<template>
  <nav class="wizard-stepper" aria-label="初始化步骤">
    <div class="wizard-stepper__track">
      <button
        v-for="(label, index) in labels"
        :key="label"
        type="button"
        :class="[
          'step-pill',
          current === index + 1 ? 'is-active' : current > index + 1 ? 'is-complete' : '',
        ]"
        :aria-current="current === index + 1 ? 'step' : undefined"
        @click="$emit('navigate', index + 1)"
      >
        <span class="step-pill__number">
          <Check v-if="current > index + 1" :size="13" :stroke-width="2.4" />
          <template v-else>{{ index + 1 }}</template>
        </span>
        <span class="step-pill__label"><span class="short-label">{{ shortLabels[index] ?? label }}</span><span class="long-label">{{ label }}</span></span>
      </button>
    </div>
  </nav>
</template>
