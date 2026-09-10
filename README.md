# siilvana-app

开发环境与常用软件配置助手，提供前端 Web、Java、Python、办公和自定义场景。

开发场景通过「选择场景 → 选择工具 → 检查方案 → 安装或导出」配置环境。Web 端导出安装脚本，Tauri 桌面端执行经过审核的安装配方；办公场景直接提供最新版官方下载入口。软件历史由官方来源采集，经过签名后随应用提供离线查询，联网时可以更新。

## 目录总览

```text
siilvana-app/
├── .github/workflows/        # 自动检查、历史采集和供应链检查
├── desktop/                 # Web 界面与 Tauri 桌面应用
│   ├── src/                 # Vue 界面、业务状态与客户端服务
│   ├── src-tauri/           # Rust 原生能力、权限与桌面配置
│   ├── public/              # 随应用发布的模型和离线历史快照
│   └── e2e/                 # 浏览器及原生交互验收脚本
├── server/                  # NestJS API 与官方历史采集服务
│   ├── src/                 # API、采集、快照发布及运维入口
│   └── migrations/          # PostgreSQL 建表及升级脚本
├── packages/                # 前后端共用的工作区包
│   ├── shared/              # 数据契约、依赖解析和安装计划
│   ├── catalog/             # 软件目录、场景、安装配方与签名
│   └── api-client/          # 类型化 API 客户端
├── assets/source/mistral/    # 可编辑的原始 Blender 模型
├── tools/                   # 开发启动、签名、校验及素材处理工具
├── docs/                    # 详细设计、功能和运维文档
├── .runtime/history/        # 本机日常数据库、配置、私钥和备份
└── artifacts/               # 验收报告、日志、旧测试数据库及备份
```

`.runtime/`、`artifacts/`、依赖及编译输出不提交到 Git，但其中的数据库、备份和私钥属于持久数据，不能仅根据目录名称整目录清理。

## 根目录与工作区配置

| 路径 | 作用 |
| --- | --- |
| `package.json` | 公共命令、Node/pnpm 版本要求、Volta 固定版本及共享开发依赖。 |
| `pnpm-workspace.yaml` | 声明 `desktop`、`server`、`packages/*` 为工作区成员。 |
| `pnpm-lock.yaml` | 锁定 JavaScript/TypeScript 依赖版本，供本地和 CI 一致安装。 |
| `.npmrc` | 启用引擎版本检查和共享工作区锁文件。 |
| `tsconfig.base.json` | 各 TypeScript 包继承的公共编译配置。 |
| `history-snapshot.lock.json` | 锁定历史清单修订、哈希和验签公钥，构建时验证离线资源；不是 pnpm 依赖锁文件。 |
| `.gitignore` | 排除依赖、编译缓存、本地配置、私钥所在目录和临时产物。 |
| `.gitattributes` | 将 `.blend` 原始模型交给 Git LFS 管理。 |
| `.git/` | Git 提交历史、索引和仓库配置，不属于项目缓存。 |
| `README.md` | 项目入口、目录用途和常用操作说明。 |
| `LICENSE` | 项目 MIT 许可证。 |

每个工作区包的 `package.json` 声明本包依赖与命令，`tsconfig.json` 定义本包编译范围；它们与根配置配合使用。

## Web 与桌面端

### Vue 界面

