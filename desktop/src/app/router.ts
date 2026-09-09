import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import EnvironmentHomeView from '../features/environment/views/EnvironmentHomeView.vue';
import EnvironmentSetupView from '../features/environment/views/EnvironmentSetupView.vue';
import MessagesView from '../features/messages/views/MessagesView.vue';
import PortalSquareView from '../features/portals/views/PortalSquareView.vue';
import SettingsView from '../features/settings/views/SettingsView.vue';

export const setupStepPaths = ['scenario', 'tools', 'review', 'install'] as const;
export type SetupStepPath = typeof setupStepPaths[number];

export const appRoutes: RouteRecordRaw[] = [
    { path: '/', redirect: '/portals' },
    { path: '/portals', name: 'portals', component: PortalSquareView, meta: { title: '环境中心' } },
    { path: '/environment', name: 'environment', component: EnvironmentHomeView, meta: { title: '开发环境' } },
    {
      path: '/environment/setup/:step',
      name: 'environment-setup',
      component: EnvironmentSetupView,
      meta: { title: '环境配置' },
      beforeEnter: (to) => to.params.step === 'export' || setupStepPaths.includes(to.params.step as SetupStepPath)
        ? true
        : { name: 'environment-setup', params: { step: 'scenario' } },
    },
    { path: '/messages', name: 'messages', component: MessagesView, meta: { title: '消息' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: '设置' } },
    { path: '/:pathMatch(.*)*', redirect: '/portals' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: appRoutes,
  scrollBehavior: () => ({ top: 0 }),
});
