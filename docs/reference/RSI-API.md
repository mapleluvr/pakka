# RSI 工单 API

当前预期见 [RSI state](../state/rsi.md)，可运行装配见 [package README](../../packages/rsi/README.md)及 [workbench](../../packages/rsi/examples/workbench.mjs)。`@pakka/rsi` 为宿主显式装配的通用工单服务。

## 服务与身份

`createTicketService({ runtime, namespace, handlers?, dispatcher?, migrateLegacy?, maxBytes? })` 绑定原 Session/namespace，使用 `runtime.records()` 的按键记录、独立历史流和原子事务。多个服务实例通过记录版本与原请求回执协调。`maxBytes` 只用于核对迁移源的旧 RuntimeStore 配置（默认 4 MiB）；历史 `maxTickets/maxRequests` 参数保留源码兼容，累计条数不参与接纳。

`service.connect(actor)` 是受信任宿主入口。actor 提供稳定 `id`、当前 `role()` 和有效期 `check()`；UI 与模型参数提供业务内容，身份由宿主绑定。每次读取、提交准备、事务和发布重新核验权限。`withAuthority(check)` 叠加 lease。原生工具使用 `forInvocation({ actor, source }, scope)` 验证原 Conversation 和当前真实 invocation。

| 角色      | 操作范围                                    |
| --------- | ------------------------------------------- |
| submitter | 建单、读取与编辑自己的工单                  |
| handler   | 作者操作，以及读取和报告分给自己的工单      |
| manager   | 空间内读取、编辑、分派、报告和显式派发/恢复 |
| reader    | 读取自己的既有作者记录                      |
| null      | 访问已撤销                                  |

## 调用与分页

| 方法           | 关键输入                                                             | 返回与效果                                       |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| `submit`       | requestId、title、body、sources                                      | 持久确认后的 TicketReceipt                       |
| `edit`         | requestId、id、expectedVersion、完整内容                             | 新内容修订和事件                                 |
| `get`          | id                                                                   | 当前内容、权限和三个历史窗口，以及各自 cursors   |
| `history`      | id、kind、cursor?、limit?                                            | revisions/events/runs 的下一页，默认及最多 32 项 |
| `list`         | state?、mine?、cursor?、limit?                                       | 有权摘要页，默认 20、最多 50 项                  |
| `observe`      | 无                                                                   | 当前身份/角色范围内的小 revision token           |
| `lookup`       | requestId                                                            | 当前 actor 的原业务回执或 null                   |
| `assign`       | requestId、id、expectedVersion、handlerId/null                       | 注册处理者分配                                   |
| `report`       | requestId、id、expectedVersion、state、text、links、runId?、results? | 进度/状态和结果引用事件                          |
| `dispatch`     | requestId、id、expectedVersion                                       | 保存固定计划，显式发送，返回原计划回执           |
| `recover`      | requestId、id、runId、expectedVersion                                | 明确继续尚未发送的计划，或核对原运行             |
| `refresh`      | id、runId                                                            | 只查询原 delivery、补记本地状态，返回详情        |
| `capabilities` | 无                                                                   | 当前权限及已注册 handlers                        |

状态为 open/active/waiting/closed。所有变更推进 version，内容编辑另外推进 contentRevision。原回执记录操作发生时的版本，继续编辑应重新读取当前版本。

同一 actor/requestId 的规范化参数必须一致；原请求重试返回原回执。提交后失去发布权限时结果为 unknown，恢复权限后查原请求。持久失败封闭写入，不能凭未收到响应判定操作未发生。

`get` 的历史数组明确是有界窗口。每页内部按时间正序，续页向更早历史读取；游标固定序列边界，新追加项由刷新取得。列表按创建顺序倒序遍历，当前状态和权限在读取时过滤。每次扫描最多 128 项；发布前核对空间变化序列，发生并发修改时从同一游标重读，最多尝试 4 次后返回冲突。即使没有匹配项也可能返回续行游标；空页不表示结束。游标绑定 Session、namespace、流及列表查询/角色，不授予权限。WebUI 每次替换历史页和列表页，Refresh 返回最新窗口。

`observe` 按已提交的空间/作者/处理者变化序列计算小 token；不包含其他作者正文。WebUI 使用宿主只读订阅，每秒读取 token，变化时刷新当前页，离开页面停止订阅。编辑中的草稿不会因观察刷新而清空。

## 固定计划与恢复