| 路径 | 作用 |
| --- | --- |
| `desktop/index.html` | Vite 的 HTML 入口。 |
| `desktop/vite.config.ts` | Vue、样式及离线缓存构建插件，开发端口和输出配置。 |
| `desktop/vitest.config.ts` | Vue 组件及客户端服务的测试环境配置。 |
| `desktop/src/app/main.ts` | 创建 Vue 应用，注册 Pinia、路由与全局样式。 |
| `desktop/src/app/App.vue` | 应用外壳、导航、搜索、同步状态及官方浏览器入口。 |
| `desktop/src/app/router.ts` | 门户、环境配置、消息和设置页面路由。 |
| `desktop/src/app/config/portals.ts` | 门户展示和导航信息。 |
| `desktop/src/app/styles.css` | 应用级通用样式。 |
| `desktop/src/features/environment/views/` | 场景选择、软件选择、方案检查、安装及环境主页。 |
| `desktop/src/features/environment/components/` | 场景卡片、软件卡片、版本面板、磁盘设置、诊断和安装进度等组件。 |
| `desktop/src/features/environment/stores/wizard.ts` | 场景筛选、工具选择、目录同步、安装计划与向导状态。 |
| `desktop/src/features/environment/stores/environment.ts` | 设备信息、磁盘扫描授权和空间检查状态。 |
| `desktop/src/features/environment/stores/installer.ts` | 原生安装任务的启动、进度、错误和重试状态。 |
| `desktop/src/features/environment/services/history-cache.ts` | 完整历史快照同步、IndexedDB 存储、修订比较与恢复。 |
| `desktop/src/features/environment/services/history-decode.worker.ts` | 在 Worker 中解压并校验快照签名、哈希和记录。 |
| `desktop/src/features/environment/services/history-query.worker.ts` | 在 Worker 中建立查询数据、排序、搜索和分页。 |
| `desktop/src/features/environment/services/history-trust.ts` | 随构建提供的历史数据集标识和可信公钥，不含私钥。 |
| `desktop/src/features/environment/services/release-cache.ts` | 版本列表读取入口及旧版查询页缓存兼容逻辑。 |
| `desktop/src/features/environment/services/catalog-cache.ts` | 工具目录缓存，与完整历史快照分开保存。 |
| `desktop/src/features/environment/services/device.ts` | 调用原生设备及磁盘能力，区分 Web 与桌面环境。 |
| `desktop/src/features/environment/services/installation-locations.ts` | 安装目标磁盘映射和随附工具的位置继承规则。 |
| `desktop/src/features/environment/styles/` | 环境中心和配置向导的业务样式。 |
| `desktop/src/features/portals/` | 门户页面和 Mistral 三维展示组件。 |
| `desktop/src/features/messages/` | 活动记录与消息页面。 |
| `desktop/src/features/settings/` | 同步偏好、扫描授权等设置页面。 |
| `desktop/src/shared/components/` | 全局搜索、图标、官方浏览器容器和离线状态等公共组件。 |
| `desktop/src/shared/services/workspace-state.ts` | 保存和恢复选择、偏好及活动记录。 |
| `desktop/src/shared/services/official-browser.ts` | 校验官方链接并协调 Web/桌面端打开行为。 |
| `desktop/e2e/` | 页面、安装、历史版本和原生下载验收脚本，输出写入 `artifacts/`。 |

同目录下的 `*.test.ts` 和 `tests/` 验证对应服务、状态或组件。`e2e/native-download.mjs` 仍被 PowerShell 下载验收脚本调用，不是无用文件。

### Tauri 原生层

| 路径 | 作用 |
| --- | --- |
| `desktop/src-tauri/Cargo.toml`、`Cargo.lock` | Rust 包配置和依赖锁定。 |
| `desktop/src-tauri/tauri.conf.json` | 应用标识、窗口、Web 入口、资源和构建配置。 |
| `desktop/src-tauri/build.rs` | 构建原生目录、复制签名文件、生成图标并运行 Tauri 构建步骤。 |
| `desktop/src-tauri/app-icon.svg` | 应用图标源文件。 |
| `desktop/src-tauri/capabilities/default.json` | 本地窗口的 Tauri 权限声明。 |
| `desktop/src-tauri/src/main.rs`、`src/lib.rs` | 原生程序入口和命令、插件注册。 |
| `desktop/src-tauri/src/device/` | 平台、架构检测，以及用户授权后的磁盘容量读取。 |
| `desktop/src-tauri/src/installer/` | 目录验签、依赖解析、任务执行、平台命令和安装位置检查。 |
| `desktop/src-tauri/src/browser.rs` | 应用内官方网页、窗口导航和下载保存流程。 |
| `desktop/src-tauri/src/download_check.rs` | 下载摘要校验及本地安全扫描。 |

## 服务端与共享包

| 路径 | 作用 |
| --- | --- |
| `server/src/main.ts` | 启动 HTTP 服务，配置 CORS、限流、校验、路由前缀及 Swagger。 |
| `server/src/app.module.ts` | 组装业务模块和数据库设施。 |
| `server/src/modules/catalog/` | 工具目录、场景推荐和安装计划 API。 |
| `server/src/modules/releases/` | 官方采集适配器、请求限制、持久化、签名快照、版本查询及只读运维接口。 |
| `server/src/modules/cron/` | 受凭据保护的定时采集入口。 |
| `server/src/modules/health/` | 存活与历史服务就绪检查。 |
| `server/src/infrastructure/database/` | 数据库连接、结构定义及迁移执行器；实际升级 SQL 位于 `migrations/`。 |
| `server/src/infrastructure/source-tls.ts` | 加载本地环境配置，使用正常 Node/系统 TLS 信任根。 |
| `server/migrations/0001_release_history.sql` | 旧版历史记录、来源状态、页面缓存和采集运行表。 |
| `server/migrations/0002_history_snapshots.sql` | 发布版本与资源、快照、清单、报告和告警相关结构。 |
| `server/migrations/0003_history_quality.sql` | 未知生命周期状态纠正及资源失效检查字段。 |
| `server/nest-cli.json` | NestJS 编译配置。 |
| `server/vercel.json` | Vercel 部署及定时触发配置。 |
| `server/.env.example` | 可提交的配置模板；实际 `server/.env` 属于本机配置。 |
| `packages/shared/src/types.ts`、`history.ts` | 目录、安装计划、历史版本、快照和质量声明的数据契约。 |
| `packages/shared/src/resolver.ts`、`renderer.ts` | 解析依赖与兼容性，生成安装步骤和脚本。 |
| `packages/shared/src/catalog-validation.ts`、`platform-version.ts` | 目录校验及目标平台推荐版本选择。 |
| `packages/catalog/src/` | 内置软件、场景、官方下载入口、可信域名、版本与已审核安装配方。 |
| `packages/catalog/native-catalog.signed.json` | 原生执行器的签名目录，是构建输入，不能当缓存删除。 |
| `packages/catalog/native-catalog.public-key` | 原生目录验签公钥，可随项目提交。 |
| `packages/api-client/src/` | 目录、安装计划及历史接口的类型化客户端和响应校验。 |

