<script setup lang="ts">
import { ArrowRight, Check, ChartNoAxesCombined, Code2, Layers3, Server, SlidersHorizontal, Smartphone } from 'lucide-vue-next';
import { computed, type Component } from 'vue';
import type { EnvironmentTemplate } from '@siilvana/shared';

const props = defineProps<{ template: EnvironmentTemplate; selected?: boolean; count?: number }>();
defineEmits<{ select: [] }>();

const featured = computed(() => ['frontend-web', 'data-science'].includes(props.template.id));

const presentation: Record<EnvironmentTemplate['scenario'], { icon: Component; tone: 'cyan' | 'violet' | 'blue' | 'rose' | 'amber' }> = {
  frontend: { icon: Code2, tone: 'cyan' },
  backend: { icon: Server, tone: 'violet' },
  fullstack: { icon: Layers3, tone: 'blue' },
  mobile: { icon: Smartphone, tone: 'rose' },
  'data-science': { icon: ChartNoAxesCombined, tone: 'amber' },
  office: { icon: Layers3, tone: 'blue' },
  custom: { icon: SlidersHorizontal, tone: 'cyan' },
};
</script>

<template>
  <button
    type="button"
    :class="['scenario-card', `scenario-card--${template.id}`, { 'is-featured': featured, 'is-selected': selected }]"
    role="radio"
    :aria-checked="!!selected"
    @click="$emit('select')"
  >
    <div class="scenario-card__content">
      <div class="scenario-card__top">
        <span :class="['scenario-symbol', `scenario-symbol--${presentation[template.scenario].tone}`]"><component :is="presentation[template.scenario].icon" :size="featured ? 34 : 28" :stroke-width="2.5" /></span>
        <span class="scenario-card__count"><Check v-if="selected" :size="12" />{{ count ?? template.items.length }} TOOLS</span>
      </div>
      <div class="scenario-card__bottom">
        <div>
          <h2>{{ template.name }}</h2>
          <p>{{ template.description }}</p>
        </div>
        <span class="scenario-card__arrow" aria-hidden="true"><ArrowRight :size="16" /></span>
      </div>
    </div>
  </button>
</template>
