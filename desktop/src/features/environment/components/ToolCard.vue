<script setup lang="ts">
import { computed, type Component } from 'vue';
import {
  Boxes, Braces, Check, ChevronDown, Code2, Coffee, Container, Database,
  Gauge, GitBranch, Layers3, Package, TerminalSquare, Wrench,
} from 'lucide-vue-next';
import { platformVersion, type Architecture, type Platform, type Tool } from '@siilvana/shared';
import IconTile from '../../../shared/components/IconTile.vue';

const props = defineProps<{ tool: Tool; selected: boolean; versionId?: string; platform?: Platform; architecture?: Architecture }>();
defineEmits<{ toggle: []; version: [versionId: string] }>();

const icons: Record<string, Component> = {
  gauge: Gauge, braces: Braces, package: Package, boxes: Boxes, 'git-branch': GitBranch,
  'code-2': Code2, coffee: Coffee, 'layers-3': Layers3, 'terminal-square': TerminalSquare,
  database: Database, container: Container,
};
const tones = {
  runtime: 'cyan', 'package-manager': 'violet', framework: 'blue', database: 'blue',
  editor: 'rose', cli: 'amber', container: 'cyan',
} as const;
const displayedVersion = computed(() => props.versionId ?? (props.platform && props.architecture ? platformVersion(props.tool, props.platform, props.architecture)?.id : props.tool.versions.find((version) => version.recommended)?.id ?? props.tool.versions[0]?.id));
const versions = computed(() => props.tool.versions.filter(version => !props.platform || !props.tool.recipes.length || version.id === props.versionId || props.tool.recipes.some(recipe => recipe.versionId === version.id && recipe.platform === props.platform && (recipe.architecture === 'any' || recipe.architecture === props.architecture))));
</script>

<template>
  <article :class="['tool-card', { 'is-selected': selected }]">
    <div class="tool-card__body">
      <div class="tool-card__top">
        <IconTile :icon="icons[tool.icon] ?? Wrench" :tone="tones[tool.category]" />
        <button
          type="button"
          :class="['check-button', { 'is-selected': selected }]"
          :aria-label="`${selected ? '取消选择' : '选择'} ${tool.name}`"
          :aria-pressed="selected"
          @click="$emit('toggle')"
        >
          <Check :size="15" :stroke-width="2.5" />
        </button>
      </div>

      <h2>{{ tool.name }}</h2>
      <p>{{ tool.description }}</p>

      <label class="tool-card__version">
        <span>版本</span>
        <span class="select-control">
          <select
            :value="displayedVersion"
            :aria-label="`${tool.name} 版本`"
            @change="$emit('version', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="version in versions" :key="version.id" :value="version.id">
              {{ version.version === 'system' ? '系统源稳定版' : version.version }}{{ version.recommended ? ' · 推荐' : version.channel === 'eol' ? ' · EOL' : '' }}
            </option>
          </select>
          <ChevronDown :size="15" />
        </span>
      </label>
    </div>
  </article>
</template>
