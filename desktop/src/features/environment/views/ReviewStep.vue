<script setup lang="ts">
import DiagnosticsList from '../components/DiagnosticsList.vue';
import InstallationPanel from '../components/InstallationPanel.vue';
import { useWizardStore } from '../stores/wizard';
import { useInstallerStore } from '../stores/installer';
import { useEnvironmentStore } from '../stores/environment';
import InstallationLocations from '../components/InstallationLocations.vue';
const store = useWizardStore();
const installer = useInstallerStore();
const environment = useEnvironmentStore();
</script>

<template>
<section class="setup-section">
      <header class="page-heading setup-heading"><span class="page-kicker">Step 03 · Validation</span><h1>检查安装方案</h1><p>{{ store.platform }} · {{ store.architecture }} · 目录 {{ store.catalog.revision }}</p></header>
      <DiagnosticsList class="diagnostics-list" :diagnostics="store.plan.diagnostics" />
      <InstallationPanel review />
      <InstallationLocations v-if="store.hasInstallationTargets" :model-value="store.installationTargets" :catalog="store.catalog" :plan="store.plan" :disks="environment.disks" readonly />
      <div v-if="!installer.current" class="install-table">
        <div class="install-row install-row--head"><span>顺序</span><span>工具</span><span>安装方式</span><span>来源</span></div>
        <div v-for="(item, index) in store.plan.steps" :key="item.id" class="install-row">
          <span class="step-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span><strong>{{ item.toolName }}</strong><small>{{ item.versionLabel ?? (item.version === 'system' ? '系统源稳定版' : item.version) }}</small></span>
          <span><b class="manager-badge">{{ item.manager }}</b></span>
          <span>{{ item.reason === 'required' ? '自动依赖' : '用户选择' }}</span>
        </div>
      </div>
    </section>
</template>
