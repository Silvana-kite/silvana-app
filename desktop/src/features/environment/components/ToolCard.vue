<script setup lang="ts">
import { latestDownload } from '@siilvana/catalog';
import { computed, ref, type Component } from 'vue';
import {
  Boxes, Braces, Check, ChevronDown, Code2, Coffee, Container, Database,
  Gauge, GitBranch, Layers3, Package, TerminalSquare, Wrench,
} from 'lucide-vue-next';
import { platformVersion, type Architecture, type Platform, type Tool } from '@siilvana/shared';
import IconTile from '../../../shared/components/IconTile.vue';
import VersionPanel from './VersionPanel.vue';
import { openOfficialUrl } from '../../../shared/services/official-browser';

const props = defineProps<{ tool: Tool; selected: boolean; versionId?: string; platform?: Platform; architecture?: Architecture; requiredBy?: string[]; bundledWith?: string[] }>();
defineEmits<{ toggle: []; version: [versionId: string] }>();

const icons: Record<string, Component> = {
  gauge: Gauge, braces: Braces, package: Package, boxes: Boxes, 'git-branch': GitBranch,
  'code-2': Code2, coffee: Coffee, 'layers-3': Layers3, 'terminal-square': TerminalSquare,
  database: Database, container: Container,
};
const tones = {
  runtime: 'cyan', 'package-manager': 'violet', framework: 'blue', database: 'blue',
  editor: 'rose', cli: 'amber', container: 'cyan', browser: 'blue', terminal: 'amber', 'api-client': 'violet', office: 'blue', pdf: 'rose', utility: 'amber', communication: 'cyan',
} as const;
const displayedVersion = computed(() => props.versionId ?? (props.platform && props.architecture ? platformVersion(props.tool, props.platform, props.architecture)?.id : props.tool.versions.find((version) => version.recommended)?.id ?? props.tool.versions[0]?.id));
const versions = computed(() => props.tool.versions.filter(version => !props.platform || !props.tool.recipes.length || version.id === props.versionId || props.tool.recipes.some(recipe => recipe.versionId === version.id && recipe.platform === props.platform && (recipe.architecture === 'any' || recipe.architecture === props.architecture))));
const latest = computed(() => latestDownload(props.tool, props.platform ?? 'windows', props.architecture ?? 'x64'));
const panelOpen = ref(false);
const canInstall = computed(() => props.tool.recipes.some(r => r.approved && (!props.platform || r.platform === props.platform) && (!props.architecture || r.architecture === 'any' || r.architecture === props.architecture)));
const currentVersion = computed(() => versions.value.find(v => v.id === displayedVersion.value));
const versionLabel = computed(() => currentVersion.value?.label ?? currentVersion.value?.version ?? '查看历史版本');
const dependency = computed(() => props.selected && !!props.requiredBy?.length);
const bundled = computed(() => !!props.bundledWith?.length);
const otherPlatform = computed(() => props.platform && props.tool.supportedPlatforms && !props.tool.supportedPlatforms.includes(props.platform));
const statusLabel = computed(() => dependency.value ? '必要依赖' : bundled.value ? '随主工具提供' : canInstall.value ? '可自动安装' : otherPlatform.value ? '适用于其他系统' : '需手动安装');
const statusNote = computed(() => dependency.value
  ? `${props.requiredBy!.join('、')} 需要此工具；如需移除，请先取消相关工具。`
  : bundled.value ? `随 ${props.bundledWith!.join('、')} 提供，无需单独勾选。`
  : otherPlatform.value ? '当前系统不适用，可前往官网查看支持的系统。'
  : canInstall.value ? '勾选后加入自动安装方案。'
  : '当前系统与架构暂无自动安装支持，请前往官网手动安装。');
</script>

<template>
  <article :class="['tool-card', { 'is-selected': selected }]">
    <div class="tool-card__body">
      <div class="tool-card__top">
        <IconTile :icon="icons[tool.icon] ?? Wrench" :tone="tones[tool.category]" />
        <span v-if="dependency || bundled || (!canInstall && !selected)" class="tool-status" :class="{ 'tool-status--dependency': dependency || bundled }">{{ statusLabel }}</span>
        <button
          v-else
          type="button"
          :class="['check-button', { 'is-selected': selected }]"
          :aria-label="`${selected ? '取消选择' : '选择'} ${tool.name}`"
          :aria-pressed="selected"
          @click="$emit('toggle')"
        >
          <Check :size="15" :stroke-width="2.5" />
        </button>
      </div>

      <h2><a :href="tool.downloadUrl ?? tool.homepage" @click.prevent="openOfficialUrl(tool.downloadUrl ?? tool.homepage)">{{ tool.name }} <small>↗</small></a></h2>
      <p>{{ tool.description }}</p>
      <small class="tool-status-note">{{ statusNote }}</small>
      <small v-if="tool.id === 'node'" class="tool-status-note">{{ currentVersion?.managedByToolId === 'volta' ? '当前版本通过 Volta 管理；切换到“独立安装”版本即可取消此依赖。' : '独立安装 Node.js 与 npm，无需选择版本管理器。' }}</small>
      <small v-if="selected && !canInstall && !dependency && !bundled" class="tool-status-note">此前选择已不适用于当前目标，请取消选择。</small>

      <div v-if="tool.historyPolicy !== 'latest-only'" class="tool-card__version">
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
      <button v-if="!canInstall && !bundled" class="tool-download-button" type="button" :aria-label="`${tool.name} ${otherPlatform ? '查看官网' : '前往官网下载'}`" :title="latest.note" @click="openOfficialUrl(latest.url)">{{ otherPlatform ? '查看官网' : tool.historyPolicy === 'latest-only' ? '官网下载最新版' : '前往官网下载' }} ↗</button>
    </div>
  </article>
  <VersionPanel v-if="panelOpen" :tool="tool" :platform="platform" :architecture="architecture" :selected-version="versionId" @close="panelOpen = false" @select="$emit('version', $event)" />
</template>

<style scoped>
.tool-card h2 a{color:inherit;text-decoration:none}.tool-card h2 small{font-size:12px;color:#799098}.tool-version-trigger{border:0;background:transparent;width:100%;text-align:left;font:inherit;padding:10px 30px 10px 10px;cursor:pointer;color:inherit}
.tool-status{padding:5px 8px;border-radius:6px;background:#f1f3f6;color:#586677;font-size:11px;line-height:1.5}.tool-status--dependency{background:#e8f1fc;color:#34668f}.tool-status-note{display:block;margin-top:10px;color:#586677;font-size:11px;line-height:1.7}.tool-download-button{margin-top:12px;padding:9px 12px;border:1px solid #c9d7e5;border-radius:6px;background:#f6f9fd;color:#285b88;text-align:left;font:inherit;font-size:12px;cursor:pointer}.tool-download-button:hover{background:#eaf2fc}.tool-download-button:focus-visible{outline:2px solid #168b88;outline-offset:3px}
</style>
