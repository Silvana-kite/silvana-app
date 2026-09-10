<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import {
  Bell, Braces, CheckCircle2, LayoutGrid, MonitorCog, RefreshCw,
  Settings, SlidersHorizontal, WifiOff,
} from 'lucide-vue-next';
import GlobalSearch from '../shared/components/GlobalSearch.vue';
import OfficialBrowser from '../shared/components/OfficialBrowser.vue';
import { portals } from './config/portals';
import { useWizardStore } from '../features/environment/stores/wizard';

const store = useWizardStore();
const route = useRoute();
const router = useRouter();
const switcherOpen = ref(false);

const currentPortal = computed(() => portals.find((portal) => route.path.startsWith(portal.route)) ?? portals[0]);

const navigation = [
  { label: '门户', path: '/portals', icon: LayoutGrid, match: (path: string) => path === '/portals' },
  { label: '环境', path: '/environment', icon: MonitorCog, match: (path: string) => path.startsWith('/environment') },
  { label: '消息', path: '/messages', icon: Bell, match: (path: string) => path === '/messages' },
  { label: '设置', path: '/settings', icon: Settings, match: (path: string) => path === '/settings' },
];

const pageTitle = computed(() => String(route.meta.title ?? 'Siilvana'));
const catalogLabel = computed(() => store.syncing
  ? '正在同步'
  : store.online === false
    ? '离线目录'
    : store.online === true ? '目录已更新' : '内置目录');

watch(() => store.motion, (value) => {
  document.documentElement.dataset.motion = value;
}, { immediate: true });

onMounted(() => void store.initialize());
</script>

<template>
  <div class="app-shell">
    <aside class="side-rail" aria-label="全局导航">
      <RouterLink class="brand" to="/portals" aria-label="Siilvana 门户广场">
        <span class="brand__mark"><Braces :size="21" /></span>
        <span class="brand__copy"><strong>Siilvana</strong><small>Workspace</small></span>
      </RouterLink>

      <nav class="side-nav">
        <RouterLink
          v-for="item in navigation"
          :key="item.path"
          :to="item.path"
          :class="['side-nav__item', { 'is-active': item.match(route.path) }]"
          :aria-current="item.match(route.path) ? 'page' : undefined"
          :title="item.label"
        >
          <component :is="item.icon" :size="19" />
          <span>{{ item.label }}</span>
          <b v-if="item.path === '/messages' && store.unreadActivities" class="nav-badge">{{ store.unreadActivities }}</b>
        </RouterLink>
      </nav>

      <div class="side-rail__footer">
        <span :class="['status-dot', { 'is-offline': store.online === false }]" />
        <span>{{ catalogLabel }}</span>
      </div>
    </aside>

    <div class="app-frame">
      <header class="top-bar">
        <div class="mobile-title">
          <small>Siilvana</small>
          <strong>{{ pageTitle }}</strong>
        </div>

        <div class="top-context">
          <span class="top-context__icon"><component :is="currentPortal.icon" :size="17" /></span>
          <span><small>当前门户</small><strong>{{ currentPortal.name }}</strong></span>
        </div>

        <GlobalSearch />

        <div class="top-actions">
          <span :class="['catalog-state', { 'is-offline': store.online === false }]">
            <WifiOff v-if="store.online === false" :size="15" />
            <CheckCircle2 v-else :size="15" />
            {{ catalogLabel }}
          </span>
          <button class="icon-button" type="button" :disabled="store.syncing" title="同步工具目录" @click="store.syncCatalog()">
            <RefreshCw :size="18" :class="{ spin: store.syncing }" />
          </button>
          <RouterLink class="icon-button" to="/settings" title="打开设置"><SlidersHorizontal :size="18" /></RouterLink>
          <div class="portal-switcher portal-switcher--compact">
            <button class="portal-menu-button" type="button" title="切换门户" aria-label="切换门户" :aria-expanded="switcherOpen" @click="switcherOpen = !switcherOpen">
              <LayoutGrid :size="19" />
            </button>
            <div v-if="switcherOpen" class="popover portal-switcher__menu">
              <button
                v-for="portal in portals"
                :key="portal.id"
                type="button"
                class="portal-option"
                @click="switcherOpen = false; router.push(portal.route)"
              >
                <component :is="portal.icon" :size="17" />
                <span><strong>{{ portal.name }}</strong><small>当前可用</small></span>
                <CheckCircle2 :size="16" class="text-success" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main class="app-content">
        <RouterView />
      </main>
    </div>

    <nav class="mobile-tabbar" aria-label="移动端全局导航">
      <RouterLink
        v-for="item in navigation"
        :key="item.path"
        :to="item.path"
        :class="['mobile-tabbar__item', { 'is-active': item.match(route.path) }]"
      >
        <span class="mobile-tabbar__icon">
          <component :is="item.icon" :size="20" />
          <b v-if="item.path === '/messages' && store.unreadActivities" />
        </span>
        <small>{{ item.label }}</small>
      </RouterLink>
    </nav>
  </div>
  <OfficialBrowser />
</template>
