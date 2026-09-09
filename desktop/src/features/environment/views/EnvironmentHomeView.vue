<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowDown, ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, Cpu, HardDrive, Info, Layers3, Package, Radar, RefreshCw, ShieldCheck, SlidersHorizontal, TriangleAlert } from 'lucide-vue-next';
import ScanScene from '../components/ScanScene.vue';
import ScanPermissionDialog from '../components/ScanPermissionDialog.vue';
import DiskList from '../components/DiskList.vue';
import DiskOverview from '../components/DiskOverview.vue';
import InstallationLocations from '../components/InstallationLocations.vue';
import { driveId, effectiveTargets } from '../services/installation-locations';
import { useEnvironmentStore } from '../stores/environment';
import { useWizardStore } from '../stores/wizard';
import { gib, isDesktop } from '../services/device';
import type { Architecture } from '@siilvana/shared';
import '../styles/environment.css';

const environment = useEnvironmentStore();
const wizard = useWizardStore();
const router = useRouter();
const results = ref<HTMLElement>();
const cleanupOpen = ref(false);
const tabs: Architecture[] = ['arm64', 'x64'];
const recent = computed(() => wizard.activities.filter((item) => item.kind === 'environment-scan').slice(0, 5));
const scanning = computed(() => environment.status === 'scanning');
const ready = computed(() => environment.validScan);
const conflicts = computed(() => environment.plan.diagnostics.filter((item) => item.severity !== 'info'));
const unavailable = computed(() => Object.entries(environment.candidate)
  .filter(([id]) => !environment.matched.some((item) => item.tool.id === id))
  .map(([id, versionId]) => ({ id, versionId, name: wizard.catalog.tools.find((item) => item.id === id)?.name ?? id })));
const capacityBudgets = computed(() => Object.fromEntries(environment.disks.map(disk => [disk.id,
  environment.choosingDisks ? environment.diskBudgets[driveId(disk.id) ?? ''] ?? 0 : disk.installationTarget !== false ? environment.budget : 0,
])));
const installationDiskIds = computed(() => environment.choosingDisks
  ? Object.values(effectiveTargets(wizard.catalog, environment.plan, environment.installationTargets))
  : environment.installDisks.map(disk => disk.id));
const insufficientDisks = computed(() => environment.disks.filter(disk => disk.availableBytes < (capacityBudgets.value[disk.id] ?? 0)));
const spaceWarning = computed(() => insufficientDisks.value.map(disk => `${disk.id} 还需释放 ${gib(capacityBudgets.value[disk.id]! - disk.availableBytes)}`).join('；'));
const diskStatus = computed(() => scanning.value ? '正在检查本地磁盘' : ready.value ? environment.targetErrors.length ? '安装磁盘待选择' : environment.enoughSpace ? '安装相关磁盘空间充足' : '安装相关磁盘空间不足'
  : environment.status === 'denied' ? '未授予磁盘权限' : environment.status === 'unsupported' ? '浏览器无法读取磁盘'
    : environment.status === 'error' ? '磁盘读取失败' : '等待磁盘授权');
const platformName = computed(() => ({ windows: 'Windows', macos: 'macOS', linux: 'Linux' })[environment.targetPlatform]);
const cleanup = computed(() => environment.device.platform === 'windows'
  ? '打开 Windows 设置 → 系统 → 存储 → 临时文件，检查并移除不需要的文件。也可卸载不常用的软件。'
  : environment.device.platform === 'macos' ? '打开系统设置 → 通用 → 储存空间，检查大型文件、下载内容和不再使用的应用。'
    : '打开系统的磁盘使用分析器，检查下载目录和不再使用的软件包，确认内容后手动释放空间。');
