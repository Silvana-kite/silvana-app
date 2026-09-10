import { vendorHosts } from './official-hosts.ts';
import type { Catalog, InstallRecipe, Platform, Tool } from '@siilvana/shared';
import { sceneSoftware, withScene } from './scenes.ts';
import { additionalSoftware, officialDownloads } from './software.ts';

const verify = (executable: string, ...args: string[]) => ({ executable, args });

function systemRecipes(
  toolId: string,
  versionId: string,
  packages: Partial<Record<Platform, { manager: 'winget' | 'brew' | 'apt'; id: string }>>,
  verifyCommand: { executable: string; args: string[] },
): InstallRecipe[] {
  return Object.entries(packages).map(([platform, value]) => ({
    id: `${toolId}-${platform}-${value.manager}`,
    versionId,
    platform: platform as Platform,
    architecture: 'any',
    strategy: 'system-package',
    manager: value.manager,
    packageId: value.id,
    arguments: platform === 'macos' && ['vscode', 'jdk21', 'jdk25', 'docker'].includes(toolId) ? ['--cask'] : undefined,
    verify: platform !== 'windows' && toolId === 'python' ? verify('python3', '--version') : verifyCommand,
    approved: true,
    installationLocation: platform === 'windows'
      ? toolId === 'git' ? { kind: 'directory' as const, executable: 'cmd/git.exe' }
        : toolId === 'vscode' ? { kind: 'directory' as const, executable: 'Code.exe' }
          : { kind: 'fixed' as const }
      : undefined,
  }));
}

