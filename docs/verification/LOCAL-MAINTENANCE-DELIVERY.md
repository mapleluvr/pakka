# 本机维护与交付：固定候选验证

## 候选与环境

- 日期：2026-11-07；分支 `pakka/long-lived-deliveries`，追加至 [PR #4 → dev](https://github.com/mapleluvr/pakka/pull/4)，不合并。
- 构建基线：`83246bacee72efe21d10b522588b211b9892b30f` 加 [20 个 TS/MJS 文件的源码清单](evidence/local-maintenance/2026-11-07/source-before.json)。聚合 SHA-256 为 `0a962daae2e8600d809a5d1b5ad8217892f0bdbb5f26d8486c2614b585e85f68`。这不是后续保存提交的 SHA。
- 完整回归前后与保全时源码相同：[after](evidence/local-maintenance/2026-11-07/source-after.json)。根 `package.json` 的附加身份见 [summary](evidence/local-maintenance/2026-11-07/summary.json)。
- 源码清单记录实际 Windows 工作树字节。Git 对其中 7 个文件将 CRLF 归一化为 LF；逐文件比对确认除此之外没有差异，[Git index 映射](evidence/local-maintenance/2026-11-07/source-git-index.json)保留两份哈希和 blob ID，不改写运行时的原始清单。
- Windows x64，Node `24.15.0`、npm `11.12.1`，Pi Durable `1.4.0-pakka.2`。模型请求只到隔离本地夹具；安装依赖使用标准 npm registry/cache，不调用外部付费模型。
- 测试使用独立 HOME、Pi 目录、存储、浏览器与本地伪凭据，不恢复或更改用户的实际数据。

## 实际结果

| 范围               | 结果与证据                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 构建、严格类型     | `npm run build`、`npm run check` 通过：[build](evidence/local-maintenance/2026-11-07/build.log)、[types](evidence/local-maintenance/2026-11-07/types.log)。固定 Durable 归档校验通过。                                                                                                            |
| 完整源码回归       | **838 项：836 通过、0 失败、2 项原有 POSIX 专用浏览器场景在 Windows 跳过**：[full](evidence/local-maintenance/2026-11-07/full.log)。                                                                                                                                                              |
| 仓库外安装消费     | 8 个归档，34 个打包、安装、声明和消费者步骤全部通过；包含 pwsh 安装命令与原 Session 重开：[汇总](evidence/local-maintenance/2026-11-07/installed.log)、[逐步日志](evidence/local-maintenance/2026-11-07/installed/)。                                                                             |
| 安装版维护生命周期 | 固定归档、禁安装脚本的独立安装、冷快照、不创建 Harness 的健康检查、入口转交、原身份重开、数据回退、恢复停机、新登录、显式继续与重复回退只读原回执均通过：[maintenance](evidence/local-maintenance/2026-11-07/installed/maintenance.log)。                                                         |
| 文档               | 22 个改动文档的格式、本地链接和标题锚点，以及新增维护 change 的 OpenSpec 严格校验通过：[文档检查](evidence/local-maintenance/2026-11-07/documents.json)、[OpenSpec](evidence/local-maintenance/2026-11-07/openspec.json)。                                                                        |
| 主动诊断           | 最终主动检查 17 个 TS 路径，16 个无诊断，1 个适配器超 5000 行未由 LSP 检查；完整 TypeScript 检查覆盖全体：[实际结果](evidence/local-maintenance/2026-11-07/final-active-lsp.txt)。扫描前的三条解析异常传播规则已核对 CLI 统一捕获与失败门禁；原缓存与范围外剩余诊断均保留，不称整个诊断缓存干净。 |

维护专用的实际场景包括：

- 原 owner 的旧登录失效，其他人的权限保留；10 分钟一次性凭据只兑换一次，重查原 recovery ID 不续期。
- 私密预备文件或认证提交后的交付失败，均按原发行操作核对，不另行发行；令牌不通过终端、shell 参数或 Session 内容交付。
- 活跃 writer 拒绝，真实进程退出后只处理匹配的原 claim；未知身份不自动清理。
- Session 内核维护读取/CAS、SQLite 快照、深层 Windows 路径和真实未完成 native Job 均有覆盖；维护没有调用该 Job handler 或模型。
- 声明的子 Session 缺失、备份篡改、已有目标以及无可信归档身份时拒绝，不发布“完整”备份。
- 当前库损坏、缺失、数据根缺失，以及损坏库带真实已退出 writer 时，可以先保全原字节或记录缺失，再恢复验证过的备份。
- 目录发布中断保留根外门禁，普通启动及可信宿主模块求值都被阻止；重复原命令续完原发布，不补建空 Session。
- 恢复撤销旧登录和待兑换邀请；原工作摘要/指纹必须显式确认才解除停机，不重置未知任务、输入或回执。

## 失败、修正与复验

开发过程保留失败，不计作通过：

1. Windows 的原路径与短路径别名曾被误判为身份变化；改为核对物理文件身份，同时保留 reparse/junction 拒绝。
2. 普通产物具有 `storage.json` 或 `-wal` 名称时曾被误识别；收窄到已核对的数据库路径，并加入多 Session 备份覆盖。
3. 初次独立升级安装因离线缓存缺少正常依赖失败，发生在备份/切换之前；改用标准 registry/cache 安装。没有手改已安装依赖。
4. Windows 315 字符的 SQLite 快照目标失败，使用扩展路径后通过；正式维护和安装版升级均已覆盖。
5. 恢复停机曾未阻止可信宿主模块求值：[红](evidence/local-maintenance/2026-11-07/host-gate-red.log)／[绿](evidence/local-maintenance/2026-11-07/host-gate-green.log)。门禁前移，最终全量再次通过。
6. 损坏库加已退出 writer 曾要求先健康打开原库：[红](evidence/local-maintenance/2026-11-07/damaged-writer-red.log)／[绿](evidence/local-maintenance/2026-11-07/damaged-writer-green.log)。修正后保留原 claim 字节，不用清锁绕过损坏。最终全量再次通过。

红绿日志描述各自开发阶段；最终冻结候选的结果以完整回归与最终安装日志为准。

## 前序文档检查

另外复验了仅更新 tasks 的 `improve-webui-navigation-and-local-recovery`。其 strict 检查因三个已有的 Devin 条款长度超过 500 字符而失败，不能记作通过：[实际输出](evidence/local-maintenance/2026-11-07/prior-navigation-openspec.json)。这份 delta 与构建基线的 Git blob 相同，身份见 [summary](evidence/local-maintenance/2026-11-07/summary.json)。本次没有为清除长度告警重写旧的模型选择/排版契约；新增维护 change 的 strict 检查独立通过。

## 适用边界

- 这是本机停服维护，不是浏览器提权接口，也不承诺在线热备。
- “完整”指已登记/声明的持久存储域与纳管文件。外部项目、Pi 配置/凭据、宿主模块及 `PAKKA_HOME` 启动定位须另行保全；原位置恢复依赖原产品定位。整个 HOME 丢失后的自动重建与跨机器迁移不在本版范围。
- 同一候选归档的安装、升级和数据回退已验证，不推导任意旧版本的数据迁移兼容。首版使用操作者确认来源的本地 release 清单，不支持 `latest`。
- 哈希校验不等于发行者认证。备份未加密，须按敏感历史/可能含旧宿主凭据的私密资料保管。
- Windows ACL、长路径与真实进程已执行；POSIX 代码路径不能据此记为设备通过。
- 备份不是撤销外部效果的机制；恢复后确认工作集不等于证明备份之后的效果不存在。
- 流式复制避免整体装载备份文件，但本轮没有建立 WebUI/多 Runtime 的 OOM 上界，也没有完成默认 Dynamite 的产品装配；两者由所属任务继续。

## 保全与复核

- 所有证据文件的长度与 SHA-256 在 [files.json](evidence/local-maintenance/2026-11-07/files.json)；归档与消费者身份在 [archives.json](evidence/local-maintenance/2026-11-07/archives.json)。
- 固定 release ID：`1a7f3f618b268ec296a01455edace46bca71e1baee5a7513fa54eb2c2745992a`。
- 8 个原归档、release 清单、消费者锁文件及升级安装锁文件保全于 `D:/Projects/pakka-works/.backups/2026-11-07-local-maintenance-release/`；私密目录含恢复 README 与逐文件哈希，没有测试凭据或数据库。
- 验证命令：`npm run build`、`npm run check`、`npm test`、`npm run smoke:package`。开发阶段红绿使用所列单项测试。`npm run pack:release` 提供固定发行清单生成入口，实际发行清单亦由本次安装检查调用同一生成函数产生。
- 复核源码、归档和文件哈希，再按[维护指南](../guides/LOCAL-MAINTENANCE.md)在新的隔离工作区演练。不要以测试归档直接维护未备份的用户数据。

预期在[本机维护 state](../state/local-maintenance.md)，采用经过在[变更记录](../changes/local-maintenance-and-delivery.md)，任务和未完成资源治理见 [OpenSpec tasks](../../openspec/changes/add-local-maintenance-and-delivery/tasks.md)。
