# siilvana-app

开发环境初始化助手。通过四步向导选择技术栈、检查版本兼容性，并为 Windows、macOS 和 Ubuntu/Debian 生成可审阅的安装脚本。

当前仓库包含 Vue/Tauri 桌面端、NestJS 目录 API、共享依赖解析、脚本导出和原生安装执行器。四步向导依次完成场景选择、工具调整、方案检查和安装；浏览器提供脚本导出，桌面端在用户点击开始安装后执行受审查的配方，系统授权交由操作系统处理。

## 工程结构

- `desktop/`：Tauri 2 + Vue 3 + TypeScript + Vite + Pinia
- `server/`：NestJS + Vercel Functions + Neon/Drizzle
- `packages/shared/`：兼容性、依赖图、安装计划与脚本 renderer
- `packages/catalog/`：经过审核的内置离线目录
- `packages/api-client/`：桌面端类型化 API 客户端
- `desktop/src/app/`：应用入口、路由、导航配置和全局样式
- `desktop/src/features/`：environment、portals、messages、settings 业务功能，各自管理页面、组件、状态和服务
- `desktop/src/shared/`：公共界面组件和工作区持久化
- `desktop/src-tauri/src/`：device 设备检测、installer 安装任务及平台适配
- `server/src/modules/`：catalog、health、cron 业务模块；`infrastructure/` 提供数据库设施
- `assets/source/`：原始素材；`desktop/public/`：运行时发布素材
- `tools/`：目录构建和素材转换工具；`desktop/e2e/`：浏览器验证脚本
- `artifacts/`：截图、测试报告和下载校验文件，不提交到版本库
- `docs/technical-design.md`：完整架构、安全和里程碑方案

## 开发环境

```bash
volta install node@24.20.0 npm@11.19.0
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile
```

Volta 固定 Node 与 npm；依赖安装、workspace、CI 和 Vercel 构建统一使用 pnpm。仓库只提交根目录的 `pnpm-lock.yaml`，不提交 npm 或 Yarn 锁文件。

## 常用命令

```bash
pnpm dev                         # 并行启动 API 和 Tauri 桌面应用
pnpm --filter @siilvana/desktop dev:web
pnpm --filter @siilvana/server dev
pnpm --filter @siilvana/desktop tauri dev
pnpm check                       # 目录校验、类型检查、测试和构建
```

服务端默认监听 `http://localhost:3000`，Swagger 位于 `http://localhost:3000/docs`。桌面 Web 开发服务默认监听 `http://localhost:1420`；设置 `VITE_API_URL=http://localhost:3000/v1` 后会启用目录条件同步，否则使用内置离线目录。

## 文档

[技术设计、数据模型、API、安全方案与 MVP 路线](docs/technical-design.md)

[原生安装流程、权限、日志与三平台验收](docs/installation.md)

[软件历史版本采集、数据库初始化与内置浏览器](docs/release-history.md)

## License

[MIT](LICENSE)
