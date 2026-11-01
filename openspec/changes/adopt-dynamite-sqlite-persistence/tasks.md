# 实施任务

## 1. 计划与采用

- [x] 编写初步计划，核对宿主、SDK 与当前 Compresser 配对身份。
- [x] 确认采用 SQLite，建立 proposal/design/spec delta。
- [x] 同步 state、开发入口与形成记录。
- [x] OpenSpec strict 和受影响文档链接检查。

## 2. SQLite 后端与生命周期

- [x] 添加真实 SDK 回归：新建文件、持久结果、重开与 writer 排他。
- [x] 添加存储格式／描述不匹配、初始化失败、close 未确认的失败路径。
- [x] 实现 Session 和 Compresser 的 public SQLite Storage 打开，WAL/FULL 配置与存储身份描述。
- [x] 将物理 receipt 核对改为公开持久记录查询。
- [x] 更新当前存储消费者和直接使用存储格式的回归。
- [x] 执行聚焦回归、类型与构建；记录实际范围。

## 3. 领域写入与产物

- [x] 取得 Dynamite 0.5.0 / 279eb83 的可构建源码并核对配对身份；实现基线采用包含窗口并发修正的 5ec402f。
- [x] 明确异步 commit 端口、读取地址／版本与缓存职责，联动策略消费者。
- [x] 将 run/block、P1–P4 bundle、采纳回执和 checkpoint 接入同域事务。
- [x] 实施 expectedVersion 冲突、提交 unknown 与原 transaction 重查。
- [x] 以真实本地 provider 验证产物可见性、独立 blockId 和窗口并行。

源码已取得：2026-10-31 抓取用户发布的 origin/main，核对 279eb83 存在，并从 5ec402f 建立独立 `dynamite-sqlite-persistence` 工作树。该增量保留独立原生窗口的并发和采纳队列。0.5.0 在新宿主开发归档上编译通过；旧 pairing 保存固定身份，当前开发组合明确标记 workingTree。

## 4. 持久工作与恢复

- [x] 保存 WorkPlan、Attempt、WorkCheckpoint 与固定读取集，联动 Dynamite 固定窗口、配置与重试位置。
- [x] 用公开 document/index/proof 保存领域阶段及封存结果，原生 Compresser 执行沿用 task 调度。
- [x] 保存跨 Session 固定身份与结果确认，重开从已存结果继续本地工作。
- [x] 受控中断 planned／reservation／dispatch／result／adoption 各阶段；unknown 保留原 attempt 与预算。
- [x] 复查 Conversation 独立计数、seal、迟到结果和关闭责任。

## 5. 读取与交付

- [x] 改造关键历史／产物读取，使用 ID/cursor 增量读取和已确认领域缓存；当前 frame 仍物化所属 Conversation 的历史与投影。
- [x] 执行长历史地址／分页、重开、实际存储故障与并行回归。
- [x] 构建宿主和策略，核对声明、编译消费和新的固定配对。
- [x] 回写 state/API 与 tasks 的实际实施及检查记录。

## 执行记录

实施基线：Pakka ec173fd，Pi 1.4.0-pakka.1，Node 24.15.0。Verification 为可选活动；本 change 选择针对 SQLite/事务/恢复语义的本地确定性回归及编译检查。

### 首阶段：SQLite 原生后端

- Session 和 Compresser 使用 public SQLite Storage，存储描述和 PAKK application identity 已绑定。既有文件的身份预检只读；WAL/FULL 在身份确认后设置。
- 初始化期间记录原始连接所有权。公开 facade 的失败队列阻止清理时，尚未交付的初始化连接确认关闭后才释放 claim；已交付存储的 close 未确认仍保留 writer。
- WebUI bootstrap、独立 worker 与安装消费者已使用 main.sqlite。持久记录断言使用一致性备份和公开 Storage 查询；catalog 激活的单提交断言使用真实 WAL commit marker。
- 第二次 branchAtTarget 原先在执行时读取上次导航后的 Conversation；现在固定调用时的来源 Conversation。现有导航／能力失效回归覆盖该路径。
- 实际 SQLite fault 由第二连接取得写锁，替代 JSONL 文件改名故障；hot rollback journal 由独立进程制造并中断。异属拒绝、损坏文件拒绝、pending/unknown、初始化关闭、已消费额度和重开身份均有真实回归。
- 全量 agent 回归：254/254；HTTP/产品：20/20；安装后的 Host、Runtime、MAS：3/3。聚焦重跑 19/19 是上述 agent 范围的子集。build/check、8 个改动路径的 active LSP error 检查及 change strict 通过；11 个受影响 Markdown 的 121 项相对路径存在。
- 全仓尝试中的 owned-browser 调用超时，在独立 ec173fd 源码控制中再次复现（同一本地依赖与隔离环境）；该结果支持“超时不是本轮 SQLite 改动独有”，不证明浏览器运行条件完整可用。全仓通过未成立。
- 仓库外安装检查的原始结果保留在本地 logs。初次消费断言把文本登录链接和工具输出也送入了 SQLite reader，现已恢复其普通文件读取；真正的原生数据库断言保持 Storage 查询。重新打包的完整 smoke 结果随后在此收口。

### 领域提交与宿主持久工作增量

