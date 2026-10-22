# 文档入口、视觉工作材料与补丁声明

## 条件与采用依据

用户先要求删除 docs 根的 M3/M4/M5 迁移验收跳转、忽略 visual-primitives，并讨论 verification 是否主要为历史。随后要求核对 Pocket 状态页的冗余，将 Pi Durable patch 作为项目产物补入 state。

核对基线为 main `200af506913ee38d7a357e5da96ea5e2afc03d67`。原验证方法已经在 `docs/development/VERIFICATION.md`；verification 的 97 个跟踪文件包括 92 个 evidence 文件、四份报告和一个索引。此数量描述目录用途，不是内容冗余率。

## 内容归属

| 内容                               | 维护位置                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| 产品范围、服务、前端、交付条件     | 对应 state/API/领域场景                                               |
| Pi Durable 当前源补丁产物与行为    | state/durable-patch.md，映射源补丁、机器身份与构建/回归入口           |
| 当前工作与具体差距                 | OVERVIEW 与所属 OpenSpec tasks；本地 active-plan 安排执行             |
| 某版本候选数字、人工确认与运行结果 | 既有候选记录及固定 Git 版本                                           |
| 兼容性变化与采用经过               | 追加式兼容性账本                                                      |
| 视觉运行图、差图与判读草稿         | 忽略的 docs/visual-primitives；已有历史引用使用固定 Git 版本          |
| 回归持续依赖的参考元数据           | apps/webui/test/fixtures，作为测试输入跟踪                            |
| 通用执行方法                       | 既有 development/VERIFICATION.md；verification 是结果记录而非方法规范 |

## Pocket 状态页的去重依据

其产品和边界声明已由 product、runtime、mas、webui、frontend、delivery 承接。候选 004 的结果在 R2 记录中；人工确认和 main 集成还有清理前的固定 Git 快照。五类交付待办对应 adopt-devin-frontend/tasks；Conversation 删除/保留策略及各远程条件补到所属未完成任务。

因此移除状态聚合页，而不是把进度数字、人工确认或“当前失败”复制进 state。当前读者改从 OVERVIEW 和所指领域任务接续。历史引用仍可定位到清理前 commit。

## 视觉材料与回归

仅增加 ignore 对既有 tracked 文件无效，因此同步取消跟踪 62 个视觉文件，并逐项核对本机文件仍在且哈希相同。它们的原版本已在上述公开 Git commit 中。

现有 reference 测试读取视觉 run 的 oracle manifest。仅导出 tracked 文件后，该测试因缺少 manifest 而失败；将持续需要的 repository/commit/CSS 身份分离为测试 fixture 后，同样的 tracked-only 导出通过。生成图和运行说明没有作为 fixture 搬入测试目录。

## 兼容性账本与引用

账本旧条目保持原文。根跳转删除后，末尾追加三个历史引用的归档映射，并指出当前补丁声明的入口；这个 supersedes 只调整引用解析位置。普通当前文档修复实际链接，既有视觉报告链接改用清理前 commit 的 Git permalink。

## 验证方法与进一步瘦身

本轮没有另建一套方法论。既有页面覆盖源码门禁、隔离环境、浏览器、安装、OpenSpec、独立操作和文档检查，已有证据强度与反例提醒；但主要按执行入口排列，尚未将“从什么契约选用什么测试、断言如何失败、结果如何反馈”组织为贯通流程。

建议在原方法页补全：

1. 从 state/API/领域场景列出本轮改变的行为、风险边界和可观察结果。
2. 为每项行为写明成功断言与拒绝/边界反例；选择最小能覆盖真实消费边界的测试层。
3. 缺陷先复现，新增行为先得到有判别力的失败；修复后跑定向 green，再按共享影响面扩大回归。
4. 固定依赖、环境和源码身份；用真实 Pi、本地确定性 HTTP 与真实存储/安装路径取得对应层的结果。
5. 将环境限制、实现失败和未知效果分开；归因使用同条件对照，结果回到实现、测试解释或需求设计中处理。
6. 在测试代码中保留可重跑用例；阶段输出绑定候选身份，完成后以固定 Git 版本查询，当前入口只指向实际工作。

这六步是待采用的补全方案，本轮未将它们加入 state 或变成新的交付门禁。

| 材料                          | 内容检查所得                                                 | 建议                                                               |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| MAS-BOARD-R1                  | r1–r8 的修复、数字和人工确认沿革                             | 作为历史从固定 Git 读取；持续有效的行为在 MAS/API/场景与回归中维护 |
| DEVIN-FRONTEND-R2 与 evidence | 固定候选 004 的复现入口、原日志和尚需诊断的 Browser/进程停点 | 当前任务仍引用必要复现依据；后续候选产生后退出常驻工作目录         |
| DOCUMENTATION-CLEANUP         | 2026-10-21 清理、外置备份身份与恢复方法                      | 历史记录；恢复入口可从变更来路定位，不作为通用测试方法             |
| DYNAMITE-PRODUCT-ACCEPTANCE   | 历史验收与当前支持配对/条件混在一页                          | 先将当前条件落实到产品声明/API 与 pairing manifest，再移除验收正文 |

不建议再把 verification 整体搬入 archive；这仅改变路径，仍让历史包常驻文档树。进一步清理应删除已经完成用途的工作树材料，并由固定 Git 引用承担追溯。本轮只形成这一评估，未批量删除 verification。

## 检查范围

检查当前与历史引用、ignore/跟踪状态、本机视觉文件身份、tracked-only reference 回归、补丁哈希、账本追加性、格式和相关 OpenSpec。原始证据内容与产品/补丁源码作为身份对照。

## 本轮核对

- 基线为已发布 main `200af506913ee38d7a357e5da96ea5e2afc03d67`。四个被删除入口和视觉工作区原版本从该 commit 恢复。
- 本机 62 个视觉文件逐项哈希相同；92 个 verification/evidence 文件与 Git 基线逐字节相同。产品源码、源补丁、依赖锁和安装归档保持原身份。
- 全仓非忽略 Markdown 的相对路径/锚点与所用固定 Git 链接共核对 624 项，无新增或继承的未处理断链；账本三条旧引用单独按新增映射核对。账本历史前缀与基线一致，仅末尾追加八行。
- reference 回归在 tracked-only 导出中先因缺少旧 manifest 失败，分离稳定 fixture 后通过；完整 workspace build 与 `npm run check` 通过。
- 55 个修改/新增文档及测试输入的格式检查通过。主动 LSP 检查覆盖同一批路径：49 confirmed clean、6 inconclusive、未返回诊断；类型结论另由实际编译/check 核对。
- 本轮 change、organize-project-documentation、adopt-devin-frontend 和 pakka-pocket-webui 的 strict 均通过。当前与独立基线的全量 strict 都只含相同三条长度警告：authenticated-mas-apps、integrated-mas-product、recoverable-multi-session。

链接核对按当前 tracked 与非忽略新文件解析相对路径、Markdown heading 和固定 Git 目标；代码块/内联代码中的示例排除，账本原条目通过其追加映射解析。执行原始输出与审计 helper 在本机 `docs/.temp/documentation-slimming/`；本记录保存核对范围、方法与所得，不把临时目录当唯一说明。
