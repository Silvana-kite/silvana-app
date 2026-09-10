<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { officialBrowser as browser } from '../services/official-browser';

const surface = ref<HTMLElement>(); const status = ref(''); const error = ref(''); const downloads = ref<string[]>([]);
const route = useRoute(); let resize: ResizeObserver | undefined; let unlisten: UnlistenFn | undefined; let generation = 0; let previousFocus: HTMLElement | null = null;
let loadTimer: ReturnType<typeof setTimeout> | undefined;
function loading() {
  clearTimeout(loadTimer); error.value = ''; status.value = '正在加载官网…';
  loadTimer = setTimeout(() => { if (browser.open) { error.value = '网页加载超时，可重试或复制地址'; status.value = '加载超时'; } }, 30000);
}
function bounds() { const rect = surface.value!.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }
async function resizeSurface() { if (browser.open && surface.value) await invoke('browser_resize', { bounds: bounds() }).catch(() => undefined); }
async function show() {
  const turn = ++generation; loading();
  await nextTick();
  if (turn !== generation || !browser.open || !surface.value) return;
  try {
    if (!unlisten) unlisten = await listen<{ kind: string; value: string }>('official-browser', ({ payload }) => {
      if (payload.kind === 'url') browser.location = payload.value;
      if (payload.kind === 'title') browser.title = payload.value;
      if (payload.kind === 'loading') loading();
      if (payload.kind === 'loaded') { clearTimeout(loadTimer); error.value = ''; status.value = '官网页面'; }
      if (payload.kind === 'error') { clearTimeout(loadTimer); error.value = payload.value; status.value = '无法打开'; }
      if (payload.kind === 'download') { clearTimeout(loadTimer); error.value = ''; status.value = '文件下载'; downloads.value.unshift(payload.value); downloads.value = downloads.value.slice(0, 5); }
    });
    if (turn !== generation || !browser.open) return;
    await invoke('browser_open', { url: browser.requestedUrl, bounds: bounds() });
    resize?.disconnect(); resize = new ResizeObserver(() => void resizeSurface()); resize.observe(surface.value!);
  } catch (cause) { clearTimeout(loadTimer); error.value = String(cause); status.value = '加载失败'; }
}
async function close() {
  generation++; clearTimeout(loadTimer); browser.open = false; resize?.disconnect();
  await invoke('browser_hide').catch(() => undefined); previousFocus?.focus(); previousFocus = null;
}
async function action(action: 'back' | 'forward' | 'reload') { error.value = ''; await invoke('browser_action', { action }).catch(cause => { error.value = String(cause); }); }
watch(() => browser.serial, () => { if (!previousFocus || !browser.open) previousFocus = document.activeElement as HTMLElement; void show(); });
watch(() => route.fullPath, () => { if (browser.open) void close(); });
onBeforeUnmount(() => { generation++; clearTimeout(loadTimer); resize?.disconnect(); unlisten?.(); if (browser.open) void invoke('browser_hide').catch(() => undefined); });
</script>

<template>
  <Teleport to="body">
    <section v-if="browser.open" class="official-browser" role="dialog" aria-modal="true" aria-label="应用内官方网站浏览器">
      <header class="official-browser__toolbar">
        <button type="button" aria-label="网页后退" @click="action('back')">←</button>
        <button type="button" aria-label="网页前进" @click="action('forward')">→</button>
        <button type="button" aria-label="刷新网页" @click="action('reload')">↻</button>
        <div class="official-browser__address"><strong>{{ browser.title }}</strong><input readonly :value="browser.location" aria-label="当前网页地址" /></div>
        <button type="button" aria-label="关闭内置浏览器" @click="close">关闭 ✕</button>
      </header>
      <div class="official-browser__status" role="status">{{ error || status }}<button v-if="error" type="button" @click="show">重试</button></div>
      <div v-if="downloads.length" class="official-browser__downloads"><div v-for="(download, index) in downloads" :key="index">{{ download }}</div></div>
      <div ref="surface" class="official-browser__surface"><p v-if="error">网页未能加载。可在应用内重试，或复制上方地址。</p></div>
    </section>
  </Teleport>
</template>

<style scoped>
.official-browser{position:fixed;inset:12px;z-index:1000;display:flex;flex-direction:column;background:white;border:1px solid #d5e1e8;border-radius:12px;box-shadow:0 20px 100px #10283c55;overflow:hidden}.official-browser__toolbar{display:flex;align-items:center;gap:8px;padding:12px;background:#f4f8fa}.official-browser button{padding:8px 12px;border:1px solid #d8e1e7;border-radius:6px;background:white;color:#234455;cursor:pointer}.official-browser__address{flex:1;min-width:0}.official-browser__address strong{font-size:12px;display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.official-browser__address input{width:100%;box-sizing:border-box;border:0;background:transparent;color:#667685;font-size:12px;padding:4px 0}.official-browser__status{padding:7px 14px;border-bottom:1px solid #e7edf2;font-size:12px;color:#677889}.official-browser__downloads{max-height:100px;overflow:auto;font-size:12px;padding:6px 14px;background:#eef8f4;color:#245d4f;overflow-wrap:anywhere}.official-browser__surface{flex:1;min-height:100px}.official-browser__surface p{padding:24px;color:#758494}
</style>