- 产物以不可变 batch document 和 namespace head 进入业务 SQLite，异步 append 等待实际 commit；采纳回执及本地 checkpoint 作为同一 Harness.commit 的 companion。真实 WAL marker 核对为一次提交。
- transaction ID 固定、原回执查询与相同内容的幂等确认已有 5 项 SQLite journal 回归。不同内容复用同一身份在写入前拒绝。预约／完成的本地提交串行化，模型请求仍可并行；unknown 不按版本冲突重试。
- Dynamite 的异步 adapter 有真实延迟提交反例，修改后通过；示例偏好初始化／保存竞态的 3 项回归通过，重新打包的完整仓库外 smoke 通过。
- SourceWork 使用公开 document family/index 保存计划、来源证明、预算、结果及 ready/finished checkpoint；计划对照不可变 journal proof 校验。该增量先验证宿主单调用的重开和本地采纳；后续 Dynamite 配置／窗口和 Compresser 跨库恢复在下面的收口记录承接。
- 6 项宿主工作回归覆盖 planned 重开、封存结果复用、请求 digest 改变拒绝、重试时间、有限预算、计划元数据篡改，以及真实 HTTP 已收到请求后杀死独立进程。杀进程用例在确认精确 writer 退出并核对 claim 后执行隔离测试维护；该阶段生产打开仍拒绝残留 claim；受信任维护命令由后续生命周期增量实现。恢复能力限定本地核对，未知预约不因新 capability 而放行普通请求。
- 前一轮相关边界 49/49；上述含真实进程中断的最新宿主工作回归 6/6。最新构建和 check 通过；后续全量范围在执行后记录，不将这些子集视为全部变更完成。
- 初始化错误通知原先会访问尚未赋值的 adapter，掩盖持久化错误；现在保持失败状态和原始原因，符合既有 failed-Host 返回契约。

### 联动与交付收口

- Dynamite 已持久保存固定窗口、来源版本、规范化配置、模型顺序和 request 构造参数；prepare 确认计划后才发请求。确认失败的 attempt 与后继模型位置／绝对 retry 时间一起保存，重开沿原有限预算继续。
- 已封存候选使用原内容继续本地验证与采纳。Compresser 先存结果、业务最终封存失败的跨库缝隙，通过原 Session/Conversation、job/attempt 和请求摘要核对；真实进程中断回归确认不重发、不增加预约。
- reload/dispose 先拒绝新工作并等待原尝试结算／quarantine，再关闭存储。受信 `recoverStorageWriter()` 使用独占维护门禁、只读数据库身份预检、精确 claim 和死进程核对；普通打开仍拒绝残留 writer。
- 历史用 256 条公开 ID/cursor 分页，日常增量加载；reload／新 Conversation／重开重新建立读取集。领域 head 不变时复用确认缓存，reload 冷读一致性 Storage 快照重验 proof。超过分页界限的实际 ID 序列回归覆盖追加、reload 和重开。当前 frame 仍物化所属 Conversation 的历史与有效投影。
- Source gates：Pakka agent **278/278**、Dynamite **386/386**；build/check/typecheck 通过。Dynamite 386 项包含下述 73 项源码集成用例，计数不作独立用例相加。收尾时 13 个当前实现／消费路径 active LSP 为 0 diagnostics；21 个受影响 Markdown 的 201 个相对链接和 11 个 heading anchor 通过，跨仓 sibling 引用明确映射到本次两个候选工作树，change strict 通过。
- 两份真实 tarball 安装进新的仓库外消费者；公开声明、原 installed Host smoke 和完整 **73/73** 集成矩阵通过，矩阵记录 **461 次 loopback HTTP、0 个 provider 错误、0 skip/todo/cancelled**。Root Runtime 另在同一真实安装归档的全新数据命名空间通过，重开零 dispatch，预算及独立 namespace 保留。
- 安装 driver 的修正保留原断言：复制 Storage 查询 helper，并启用公开 parent-URL resolver；合法 append 等待 Promise。跨 scope 的身份检查仍同步拒绝。Root Host 7 次请求和 Runtime 3 次请求另行记录，不计入上面的 461 次矩阵计数。
- 初次冷缓存安装在公开 native compiler 的 registry 下载阶段超时。交付重跑使用显式隔离的公开包缓存；只导入指定 registry 的精确公共 tarball，不导入用户 npm 配置或模型凭据。消费者、安装树、profile、数据和实际请求仍独立。
- 固定组合见 [SQLite pairing](../../../integrations/dynamite/sqlite-persistence-pairing.json)：agent SHA-256 `3cd81e13ed3dc173e4108a472a5ce5c45c0e90ca7c7520cd6afd04c60b770c82`；Dynamite SHA-256 `67a13e72b644c2f8163ad720d486703f608fdf1c59dfb5f65b290c4186574a30`。两仓实现当前为 workingTree，基线分别 ec173fd 与 5ec402f；原发布配对保持固定身份。

实施与已选检查闭合；当前源码尚未提交／推送，下一步由操作者决定保存与合并。预期和接口分别在 [state](../../../docs/state/dynamite-persistence.md) 与 [Strategy API](../../../docs/reference/STRATEGY-API.md)。

执行材料：宿主 `docs/.temp/dynamite-persistence/` 与库的 `docs/.temp/` 保留各阶段 red/green、process-interruption、源码／安装 TAP、build/check、docs 与 strict 输出。两包安装 summary 和归档在宿主 `artifacts/dynamite/sqlite-persistence/`，实际消费者 `dynamite-packed-consumer-P3N8dv` 保留安装树及原 evidence；生成材料按 ignore 管理，固定身份与检查结论以本页和 pairing 承接。
