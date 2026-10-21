# 2026-10-21：文档分工与初始 state

## 形成条件

用户要求采用 state-evo 重构本项目文档系统，并先在 `docs/.temp/` 写 state 构造方案，完成方案后开工。工作位于 `feat/devin-like-frontend`，文档基线 `e7b7d7c`；本轮不改产品代码或 main。

盘点时已有 132 份 tracked Markdown、公开 API、OpenSpec 基础与活动场景、历史归档及固定候选证据。R2 计划将采用的界面结构、纠偏经过、实施步骤与结果混写；入口、MAS 指南和验证方法含不同阶段的“当前”。这些是正文可核对的编辑问题，不是本轮新取得的产品失败结论。

先写的方案在本地 `docs/.temp/state-construction-plan.md`；其关键取舍、映射与交接条件由本记录和正式入口保存，不要求接手者拥有该临时文件。

## 用户要求与本轮设计

用户指定的是 state/changes/临时材料的持续分工及先方案后实施。以下文件拆分和迁移方式是代理依据现有材料作出的文档设计，不冒充用户逐项指定：

| 材料                   | 采用的维护位置                                                   | 处理                                                  |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| 当前工作入口           | [OVERVIEW](../OVERVIEW.md)                                       | 保持短小，指向当前预期、差距与下一步                  |
| 产品范围与 non-goals   | [product state](../state/product.md)                             | 从既有约定/提案/范围计划提取，不随实现缩减            |
| Runtime 身份/持久化    | [runtime state](../state/runtime.md)与原架构/API                 | state 组织关系，原位置维护细则                        |
| MAS 与关系观测         | [mas state](../state/mas.md)与原领域场景/API                     | 保留真实资源/权限关系，不以旧布局作规范               |
| WebUI 与扩展           | [webui state](../state/webui.md)与开发契约/领域场景              | 保留服务与 facet 细则，不复制每个接口                 |
| Devin 与 Team 交互     | [frontend state](../state/frontend.md)                           | 将已采用 R2 内容改写为无历史的声明                    |
| 验证目标/执行方法      | [delivery state](../state/delivery.md)、原开发/验证文档          | 目标、方法与候选结果分开                              |
| R2 混合计划            | [采用记录](devin-frontend-adoption.md)                           | 保留原文与身份；旧路径转为兼容入口                    |
| P0–P6 范围与顺序       | [原范围计划](../plans/PAKKA-POCKET-PLAN.md)                      | 保留形成材料身份，不再声称是当前待办                  |
| 原当前状态             | [历史快照](../archive/status/PAKKA-POCKET-PRE-STATE-EVO.md)      | 保留旧确认、数字和范围，调整相对链接                  |
| 实现/验收差距          | [实施状态](../PAKKA-POCKET-STATUS.md)                            | 更新为 R2 固定候选及后续工作                          |
| 架构阶段史             | [核心集成记录](core-integration-lineage.md)                      | 移出技术契约，保留原阶段结果                          |
| 旧 OpenSpec 检查数字   | [旧整理记录](../verification/DOCUMENTATION-REORGANIZATION-R0.md) | 从验证方法中移出，不宣称本轮复跑                      |
| 待办、调查、草稿与实验 | `docs/.temp/`                                                    | Git 忽略；正式依据与未完成工作仍可在 tracked 文档找到 |

既有自动化 runner 的临时输出继续在根 `artifacts/`，不批量搬迁或修改产品/门禁脚本；人工计划与草稿默认在 `docs/.temp/`。采用为长期依据的输出仍需封存至 verification 等正式位置。

既有 API/场景有明确用途，大量旧记录已有外部引用。我们考虑了整树迁移与复制所有细则；本轮采用保留原路径、明确映射和局部拆分，避免使固定证据悬空，也避免 state 成为另一套平行 API。

## 材料的地位

- OpenSpec 七份基础规范保持原字节；映射的活动 `specs/` 继续承载相应领域补充。没有将整个活动目录、旧 proposal 或 task checkbox 宣告为已采用/已完成。
- R2 是用户对采用主从关系的明确纠正；Team 的页面结构是随后采用的设计推导。来路见[采用记录](devin-frontend-adoption.md)，不是本轮新提案。
- 本轮不改变 unknown、原生调度、授权、支持矩阵、Plan mode 排除项、普通删除尚待明确或独立 GUI 条件。
- 旧文档里的“已验收”仍限定于当时版本。当前候选的失败、取消、跳过和 BLOCKED 没有因文档整理被核销。
- 44×44 独立控件触达约定继续有效；紧凑视觉是否同时满足需另行核对，不能从实现尺寸反推放宽规格。

## 后续维护

初始 state 不是一次性快照。已采用的要求变动时，改写相应声明，并在本目录或对应 OpenSpec change 留记录、调整工作安排；不在 state 末尾累加一串修订片段。

开始/接续时从 OVERVIEW、相关声明和 active-plan 进入；临时文件缺失时依据 tracked 实施状态恢复。验证结果与本轮文档检查见[文档系统验证](../verification/DOCUMENTATION-SYSTEM.md)，不是声明是否存在的替代。
