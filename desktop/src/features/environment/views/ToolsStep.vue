<script setup lang="ts">
import { computed } from 'vue';
import { Search, X } from 'lucide-vue-next';
import type { ToolCategory } from '@siilvana/shared';
import ToolCard from '../components/ToolCard.vue';
import { useWizardStore } from '../stores/wizard';
const store = useWizardStore();
const categories = computed(() => ['all', ...new Set(store.catalog.tools.map(tool => tool.category))] as Array<ToolCategory | 'all'>);
const selectedIds = computed(() => new Set(store.plan.selections.map(item => item.toolId)));
</script>

<template>
<section class="setup-section setup-section--wide">
      <header class="page-heading setup-heading"><span class="page-kicker">Step 02 · Toolchain</span><h1>选择开发工具</h1><p>必要依赖会自动补充，每个工具的版本仍可单独调整。</p></header>
      <div class="tool-filters">
        <label class="search-control"><Search :size="17" /><input v-model="store.search" placeholder="搜索工具或用途" aria-label="搜索工具" /><button v-if="store.search" type="button" title="清空搜索" @click="store.search = ''"><X :size="15" /></button></label>
        <div class="category-tabs" role="tablist" aria-label="工具分类">
          <button v-for="item in categories" :key="item" type="button" :class="['category-tab', { 'is-active': store.category === item }]" :aria-selected="store.category === item" role="tab" @click="store.category = item">{{ store.categoryLabels[item] }}</button>
        </div>
      </div>
      <div v-if="store.visibleTools.length" class="tool-grid">
        <ToolCard v-for="tool in store.visibleTools" :key="tool.id" :tool="tool" :platform="store.platform" :architecture="store.architecture" :selected="selectedIds.has(tool.id)" :version-id="store.selected[tool.id]" @toggle="store.toggleTool(tool.id)" @version="store.setVersion(tool.id, $event)" />
      </div>
      <div v-else class="empty-state empty-state--page"><span><Search :size="25" /></span><h2>没有找到工具</h2><p>尝试更换分类或使用更短的关键词。</p></div>
    </section>
</template>
