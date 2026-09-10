<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import {
  Boxes, Braces, Check, ChevronDown, Code2, Coffee, Container, Database,
  Gauge, GitBranch, Layers3, Package, TerminalSquare, Wrench,
} from 'lucide-vue-next';
import { platformVersion, type Architecture, type Platform, type Tool } from '@siilvana/shared';
import IconTile from '../../../shared/components/IconTile.vue';
import VersionPanel from './VersionPanel.vue';
import { openOfficialUrl } from '../../../shared/services/official-browser';

const props = defineProps<{ tool: Tool; selected: boolean; versionId?: string; platform?: Platform; architecture?: Architecture }>();
defineEmits<{ toggle: []; version: [versionId: string] }>();

const icons: Record<string, Component> = {
  gauge: Gauge, braces: Braces, package: Package, boxes: Boxes, 'git-branch': GitBranch,
  'code-2': Code2, coffee: Coffee, 'layers-3': Layers3, 'terminal-square': TerminalSquare,
  database: Database, container: Container,
};
const tones = {
  runtime: 'cyan', 'package-manager': 'violet', framework: 'blue', database: 'blue',
  editor: 'rose', cli: 'amber', container: 'cyan', browser: 'blue', terminal: 'amber', 'api-client': 'violet',
} as const;
const displayedVersion = computed(() => props.versionId ?? (props.platform && props.architecture ? platformVersion(props.tool, props.platform, props.architecture)?.id : props.tool.versions.find((version) => version.recommended)?.id ?? props.tool.versions[0]?.id));
const versions = computed(() => props.tool.versions.filter(version => !props.platform || !props.tool.recipes.length || version.id === props.versionId || props.tool.recipes.some(recipe => recipe.versionId === version.id && recipe.platform === props.platform && (recipe.architecture === 'any' || recipe.architecture === props.architecture))));
const panelOpen = ref(false);
const canInstall = computed(() => props.tool.recipes.some(r => r.approved && (!props.platform || r.platform === props.platform) && (!props.architecture || r.architecture === 'any' || r.architecture === props.architecture)));
const versionLabel = computed(() => versions.value.find(v => v.id === displayedVersion.value)?.version ?? '查看历史版本');
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
          :disabled="!canInstall && !selected"
          :title="!canInstall ? '此工具请通过官方入口手动下载' : undefined"
          @click="$emit('toggle')"
        >
          <Check :size="15" :stroke-width="2.5" />
        </button>
      </div>

      <h2><a :href="tool.downloadUrl ?? tool.homepage" @click.prevent="openOfficialUrl(tool.downloadUrl ?? tool.homepage)">{{ tool.name }} <small>↗</small></a></h2>
      <p>{{ tool.description }}</p>

      <div class="tool-card__version">
        <span>版本</span>
        <span class="select-control">
          <button
            type="button"
            class="tool-version-trigger"
            :aria-label="`${tool.name} 版本`"
            aria-haspopup="dialog"
            :aria-expanded="panelOpen"
            @click="panelOpen = true"
          >
            {{ versionLabel === 'system' ? '系统源稳定版' : versionLabel }}
          </button>
          <ChevronDown :size="15" />
        </span>
      </div>
      <small v-if="!canInstall" class="tool-manual-label">{{ tool.supportedPlatforms && platform && !tool.supportedPlatforms.includes(platform) ? '适用于其他系统 · 可查看官网' : tool.id === 'npm' ? '随 Node.js 提供' : '官网下载 · 手动安装' }}</small>
    </div>
  </article>
  <VersionPanel v-if="panelOpen" :tool="tool" :platform="platform" :architecture="architecture" :selected-version="versionId" @close="panelOpen = false" @select="$emit('version', $event)" />
</template>

<style scoped>
.tool-card h2 a{color:inherit;text-decoration:none}.tool-card h2 small{font-size:12px;color:#799098}.tool-version-trigger{border:0;background:transparent;width:100%;text-align:left;font:inherit;padding:10px 30px 10px 10px;cursor:pointer;color:inherit}.tool-manual-label{display:block;margin-top:8px;color:#70808c;font-size:11px}.check-button:disabled{opacity:.4;cursor:default}
</style>
