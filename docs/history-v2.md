# 历史版本库 v2

历史元数据与可执行安装配方独立。场景包括前端 Web、Java、Python、办公、自定义；修改安装选择不改变场景筛选。办公条目只进入官方最新版下载页。

## 数据与质量

`history_releases` 以工具、原始版本、构建、发布类型及发布系列区分版本；`history_assets` 再区分系统、架构、安装器和厂商资源名称。版本总数不包含重复安装资源。LTS、EOL 和 yanked 为可变状态，不参与版本身份；缺少生命周期证据时 eol 为 null，不把未知解释为仍受支持。

`history_reports` 保留发布及补充元数据失败记录，`release_sources` 保留采集检查点和重试时间。历史发布采用新增或更新，不因厂商缩短列表删除记录。资源使用 unavailable 状态保留失效痕迹。`history:probe --tool=node --limit=20` 只检查 HEAD，不批量下载安装包；间隔至少一天的两次 404/410 才判定失效，超时和限流不构成删除证据。检查后执行 history:publish 发布资源状态变化。

覆盖声明为 full、partial、latest-only、undisclosed；full 仅表示声明范围内的官方公开索引已处理完毕。失败不会将已有数据变为零条。Python、Maven、JetBrains 等归档默认声明 partial；不宣称厂商已公开其全部历史。GitHub draft 不公开，preview/EAP 可通过开关查看；PyPI yanked 及原因保留。

Node 的发行索引独立于生命周期补充来源；生命周期文件无法获取时保留采集报告，不阻止发行索引入库，也不猜测 EOL 日期。

## 本地运行与隔离

```sh
pnpm dev:web                 # 启动已配置的本地数据库、API 和 Web
pnpm dev                     # 启动已配置的本地数据库、API 和桌面端
pnpm --filter @siilvana/server db:migrate
pnpm --filter @siilvana/server catalog:sync --all
pnpm --filter @siilvana/server history:export
pnpm history:validate
```

首次配置：创建一个独立日常 PostgreSQL 数据库，通过进程环境提供 DATABASE_URL，再执行 `node tools/catalog/init-local.mjs`。它保留现有 `.env`，只在 `.runtime/history` 创建本地签名私钥。生产环境必须改用受保护的发布密钥及独立 datasetId。

Neon 连接串使用 `sslmode=verify-full`，明确保留证书与主机名校验。若本机通过 `pg` 连接 Neon 超时，可先构建后端，再运行 `pnpm --filter @siilvana/server db:migrate --neon` 或 `pnpm --filter @siilvana/server catalog:sync --all --neon`；该选项通过 Neon 加密 WebSocket（443 端口）执行事务，仅支持 `*.neon.tech` 数据库。部署环境可设置 `DATABASE_TRANSPORT=neon` 使用相同连接方式。迁移失败会输出失败阶段、嵌套错误及错误码，并隐藏连接串和密码；连接超时为 15 秒。

本机 `.runtime/history/local-database.json` 可配置 pgCtl 可执行文件、工作区 `.runtime` 内的 dataDirectory 和本机监听 port。远程数据库部署无需该文件。连接串和私钥不可提交；目录和快照发布信息不包含它们。数据库连接配置读取失败时服务返回不可用，不清空客户端历史。

测试仅允许 `RELEASE_TEST_DATABASE_URL` 指向名为 `siilvana_release_test` 的独立数据库；日常采集 CLI 拒绝测试库。**不要将真实采集数据存入这个测试库。** 集成测试会清空其中的历史表。

## 迁移与回滚

先执行 `pg_dump -Fc` 备份并保存工具数量。迁移只新增 v2 表；采集事务同时维护 v2 和兼容 v1 表，v1 将同版本多构建合并展示。

迁移前已有数据必须保留；运行 `pnpm --filter @siilvana/server history:backfill` 可事务性导入旧记录，也可传入 `--tools=node,git` 限定工具。导入不覆盖既有 v2 记录并保留 v1，覆盖标记为待核验的 partial；后续成功采集再清除该标记。不要将已知测试夹具导入正式快照。

恢复演练使用一个新数据库，运行 `pg_restore --no-owner --no-acl -d <新库> <备份>`，校验数量和关键版本后再切换 DATABASE_URL。跨实例恢复不要依赖原角色存在。原库、备份以及兼容表至少保留 30 天和两个成功采集周期。

回滚读路径可继续使用 `/v1/tools/:id/versions`。已发布工具内容回滚应在数据库保持修订计数的前提下生成更高修订；不可将旧 Manifest 作为新版本部署。数据库灾难恢复前先比对已发布锁文件的最高修订，避免序号回退。

## 快照协议

