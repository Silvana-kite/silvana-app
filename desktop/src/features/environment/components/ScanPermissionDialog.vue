<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { HardDrive, ShieldCheck, X } from 'lucide-vue-next';
import { isDesktop } from '../services/device';
const emit = defineEmits<{ allow: []; deny: [] }>();
const dialog = ref<HTMLDialogElement>();
const previous = document.activeElement as HTMLElement | null;
onMounted(async () => { await nextTick(); dialog.value?.showModal(); });
onBeforeUnmount(() => { dialog.value?.close(); previous?.focus(); });
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="scan-permission" aria-labelledby="scan-permission-title" aria-describedby="scan-permission-copy" @cancel.prevent="emit('deny')">
    <button class="icon-button is-quiet permission-close" title="关闭" aria-label="关闭" @click="emit('deny')"><X :size="18" /></button>
    <span class="permission-icon"><HardDrive :size="28" :stroke-width="1.5" /></span>
    <h2 id="scan-permission-title">允许检查本地磁盘空间？</h2>
    <p id="scan-permission-copy">Siilvana 将查询所有已挂载本地磁盘（含外接盘）的总容量与可用空间，并检查系统盘和用户目录所在盘是否有足够的安装空间。</p>
    <div class="permission-note"><ShieldCheck :size="18" /><span>仅查询容量，不读取文件内容。授权仅在本次页面会话内有效。</span></div>
    <p v-if="!isDesktop()" class="permission-web">当前为浏览器模式，无法读取本地磁盘。你仍可查看软件匹配结果或进入手动配置。</p>
    <footer><button class="secondary-button" autofocus @click="emit('deny')">暂不允许</button><button class="primary-button" @click="emit('allow')">允许并扫描</button></footer>
  </dialog></Teleport>
</template>
<style scoped>
.scan-permission { margin: auto; }
.scan-permission { width: min(460px, calc(100% - 32px)); max-height: calc(100dvh - 48px); overflow-y: auto; padding: 32px; border: 1px solid #fff; border-radius: 8px; color: #20272a; background: #fdfefef5; backdrop-filter: blur(24px); box-shadow: 0 30px 100px #173a3b26; }.scan-permission::backdrop { background: #25393a30; backdrop-filter: blur(7px); }.permission-close { position: absolute; right: 10px; top: 10px; }.permission-icon { display: grid; place-items: center; width: 58px; height: 58px; border: 1px solid #d4e8e2; border-radius: 8px; color: #168674; background: #edf7f3; }h2 { margin: 22px 0 12px; font-size: 22px; line-height: 1.4; }p { color: #677274; font-size: 13px; line-height: 1.8; }.permission-note { display: flex; align-items: start; gap: 9px; margin-top: 22px; color: #387a69; font-size: 12px; line-height: 1.7; }.permission-note svg { flex-shrink: 0; margin-top: 2px; }.permission-web { padding-top: 12px; border-top: 1px solid #e3e9e7; }footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 26px; }footer button { min-height: 42px; }
</style>
