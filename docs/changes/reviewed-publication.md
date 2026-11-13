# 2026-11-12：按对象归属整改发布边界

全仓 development 审查（双 reviewer workflow `0fd3a0ee`）归并六项 P1 和一项 P2。用户批准处理 A-1 至 A-5 与 B-2；MAS Board 的 B-1 容量适配留待重构，本次不修改 Board，也不缩小 MAS 通用消息能力。

## 对象与修正位置

- **Dynamite / A-1**：已发表 Book 正文、目录、图、保存的引用和补注按 Book 自身授权。真正回源才核验目标及固定版本。来源键摘要随版本根保存；没有可选解析端口时也保存空键快照，后来装配端口不会重新解释旧索引。读、改旧索引和重开不重读已保存引用的目标资料。引用准入验证仍由新提交动作负责。
- **Memo / A-2**：完成结果保留原服务、invocation 和结果绑定的同步 verifier；`research_finish` 在最后一次异步处理后检查工具贡献、lease、invocation 和完成结果。已提交完成后失权返回 unknown，run 与原发表回执仍保留。不是给 MAS 增加馆员语义。
- **HTTP / A-3**：v1 transport 在 dispatch 结束、序列化响应前重新核验本次 issuer；撤销后不发布成员 snapshot。消费已有 issuer 能力，不改变成员服务。
- **RSI / A-4**：在最终公共写入返回前核验具体工单的读取权限，回执发布不重新要求原执行资格；已提交后的执行续行或发布异常返回 unknown，保留原请求和回执。发布拒绝不毒化健康 Runtime。
- **Agent / Historian / A-5**：HistoricalWork lookup 和 Historian status 分别在自己的最后一次 await 后重验对象读权；普通状态读取不创建记史 Session。
- **EI / B-2**：独立文档分支先本地保全并逐项核验 23 项原材料，再移出 21 项原始交付文件，正式树保留两份摘要。文件实现不变；来源及包身份见 EI 所属记录。

Book 服务仍归 Dynamite；图书馆适配仍在 `@pakka/memo/dynamite`。没有增加上游 Memo 专属端口、selected-child API、共享业务状态机或 Historian 执行层重构。

## 失效模式与测试取舍

权限时序使用真实 Runtime/SQLite 与公开回调屏障。Book 的独立授权、回源权限、固定版/重开、来源索引及重转义编码共享 fixture；修订旧测试中把保存引用当作目标正文的假设，但保留真实回源拒绝与自身授权撤销对照。

研究完成测试覆盖贡献撤销、invocation 失效和正常完成；HTTP 保留 loopback 请求；历史 lookup/status 保留被动读取。RSI 的迟到失权与原回执核对合并进已有 `review-boundaries.test.ts`，替换旧时序而非另留重复 fixture。新真实存储/原生用例保持 heavy，按 Memo、RSI、History 与明确 HTTP 文件选择，不进入轻型并行池。

实现前目标反例均观察失败。来源键缓存新增的重转义容量和可选端口后装配边界也先失败，再修正为有界固定摘要及空快照。第一版补测误用了未提供的删除操作，原失败保留；改用公开的 put 移除旧引用后，两个真实反例重新失败，才计为缺陷证据。

原冻结候选的八阶段复审通过保留 A 首轮和指定新模型接管完成，双方均为 BLOCK、无分歧：其余五组整改有效，但 RSI 仍有具体工单读权和提交后续行异常两项 P1。主会话在真实 SQLite/MAS 上分别复现他人工单降权、dispatch、recover 三个反例；自己的可读回执、提交前确定拒绝、原请求核对、唯一 delivery 和健康 Runtime 对照保留。三条断言并入同一个核心/heavy `review-boundaries.test.ts`；先观察目标断言失败，再修正公共层。原冻结候选和失败证据保持原时点，新候选独立验证与复审。

随后八阶段复审确认上述两个修正，但双方仍 BLOCK：具体工单归属在异步 head 快照取得后撤销时，该旧快照仍可发布回执。主会话用双服务实例和真实原生快照独立复现；同一 fixture 加入目标撤销、无关工单变更和作者自身可读三个向量。修正由 RSI 协调其管理的归属写入与在途发布，只保存当前操作；最终同步检查同时核验当前身份和所依赖的归属快照。没有新增上游接口或持久读回执，提交后的 unknown、原效果核对和执行 CAS 仍分开。定向回归 8/8、核心＋RSI 56 文件 150/150、严格检查、RSI 构建和仓库外固定安装消费 4/4 通过。归属修正候选完成原八阶段复审 `4f134eb3`，双方均为 OK with notes、无分歧，未发现本轮六文件修正的新增或残留合格问题。复审后在同一安装包补测 writer 先在途、reader 后登记，以及写入拒绝/CAS 冲突/异常后的后续 handler 发布，6/6、0 模型请求；产品源码保持冻结。既有 RSI lookup/工具外层同类窗口仍只有源码迹象，另留待补查，不借局部 verdict 宣称整个 RSI 或 release 放行。固定结果和受限本地证据包见[验证摘要](../verification/REVIEWED-PUBLICATION.md)。

首批实现的构建、严格检查、核心＋Memo/RSI/History 影响域和明确 HTTP 文件已通过；Dynamite 完整源码回归 417/417。这些结果对应各自固定候选；RSI 后续修正结果与独立复审在[所属任务](../../openspec/changes/fix-reviewed-publication/tasks.md)接续。旧全仓 Node 子进程崩溃和历次 reviewer 结论不被重写为通过。
