<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Architecture, Platform, Tool, ToolReleasePage } from '@siilvana/shared';
import { loadReleases } from '../services/release-cache';
import { openOfficialUrl } from '../../../shared/services/official-browser';

const props = defineProps<{ tool: Tool; platform?: Platform; architecture?: Architecture; selectedVersion?: string }>();
const emit = defineEmits<{ close: []; select: [id: string] }>();
const includePrerelease = ref(false);
const search = ref(''); const page = ref(1); const data = ref<ToolReleasePage>(); const loading = ref(false); const error = ref(''); const offline = ref(false);
const dialog = ref<HTMLElement>(); const input = ref<HTMLInputElement>(); let sequence = 0; let timer: ReturnType<typeof setTimeout> | undefined;
const previousFocus = document.activeElement as HTMLElement | null;
const previousOverflow = document.body.style.overflow;
const installable = computed(() => props.tool.versions.filter(v => props.tool.recipes.some(r => r.approved && r.versionId === v.id && (!props.platform || r.platform === props.platform) && (!props.architecture || r.architecture === 'any' || r.architecture === props.architecture))));
const localVersions = computed(() => installable.value.filter(v => v.version.toLowerCase().includes(search.value.toLowerCase())));
const installId = (version: string) => installable.value.find(v => v.version === version)?.id;
const statusText = computed(() => data.value?.quality ? `${({ full: '完整（声明范围内）', partial: '部分历史', 'latest-only': '仅最新版', undisclosed: '来源未公开' })[data.value.quality.coverage]} · ${offline.value ? '本地数据' : '已同步'} · ${{ pending: '等待采集', syncing: '正在采集', ready: '来源正常', failed: '采集失败，保留上次数据', disabled: '来源未启用' }[data.value.quality.sourceStatus]}` : offline.value ? '离线缓存，仅包含此前加载过的查询页' : data.value?.status === 'stale' ? '当前显示最近成功采集的数据' : data.value?.status === 'pending' ? '历史版本尚在采集中' : data.value?.status === 'unavailable' ? '历史版本服务暂不可用' : data.value?.status === 'unsupported' ? '此工具暂未接入历史采集' : '官方历史版本');
async function fetchPage(refresh = false) {
  const request = ++sequence; loading.value = true; error.value = '';
  try {
    const result = await loadReleases(props.tool.id, { q: search.value.trim(), page: page.value, includePrerelease: includePrerelease.value }, refresh);
    if (request === sequence) { data.value = result.data; offline.value = result.offline; }
  } catch (cause) { if (request === sequence) { data.value = undefined; error.value = cause instanceof Error ? cause.message : '加载失败'; } }
  finally { if (request === sequence) loading.value = false; }
}
function choose(id: string) { emit('select', id); emit('close'); }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); emit('close'); }
  if (event.key !== 'Tab') return;
  const nodes = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]') ?? [])];
  const first = nodes[0]; const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
watch([search, includePrerelease], () => { clearTimeout(timer); page.value = 1; data.value = undefined; sequence++; timer = setTimeout(() => void fetchPage(), 250); });
function changePage(next: number) { page.value = next; void fetchPage(); }
onMounted(async () => { document.body.style.overflow = 'hidden'; await nextTick(); input.value?.focus(); void fetchPage(); });
onBeforeUnmount(() => { sequence++; clearTimeout(timer); document.body.style.overflow = previousOverflow; previousFocus?.focus(); });
</script>

