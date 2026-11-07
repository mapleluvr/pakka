# 长期投递持久化验证

本记录验证同 Session Catalog 的长期输入接纳、旧记录迁移与原请求核对。完整历史的保存与模型上下文的选取分别管理；默认 Dynamite 装配由独立 change 承接。

## 候选身份

- 基线：`e7c938ef3b7c2005ef9db319bd84598c25ab8b23`（已合入 Git 工作流规范的 `dev`）。
- 工作分支：`pakka/long-lived-deliveries`。
- Node：`v24.15.0`，Windows x64。
- 最终候选源码清单摘要：`911f6cb8d5e8df7634e18934bfa965ae7e5f99b466f01826c161a44a9adef26b`。
- 验证期间使用隔离目录、合成数据与 loopback 模型服务；没有读取用户会话正文或调用外部付费模型。

## 已验证行为

| 范围             | 核对方式与实际结果                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 解除累计接纳门槛 | 先在原版复现第 513 笔被拒绝；修改后跨两个 Conversation 顺序完成 520 笔，正常关闭、重开原 Session 后继续接纳。                     |
| 原请求去重       | 重开后核对首笔请求与回执；原身份及结果保持，没有额外模型请求。不同内容复用原请求仍被拒绝。                                        |
| 存储布局         | 完成 520 笔后接纳索引小于 16 KiB；继续接纳不改写首笔独立归档文档。完整记录仍可按游标读取，权限过滤先于结果公开。                  |
| 旧格式           | 使用真实 Storage API 制造 v1 布局；正常迁移保留原 ID、native submission、顺序与正文。真实 SQLite 写锁下迁移失败不会只提交一部分。 |
| 损坏与未知状态   | 指纹损坏、原生接纳关系不匹配时封闭；不补造回执、不替换 Session、不重放原输入。                                                    |
| 未完成工作与权限 | 现有 pending、owner、动态撤权、task 归属、原生队列、持久化 unknown 回归保留并执行。                                               |
| 配置与进程边界   | server、真实 worker、WebUI 与安装消费者使用不含 `maxDeliveries` 的配置；旧字段仍兼容接收但不参与接纳和存储身份。                  |

该存储改动复用 Pi Durable 的公开文档与事务 API，没有修改已安装依赖。首次修改 v1 Catalog 时，在同一原生事务中校验旧投递与 submission 关系、拆出独立记录并建立索引。

## 执行记录

构建和完整 TypeScript 检查通过。LSP 对本次可覆盖文件未报告错误；`durable-adapter.ts` 超出 LSP 扫描行数限制，由完整 TypeScript 检查覆盖。

第一轮全量结果为 812 项：809 通过、1 失败、2 项原有平台跳过。唯一失败发生于 HTTP 权限测试发出请求前的 `fetch failed / bad port`。同一测试独立重复 8 次通过，完整报告定位后，对照本机 Node 24 内置 Fetch 规则发现共享监听器缺少 `4190`、`6679`。补充确定性测试后，原实现为 2 通过、4 失败；补齐两项后，监听器与 HTTP 的 19 项回归通过。权限断言保持原样。

端口修正后的最终 Node 24 安装消费通过：8 个归档在仓库外安装，严格公开声明、headless SDK、MAS、真实 broker/worker、CLI、WebUI 及安装生成的 pwsh `pakka` 均通过；原 Session 重开与原请求核对没有额外模型调用。安装包的公开 HTTP 监听器另行验证了 `4190`、`6679` 的拒绝行为。

最终源码全量回归为 **816 项：814 通过、0 失败、2 项原有平台跳过**。验证前后的 16 个源码/测试文件清单及摘要完全一致。固定的[证据与归档哈希](evidence/long-lived-deliveries/manifest.json)、[源码清单](evidence/long-lived-deliveries/source.json)、[全量输出](evidence/long-lived-deliveries/full.txt)和[安装消费](evidence/long-lived-deliveries/installed.txt)随本记录保留。

一次准备命令误用了 `npm exec node`，它另行解析了 Node 包；该任务已停止，未计入验证。有效安装检查明确使用本机 Node 24 与现有 npm CLI。

## 验证边界

- 520 笔用于越过原来的拒绝条件及检验原请求核对，不代表半 GB 历史或无限磁盘的性能认证。
- 本次解除 workspace 和同 Session MAS Catalog 的累计投递门槛。跨 Session broker outbox 的容量、完整 received/inbox 集合读取、稀疏权限过滤的历史扫描仍有各自的扩展工作。
- 完整历史不会因本次修改而全部送入模型。模型上下文治理的默认策略、触发条件和预算仍由相应 Dynamite 装配任务负责。

## 接续

- [形成记录](../changes/long-lived-deliveries.md)
- [设计](../../openspec/changes/retain-long-lived-deliveries/design.md)
- [任务](../../openspec/changes/retain-long-lived-deliveries/tasks.md)
