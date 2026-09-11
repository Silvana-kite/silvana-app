<script setup lang="ts">
import { computed } from 'vue';
import { Search, X } from 'lucide-vue-next';
import type { ToolCategory } from '@siilvana/shared';
import ToolCard from '../components/ToolCard.vue';
import { useWizardStore } from '../stores/wizard';
import { useEnvironmentStore } from '../stores/environment';
import { useInstallerStore } from '../stores/installer';
import InstallationLocations from '../components/InstallationLocations.vue';
const store = useWizardStore();
const environment = useEnvironmentStore();
const installer = useInstallerStore();
const categories = computed(() => ['all', ...new Set(store.sceneTools.map(tool => tool.category))] as Array<ToolCategory | 'all'>);
const selections = computed(() => new Map(store.plan.selections.map(item => [item.toolId, item])));
const automaticCount = computed(() => store.plan.selections.filter(item => item.reason !== 'explicit').length);
const requiredBy = computed(() => {
  const sources: Record<string, string[]> = {};
  for (const item of store.plan.selections) {
    const tool = store.catalog.tools.find(tool => tool.id === item.toolId);
    const version = tool?.versions.find(version => version.id === item.versionId);
    const targets = new Set([
      ...store.catalog.dependencies.filter(rule => rule.sourceToolId === item.toolId && rule.kind === 'requires').map(rule => rule.targetToolId),
      ...(version?.managedByToolId ? [version.managedByToolId] : []),
    ]);
    for (const target of targets) (sources[target] ??= []).push(tool?.name ?? item.toolId);
  }
  return sources;
});
const bundledWith = computed(() => {
  const sources: Record<string, string[]> = {};
  for (const tool of store.catalog.tools) {
    const selectedVersion = selections.value.get(tool.id)?.versionId;
    const versions = selectedVersion ? tool.versions.filter(version => version.id === selectedVersion) : tool.versions;
    for (const target of new Set(versions.flatMap(version => version.bundledTools?.map(item => item.toolId) ?? []))) {
      (sources[target] ??= []).push(tool.name);
    }
  }
  return sources;
});
</script>

<template>
<section class="setup-section setup-section--wide">
      <header class="page-heading setup-heading"><span class="page-kicker">Step 02 · Toolchain</span><h1>选择软件与环境</h1><p>支持自动安装的工具可自由勾选，选择数量不限。标注“需手动安装”的软件请通过官网入口下载。</p></header>
      <div class="tool-selection-guide">
        <strong role="status">已选 {{ store.plan.selections.length }} 项<span v-if="automaticCount">（含 {{ automaticCount }} 项自动依赖）</span> · 数量不限</strong>
        <p>必要依赖会自动加入，并在卡片上说明来源。<template v-if="store.activeScene && !store.showAllTools">当前仅显示所选场景的软件，打开“全部软件”可选择更多工具。</template></p>
      </div>
      <div class="tool-filters">
        <div class="tool-filters__toolbar">
          <label v-if="store.activeScene" class="tool-scope-toggle"><input v-model="store.showAllTools" type="checkbox" /><span>全部软件</span></label>
          <div class="search-control" role="search" aria-label="筛选工具"><Search :size="17" /><input v-model="store.search" placeholder="搜索工具或用途" aria-label="搜索工具" /><button v-if="store.search" type="button" title="清空搜索" @click="store.search = ''"><X :size="15" /></button></div>
        </div>
        <div class="category-tabs" role="tablist" aria-label="工具分类">
          <button v-for="item in categories" :key="item" type="button" :class="['category-tab', { 'is-active': store.category === item }]" :aria-selected="store.category === item" role="tab" @click="store.category = item">{{ store.categoryLabels[item] }}</button>
        </div>
      </div>
      <div v-if="store.visibleTools.length" class="tool-grid">
        <ToolCard v-for="tool in store.visibleTools" :key="tool.id" :tool="tool" :platform="store.platform" :architecture="store.architecture" :selected="selections.has(tool.id)" :version-id="selections.get(tool.id)?.versionId" :required-by="requiredBy[tool.id]" :bundled-with="bundledWith[tool.id]" @toggle="store.toggleTool(tool.id)" @version="store.setVersion(tool.id, $event)" />
      </div>
      <div v-else class="empty-state empty-state--page"><span><Search :size="25" /></span><h2>没有找到工具</h2><p>尝试更换分类或使用更短的关键词。</p></div>
      <InstallationLocations v-if="store.hasInstallationTargets" v-model="store.installationTargets" :catalog="store.catalog" :plan="store.plan" :disks="environment.disks" :disabled="installer.running || installer.busy" />
    </section>
</template>

<style scoped>
.tool-selection-guide{margin-bottom:20px;padding:14px 16px;border:1px solid #dce6f0;border-radius:8px;background:#f0f5fb;color:#345877;font-size:12px;line-height:1.7}.tool-selection-guide strong{font-weight:600}.tool-selection-guide p{margin:5px 0 0;color:#586677}

.tool-filters {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 16px;
  margin-top: 20px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: white;
}
.tool-filters__toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.tool-scope-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  color: var(--text);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.tool-scope-toggle input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
.tool-scope-toggle input:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
.tool-filters .search-control {
  flex: 1 1 320px;
  width: auto;
  min-width: 0;
  max-width: 460px;
  height: 42px;
  margin-left: auto;
  background: #f8f9fb;
}
.tool-filters .search-control > svg,
.tool-filters .search-control button { flex-shrink: 0; }
.tool-filters .search-control input { font-size: 12px; }
.tool-filters .category-tabs {
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 14px 0 0;
  overflow: visible;
  border-top: 1px solid var(--border);
}
.tool-filters .category-tab {
  min-height: 36px;
  padding: 7px 12px;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 550;
  white-space: nowrap;
}
@media (max-width: 540px) {
  .tool-filters { padding: 12px; gap: 12px; }
  .tool-filters__toolbar { flex-wrap: wrap; gap: 8px; }
  .tool-scope-toggle { min-height: 36px; }
  .tool-filters .search-control { flex-basis: 100%; max-width: none; }
  .tool-filters .category-tabs { gap: 5px; padding-top: 12px; }
  .tool-filters .category-tab { min-height: 40px; padding-inline: 10px; }
}
</style>