<template>
  <Teleport to="body">
    <div class="release-overlay" @click.self="emit('close')">
      <section ref="dialog" class="release-panel" role="dialog" aria-modal="true" :aria-label="`${tool.name} 版本`" @keydown="keydown">
        <header><div><h2>{{ tool.name }} 版本</h2><a :href="tool.downloadUrl ?? tool.homepage" @click.prevent="openOfficialUrl(tool.downloadUrl ?? tool.homepage)">官方软件下载页 ↗</a></div><button type="button" aria-label="关闭版本面板" @click="emit('close')">✕</button></header>
        <input ref="input" v-model="search" :aria-label="`搜索 ${tool.name} 历史版本`" placeholder="搜索版本号，例如 12.22.12" maxlength="80" />
        <label><input v-model="includePrerelease" type="checkbox" style="width:auto;margin:8px" />显示预发布版本</label>
        <p v-if="data?.quality" class="release-notice">{{ data.quality.scope }} ? {{ data.quality.missingReason }}<br />{{ data.notice }}</p>
        <div v-if="localVersions.length" class="release-local"><h3>可加入安装方案</h3><div v-for="version in localVersions" :key="version.id" class="release-row"><span>{{ version.version }} <small v-if="version.recommended">推荐</small></span><button type="button" @click="choose(version.id)">{{ selectedVersion === version.id ? '已选择' : '选择此版本' }}</button></div></div>
        <div v-if="tool.id === 'npm'" class="release-notice">npm 随 Node.js 提供；这里的历史版本用于查询与手动下载。</div>
        <div class="release-status"><span>{{ statusText }}<small v-if="data?.updatedAt"> · 更新于 {{ new Date(data.updatedAt).toLocaleString() }}</small></span><button type="button" :disabled="loading" @click="fetchPage(true)">刷新</button></div>
        <p v-if="loading" role="status">正在读取版本…</p>
        <p v-if="error" role="alert">{{ error }}，仍可使用上方已支持版本或官方入口。</p>
        <div class="release-list" :aria-busy="loading">
          <article v-for="version in data?.items ?? []" :key="`${version.originalVersion}:${version.build}:${version.releaseTrack}`" class="release-row">
            <div><a :href="version.pageUrl" @click.prevent="openOfficialUrl(version.pageUrl)">{{ version.originalVersion }} ↗</a><small v-if="version.build || version.releaseTrack && version.releaseTrack !== 'stable'">{{ version.releaseTrack }} {{ version.build ? `构建 ${version.build}` : '' }}</small><small v-if="version.isPrerelease">预发布</small><small v-if="version.withdrawn">已撤回 · {{ version.withdrawnReason }}</small><small>{{ version.channel === 'eol' ? '已结束支持 · ' : version.channel === 'lts' ? 'LTS · ' : '' }}{{ version.releaseDate?.slice(0, 10) }}</small><small v-if="version.assets.length && platform && !version.assets.some(a => (!a.platform || a.platform === platform) && (!architecture || !a.architecture || a.architecture === 'universal' || a.architecture === architecture))">当前系统不支持</small><small v-if="tool.category === 'runtime' && version.lifecycleKnown === false">生命周期信息未核验</small><small v-if="version.bundledNpm">附带 npm {{ version.bundledNpm }}</small></div>
            <div class="release-actions"><button v-if="!version.withdrawn && !version.isPrerelease && installId(version.version)" type="button" @click="choose(installId(version.version)!)">选择此版本</button><span v-else class="release-manual">仅官方下载</span><a :href="version.pageUrl" @click.prevent="openOfficialUrl(version.pageUrl)">{{ version.assets.length ? '官方发布 / 下载页' : '官方发布记录' }} ↗</a>
              <small v-if="version.assets.some(a => a.downloadStatus === 'unavailable')">部分下载资源已失效或来源尚未核验，发布记录仍保留。</small><details v-if="version.assets.length"><summary>下载资源（{{ version.assets.length }}）</summary><a v-for="file in version.assets.filter(a => a.downloadStatus !== 'unavailable')" :key="file.url" :href="file.url" @click.prevent="openOfficialUrl(file.url, file.sha256)">{{ file.kind === 'source' ? '源码 / 包归档' : '安装资源' }} · {{ file.name }}{{ file.platform && platform && file.platform !== platform ? ` · ${file.platform}（其他系统）` : '' }}{{ file.architecture && architecture && !['universal',architecture].includes(file.architecture) ? ` · ${file.architecture}（其他处理器）` : '' }} ↗</a></details>
            </div>
          </article>
          <p v-if="!loading && data && !data.items.length">{{ search ? '没有找到匹配版本' : '暂时没有可用的历史数据' }}</p>
        </div>
        <p class="release-notice">历史版本可能不再受支持。仅官方入口不表示安装包已由本应用验证。</p>
        <footer><span>{{ data && ['ready','stale'].includes(data.status) ? `共 ${data.total} 个匹配版本` : '历史数量暂不可用' }} · 第 {{ page }} 页</span><div><button type="button" :disabled="loading || page === 1" @click="changePage(page - 1)">上一页</button><button type="button" :disabled="loading || !data || page * data.pageSize >= data.total" @click="changePage(page + 1)">下一页</button></div></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.release-overlay{position:fixed;inset:0;z-index:200;background:#14243966;display:grid;place-items:center;padding:24px}.release-panel{width:min(760px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:24px;color:#243047;box-shadow:0 24px 80px #0e223a33}.release-panel header,.release-panel footer,.release-row,.release-status{display:flex;justify-content:space-between;gap:16px;align-items:center}.release-panel h2{margin:0 0 8px;font-size:20px}.release-panel h3{font-size:13px}.release-panel a{color:#167a79;text-decoration:none;overflow-wrap:anywhere}.release-panel button{cursor:pointer;padding:7px 12px;border:1px solid #d7e1e7;border-radius:7px;background:#fff;color:#244957}.release-panel button:disabled{opacity:.45;cursor:default}.release-panel input{width:100%;box-sizing:border-box;margin:20px 0 8px;padding:12px;border:1px solid #c7d7de;border-radius:8px}.release-row{padding:13px 0;border-bottom:1px solid #edf1f4;align-items:flex-start}.release-row small{display:block;color:#6b7788;font-size:11px;margin-top:5px}.release-status,.release-notice{font-size:12px;color:#64748b;padding:12px 0}.release-actions{display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-size:12px;max-width:60%}.release-manual{color:#758295}.release-actions details{text-align:right}.release-actions details a{display:block;margin:10px 0}.release-panel footer{margin-top:20px;font-size:12px}.release-panel footer button{margin-left:8px}.release-panel :focus-visible{outline:2px solid #168b88;outline-offset:3px}@media(max-width:600px){.release-overlay{padding:8px}.release-panel{padding:16px;max-height:96vh}.release-row{gap:10px}}
</style>