### 命令行与辅助脚本

| 文件 | 作用 |
| --- | --- |
| `tools/dev.mjs` | 启动已配置的本地数据库，构建共享包，再启动 API 和 Web 或桌面应用。 |
| `tools/catalog/init-local.mjs` | 初始化本机签名密钥与服务端配置，保留已有配置文件。 |
| `tools/catalog/start-local.mjs` | 按本地配置检查并启动 PostgreSQL，不负责安装 PostgreSQL。 |
| `tools/catalog/native-manifest.mjs` | 将内置目录转换为 Rust 执行器的构建输入。 |
| `tools/catalog/sign-native.mjs` | 对审核后的原生目录签名并输出公钥。 |
| `tools/catalog/validate-snapshots.mjs` | 核对快照锁文件、签名、分片哈希、数量及体积限制。 |
| `tools/catalog/offline-plugin.mjs` | 构建 Service Worker，缓存应用页面及随包历史。 |
| `tools/catalog/sbom.mjs` | 生成 npm 与 Cargo 依赖的 CycloneDX SBOM。 |
| `tools/blender/audit_model.py` | 在 Blender 中检查原始模型、贴图和场景信息。 |
| `tools/blender/export_mistral_web.py` | 将原始 Blender 工程导出为 Web 模型。 |
| `server/src/catalog-cli.ts` | 执行数据库迁移或历史采集，协调发布与监控。 |
| `server/src/history-cli.ts` | 发布签名历史清单，或导出随应用提供的离线快照。 |
| `server/src/history-backfill.ts` | 将旧版记录导入新模型，保留旧数据并标明待核验覆盖范围。 |
| `server/src/history-probe.ts` | 有限量地检查资源链接，保留失效记录，不批量下载安装包。 |

## 素材、持久数据与生成文件

| 路径或规则 | 作用与保留方式 |
| --- | --- |
| `assets/source/mistral/mistral.blend` | 可编辑的原始工程，通过 Git LFS 管理，编辑或重新导出模型时使用。 |
| `assets/source/mistral/README.md` | 模型来源、导出入口和已知素材情况。 |
| `desktop/public/models/mistral/mistral-web.glb` | 应用实际加载的三维模型，属于运行所需资源。 |
| `desktop/public/history/manifest.json` | 随应用发布的签名历史清单。 |
| `desktop/public/history/tools/` | 按工具和修订保存的签名快照描述文件。 |
| `desktop/public/history/blobs/` | 以 SHA-256 命名的压缩分片，无扩展名文件也是正常运行资源。 |
| `.runtime/history/postgres/` | 本机日常数据库实例的持久数据。 |
| `.runtime/history/local-database.json` | 本机 PostgreSQL 程序位置、数据目录和端口配置。 |
| `.runtime/history/signing.pem` | 本机签名私钥，不要提交、展示或当缓存删除。 |
| `.runtime/history/*.backup` | 日常数据库迁移、恢复使用的备份。 |
| `.runtime/history/postgres.log` | 日常 PostgreSQL 日志，可能正在写入。 |
| `artifacts/release-history/postgres/` | 旧的本地测试数据库实例，保留用于复现测试，与日常库分离。 |
| `artifacts/release-history/*.backup` | 旧数据库备份。 |
| `artifacts/release-history/*.json` | 旧版历史、原生浏览器和下载验收报告，不代表当前版本全部功能的验收结论。 |
| `artifacts/release-history/postgres*.log` | 旧测试数据库日志。 |
| `artifacts/history-v2/` | 当前历史流程的完成报告、离线恢复、运维、性能验收及截图。 |
| `artifacts/supply-chain/` | SBOM；执行相关 CI 时还会产生依赖审计和安全扫描报告。 |
| `artifacts/dev/` | 本地开发日志。本次保留了仍被进程占用的 `web.log`、`web-error.log`。 |
| `artifacts/cleanup-report.json` | 本次实际删除清单、保留项和关键路径核对记录。 |
| 根目录及各包的 `node_modules/` | 已安装依赖，可重新安装，本次保留以继续开发。 |
| `desktop/dist/`、`server/dist/`、`packages/*/dist/` | Web、服务端及共享包构建输出，本次保留。 |
| `desktop/src-tauri/target/` | Rust 编译缓存、测试程序和可执行文件，本次保留。检查版为 `debug/siilvana-review.exe`。 |
| `desktop/src-tauri/icons/`、`gen/` | Tauri 生成的图标和接口/权限描述，本次保留；图标源文件另有保存。 |
| `*.tsbuildinfo` | TypeScript 增量检查与编译缓存，本次保留。 |

