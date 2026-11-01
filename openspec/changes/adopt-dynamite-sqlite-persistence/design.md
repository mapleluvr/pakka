# Dynamite SQLite 持久化架构

## 形成与基线

用户先要求调查持久化方式和 JSONL 空间特征，随后明确 SQLite、参考 Pi Durable 作架构决策，并按内部开发阶段的新建数据布局实施。

宿主基线为 `ec173fd0deae487ae7664a1575c1f76de27e0913`。当前 SDK 是 `pi-durable@1.4.0-pakka.1`；同 cohort 公开依赖为 1.4.0。当前 Compresser 配对身份在 [pairing](../../../integrations/dynamite/compresser-conversation-pairing.json)：agent 0.7.0、Dynamite 0.5.0 / `279eb83`。

初始调查时，本机和远端仍为 `5ff775a`，配对源码尚未取得。2026-10-31 用户发布后，已取得精确 `279eb83`，并采用后续 `5ec402f3d84a539163ca932b5f98bcd0253de7f8` 为库实施基线：该增量明确保持独立原生窗口并发、采纳序列化与批次 drain。旧配对身份保留；开发归档和最终交付分别重新绑定实际字节。

## 决策 1：SQLite 与新建布局

采用每个持久 Session 一个 SQLite 存储域。业务 Session 保存业务原文和产物；长期 Compresser Session 保存 registry、策略、Conversation 轨迹和执行结果。每个域有自己的 writer claim 与提交序列。

原生布局通过 Pi public SQLite Storage 创建，文件为 `main.sqlite`。存储描述记录 backend、schemaVersion、文件身份和耐久策略；provenance 继续绑定产品 Session 与 cwd。打开既有文件先核对格式、描述和 provenance，再初始化 Harness。

JSONL 空间调查显示，图片表示和工具大结果主导样本占用；原样装入 SQLite 的有限对照没有显示节省。这支持把空间问题与事务／恢复选择分开。SQLite 的采用依据是提交关系、地址读取、持久任务与工作集管理。

## 决策 2：复用 Pi 的公开持久化机制

Pi Durable 1.4.0 的参考点：

- immutable entries 保存原始事实；documents 保存可版本化的状态。
- commit 可以同时写 entries、documents、tasks，发布发生在提交确认之后。
- task 的阶段和 checkpoint 持久化；waiting/sleeping 结束当前阶段并保存续行位置。
- submission 的 requestId 标识原接纳，重查返回原 submission。
- storage failure 结束所属 Harness；未确认外部效果与本地恢复分开处理。

宿主使用公开 `NodeSqliteDatabase`、`SqliteStorage.open`、`Harness.commit`、`defineDoc` 和查询端口。原生 Compresser 执行沿用 Pi 的 `defineTask` 调度；领域 SourceWork 使用 document/index/proof 保存阶段，由当前受权服务的恢复命令读取 checkpoint 续行。这个分工使持久计划与当前可执行权限分开。Pi mutable objects 只存在于 durable adapter；外部取得冻结 DTO 和身份绑定的命令。

领域提交端口以 Promise 返回确定提交／版本冲突／unknown。现有同步 projector 读取已经提交的缓存；它不承担刷盘或跨域推进。接口联动与策略编译同步实施，以实际 consumer 回归核对返回值。

## 决策 3：耐久性和 writer 生命周期

宿主显式持有 Node DatabaseSync 的生命周期，通过公开 NodeSqliteDatabase facade 设置 `PRAGMA synchronous = FULL`，核对 WAL 和 FULL 的实际值，再交给 SqliteStorage。既有文件经格式检查后，使用只读连接核对 application_id，再取得写连接和改变 journal mode。异属数据库的反例证明反向顺序会改写拒绝对象的 header；独立进程制造的真实 hot rollback journal 进一步证明，写连接的第一次读取就可能回滚并改写拒绝对象。只读预检的失败保持原数据库与 journal 字节，不能据此取得恢复外来事务的权限。

Chord 1.4 的 opener 会在初始化异常时吞掉 cleanup 失败，且 options 没有 synchronous 字段。本轮使用公开构造器和 exec/get，并显式保留原始连接。facade 的 close 包含 checkpoint，可能因初始化／checkpoint 失败拒绝；尚未交付存储时，以实际句柄关闭确认完成初始化清理。已经交付后的关闭错误继续作为失败处理。安装依赖保持原字节。

writer claim 在打开数据库之前取得；已知关闭完成后释放。数据库初始化、Harness 打开、任务关闭和异常 cleanup 都需处理同一责任。close 未确认时保留 claim 和失败原因。独立进程恢复由可信 writer 管理入口处理。

WAL/FULL 是采用的 SQLite 策略。进程强制退出回归证明进程中断后的提交恢复；它与断电、磁盘控制器和文件系统耐久保证属于不同证据层级。

## 决策 4：持久对象

