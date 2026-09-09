<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown, Database, Monitor, RotateCcw, Trash2, X } from 'lucide-vue-next';
import { useWizardStore } from '../../environment/stores/wizard';

const store = useWizardStore();
const showClearDialog = ref(false);

function clearHistory() {
  store.clearActivities();
  showClearDialog.value = false;
}
</script>

<template>
  <div class="page-container narrow-page settings-page">
    <header class="page-heading"><span class="page-kicker">Preferences</span><h1>设置</h1><p>调整目录同步、目标平台和界面行为。更改会自动保存在本设备。</p></header>

    <section class="settings-section">
      <div class="settings-section__heading"><span><Database :size="19" /></span><div><h2>目录与同步</h2><p>控制应用启动时是否获取最新工具目录。</p></div></div>
      <label class="setting-row">
        <span><strong>启动时自动同步</strong><small>同步失败时自动使用最近一次有效目录或内置目录。</small></span>
        <input v-model="store.syncOnLaunch" class="switch-input" type="checkbox" role="switch" />
      </label>
    </section>

    <section class="settings-section">
      <div class="settings-section__heading"><span><Monitor :size="19" /></span><div><h2>环境默认值</h2><p>用于当前方案和之后创建的环境配置。</p></div></div>
      <div class="setting-row">
        <span><strong>目标系统</strong><small>安装脚本将匹配对应的平台包管理器。</small></span>
        <label class="select-control">
          <select v-model="store.platform" aria-label="目标系统">
            <option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Ubuntu / Debian</option>
          </select><ChevronDown :size="15" />
        </label>
      </div>
      <div class="setting-row">
        <span><strong>处理器架构</strong><small>仅显示与所选架构兼容的安装方案。</small></span>
        <label class="select-control">
          <select v-model="store.architecture" aria-label="处理器架构"><option value="x64">x64</option><option value="arm64">ARM64</option></select><ChevronDown :size="15" />
        </label>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section__heading"><span><RotateCcw :size="19" /></span><div><h2>界面行为</h2><p>保持浅色界面，同时按需要减少过渡动画。</p></div></div>
      <div class="setting-row">
        <span><strong>动画效果</strong><small>“跟随系统”会尊重设备的减少动态效果设置。</small></span>
        <div class="segmented-control" role="group" aria-label="动画效果">
          <button type="button" :class="{ 'is-active': store.motion === 'system' }" @click="store.motion = 'system'">跟随系统</button>
          <button type="button" :class="{ 'is-active': store.motion === 'reduced' }" @click="store.motion = 'reduced'">减少动画</button>
        </div>
      </div>
    </section>

    <section class="settings-section danger-section">
      <div class="setting-row">
        <span><strong>清空本地活动</strong><small>删除 {{ store.activities.length }} 条同步、模板和导出记录，不影响当前方案。</small></span>
        <button class="danger-button" type="button" :disabled="!store.activities.length" @click="showClearDialog = true"><Trash2 :size="16" />清空记录</button>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="showClearDialog" class="dialog-backdrop" role="presentation" @mousedown.self="showClearDialog = false">
        <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-dialog-title">
          <button class="icon-button is-quiet confirm-dialog__close" type="button" title="关闭" @click="showClearDialog = false"><X :size="18" /></button>
          <span class="confirm-dialog__icon"><Trash2 :size="22" /></span>
          <h2 id="clear-dialog-title">清空所有活动记录？</h2>
          <p>该操作只影响当前设备上的消息记录，无法撤销。</p>
          <div><button class="secondary-button" type="button" @click="showClearDialog = false">取消</button><button class="danger-button" type="button" @click="clearHistory">确认清空</button></div>
        </section>
      </div>
    </Teleport>
  </div>
</template>