function viewResults() { results.value?.scrollIntoView({ behavior: wizard.motion === 'reduced' ? 'auto' : 'smooth', block: 'start' }); }
function next() { if (environment.commit()) void router.push('/environment/setup/tools'); }
function manual() { wizard.setValidationMode('manual'); wizard.platform = environment.targetPlatform; wizard.architecture = environment.targetArchitecture; void router.push('/environment/setup/scenario'); }
function time(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
onMounted(() => void environment.initialize());
onBeforeUnmount(() => { if (environment.status === 'permission') environment.deny(); });
</script>

<template>
  <div class="adapt-home">
    <header class="adapt-heading"><span><span class="adapt-dot" /> SYSTEM INTELLIGENCE</span><span>环境适配中心 <span class="adapt-divider">/</span> 概览</span></header>
    <section class="adapt-hero">
      <div class="adapt-hero__copy">
        <div class="adapt-eyebrow"><Cpu :size="14" /> 为你的设备，找到合适的软件</div>
        <h1>智能识别系统架构<br /><span>与软件适配</span></h1>
        <p v-if="!environment.detected">正在识别设备系统与处理器架构。开始扫描前，我们将请求查询本地磁盘空间的权限。</p>
        <p v-else-if="environment.consent">已记住本设备的磁盘扫描授权。进入时自动检查磁盘空间，也可随时重新扫描。</p>
        <p v-else>已完成设备识别，{{ environment.device.architecture ? environment.device.architecture.toUpperCase() + ' 架构' : '处理器架构待确认' }}。允许查询本地磁盘空间后，即可检查软件适配与安装所需容量。</p>
        <div class="adapt-hero__actions"><button class="primary-button" :disabled="!environment.detected || scanning" @click="environment.requestScan"><Radar :size="18" :class="{ spin: scanning }" />{{ scanning ? '正在智能扫描' : environment.consent ? '重新扫描' : '开始智能扫描' }}</button><button class="secondary-button" :disabled="!environment.detected" @click="viewResults">查看匹配结果<ArrowDown :size="16" /></button></div>
        <span class="adapt-privacy"><ShieldCheck :size="13" /> 本地检测 · 仅查询容量 · 文件内容不被读取</span>
      </div>
      <div class="adapt-hero__visual">
        <ScanScene :scanning="scanning" />
        <div class="adapt-glass adapt-glass--architecture"><span class="adapt-glass__icon"><Cpu :size="17" /></span><span><small>处理器架构</small><strong>{{ environment.device.architecture ? '已识别：' + environment.device.architecture.toUpperCase() : environment.detected ? '架构待确认' : '正在识别设备' }}</strong></span><CheckCircle2 v-if="environment.device.architecture" :size="14" /></div>
        <div class="adapt-glass adapt-glass--disk"><span class="adapt-glass__icon"><HardDrive :size="17" /></span><span><small>本地存储</small><strong>{{ diskStatus }}</strong></span><span :class="['adapt-dot', { 'is-muted': !ready && !scanning }]" /></div>
        <div class="adapt-visual-caption"><span /> DEVICE SCAN ENGINE <span /></div>
      </div>
    </section>

    <section class="adapt-metrics" :class="{ 'has-disks': ready && environment.disks.length > 0 }" aria-label="设备与适配状态" aria-live="polite">
      <article class="adapt-metric"><div class="adapt-metric__label"><span><Cpu :size="17" />当前系统架构</span><span class="adapt-index">01</span></div><strong class="adapt-metric__value adapt-metric__cpu">{{ environment.device.cpuName || (environment.device.architecture ? environment.device.architecture.toUpperCase() + ' 处理器' : '架构待确认') }}</strong><small><span class="adapt-dot" :class="{ 'is-muted': !environment.device.architecture }" />{{ environment.device.platform || '系统待确认' }} · {{ environment.device.architecture?.toUpperCase() || '未识别' }}</small></article>
      <article class="adapt-metric"><div class="adapt-metric__label"><span><Package :size="17" />智能适配软件</span><span class="adapt-index">02</span></div><strong class="adapt-metric__value">{{ environment.detected ? environment.matched.length.toString().padStart(2, '0') : '--' }}<span>款已匹配</span></strong><small>{{ platformName }} / {{ environment.targetArchitecture.toUpperCase() }}<span class="adapt-tag">{{ environment.device.architecture ? '目录匹配' : '目标预览' }}</span></small></article>
      <article class="adapt-metric"><div class="adapt-metric__label"><span><ShieldCheck :size="17" />系统兼容性检查</span><span class="adapt-index">03</span></div><strong class="adapt-metric__value is-status" :class="{ 'is-warning': ready && conflicts.length }"><CheckCircle2 v-if="ready && !conflicts.length" :size="23" />{{ !ready ? '等待扫描' : conflicts.length ? conflicts.length + ' 项需留意' : '无冲突' }}</strong><small>{{ ready ? '当前软件方案的依赖与版本检查' : '扫描后确认当前方案兼容性' }}</small></article>
      <DiskOverview :disks="environment.disks" :budgets="capacityBudgets" :installation-disk-ids="installationDiskIds" :ready="ready" :status-text="diskStatus" />
    </section>

    <DiskList v-if="ready" :disks="environment.disks" :budget="environment.budget" :budgets="environment.choosingDisks ? environment.diskBudgets : undefined" />
    <InstallationLocations v-if="ready && environment.choosingDisks" v-model="environment.installationTargets" :catalog="wizard.catalog" :plan="environment.plan" :disks="environment.disks" :disabled="scanning" />
    <div v-if="environment.error || environment.status === 'unsupported' || environment.status === 'denied'" class="adapt-notice" role="status"><Info :size="17" /><span>{{ environment.error || (environment.status === 'unsupported' ? '当前浏览器无法读取本地磁盘空间。请在桌面端扫描，或使用手动配置。' : '尚未授予磁盘权限。你可以再次扫描，或使用手动配置。') }}</span><button class="text-button" @click="environment.requestScan">重新扫描<RefreshCw :size="14" /></button></div>
    <div v-if="ready && insufficientDisks.length" class="adapt-notice is-danger" role="alert"><TriangleAlert :size="18" /><span>{{ spaceWarning }}，才能继续当前方案。</span><button class="text-button" @click="cleanupOpen = !cleanupOpen">释放空间<ArrowRight :size="14" /></button></div>
    <div v-if="cleanupOpen" class="adapt-cleanup"><strong>释放空间</strong><p>{{ cleanup }}</p><p>请先确认文件用途，并保留重要数据的备份。完成后重新扫描。</p><button class="secondary-button" @click="environment.requestScan"><RefreshCw :size="15" />重新检测</button></div>

    <div class="adapt-bottom">
      <section ref="results" class="adapt-recommendations">
        <div class="adapt-section-heading"><div><span class="adapt-section-kicker">SOFTWARE MATCH</span><h2>推荐的软件适配</h2></div><label class="adapt-platform"><select v-model="environment.targetPlatform" :disabled="scanning" aria-label="目标系统"><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Linux</option></select><ChevronDown :size="14" /></label></div>
        <div class="adapt-list-toolbar"><div class="adapt-tabs" role="tablist" aria-label="目标处理器架构"><button v-for="tab in tabs" :key="tab" role="tab" :aria-selected="environment.targetArchitecture === tab" :disabled="scanning" :class="{ 'is-active': environment.targetArchitecture === tab }" @click="environment.targetArchitecture = tab"><Cpu :size="14" />{{ tab === 'arm64' ? 'ARM64' : 'Intel / AMD x64' }}<span>{{ environment.matches(tab).length }}</span></button></div><span class="adapt-native-label">{{ environment.nativeTarget ? '当前设备' : '目标预览' }}</span></div>
        <div class="adapt-software-list">
          <label v-for="item in unavailable" :key="item.id" class="adapt-software-row"><span class="adapt-software-icon"><TriangleAlert :size="20" /></span><span class="adapt-software-copy"><strong>{{ item.name }}</strong><small>当前目标暂无可用安装方式，取消选择后可继续检查。</small></span><span class="adapt-software-meta">不支持</span><input type="checkbox" checked :disabled="scanning" :aria-label="'移除不支持的 ' + item.name" @change="environment.toggle(item.id, item.versionId)" /></label>
          <label v-for="item in environment.matched" :key="item.tool.id" class="adapt-software-row"><span :class="['adapt-software-icon', 'tool-' + item.tool.id]"><component :is="item.tool.category === 'runtime' ? Cpu : item.tool.category === 'package-manager' ? Package : item.tool.category === 'editor' ? SlidersHorizontal : Layers3" :size="21" :stroke-width="1.6" /></span><span class="adapt-software-copy"><strong>{{ item.tool.name }}<span>{{ item.version.version }}</span></strong><small>{{ item.tool.description }}</small></span><span class="adapt-software-meta"><span>{{ item.universal ? '通用架构' : environment.targetArchitecture.toUpperCase() + ' 原生' }}</span><small>{{ item.tool.diskMb }} MiB</small></span><input type="checkbox" :aria-label="'选择 ' + item.tool.name" :checked="!!environment.candidate[item.tool.id]" :disabled="scanning" @change="environment.toggle(item.tool.id, item.version.id)" /></label>
          <div v-if="!environment.matched.length" class="adapt-empty"><Package :size="26" /><strong>暂无匹配软件</strong><span>该系统与架构尚无可用的安装配方。</span></div>
        </div>
        <div v-if="ready && conflicts.length" class="adapt-conflicts"><p v-for="item in conflicts" :key="item.code + item.toolIds.join()"><TriangleAlert :size="14" />{{ item.message }}</p></div>
        <footer class="adapt-selection"><div><strong>已选 {{ environment.plan.selections.length }} 项<span>含必要依赖</span></strong><small>预计 {{ gib(environment.plan.estimatedDiskMb * 1024 ** 2) }} · 建议预留 {{ gib(environment.budget) }}</small></div><button class="primary-button" :disabled="!environment.canContinue" @click="next">下一步<ArrowRight :size="16" /></button></footer>
        <p v-if="!environment.nativeTarget" class="adapt-target-note">当前为目标架构预览；智能校验需要与本机架构一致。</p>
      </section>
      <aside class="adapt-history">
        <div class="adapt-section-heading"><div><span class="adapt-section-kicker">RECENT ACTIVITY</span><h2>最近的扫描记录</h2></div><button class="icon-button is-quiet" title="查看全部记录" @click="router.push('/messages')"><ArrowRight :size="17" /></button></div>
        <div v-if="recent.length" class="adapt-timeline"><article v-for="item in recent" :key="item.id"><span :class="['adapt-timeline-icon', { 'is-error': item.status === 'error' }]"><Check v-if="item.status === 'success'" :size="14" /><TriangleAlert v-else :size="14" /></span><div><time>{{ time(item.createdAt) }}</time><strong>{{ item.title }}</strong><p>{{ item.detail }}</p></div></article></div>
        <div v-else class="adapt-history-empty"><span><Clock3 :size="25" :stroke-width="1.4" /></span><strong>等待第一次扫描</strong><p>完成设备扫描后，结果将保存在这里。</p></div>
        <div class="adapt-storage-note"><HardDrive :size="18" /><strong>{{ ready ? '本地容量快照' : '设备空间，心中有数' }}</strong><p v-if="ready">已检查 {{ environment.disks.length }} 个磁盘<br />各盘容量与用途见上方概览<br />{{ time(environment.checkedAt) }}</p><p v-else>安装前检查磁盘容量，为软件和依赖预留足够空间。</p><small>容量预算包含 20% 缓存余量与 2 GiB 预留空间。</small></div>
        <button class="adapt-manual" @click="manual"><span><SlidersHorizontal :size="16" />手动配置<small>{{ isDesktop() ? '自行选择环境方案' : '浏览器模式 · 空间未验证' }}</small></span><ArrowRight :size="16" /></button>
      </aside>
    </div>
    <footer class="adapt-footer"><span><ShieldCheck :size="13" /> Siilvana · 本地优先</span><span>目录 {{ wizard.catalog.revision }}</span></footer>
    <ScanPermissionDialog v-if="environment.status === 'permission'" @allow="environment.scan(true)" @deny="environment.deny" />
  </div>
</template>
