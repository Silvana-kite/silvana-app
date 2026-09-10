import type { Platform, Tool } from '@siilvana/shared';

const all: Platform[] = ['windows', 'macos', 'linux'];
const entries: Array<[string, string, Tool['category'], string, string, string, Platform[]?]> = [
  ['yarn', 'Yarn', 'package-manager', '包管理器，包含 Classic 和现代 CLI 版本。', 'https://yarnpkg.com', 'https://yarnpkg.com/getting-started/install'],
  ['bun', 'Bun', 'runtime', 'JavaScript 与 TypeScript 运行时和包管理工具。', 'https://bun.sh', 'https://bun.sh/docs/installation'],
  ['deno', 'Deno', 'runtime', 'JavaScript 与 TypeScript 运行时。', 'https://deno.com', 'https://docs.deno.com/runtime/getting_started/installation/'],
  ['fnm', 'fnm', 'package-manager', '快速切换电脑上的 Node.js 版本。', 'https://github.com/Schniz/fnm', 'https://github.com/Schniz/fnm/releases'],
  ['nvm', 'nvm', 'package-manager', '用于 macOS 和 Linux Shell 的 Node.js 版本管理器。', 'https://github.com/nvm-sh/nvm', 'https://github.com/nvm-sh/nvm/releases', ['macos', 'linux']],
  ['nvm-windows', 'nvm-windows', 'package-manager', '用于 Windows 的 Node.js 版本管理器。', 'https://github.com/coreybutler/nvm-windows', 'https://github.com/coreybutler/nvm-windows/releases', ['windows']],
  ['github-cli', 'GitHub CLI', 'cli', '在终端管理 GitHub 仓库、Issue 和 Pull Request。', 'https://cli.github.com', 'https://github.com/cli/cli/releases'],
  ['github-desktop', 'GitHub Desktop', 'cli', 'Git 图形客户端。', 'https://desktop.github.com', 'https://desktop.github.com/download/', ['windows', 'macos']],
  ['webstorm', 'WebStorm', 'editor', '面向 JavaScript 和 TypeScript 的桌面 IDE。', 'https://www.jetbrains.com/webstorm/', 'https://www.jetbrains.com/webstorm/download/'],
  ['chrome', 'Google Chrome', 'browser', '用于网页开发、调试和兼容性验证。', 'https://www.google.com/chrome/', 'https://www.google.com/chrome/'],
  ['edge', 'Microsoft Edge', 'browser', '用于网页开发和跨浏览器测试。', 'https://www.microsoft.com/edge', 'https://www.microsoft.com/edge/download'],
  ['firefox', 'Mozilla Firefox', 'browser', '使用 Gecko 引擎调试网页与验证兼容性。', 'https://www.mozilla.org/firefox/', 'https://www.mozilla.org/firefox/all/'],
  ['powershell', 'PowerShell', 'terminal', '跨平台 Shell 和系统自动化环境。', 'https://learn.microsoft.com/powershell/', 'https://github.com/PowerShell/PowerShell/releases'],
  ['windows-terminal', 'Windows Terminal', 'terminal', 'Windows 多标签终端。', 'https://github.com/microsoft/terminal', 'https://github.com/microsoft/terminal/releases', ['windows']],
  ['postman', 'Postman', 'api-client', '桌面 HTTP API 调试与联调工具。', 'https://www.postman.com', 'https://www.postman.com/downloads/'],
  ['bruno', 'Bruno', 'api-client', '将接口集合保存为本地文件的 API 调试工具。', 'https://www.usebruno.com', 'https://www.usebruno.com/downloads'],
];
export const additionalSoftware: Tool[] = entries.map(([id, name, category, description, homepage, downloadUrl, platforms]) => ({
  id, name, category, description, homepage, downloadUrl, supportedPlatforms: platforms ?? all,
  icon: category === 'editor' ? 'code-2' : 'terminal-square', diskMb: 0,
  versions: [], recipes: [],
}));
export const officialDownloads: Record<string, string> = {
  node: 'https://nodejs.org/en/download', npm: 'https://www.npmjs.com/package/npm',
  pnpm: 'https://pnpm.io/installation', volta: 'https://github.com/volta-cli/volta/releases',
  git: 'https://git-scm.com/downloads', vscode: 'https://code.visualstudio.com/download',
  jdk: 'https://adoptium.net/temurin/releases/', maven: 'https://maven.apache.org/download.cgi',
  python: 'https://www.python.org/downloads/', postgresql: 'https://www.postgresql.org/download/',
  docker: 'https://www.docker.com/products/docker-desktop/',
};
