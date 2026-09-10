import type { Tool, Platform } from '@siilvana/shared';

const development: Array<[string, string, Tool['category'], string, string]> = [
  ['gradle', 'Gradle', 'package-manager', 'Java 项目构建与依赖管理。', 'https://gradle.org/releases/'],
  ['idea', 'IntelliJ IDEA', 'editor', 'Java 与 JVM 开发环境，历史版本包含不同产品系列。', 'https://www.jetbrains.com/idea/download/'],
  ['pip', 'pip', 'package-manager', 'Python 软件包安装工具，通常随 Python 提供。', 'https://pip.pypa.io/en/stable/installation/'],
  ['uv', 'uv', 'package-manager', 'Python 项目、虚拟环境与软件包管理。', 'https://docs.astral.sh/uv/getting-started/installation/'],
  ['poetry', 'Poetry', 'package-manager', 'Python 依赖管理与项目打包。', 'https://python-poetry.org/docs/#installation'],
  ['conda', 'Conda', 'package-manager', '环境与软件包管理；Miniconda 安装器版本与 Conda 发布版本不同。', 'https://docs.conda.io/projects/conda/en/stable/user-guide/install/index.html'],
  ['pycharm', 'PyCharm', 'editor', 'Python 集成开发环境。', 'https://www.jetbrains.com/pycharm/download/'],
];
const office: Array<[string, string, Tool['category'], string, string, Platform[]]> = [
  ['wps', 'WPS Office', 'office', '文档、表格、演示办公套件。', 'https://www.wps.cn/', ['windows', 'macos', 'linux']],
  ['microsoft-365', 'Microsoft 365', 'office', '官方安装需要登录并具备相应许可；Linux 可使用网页版。', 'https://www.microsoft.com/microsoft-365/download-office', ['windows', 'macos']],
  ['libreoffice', 'LibreOffice', 'office', '开源文档、表格与演示套件。', 'https://www.libreoffice.org/download/download-libreoffice/', ['windows', 'macos', 'linux']],
  ['onlyoffice', 'ONLYOFFICE', 'office', '桌面文档协作与编辑套件。', 'https://www.onlyoffice.com/download-desktop.aspx', ['windows', 'macos', 'linux']],
  ['acrobat-reader', 'Adobe Acrobat Reader', 'pdf', 'PDF 阅读、批注与填写。', 'https://get.adobe.com/reader/', ['windows', 'macos']],
  ['7zip', '7-Zip', 'utility', '文件压缩与解压，按系统选择官方资源。', 'https://www.7-zip.org/download.html', ['windows', 'macos', 'linux']],
  ['wechat', '微信', 'communication', '日常沟通与文件传输。', 'https://weixin.qq.com/', ['windows', 'macos', 'linux']],
  ['dingtalk', '钉钉', 'communication', '团队沟通与协同办公。', 'https://www.dingtalk.com/download', ['windows', 'macos', 'linux']],
  ['feishu', '飞书', 'communication', '消息、文档、日历与团队协作。', 'https://www.feishu.cn/download', ['windows', 'macos', 'linux']],
  ['tencent-meeting', '腾讯会议', 'communication', '在线视频会议与屏幕共享。', 'https://meeting.tencent.com/download/', ['windows', 'macos', 'linux']],
];
export const sceneSoftware: Tool[] = [
  ...development.map(([id, name, category, description, url]): Tool => ({ id, name, category, description, homepage: url, downloadUrl: url,
    supportedPlatforms: ['windows', 'macos', 'linux'], scenes: ['gradle', 'idea'].includes(id) ? ['java'] : ['python'], historyPolicy: 'history', icon: category === 'editor' ? 'code-2' : 'package', diskMb: 0, versions: [], recipes: [] })),
  ...office.map(([id, name, category, description, url, supportedPlatforms]): Tool => ({ id, name, category, description, homepage: url, downloadUrl: url,
    supportedPlatforms, scenes: ['office'], historyPolicy: 'latest-only', icon: 'layers-3', diskMb: 0, versions: [], recipes: [] })),
];
export function withScene(tool: Tool): Tool {
  const shared = ['git', 'vscode', 'postgresql', 'docker', 'github-cli', 'github-desktop', 'powershell', 'windows-terminal', 'postman', 'bruno'];
  return { ...tool, historyPolicy: 'history', scenes: shared.includes(tool.id) ? ['frontend', 'java', 'python']
    : ['jdk', 'maven'].includes(tool.id) ? ['java'] : tool.id === 'python' ? ['python'] : ['frontend'] };
}

export function latestDownload(tool: Tool, platform: Platform, architecture: 'x64' | 'arm64') {
  const platformUrls: Record<string, Partial<Record<Platform, string>>> = {
    wechat: { windows: 'https://pc.weixin.qq.com/', macos: 'https://mac.weixin.qq.com/', linux: 'https://linux.weixin.qq.com/' },
    wps: { linux: 'https://linux.wps.cn/' },
  };
  return { toolId: tool.id, platform, architecture, supported: tool.supportedPlatforms?.includes(platform) ?? false,
    url: platformUrls[tool.id]?.[platform] ?? tool.downloadUrl ?? tool.homepage,
    mode: 'vendor-selector' as const, note: tool.id === 'microsoft-365' ? '官方安装需要相应账号与许可；Linux 可使用网页版。' : '在官网选择对应系统和处理器的最新版。' };
}
