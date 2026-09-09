<script setup lang="ts">
import { computed } from 'vue';
import { Check, CheckCheck, Clock3, Database, Download, FileStack, Inbox } from 'lucide-vue-next';
import { useWizardStore } from '../../environment/stores/wizard';

const store = useWizardStore();
const sortedActivities = computed(() => [...store.activities].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
const icons = { 'catalog-sync': Database, 'template-applied': FileStack, 'script-exported': Download, 'environment-scan': CheckCheck } as const;

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
</script>

<template>
  <div class="page-container narrow-page">
    <header class="page-heading page-heading--with-action">
      <div><span class="page-kicker">Activity center</span><h1>消息</h1><p>目录同步、模板应用和脚本导出的本地活动记录。</p></div>
      <button v-if="store.unreadActivities" class="secondary-button" type="button" @click="store.markAllActivitiesRead"><CheckCheck :size="17" />全部已读</button>
    </header>

    <section v-if="sortedActivities.length" class="activity-feed">
      <button
        v-for="item in sortedActivities"
        :key="item.id"
        type="button"
        :class="['activity-feed__item', { 'is-unread': !item.read }]"
        @click="store.markActivityRead(item.id)"
      >
        <span :class="['activity-icon is-large', `is-${item.status}`]"><component :is="icons[item.kind]" :size="19" /></span>
        <span class="activity-feed__copy"><strong>{{ item.title }}</strong><small>{{ item.detail }}</small><time><Clock3 :size="13" />{{ formatTime(item.createdAt) }}</time></span>
        <span v-if="!item.read" class="unread-dot" aria-label="未读" />
        <Check v-else :size="17" class="read-check" aria-label="已读" />
      </button>
    </section>
    <section v-else class="empty-state empty-state--page"><span><Inbox :size="28" /></span><h2>消息中心是空的</h2><p>这里仅记录你在本设备上的真实操作，不会展示模拟通知。</p></section>
  </div>
</template>
