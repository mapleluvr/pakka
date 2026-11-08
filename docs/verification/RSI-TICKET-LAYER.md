# RSI 工单薄层验证

## 候选与范围

2026-11-09 本地完成 `@pakka/rsi@0.1.0` 和 `@pakka/memo@0.1.0` 的实现/消费检查。基线为成功 fetch 的 `origin/dev` `e7c938ef3b7c2005ef9db319bd84598c25ab8b23`，工作分支 `feat/rsi-ticket-layer`；原 checkout 和其他 worktrees 未改动。

本次是可选工单服务，不是完整 RSI 业务流程。Memo 只有无 I/O 的包入口。实现、工具、UI、MAS 和示例均使用既有公开接口，没有改动 Runtime、Durable 或已有产品的执行逻辑。

[产物身份](rsi-ticket-artifacts.json)固定所有新增包/消费脚本及 workspace metadata 的逐文件 SHA-256、实际归档 SHA-256 与 npm integrity。源码清单摘要为 `94ee4e20d14e6b512a296f5ccc6caca78e5037c4be374e80b52585fb3f90a3ec`。

| 归档                 | SHA-256                                                          | 逐字节匹配的安装文件 |
| -------------------- | ---------------------------------------------------------------- | -------------------- |
| pakka-rsi-0.1.0.tgz  | a35cd23c312dbe2c9987cdd5e2543ff8d44668d818ae5e906e699012ade8fb94 | 30                   |
| pakka-memo-0.1.0.tgz | 0e594a855c62e72792d0ec8fc6e01c472b5867e6ade211c582516bbf4c0e04d2 | 4                    |

环境为 Windows、Node v24.18.0、npm 11.16.0、TypeScript 7.0.2、OpenSpec 1.9.0。沿用 `pi-durable 1.4.0-pakka.2`，vendor SHA-256 `12d21b230d40706618db4ac83747b9189b7d9070f023c2705bc5c8b521d90ecd`。

## 实际检查

| 检查                                            | 结果与证明范围                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                                 | PASS：全仓 TypeScript/noEmit 与既有 Durable identity guard                                                                           |
| `npm run build`                                 | PASS：十个 workspace，加 DevPack/RSI WebUI facets                                                                                    |
| 五个 RSI test files，经隔离 `test-devin-r2.ps1` | 18/18 PASS；原始结果见[源码回归日志](rsi-ticket-evidence/focused.log)                                                                |
| pi-lens 主动 LSP                                | RSI 11 个生产 TypeScript 文件均 clean；无 unsupported/unavailable/inconclusive                                                       |
| `npm run smoke:package`                         | PASS、exit 0：十个真实 tarball、独立 full/headless 安装、类型声明及全部现有安装消费者                                                |
| 新增安装 RSI consumer                           | PASS：真实 Bot tools → 认证 HTTP extension API → MAS worker tools → 正常重开；[原始结果](rsi-ticket-evidence/installed-rsi.log)      |
| headless consumer                               | PASS：未安装/不可解析 WebUI、Preact、Coding Agent 时，RSI/Memo 与既有 DevPack 入口可用；[原始结果](rsi-ticket-evidence/headless.log) |
| 归档/安装比对                                   | 两个新包全部安装文件与本地打包输入逐字节一致，tarball SHA-512 与消费者 lock integrity 相同，安装目录不是 workspace symlink           |
| 格式与文档                                      | 改动包/脚本/metadata 的 Prettier 检查通过；OpenSpec 严格校验通过，文档链接与 diff 在交付前检查                                       |

安装消费者未携带 workspace overrides、私有源码、测试 oracle 或用户模型配置。RSI consumer 只访问本地确定性 HTTP provider，共 **5 次**模型请求：inbox 原生提交及继续回复，worker 原生查询、原生回报及完成回复。工单最终为 `closed`、原 MAS delivery 为 `done`，作者为 `agent:inbox`、结果作者为 `agent:worker`；正常重开后数据完全相同且请求仍为 5。工单 CRUD/观察本身不触发模型请求。

