<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, Braces, FileStack, LayoutGrid, MonitorCog, Search, Settings, Wrench, X } from 'lucide-vue-next';
import { useWizardStore } from '../../features/environment/stores/wizard';
import { useInstallerStore } from '../../features/environment/stores/installer';

type SearchResult = {
  id: string;
  type: 'page' | 'template' | 'tool';
  title: string;
  detail: string;
  icon: typeof Search;
  action: () => void;
};

const store = useWizardStore();
const installer = useInstallerStore();
const router = useRouter();
const open = ref(false);
const query = ref('');
const activeIndex = ref(0);
const input = ref<HTMLInputElement>();

const pages = [
  { id: 'portals', title: '环境中心', detail: '查看环境流程与当前状态', path: '/portals', icon: LayoutGrid },
  { id: 'environment', title: '开发环境', detail: '查看当前环境方案', path: '/environment', icon: MonitorCog },
  { id: 'settings', title: '设置', detail: '同步与平台偏好', path: '/settings', icon: Settings },
];

const results = computed<SearchResult[]>(() => {
  const term = query.value.trim().toLocaleLowerCase();
  const matches = (value: string) => !term || value.toLocaleLowerCase().includes(term);
  return [
    ...pages.filter((item) => matches(`${item.title} ${item.detail}`)).map((item) => ({
      id: `page-${item.id}`,
      type: 'page' as const,
      title: item.title,
      detail: item.detail,
      icon: item.icon,
      action: () => void router.push(item.path),
    })),
    ...store.catalog.templates.filter((item) => matches(`${item.name} ${item.description}`)).map((item) => ({
      id: `template-${item.id}`,
      type: 'template' as const,
      title: item.name,
      detail: '环境模板',
      icon: FileStack,
      action: () => {
        store.applyTemplate(item.id);
        void router.push('/environment/setup/tools');
      },
    })),
    ...store.catalog.tools.filter((item) => matches(`${item.name} ${item.description}`)).map((item) => ({
      id: `tool-${item.id}`,
      type: 'tool' as const,
      title: item.name,
      detail: item.description,
      icon: Wrench,
      action: () => {
        store.focusTool(item.id);
        void router.push({ path: '/environment/setup/tools', query: { tool: item.id } });
      },
    })),
  ].slice(0, 12);
});

function show() {
  if (installer.running) return;
  open.value = true;
  query.value = '';
  activeIndex.value = 0;
  void nextTick(() => input.value?.focus());
}

function close() {
  open.value = false;
}

function select(result: SearchResult) {
  result.action();
  close();
}

function move(direction: number) {
  if (!results.value.length) return;
  activeIndex.value = (activeIndex.value + direction + results.value.length) % results.value.length;
}

function selectActive() {
  const result = results.value[activeIndex.value];
  if (result) select(result);
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault();
    open.value ? close() : show();
  } else if (event.key === 'Escape' && open.value) close();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <button class="global-search-trigger" type="button" :disabled="installer.running" aria-label="打开全局搜索" @click="show">
    <Search :size="17" />
    <span>搜索工具、模板或设置项</span>
    <kbd>Ctrl K</kbd>
  </button>

  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" role="presentation" @mousedown.self="close">
      <section class="search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索">
        <label class="search-dialog__input">
          <Search :size="19" />
          <input
            ref="input"
            v-model="query"
            placeholder="搜索工具、模板或设置项"
            aria-label="全局搜索"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="selectActive"
          />
          <button class="icon-button is-quiet" type="button" title="关闭搜索" @click="close"><X :size="18" /></button>
        </label>

        <div v-if="results.length" class="search-results" role="listbox">
          <button
            v-for="(result, index) in results"
            :key="result.id"
            type="button"
            :class="['search-result', { 'is-active': index === activeIndex }]"
            role="option"
            :aria-selected="index === activeIndex"
            @mouseenter="activeIndex = index"
            @click="select(result)"
          >
            <span class="search-result__icon"><component :is="result.icon" :size="18" /></span>
            <span><strong>{{ result.title }}</strong><small>{{ result.detail }}</small></span>
            <span class="search-result__type">{{ result.type === 'page' ? '页面' : result.type === 'template' ? '模板' : '工具' }}</span>
            <ArrowRight :size="16" />
          </button>
        </div>
        <div v-else class="search-empty"><Braces :size="24" /><span>没有找到匹配内容</span></div>
      </section>
    </div>
  </Teleport>
</template>