Run 保存 ticketId、contentRevision、route（原 target/source/principal）、dispatchRequestId、payloadHash 和阶段。工单后续编辑不改变原输入。保存计划前以 `dispatcher.validate(route,input)` 纯校验实际固定输入；MAS 适配器限制序列化后正文为 65,536 UTF-16 units。该校验不进入 admission，也不产生外部效果。发送顺序是保存 planned，再以独立 attempt 身份原子转换为 dispatching，只有实际赢得 CAS 的调用才能发送。显式继续 planned 时也先做纯校验；已有 unknown 不能因此自动清除。

| 阶段                            | 当前受权操作                                            |
| ------------------------------- | ------------------------------------------------------- |
| planned                         | 显式 recover 可继续原计划；并发通过 checkpoint CAS 竞争 |
| dispatching/unknown，无 receipt | 以原路由、请求 ID 和固定正文调用纯 lookup               |
| 找到原 delivery                 | 补记 receipt 和 accepted；继续观察原结果                |
| 无记录、路由不符或无法确认      | 保持 unknown，等待核对；admission hook 可能已有外部效果 |
| accepted                        | 只查原 receipt；已确认终态不被迟到观察降级              |

`MasClient.lookup(target, input)` 在已绑定 principal/source 下查原请求，比较 target、mode/text 和关联身份，读取不进入 admission 或调度。null 表示 Catalog 没有原 delivery，不能证明 admission hook 没有效果。

新派发被本工单尚未完成或未知的运行阻止。generation 完成更新运行事实，关闭、重开或继续工单由 workflow 或有权用户报告。普通创建服务、列表、详情、观察和正常重开均不发送工作。

`report.results` 最多 8 个 `{ uri, version?, sha256?, description? }`，可用 `runId` 绑定本工单的原运行。引用描述产物身份，不授予目标产物访问权限，也不把执行全文复制进工单。

## 资源与故障边界

| 边界             | 当前值                                                               |
| ---------------- | -------------------------------------------------------------------- |
| 输入             | title 200、body/report 12000 UTF-16 units；8 条 link，每条 2048      |
| 结果引用         | 8 条；uri 2048、version 160、description 1024、sha256 64 hex         |
| 处理者           | 最多 64 项                                                           |
| 单事件           | 完整 JSON 编码后最多 180 KiB，提交前核验，保证可由历史页读取         |
| history / detail | history 192 KiB、detail 256 KiB 内；包含解码正文成本                 |
| records          | 每记录 384 KiB、每事务 1 MiB；最多 128 读版本、64 写记录和64追加项   |
| 活动工作         | 同 Session 最多1024项且索引不超过1 MiB；完成项退出，历史与原回执保留 |

这些约束保护输入、查询、事务和未完成工作。累计工单、历史和请求回执不定义空间寿命。records 使用者启用 Pi 公开 `documentRetentionMs:0`，未观察文档用后可释放；执行上下文和观察者固定持有的文档仍由各自生命周期管理。

## 迁移与维护

旧 schema 1 使用者先停服并完成一致冷备份，再以原 Session、namespace 和原 maxBytes 显式传 `migrateLegacy:true`。新空空间直接初始化。普通打开发现旧布局时返回迁移提示。

迁移校验全部旧身份与顺序，原子冻结旧 RuntimeStore 写入并保存迁移源 hash，然后分批写入确定性记录，最终发布 layout 2。源文档保持可读；中断后重复同一显式迁移，已提交块按原回执续行。只有发布完成的布局可进入普通业务。旧 pending/unknown 缺少发送证据，阶段保留 unknown。发布后打开服务只读取新元数据，不再解码旧 snapshot。

运行 checkpoint 与宿主活动记录索引原子提交，停服维护的 `work()` 包含 pendingRecords 及其指纹。备份恢复遵循产品停机核对门；原始备份可能落后于外部效果，需要查询原 MAS 接收方。切回旧程序不等于数据库回滚；旧 schema 1 写入端已冻结。

WebUI 扩展操作回执亦按键保存；配置文档保留有界 settings/initialization。旧扩展回执迁移不执行处理器；pending/unknown 继续禁止重新执行。写操作的原浏览器请求通过 operationByRequest 定位宿主 operation.id，再向 RSI lookup 核对。

## 消费入口

`@pakka/rsi`、`/agent`、`/mas` 支持 headless；`/backend`、`/client`、`/webui` 为可选面。Bot 贡献与上述方法对应的 `ticket_*` 工具。WebUI 的 backend/client/webui facets 通过 `ticketExtensionService` 注入同一服务；全局管理员默认 manager，viewer 为 reader，其余为 submitter，宿主可给当前角色策略。

页面 session storage 只保留未确认 requestId。认证秘密和工单正文不进入页面存储。Memo 保持独立惰性入口，其后续领域语义另行设计。