同一次 package smoke 继续通过已有 runtime、ExecutionEnv、MAS、跨 Session broker/真实 worker、DevPack、server/client/CLI、shell launcher、产品、WebUI services/product、MAS Board、项目 workflows、受控工作流、通知、定时输入、短记忆、Webhook 和语音安装消费者。未另跑全量 source `npm test`；本次 source 范围为新增包相关 18 项，类型/构建与 package 范围为全仓。

## 失败先行与实际修正

- 最初服务、native tools/MAS 和 Backend/UI 测试在实现缺失时失败，随后通过。
- 真实 SQLite 写故障拒绝成功回执并保留早先工单；正常重开恢复内容、修订和原请求，不启动业务工作。
- 异步准备/CAS 期间撤权及角色降级阻止效果；提交已成功而结果发布前撤权保持 unknown，重新获权后可查询原回执。
- 外来作者读/改被拒绝；处理者仅报告所分配工单；列表先过滤权限再分页；陈旧/复制 native invocation 被拒绝。
- MAS 实际接收原修订；作者后续编辑不追加启动。故意丢失 native admission 后返回值时，unknown 和重复请求均不重投。
- 重叠 refresh 的早期 `placed` 观察曾覆盖后来确认的 `done`，受控延迟真实 MAS 回执的测试复现后修复。
- 数组形式的状态值曾通过字符串转换进入存储，真实服务输入反例复现后改为严格标量 schema；拒绝时无原请求记录或状态变更。
- WebUI 真实写入后丢失 fetch 响应曾无法核对：浏览器 request key 与 BackendContext 的 host operation ID 不同。现在先解析原 operation，使用原结果或 operation ID 查询 service receipt；浏览器测试确认只有一张工单、没有重提。
- 历史容量与 UI schema 容量先有失败回归，再限制单工单 192 KiB；长修订/进度仍能经真实 decoder 与 Backend 读取。
- 第一轮安装声明检查因 Prettier 改变 `@ts-expect-error` 对应行而失败；注释放到具体字段后完整 package smoke 通过。该失败未作为产品运行失败或被跳过。

## 界面检查

自动浏览器从实际登录、侧栏入口和按钮执行创建、修改、回报/关闭及手机重开；手机导航先打开侧栏并等待原生动画结束。确认手机工单区域无水平溢出。丢响应测试只在真实服务已返回后截断浏览器 fetch 结果，不替代服务执行。

主会话另用 ego-browser 对实际装配页面完成中文建单、来源显示、分派、内容修订和 `waiting` 报告。直接检查桌面 1920×921 与手机 390×844 截图：列表/详情、状态、修订、表单和动作可辨识，手机折为单列并保留返回列表按钮。该检查未调用模型。使用的 TaskSpace 和临时 server 均已正常关闭。

原始本机证据在 `artifacts/rsi/final-complete/`、`artifacts/rsi/final-webui-recovery/`、`artifacts/rsi/red-shape-observation/` 与 `artifacts/rsi/manual/`；关键回归日志和产物身份随本记录跟踪。其他中间失败日志保留在 `artifacts/rsi/`，package 原始日志与成功消费者路径在 `artifacts/package-smoke/`。

## 结论边界与后续

本次证明工单服务、持久化、身份、工具、MAS 和界面接点可用。确定性模型输出用于触发真实生产路径，不证明实际模型会自主发现想法、研究或构建高质量成果。未运行付费/真实模型试跑；本轮没有实现 IM 采集、研究/构建/部署 pipeline、自动 review 策略或 Memo 功能。

服务有明确容量，没有无限历史/自动 GC。工单提交与 MAS admission 不是跨存储原子事务；如果投递成功却没有可保存的 receipt，保留 unknown 并阻止替代派发，当前版本没有自动 reconciliation 工作流。关闭 UI 不取消工作，正常重开不恢复任意 JS 调用栈。生产启用需显式装配工具、服务、角色和 handler 路由。

按操作者既有指令未使用 subagent review；上述源码复核、浏览器实操及证据核对均由主会话完成，不表述为独立第三方验收。工作分支 PR、合入 dev 和 OpenSpec archive 分别记录；本次未执行 dev/main 集成或 npm 发布。