- `/v2/release-history/manifest`：签名清单、覆盖、数量及来源状态。
- `/v2/tools/:id/history-snapshot?revision=…`：不可变工具快照描述文件。
- `/v2/tools/:id/history-diff?from=…&to=…`：精确基线到目标的 upsert 集合，资源墓碑同样作为更新。
- `/v2/release-history/blobs/:hash`：按 SHA-256 寻址的 gzip JSON 分片。

datasetId 隔离数据集；工具修订与全局 Manifest 修订分别使用单调整数，以字符串传输。schemaVersion=2 只表达格式。禁止用哈希字典序或生成时间判断新旧。快照描述和 Manifest 使用 Ed25519，客户端公钥来自构建源码；未知密钥和格式不能替换现有数据。

分片目标 1 MiB、上限 16 MiB，客户端核验签名、压缩前后大小、两层哈希、记录数量及根哈希。差分必须应用于精确基线且最终根哈希一致；否则重新下载全量。初版保守保留全部已发布修订，未启用破坏性历史清理。

IndexedDB 事务原子替换工具快照并保留修订高水位，Web Locks 协调多标签，兼容实现使用带续租的数据库锁。损坏的新快照可临时回退随包数据，但不能降低高水位。浏览器清除所有存储后只能从随包可信基线恢复。

后台按工具更新，查询由 Worker 处理。存储不足停止持久化更新并提示；内存只保留有限工具。存储不足时按工具 LRU 清理可由同修订或更新随包快照重建的副本；当前工具及当前场景受保护，修订高水位保留。不能安全清理时停止更新，避免将新数据降级成旧随包数据。服务工作线程只缓存本应用静态文件与随包历史，不缓存认证接口；完成后显示离线就绪。首次 Web 访问前不能离线，桌面安装包可首次离线使用。

`history-snapshot.lock.json` 锁定发布清单、公钥和内容哈希。正常构建只校验锁定产物，不访问上游。导出必须持有对应签名密钥，更新公钥与快照需要代码审核；私钥始终留在忽略目录或发布环境。工具私钥轮换应先发布包含新公钥的客户端。

## 安全与运维

服务端请求只连接登记的 HTTPS 来源，重定向逐跳校验，跨域不转发凭据；自定义 DNS lookup 对实际 socket 地址拒绝私网及回环，不能为修复网络失败关闭该检查。系统 hosts 将官方域名指向本机时，采集器尝试直接查询系统 DNS 服务器，只有所有返回地址均为公网地址时才连接；DNS 仍返回私网/空地址则失败并保留质量声明。不修改 hosts，也不关闭 TLS 或私网地址校验。

原生安装配方使用独立签名文件和编译公钥验证，且要求与当前源码生成的目录完全一致。更改目录后运行 `node tools/catalog/sign-native.mjs`，审核变更后再发布。远程采集记录不能提供执行授权。

桌面官方下载先进入 `.siilvana-download` 暂存文件。有官方摘要时校验 SHA-256，再尝试 Defender/ClamAV；失败文件隔离且不自动执行。缺少摘要或扫描器时准确标记未验证。第三方浏览器下载不属于本应用验证范围。软件包管理器安装仍使用其自身完整性机制。

`/ops/history` 为只读状态页；`/ops/history/status`、`reports`、`metrics` 使用 `Authorization: Bearer <OPS_READ_TOKEN>`。令牌不进入 URL、构建变量或持久化浏览器存储。公网部署应在网关设置全实例限流，应用额外提供每进程/IP 限流。

连续三次失败、超过 48 小时无成功采集、异常归零、来源数量下降产生去重告警。没有 OPS_ALERT_WEBHOOK 时只记录事件；配置后发送摘要事件并有限重试。告警日志不应包括连接串、token 或个人文件路径。

GitHub Actions 的 history 工作流需配置 HISTORY_DATABASE_URL、HISTORY_SIGNING_KEY、HISTORY_DATASET_ID、HISTORY_SIGNING_KEY_ID；未配置时明确失败，不能报告全量完成。手动供应链作业生成 npm SBOM、依赖审计和 ClamAV 报告。扫描未执行或平台未验收不能声称已通过。

## 验证

运行 `pnpm check`、`pnpm history:validate`、数据库集成测试及 `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib`。真实采集报告与浏览器验收保存于 artifacts。官方公开范围、网络阻断、未验证下载及未执行的 macOS/Linux 验收必须如实记录。

Docker 的采集源使用官方 docker/docs 文档仓库的 raw-media API，避免文档网站连接失败影响历史记录。JDK 从 Adoptium available_releases 索引发现全部 GA 主版本，包含非 LTS；保留厂商原始系统和架构标识，v1 接口投影为旧客户端支持的枚举。
