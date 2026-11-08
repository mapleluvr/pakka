# RSI 工单

`@pakka/rsi` 提供一个由宿主装配的持久工单空间。Agent tools、WebUI 和 workflow 客户端使用同一份记录。工单服务保存内容、作者、处理者、通用状态、修订、进度与结果引用、关联的 MAS 运行；研究、构建、测试和应用由调用它的程序组织。

## 身份与操作

受信任宿主绑定稳定 actor ID、动态角色和有效期检查。提交者可以非阻塞建单、编辑自己的工单并查询；分派的 handler 可以读取和报告所分配工单；manager 可以查看空间内工单、编辑、分派、报告和显式派发。reader 只读取其原有归属记录。身份与角色来自服务端 closure，模型和浏览器参数只表达业务内容。

提交在持久化成功后返回原请求回执，不等待处理。修改带 `expectedVersion`，并发冲突保留原草稿和已存记录。`version` 覆盖全部变更，`contentRevision` 只覆盖内容修订。相同 actor/request 的相同操作返回原回执，参数冲突拒绝；lookup 只读原请求，不重进副作用。

通用状态为 `open / active / waiting / closed`。处理阶段、结论和结果引用由 progress report 表达。列表在过滤权限后分页，详情包含内容修订和事件记录。

## 执行与存储

MAS 对接使用宿主批准的 handler 路由和已授予的 MasClient。显式 dispatch 先保存运行身份与精确内容修订，再投递到原生 MAS；编辑工单不会启动另一次运行。运行保留发送者、完整目标引用和原回执。原生 generation 完成与工单关闭分别表达。未确认投递保留 pending/unknown，查询和重复原请求不重新发送。

数据在所属 Runtime 的独立 namespace 中通过 CAS 保存。记录、原请求和版本随正常重开保留；当前权限由宿主重新绑定。容量和结构在写入/读取时检查，容量耗尽拒绝新增，未知存储不返回成功或自动清空。实际边界与调用方式见 [RSI API](../reference/RSI-API.md)。

## 可选界面与包

WebUI 通过公开 Backend、Client 和页面插槽提供工单列表、详情、创建/编辑、处理者选择、进度/结果、修订及回执观察。页面使用当前人类身份绑定服务，已关闭页面的回调失效；关闭页面不删除工单或取消已派发工作。失去确认的写入保留原 request ID，先只读核对。

`@pakka/rsi` 的 headless/Agent 入口独立于 WebUI runtime。`@pakka/memo` 当前是一个可构建的惰性 workspace 入口，其功能语义待单独定义；工单持久化由 RSI 自身承担。

形成记录见 [RSI 工单层](../changes/rsi-ticket-layer.md)，场景见 [rsi-tickets](../../openspec/changes/add-rsi-ticket-layer/specs/rsi-tickets/spec.md)。