const tools: Tool[] = [
  {
    id: 'volta', name: 'Volta', category: 'package-manager', icon: 'gauge', diskMb: 30,
    description: '跨平台管理 Node.js 与 npm 版本，并按项目自动切换。', homepage: 'https://volta.sh',
    versions: [{ id: 'volta-stable', version: 'stable', channel: 'stable', recommended: true }],
    recipes: [
      ...systemRecipes('volta', 'volta-stable', {
        windows: { manager: 'winget', id: 'Volta.Volta' },
        macos: { manager: 'brew', id: 'volta' },
      }, verify('volta', '--version')),
      {
        id: 'volta-linux-official', versionId: 'volta-stable', platform: 'linux', architecture: 'any',
        strategy: 'official-installer', manager: 'official', packageId: 'volta-unix',
        verify: verify('volta', '--version'), approved: true,
      },
    ],
  },
  {
    id: 'node', name: 'Node.js', category: 'runtime', icon: 'braces', diskMb: 180,
    description: '前端构建与 JavaScript/TypeScript 服务端运行时。', homepage: 'https://nodejs.org',
    versions: [
      { id: 'node-24.20.0', version: '24.20.0', channel: 'lts', recommended: true, managedByToolId: 'volta', bundledTools: [{ toolId: 'npm', version: '11.19.0' }] },
      { id: 'node-26.8.1', version: '26.8.1', channel: 'current', managedByToolId: 'volta', bundledTools: [{ toolId: 'npm', version: '11.19.0' }] },
      { id: 'node-20.20.2', version: '20.20.2', channel: 'eol', eolDate: '2026-04-30', managedByToolId: 'volta', bundledTools: [{ toolId: 'npm', version: '10' }] },
    ],
    recipes: [
      ...(['windows', 'macos', 'linux'] as const).flatMap((platform) => [
        { id: `node-24-${platform}-volta`, versionId: 'node-24.20.0', platform, architecture: 'any' as const, strategy: 'version-manager' as const, manager: 'volta' as const, packageId: 'node@24.20.0', arguments: ['npm@11.19.0'], verify: verify('node', '--version'), approved: true },
        { id: `node-26-${platform}-volta`, versionId: 'node-26.8.1', platform, architecture: 'any' as const, strategy: 'version-manager' as const, manager: 'volta' as const, packageId: 'node@26.8.1', arguments: ['npm@11.19.0'], verify: verify('node', '--version'), approved: true },
        { id: `node-20-${platform}-volta`, versionId: 'node-20.20.2', platform, architecture: 'any' as const, strategy: 'version-manager' as const, manager: 'volta' as const, packageId: 'node@20.20.2', arguments: ['npm@10'], verify: verify('node', '--version'), approved: true },
      ]),
    ],
  },
  {
    id: 'npm', name: 'npm', category: 'package-manager', icon: 'package', diskMb: 0,
    description: 'Node.js 自带的包管理器；本项目只用它引导安装 pnpm。', homepage: 'https://www.npmjs.com',
    versions: [
      { id: 'npm-11.19.0', version: '11.19.0', channel: 'stable', recommended: true },
      { id: 'npm-10', version: '10', channel: 'stable' },
    ], recipes: [],
  },
  {
    id: 'pnpm', name: 'pnpm', category: 'package-manager', icon: 'boxes', diskMb: 25,
    description: '高效、严格且适合 monorepo 的项目依赖管理器。', homepage: 'https://pnpm.io',
    versions: [{ id: 'pnpm-10.34.5', version: '10.34.5', channel: 'stable', recommended: true }],
    recipes: (['windows', 'macos', 'linux'] as const).map((platform) => ({
      id: `pnpm-${platform}-npm`, versionId: 'pnpm-10.34.5', platform, architecture: 'any', strategy: 'package-binary', manager: 'npm', packageId: 'pnpm@10.34.5', verify: verify('pnpm', '--version'), approved: true,
    })),
  },
  {
    id: 'git', name: 'Git', category: 'cli', icon: 'git-branch', diskMb: 350,
    description: '分布式版本控制工具，是大多数开发流程的基础。', homepage: 'https://git-scm.com',
    versions: [{ id: 'git-stable', version: 'stable', channel: 'stable', recommended: true }],
    recipes: systemRecipes('git', 'git-stable', { windows: { manager: 'winget', id: 'Git.Git' }, macos: { manager: 'brew', id: 'git' }, linux: { manager: 'apt', id: 'git' } }, verify('git', '--version')),
  },
  {
    id: 'vscode', name: 'Visual Studio Code', category: 'editor', icon: 'code-2', diskMb: 650,
    description: '轻量、可扩展的跨平台代码编辑器。', homepage: 'https://code.visualstudio.com',
    versions: [{ id: 'vscode-stable', version: 'stable', channel: 'stable', recommended: true }],
    recipes: systemRecipes('vscode', 'vscode-stable', { windows: { manager: 'winget', id: 'Microsoft.VisualStudioCode' }, macos: { manager: 'brew', id: 'visual-studio-code' }, linux: { manager: 'apt', id: 'code' } }, verify('code', '--version')),
  },
  {
    id: 'jdk', name: 'Eclipse Temurin JDK', category: 'runtime', icon: 'coffee', diskMb: 450,
    description: '稳定的 OpenJDK 发行版，用于 Java 后端开发。', homepage: 'https://adoptium.net',
    versions: [{ id: 'jdk-21', version: '21', channel: 'lts', recommended: true }, { id: 'jdk-25', version: '25', channel: 'lts' }],
    recipes: [
      ...systemRecipes('jdk21', 'jdk-21', { windows: { manager: 'winget', id: 'EclipseAdoptium.Temurin.21.JDK' }, macos: { manager: 'brew', id: 'temurin@21' }, linux: { manager: 'apt', id: 'openjdk-21-jdk' } }, verify('java', '-version')),
      ...systemRecipes('jdk25', 'jdk-25', { windows: { manager: 'winget', id: 'EclipseAdoptium.Temurin.25.JDK' }, macos: { manager: 'brew', id: 'temurin@25' }, linux: { manager: 'apt', id: 'openjdk-25-jdk' } }, verify('java', '-version')),
    ],
  },
  {
    id: 'maven', name: 'Apache Maven', category: 'package-manager', icon: 'layers-3', diskMb: 25,
    description: 'Java 项目构建与依赖管理工具。', homepage: 'https://maven.apache.org',
    versions: [{ id: 'maven-stable', version: '3.9.11', acceptedRange: '>=3.6.0, <4.0.0', channel: 'stable', recommended: true }],
    recipes: systemRecipes('maven', 'maven-stable', { windows: { manager: 'winget', id: 'Apache.Maven' }, macos: { manager: 'brew', id: 'maven' }, linux: { manager: 'apt', id: 'maven' } }, verify('mvn', '--version')),
  },
  {
    id: 'python', name: 'Python', category: 'runtime', icon: 'terminal-square', diskMb: 180,
    description: '通用编程语言，适合自动化、后端与数据科学。', homepage: 'https://python.org',
    versions: [{ id: 'python-3.13', version: '3.13.7', channel: 'stable', recommended: true }, { id: 'python-system', version: 'system', acceptedRange: '>=3.8.0, <4.0.0', channel: 'stable', recommended: true }],
    recipes: [
      ...systemRecipes('python', 'python-3.13', { windows: { manager: 'winget', id: 'Python.Python.3.13' }, macos: { manager: 'brew', id: 'python@3.13' } }, verify('python', '--version')),
      ...systemRecipes('python-system', 'python-system', { linux: { manager: 'apt', id: 'python3' } }, verify('python3', '--version')),
    ],
  },
  {
    id: 'postgresql', name: 'PostgreSQL', category: 'database', icon: 'database', diskMb: 900,
    description: '功能完整的开源关系型数据库。', homepage: 'https://postgresql.org',
    versions: [{ id: 'postgresql-17', version: '17', channel: 'stable', recommended: true }, { id: 'postgresql-system', version: 'system', acceptedRange: '>=14.0.0, <19.0.0', channel: 'stable', recommended: true }],
    recipes: [
      ...systemRecipes('postgresql', 'postgresql-17', { windows: { manager: 'winget', id: 'PostgreSQL.PostgreSQL.17' }, macos: { manager: 'brew', id: 'postgresql@17' } }, verify('psql', '--version')),
      ...systemRecipes('postgresql-system', 'postgresql-system', { linux: { manager: 'apt', id: 'postgresql' } }, verify('psql', '--version')),
    ],
  },
  {
    id: 'docker', name: 'Docker', category: 'container', icon: 'container', diskMb: 1800,
    description: '构建和运行隔离容器环境。', homepage: 'https://docker.com',
    versions: [{ id: 'docker-stable', version: 'stable', channel: 'stable', recommended: true }],
    recipes: systemRecipes('docker', 'docker-stable', { windows: { manager: 'winget', id: 'Docker.DockerDesktop' }, macos: { manager: 'brew', id: 'docker' }, linux: { manager: 'apt', id: 'docker.io' } }, verify('docker', '--version')),
  },
];