| 对象               | 身份与关系                                                                      |
| ------------------ | ------------------------------------------------------------------------------- |
| WorkPlan           | jobId、planId、策略身份、固定来源与指纹、窗口、配置版本、模型序列               |
| Attempt            | attemptId、source job、预算预占、dispatch 和完成状态、usageStatus、结果身份     |
| WorkCheckpoint     | phase、已存 attempt/result、当前产物版本、下一步本地动作、终结原因              |
| Artifact           | run/block 身份、P1 text、P2 graph、图内 P3 annotations、P4 clues、bundleVersion |
| AdoptionReceipt    | transactionId、attemptIds、artifactVersion、resultDigest、checkpoint            |
| ConversationPolicy | incidents、各自两类计数、lastError、seal                                        |

WorkPlan 固定实际使用的来源与参数；恢复时重核这些来源和当前授权。checkpoint 的业务身份独立于某次进程内 lease；新进程须重新取得可执行能力。

P1–P4 以当前产物 bundle 的明确结构保存，保留各字段语义及其校验范围。正文投影从 P1 读取，图与注释的读取从同版 bundle 取得。稳定引用使用对象身份和版本。

## 决策 5：事务域与跨 Session 衔接

同一业务 Session 的 run、block、产物版本、精确 adoption receipt 和对应 checkpoint 在一个领域提交中出现。expectedVersion 冲突发生在提交前；成功后的重复确认返回原 receipt。

业务 Session 的预算预占与 dispatch 意图先持久化，然后以稳定 jobId/attemptId/submission requestId 驱动 Compresser Conversation。Compresser 封存结果后，业务 Session 保存结果身份，再执行本地校验和采纳。跨域确认保存双方身份与 resultDigest。

两个 Session 的数据库分别提交；恢复依据这些已存事实衔接：一方成功、另一方未确认时，先查询固定结果和原 receipt。模型 HTTP 也独立于 SQLite。明确的未发送结论、已封存结果和效果未知分别处置；效果未知保留预算和原 attempt。

## 决策 6：工作恢复

| 已提交状态                           | 续行规则                              |
| ------------------------------------ | ------------------------------------- |
| planned                              | 核对来源／当前授权后准备执行          |
| dispatch prepared 且有确定未发送结论 | 按该结论推进，保持原身份              |
| dispatched 且结果 unknown            | 持久化 quarantined，等候核对          |
| result stored                        | 从该结果继续本地校验／采纳            |
| adopted                              | 返回原产物和回执，推进已存 checkpoint |
| terminal / sealed                    | 保持终态和原原因                      |

提交失败时闭锁所属存储域；来源局部失败保留来源归属。一个 Conversation 的 seal 继续只作用于自身。重开对未确认在途请求的 quarantine 规则保持有效；当前服务通过 `recover()` 使用保存的计划、配置与 retry checkpoint 继续工作，已存结果执行本地校验／采纳。跨库查验核对原 Compresser envelope 与请求摘要，恢复不会增加 HTTP 或预约。

## 决策 7：读取与工作集

SQLite 存储的地址和 cursor 查询承担历史读取。adapter 保存当前投影、活跃任务和观察中的冻结 DTO；独立 Conversation 按其地址读取。日常刷新用 ascending ID/cursor 的 256 条分页，从最后确认的 immutable ID 继续；reload、新 Conversation 及重开重新建立读取集。领域 head 未变化时复用确认过的 snapshot，增长时只补读新 batch。显式 reload 通过公开 backup/Storage 重新核对完整领域链，避免 Harness 的旧 document 缓存掩盖持久损坏。

当前 ContextFrame 仍物化可见历史用于编号和来源证明；这里减少重复存储扫描与旧 Conversation 数据保留，不承诺常数内存。长历史回归跨越分页界限，核对追加、reload、重开的完整 ID 序列。

## 首阶段形成记录

内部开发的新建布局采用当前 runtime 身份。先前的 `migrateLegacy`／source-prefix 映射依据 append-only 文件实现，本阶段移除该实现、导出类型与七项对应场景；历史源码位于宿主固定基线。当前入口在存储创建前拒绝该参数，单 Conversation 与 managed store 的普通重开边界另由 SQLite 回归保持。

直接读取 JSONL 事务的回归改用公开 Storage 的一致性备份查询。仓库外安装的断言亦使用实际备份和已提交 records；主文件尚未 checkpoint 时，读取它的原始字节不能证明当前内容。安装用例以 Node 的公开 parent-URL ESM resolver 定位实际 agent cohort 的 SDK export；Chord 的 context 是 import-only，不能改为私有路径导入。catalog 的物理原子性另由标准 SQLite WAL commit frame 核对，而不是重建一份“事务日志”。实际写入故障使用另一连接的写锁：改名文件或 chmod 文件无法可靠阻断已打开的 SQLite 连接。

连续同步导航的反例发现：按执行时的最新 Conversation 创建第二个 fork，会使原调用目标不再可见。每次 branch 现在捕获调用时的 Conversation，native fork 仍序列化提交；原 capability 继续失效。

## 实施与检查

先完成 Session/Compresser 后端、打开关闭和格式识别，再联动领域端口、原子采纳、持久任务和分页。任务与验证记录在 [tasks](tasks.md)。检查选用真实本地 provider、实际 SQLite、受控提交故障与独立进程中断；数据和模型均使用隔离测试配置。

Verification 依开发规则选用；跳过的活动在所属任务记录一次，实际执行的检查记录固定版本和证明范围。
