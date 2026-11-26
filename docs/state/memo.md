# Memo 知识服务

Memo 为受权调用者提供 Markdown Wiki、来源目录、综合检索和按需读取。可信宿主通过独立 `@pakka/memo` 入口选择 Memo SQLite 文件和来源 provider，并将当前身份绑定到 client。知识读取可独立于模型、馆员、定时输入与 MAS 成员使用。

## 能力依赖与下游适配

Memo 单向消费 Dynamite 和 MAS 的通用能力，RSI/EI 为独立 opt-in；这不是要求普通知识服务安装或启动所有上游。Wiki 核心只有自己的 SQLite，Book 适配位于 `@pakka/memo/dynamite`，馆员执行适配位于 `@pakka/memo/patchouli/mas`。宿主提供公开服务实例；适配层不访问上游私有状态、不打开上游数据库，也不复制 Book/MAS 的核心机制。RSI/EI 未装配时没有隐含导入、执行或新状态。

Book 已发表正文、图与引用使用 Book 自身权限；实际回源读取使用目标对象当前权限。Memo 负责书库分享、格式转换、来源导航与最终消费检查，不迫使 Dynamite 按图书馆规则裁剪原产物。独立发表的 Wiki 知识使用自己的书库权限，引用来源后来撤权不自动撤销 Wiki 正文；引用可见性仍单独过滤。

## 书库和知识身份

书库采用 reader、editor、manager：reader 浏览和读取，editor 创建及修订 Wiki，manager 管理授权、来源登记及删除。调用参数表达资源和操作；实际身份来自宿主绑定。每次操作在读取、提交和发布时检查当前授权。

页面由书库和稳定 pageId 寻址，路径可改名。每个修订保留实际作者、时间、说明、正文与来源引用。恢复指定修订创建新修订并保留当前路径。管理删除使页面退出普通读取和检索，历史保留于数据库。

来源引用携带书库、sourceId、版本和可选章节定位符。固定版本对应的来源地址保持稳定；无快照的外部可变来源用空版本表达当前内容。来源 provider 校验原资料的读权与分享范围；书库授权和来源授权共同决定可见性。

## 持久化与读取

Memo SQLite 保存独立的页面、修订、权限、来源版本、变更和请求回执。一次写入将业务记录、变更事实和回执原子提交。相同 actor/requestId 和参数返回原回执，参数不同则拒绝。提交后失去响应发布权限返回 unknown，允许之后在当前授权下查询原回执。

目录、修订和变更使用有界分页，读取正文按 Unicode 码点范围展开。游标绑定原身份、查询及数据库，并固定扫描上界；继续读取时使用当前权限。Markdown 导出包含原 pageId 和基础修订，重新导入接受同样的版本冲突检查。

业务 Runtime 与 Memo 使用各自提交域。来源正文通过宿主公开端口读取，原业务 Session 的 writer 所有权由 Runtime 保持。

异步来源 read/search 在 DTO 转换前取得原结果的同步授权校验，绑定到该 Memo Client 的返回结果；公共服务、Patchouli 的过滤包装和原生工具均在最后一次 await 后复查。校验保留实际对象身份与授权，不将正文复制进证明，不建立强结果缓存或持久令牌。只按输入就能完全判断权限的 provider 可使用现有 check；解析后才确定的对象权限通过可选 publicationCheck 传递。外部消费者继续异步加工时，先取得 `client.publicationCheck(result)`，最终同步发布前调用，不能把序列化副本或其他 Client 的结果冒充原结果。

## 可选持久馆员

`@pakka/memo/patchouli` 保存 librarianId、固定研究/发表范围及原 Runtime/MAS 路由指纹；每个研究请求单独保存 runId、主题/来源、到期时间、派发身份、回执和业务完成状态。书库知识读取不依赖馆员。

运行绑定由宿主批准并保持专用 persistent Conversation，工具只在该成员当前 native invocation 中取得权限。研究的读/写范围由代码限制；管理能力和原始资料写入不向馆员提供。源分享授权须覆盖该持久上下文可能发表的书库，宿主持续约束已经读入上下文的私有信息。

请求、get、普通重开均不启动模型。显式启用、advance 或当前进程内 start 才推进到期请求。每个绑定同时推进一项未完成研究，先保存派发阶段，再发送原请求；unknown 仅查原路由/原 requestId，不重发。代次或源身份变化不能替换原请求。Runtime 的尝试预算继续跨研究保留。

输入回答完成只更新 delivery，研究由 research_finish 明确结束，允许无发表。完成结果保留同一服务、原 invocation 与原结果绑定的同步 `publicationCheck`；消费者在最后一次 await 后复查，原生工具同时检查当前贡献、lease 和 invocation。完成已提交但最终发布失权时返回 unknown，保留 completed 及原发表回执，不重放完成动作。发表列表来自实际 Wiki 变更回执。结束后还需当前成员真正空闲，才推进下一项研究。取消先停止该 run 的工具与派发资格，已接纳的原运行显式 abort 并核对；未知接纳继续占原槽位。执行槽位与业务完成状态分别持久保存，`executionHeld` 表示原成员仍受该 run 约束。取消意图由后续显式 advance 继续推进；原取消未确认时不能释放槽位。同一实时 Runtime 上原取消请求共用一次执行，已完成的旧 run 不得取消新研究。

调用者获得研究 read/control 权限时，宿主必须核验整个研究范围，而不以某篇公开 Wiki 的权限代替。当前提供实际单成员、独立 Memo/Runtime 提交域的装配与恢复。MAS 的成员、路由、发送、原请求查询、空闲与取消能力经现有公开端口消费；研究范围、队列、发表和取消意图属于 Memo。辅助成员是独立演进；Book 消费见 [History Book 与图书馆](../guides/HISTORY-LIBRARY.md)。

## 使用与形成

API 以公开 TypeScript contracts 为字段依据，headless 和原生工具消费同一服务。当前实现进度、后续 Patchouli/History Book 与小恶魔切片见[任务](../../openspec/changes/add-memo-knowledge/tasks.md)，采用经过见[变更](../changes/memo-knowledge.md)。