原始素材、已签名目录、历史清单、数据分片和锁文件应随项目保存。快照更新通过导出工具完成，不能单独删除分片或手工改动签名内容。本地数据库、备份、私钥与日志不进入 Git。

旧截图、测试下载包、测试浏览器缓存和一次性启动项目已清理。测试再次运行时会按需创建输出目录；若再次产生 `.pnpm-store/`，它会被 Git 忽略。

## 开发与常用命令

使用 Node 24 和 pnpm 10。具体版本要求见根 `package.json`：

```bash
volta install node@24.20.0 npm@11.19.0
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile

pnpm dev:web                     # 启动已配置的本地数据库、API 和 Web
pnpm dev                         # 启动已配置的本地数据库、API 和桌面应用
pnpm --filter @siilvana/desktop dev:web  # 仅启动 Vite
pnpm --filter @siilvana/server dev      # 仅启动 API
pnpm check                       # 目录校验、类型检查、测试和构建
pnpm history:validate            # 只校验当前随包快照
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib
```

API 默认在 `http://localhost:3000`，Swagger 在 `http://localhost:3000/docs`；Web 开发服务默认在 `http://localhost:1420`。开发模式默认连接本机 API，生产构建通过 `VITE_API_URL` 配置 API 地址。没有历史服务连接时，可查询随包签名快照；更新需要可用的服务端。

本机数据库配置是可选的，`tools/dev.mjs` 只启动已经配置的 PostgreSQL 实例。首次数据库设置、签名密钥和部署参数见 [历史 v2 运维说明](docs/history-v2.md)。编辑原始模型前，通过 Git LFS 获取完整 `.blend` 文件；Blender 只用于模型编辑、检查和导出。

### 采集与发布

```bash
pnpm --filter @siilvana/shared build
pnpm --filter @siilvana/catalog build
pnpm --filter @siilvana/server build
pnpm --filter @siilvana/server db:migrate
pnpm --filter @siilvana/server catalog:sync --all
pnpm --filter @siilvana/server history:publish
pnpm --filter @siilvana/server history:export
pnpm history:validate
```

采集和发布需要配置数据库及签名密钥；日常查询和普通 Web 构建使用现有随包资源，不会临时爬取官网。修改审核目录后，使用 `node tools/catalog/sign-native.mjs` 重新签名。迁移旧记录可用 `history:backfill`，检查下载资源可用 `history:probe`，参数见详细运维文档。

数据库集成测试只允许 `RELEASE_TEST_DATABASE_URL` 指向专用的 `siilvana_release_test` 数据库；测试会清空其中的历史表。真实采集数据必须使用独立日常库。

## 自动化与详细文档

| 文件 | 作用 |
| --- | --- |
| [.github/workflows/check.yml](.github/workflows/check.yml) | 工作区检查、专用 PostgreSQL 集成测试及跨平台 Rust 检查。 |
| [.github/workflows/history.yml](.github/workflows/history.yml) | 定时采集、签名快照产物和手动供应链检查，发布凭据通过 CI 配置。 |
| [docs/history-v2.md](docs/history-v2.md) | 当前历史契约、离线快照、安全、迁移和运维。 |
| [docs/release-history.md](docs/release-history.md) | v1 兼容历史接口，以及原生官方浏览器、下载验收。 |
| [docs/installation.md](docs/installation.md) | 原生安装流程、位置、权限、日志和平台验证。 |
| [docs/environment-center.md](docs/environment-center.md) | 环境中心、设备检测、磁盘授权及导出检查。 |
| [docs/technical-design.md](docs/technical-design.md) | 总体架构与路线设计，包含规划内容；现行操作以对应功能文档和代码为准。 |

## License

[MIT](LICENSE)
