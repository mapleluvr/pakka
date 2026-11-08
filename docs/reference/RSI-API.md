# RSI 工单 API

当前预期见 [RSI state](../state/rsi.md)。公开入口与可运行装配见 [package README](../../packages/rsi/README.md)和 [workbench 示例](../../packages/rsi/examples/workbench.mjs)。包为私有、显式启用；没有自动发现或导入副作用。

## 服务与身份

`createTicketService({ runtime, namespace, handlers?, dispatcher?, maxTickets?, maxRequests?, maxBytes? })` 打开所属 Runtime 的工单空间。每个 namespace 由一个服务实例协调，底层沿用 Runtime 的单 writer/CAS。

`service.connect(actor)` 只交给受信任装配代码。`actor` 提供稳定 `id`、当前 `role()` 和有效期 `check()`。每次读取、提交准备、真实提交与结果发布均检查当前身份；写入时重新检查具体动作所需角色。浏览器、工具和工单正文均不能选择 actor。

| 角色      | 可见与操作范围                                     |
| --------- | -------------------------------------------------- |
| submitter | 提交；读取、修改自己提交的工单                     |
| handler   | 提交和编辑自己提交的工单；读取、报告分给自己的工单 |
| manager   | 空间内工单的读取、编辑、分派、报告和显式执行       |
| reader    | 只读自己原有的作者记录，不能新增或修改             |
| null      | 撤回工单访问                                       |

`client.withAuthority(check)` 叠加当前 lease，不能替换原身份检查。`service.forInvocation({ actor, source }, scope)` 通过公开 native catalog 验证完整 Conversation 与当前真实工具 scope；复制、陈旧、跨 Conversation 的 scope 拒绝。

## 操作

| 方法           | 输入                                                    | 返回与效果                                                         |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `submit`       | requestId、title、body、sources                         | 保存成功后立即返回 TicketReceipt；不派发                           |
| `edit`         | requestId、id、expectedVersion、完整 title/body/sources | 新内容修订；不修改既有运行的输入                                   |
| `get`          | id                                                      | 当前 ticket、修订/事件/运行，以及当前操作权限                      |
| `list`         | 可选 state、mine、cursor、limit                         | 权限过滤后的摘要页；limit 默认 20、最大 50                         |
| `lookup`       | 原 requestId                                            | 当前 actor 的原 mutation receipt 或 null；无重复效果               |
| `assign`       | requestId、id、expectedVersion、handlerId 或 null       | manager 选择宿主注册的处理者；不自动启动                           |
| `report`       | requestId、id、expectedVersion、state、text、links      | handler/manager 写入进度与结果，显式改变状态                       |
| `dispatch`     | requestId、id、expectedVersion                          | manager 显式投递该内容修订；返回原准备回执，不等待生成             |
| `refresh`      | id、runId                                               | 查询原 MAS 回执，更新运行观察，返回 TicketView；不重投、不关闭工单 |
| `capabilities` | 无                                                      | 当前提交/管理/派发能力及可选 handlers                              |

工单状态为 `open / active / waiting / closed`。所有变更推进 `version`，内容编辑另外推进 `contentRevision`。Receipt 是原操作发生时的记录，派发后的回执观察可能已推进工单版本；继续编辑应先 `get` 当前版本。

requestId 在同 actor/空间内绑定原操作和规范化参数；不同参数冲突拒绝。相同请求返回原 receipt，列表/详情另读当前状态。权限过滤先于分页；cursor 指向已可见的最后一项，失效 cursor 明确冲突并要求刷新。

## 工具与 MAS

`createTicketTools({ resolve, timeoutMs? })` 贡献 `ticket_submit/edit/get/list/lookup/capabilities/assign/report/dispatch/refresh`。工具表不授予角色；每个工具最终通过当前 bound client 执行。`resolve(scope)` 应返回上述 `forInvocation` 客户端。默认期限 30 秒，可在 1–120,000 ms 内配置；取消/超时不能被当作已接受操作的回滚。

`createMasTicketDispatcher({ routes })` 接受有限的 `{ handlerId, target, client }`。client 已由宿主绑定 principal、source 和 MAS grants；adapter 不创建成员或授予权限。一次运行保存 handler、完整 target/source、principal、内容修订、原投递 requestId 与收到的 receiptId。

工单先保存 pending run，再请求 MAS native admission。后续内容修改与运行观察都保留原输入修订。相同 dispatch 请求不重发；pending/queued/placed/unknown 运行阻止新派发。receipt 查询只使用原路由；目标 incarnation 变化后，不把原记录悄悄指向新成员。native `done` 只说明该次 generation 得到回答；工单结果由明确的 `report` 表达。

## WebUI

装配 `rsiExtensionRoot` 的 backend/client/webui facets，并通过 `ticketExtensionService(context, service, { roleForPerson? })` 提供名为 `tickets` 的服务。一个页面承载同一空间，无需 Conversation target。

app 级 actions 使用宿主的当前登录/registration 检查，细粒度业务权限在工单服务执行。默认全局管理员为 manager、viewer 为 reader，其余已认证人类为 submitter；scoped admin 不自动管理全部工单。宿主可显式给 `roleForPerson` 当前角色策略。

Backend mutation requestId 使用宿主 operation ID，正文不能覆盖。浏览器保存自己的原 requestId；恢复时先通过 operationByRequest 得到原 operation，再读取确认结果，或用 operation.id 查询工单服务的回执。`ticketCall`/`readTicketResult` 使用每个 action 的有限 runtime schema。已知拒绝或冲突保留草稿；未知响应保留原 requestId，通过 lookup 和宿主 operationByRequest 核对。UI 在 tab session storage 中仅保存未确认 requestId，不保存正文或凭据。关闭页面不删除记录，也不取消已派发工作。

## 容量与失败

| 对象   | 边界                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| 空间   | 默认 256 tickets、4,096 mutation receipts、4 MiB JSON；配置上限分别为 4,096、32,768、16 MiB |
| 单工单 | 192 KiB JSON，最多 128 revisions、256 events、64 runs                                       |
| 输入   | 标题 200、正文/报告 12,000 UTF-16 code units；8 条引用，每条最多 2,048                      |
| 处理者 | 最多 64 个明确注册项                                                                        |

结构、版本、身份和历史一致性在重读时验证。`invalid / denied / conflict / capacity / unknown` 区分参数、权限、版本/请求冲突、容量和未知结果。容量拒绝保留原记录；无自动裁剪或删除。真实存储写入不明会封闭服务，需要恢复所属 Runtime 后查询原请求。

提交前撤权阻止效果；已提交后失去发布权限保持 unknown，恢复权限后可查询原 receipt。工单存储与 MAS 投递不是跨存储原子事务；已投递而未留住回执的运行保持未知，当前版本不自动重送或提供通用 host-side reconciliation workflow。正常重开重绑定当前权限并保留数据，不恢复旧 invocation，也不自动继续业务流程。

## 包边界

`@pakka/rsi` 与 `/agent`、`/mas` 可 headless 使用；`/backend`、`/client`、`/webui` 为显式可选面。生产包只使用公开 exports。`@pakka/memo` 当前只有无 I/O 的构建入口，其记忆/Wiki 功能语义待后续定义，RSI 不依赖它。
