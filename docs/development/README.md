# 开发与维护

开始或接续先读 [OVERVIEW](../OVERVIEW.md)、相关 [state](../state/README.md)和本地 active-plan。贡献从 [CONTRIBUTING](../../CONTRIBUTING.md)进入，Git 操作遵循 [Git 协作规范](GIT-WORKFLOW.md)。按产物关系继续查细则：

| 工作                                     | 文档                                         |
| ---------------------------------------- | -------------------------------------------- |
| 分支、提交、工作 PR、集成与发布          | [Git 协作规范](GIT-WORKFLOW.md)              |
| Runtime 身份、持久化与原生执行           | [架构契约](ARCHITECTURE.md)                  |
| package/app、依赖与发布边界              | [Monorepo 规范](MONOREPO-CONVENTIONS.md)     |
| WebUI/Backend/Client/Agent contribution  | [WebUI 开发契约](WEBUI-DEVELOPMENT.md)       |
| 可维护性、开放组合、少测试政策与交互质量 | [前端开发规范](FRONTEND-GUIDELINES.md)       |
| WebUI 文件定位、职责与公开接口           | [WebUI 架构说明](WEBUI-ARCHITECTURE.md)      |
| Astryx 与同类开源设计系统的取舍          | [设计系统调研](WEBUI-DESIGN-SYSTEMS.md)      |
| 页面结构与 Team 交互                     | [前端声明](../state/frontend.md)             |
| 测试、外部安装和证据身份                 | [验证方法](VERIFICATION.md)                  |
| Pi Durable 下游变更                      | [追加式账本](../PI-DURABLE-COMPATIBILITY.md) |

## 提交与贡献

提交、分支操作和 PR 管理前先确认当前分支。日常工作在独立分支提交推送，阶段完成时新建或更新到 `dev` 的 PR，正文包含 Intent、Mechanism 和 Verification。`dev` 的直接集成和 `dev → main` 的发布 PR 按 Git 规范取得对应明确授权；批量集成推送前的本地检查是强制门禁。

## 文档维护

[Markdown 配置](../../.markdownlint.json)与项目 Prettier 的 tab 缩进保持一致：代码围栏内保留代码缩进，正文仍检查 hard tabs。长行和同级标题的设置承接 lint 基线。格式化不改写固定原生构建锁文件或 digest-bound 验证记录，忽略范围见[格式配置](../../.prettierignore)；其完整性由所属 hash 校验核对，不能通过重新生成 hash 接受格式化改写。

1. **接续**：OVERVIEW 指向当前工作与所属 OpenSpec tasks；读取相关声明和 `docs/.temp/active-plan.md`。临时文件不存在时，从这些 tracked 入口恢复具体待办。
2. **预期**：采用的范围、条件和行为写成无历史声明。state 按模块/行为关系组织；已有 API 或 OpenSpec 场景在其位置维护细则，领域页提供映射，不随讨论轮次追加小规格。
3. **来路**：初始形成、补充、替换或撤销的完整记录写入 OpenSpec change 的 proposal/design/tasks/specs，按原生命周期维护。docs/changes 只总结，必须完整链接 change 目录、各 artifact、全部 delta 和有关主 spec；多项变更逐项列全。说明当时条件，区分用户要求、既有约定、设计推导和观察。
4. **差距**：实施未具备的目标继续留在声明中；在 active-plan 安排具体实现、调查和验证。未定解释留在临时材料，不把代码较窄写成新规格。
5. **同步**：采用要求调整时同时更新受影响声明、变更记录和工作安排。普通局部修复/测试进展无需制造预期变更记录。
6. **使用与证据**：指南写当前操作，API 手册写当前接口，development 维护现行方法与规则；正文独立表达对象与条件，不以开发阶段、验收状态或进度定义产物。候选结果按明确版本保存在 verification 或固定 Git 记录。本机视觉生成物在忽略的 `docs/visual-primitives/`；回归持续依赖的稳定输入进入测试 fixtures。
7. **迁移/清理**：先核对用途、Git 跟踪和引用。tracked 材料从已发布的固定 Git 版本或经校验备份恢复；仍需使用的唯一 untracked 材料先保留或备份。修复当前引用，追加式账本的旧链接通过新增映射解析。未知身份、文件锁、编辑器锁与用户现场保持原状。
8. **收尾**：对照预期检查实际产物；已完成项撤出待办，未完成项仍可访问。OVERVIEW 保持简短，指向下一项实际工作或注明暂无进行中的工作；历史提交、检查计数和完成过程由 changes/verification 承接。确认材料用途结束才清理/归档。
9. **检查**：核对链接、锚点、格式、diff 和规范引用；纯文档按影响面选择检查。批量集成与发布按 Git 协作规范执行对应门禁。检查缺环境时明确记 BLOCKED，不引用旧通过代替。

## 范围与状态的维护

产品契约由 state/API/场景维护；实现差距与下一步由 [OVERVIEW](../OVERVIEW.md)和所属 OpenSpec tasks 承接。候选数字、人工确认和历史结果按[固定验证记录](../verification/README.md)或注明的 Git 版本查询。

[AGENTS](../../AGENTS.md)保留项目级约定，OpenSpec 的基础规范、活动变更和归档继续由原流程管理。文档系统映射见[形成记录](../changes/2026-10-21-documentation-system.md)，Git 规则采用与入口调整见[本项记录](../changes/git-workflow-and-project-metadata.md)。代码推送、功能验收、指定审查和变更归档分别记录。