export const catalog: Catalog = {
  schemaVersion: 1,
  revision: '2026-09-10.3',
  generatedAt: '2026-09-10T00:00:00Z',
  tools: [...tools.map(tool => ({ ...tool, downloadUrl: officialDownloads[tool.id] })), ...additionalSoftware].map(withScene).concat(sceneSoftware),
  dependencies: [
    { sourceToolId: 'node', targetToolId: 'volta', kind: 'requires' },
    { sourceToolId: 'pnpm', targetToolId: 'node', kind: 'requires', targetRange: '>=18' },
    { sourceToolId: 'maven', targetToolId: 'jdk', kind: 'requires', targetRange: '>=17' },
    { sourceToolId: 'docker', targetToolId: 'git', kind: 'recommends' },
  ],
  compatibility: [
    { sourceToolId: 'pnpm', sourceRange: '>=10 <11', targetToolId: 'node', targetRange: '>=18', relation: 'requires', severity: 'error', message: 'pnpm 10 需要 Node.js 18 或更高版本。' },
    { sourceToolId: 'maven', sourceRange: '*', targetToolId: 'jdk', targetRange: '>=17', relation: 'requires', severity: 'error', message: '当前 Maven 方案需要 JDK 17 或更高版本。' },
  ],
  templates: [
    { id: 'frontend-web', scene: 'frontend', name: '前端 Web', description: 'Volta、Node LTS、pnpm、Git 与 VS Code。', scenario: 'frontend', items: [{ toolId: 'volta' }, { toolId: 'node' }, { toolId: 'pnpm' }, { toolId: 'git' }, { toolId: 'vscode' }] },
    { id: 'node-backend', visible: false, name: 'Node.js 后端', description: 'Node 工具链、PostgreSQL 与 Docker。', scenario: 'backend', items: [{ toolId: 'volta' }, { toolId: 'node' }, { toolId: 'pnpm' }, { toolId: 'git' }, { toolId: 'vscode' }, { toolId: 'postgresql' }, { toolId: 'docker' }] },
    { id: 'java-backend', scene: 'java', name: 'Java', description: 'JDK、Maven、Gradle 与 Java 开发软件。', scenario: 'backend', items: [{ toolId: 'jdk' }, { toolId: 'maven' }, { toolId: 'git' }, { toolId: 'vscode' }] },
    { id: 'data-science', scene: 'python', name: 'Python', description: 'Python、Git 与 VS Code 的轻量起点。', scenario: 'data-science', items: [{ toolId: 'python' }, { toolId: 'git' }, { toolId: 'vscode' }] },
    { id: 'mobile-cross-platform', visible: false, name: '移动开发', description: '面向跨端 JavaScript 应用的 Node 工具链。', scenario: 'mobile', items: [{ toolId: 'volta' }, { toolId: 'node' }, { toolId: 'pnpm' }, { toolId: 'git' }, { toolId: 'vscode' }] },
    { id: 'fullstack', visible: false, name: '全栈开发', description: '前后端运行时、数据库与容器工具。', scenario: 'fullstack', items: [{ toolId: 'volta' }, { toolId: 'node' }, { toolId: 'pnpm' }, { toolId: 'python' }, { toolId: 'git' }, { toolId: 'vscode' }, { toolId: 'postgresql' }, { toolId: 'docker' }] },
    { id: 'office', scene: 'office', name: '办公', description: '文档、PDF、压缩与团队协作软件，直接下载最新版。', scenario: 'office', items: [] },
    { id: 'custom', name: '自定义', description: '从空白清单开始选择。', scenario: 'custom', items: [] },
  ],
};

export default catalog;
export { latestDownload } from './scenes.ts';

export const officialHosts = new Set([...vendorHosts, ...catalog.tools.flatMap(t => [t.homepage, t.downloadUrl].filter((u): u is string => !!u).map(u => new URL(u).hostname))]);
export function isOfficialUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && officialHosts.has(url.hostname); } catch { return false; }
}
