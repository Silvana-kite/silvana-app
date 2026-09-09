<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(defineProps<{
  icon: Component;
  tone?: 'cyan' | 'violet' | 'blue' | 'rose' | 'amber';
  size?: number;
}>(), { tone: 'cyan', size: 21 });
</script>

<template>
  <span :class="['icon-tile', `icon-tile--${tone}`]" aria-hidden="true">
    <component :is="icon" :size="size" :stroke-width="1.8" />
  </span>
</template>
