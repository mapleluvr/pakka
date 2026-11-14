# 2026-11-14 RSI 原工作与独立报告：headless 候选

## 采用范围

采用[原工作报告需求](../requirements/RSI-WORK-REPORTS.md)中的服务切片：可信原工作关联、独立报告与修订、独立状态操作，以及保存后的可选 MAS 交接。对象与权限契约见[RSI state](../state/rsi.md)、[API](../reference/RSI-API.md)和[操作指南](../guides/RSI-WORK-REPORTS.md)。

实现位于 `pakka/rsi-work-reports`，以已推送参考提交 `170aa15` 为基线。2026-11-14 用户授权提交、推送本分支并向 `dev` 创建 PR；它仍是代码评审候选，不是正式 SDK 冻结、发布基线或远端 WebUI 重构的强制迁移要求，不包含自动合并或 npm 发布。原参考分支的性质见[参考记录](history-reference-branches.md)。

形成材料包括[提案](../../openspec/changes/separate-rsi-work-reports/proposal.md)、[设计](../../openspec/changes/separate-rsi-work-reports/design.md)、[任务](../../openspec/changes/separate-rsi-work-reports/tasks.md)及[独立报告场景](../../openspec/changes/separate-rsi-work-reports/specs/rsi-work-reports/spec.md)。现有工单场景仍位于[持久工单 delta](../../openspec/changes/persist-rsi-ticket-records/specs/rsi-tickets/spec.md)，MAS 通信依赖见[主规范](../../openspec/specs/same-session-mas/spec.md)。

PR 前成功 fetch 确认 `origin/dev` 为 `cc1cdd8aead42cd0afe018c75973f09fd369184d`，尚未包含 `0a4e286` 与 `170aa15` 两笔 History 参考提交。本分支到 `dev` 的完整 PR 范围会包含这两笔前置，不只包含本轮 RSI delta。它们承载宿主历史能力、Memo 适配和限定授权整改；依赖与验证范围在 PR 中分别说明。Dynamite/EI 工作分支不由这个 Pakka PR 提交或合并。

## 形成的能力

- 原工作保存贡献者、真实固定内容修订及精确 Conversation 引用；新派发把它与运行计划原子登记。受信任 manager 可手动登记获准 handler 的已有上下文；普通调用者不能通过自报 runId、作者或内容修订取得贡献资格。
- H 转派后仍能读取原工作的修订并保存成果，不读取 J 后来的工单正文。报告使用独立身份与版本 CAS，追加不争抢无关工单头版本；原作者与每份正文版本实际作者分别记录。
- `report` 不再承担状态副作用；现有消费者改用 `setState` 推进当前状态。旧 `reported` 历史与旧回执保留，缺失可信关系的旧 run 不伪造为新工作。
- 原工作、报告摘要、不可变正文及原请求回执在所属 Runtime 的原 Session SQLite 独立寻址。摘要分页不读全文，固定正文版本和原回执在重开后保留。
- 保存与通知分别授权、分别记录结果。RSI 适配已有 MAS 公开发送/lookup 能力，固定原地址与消息身份，独立 CAS 确认唯一发送资格；未知接纳不盲目重发，通知失败不删除报告。
- 提交资格与回执读权分开。提交后失权保留 `unknown`；有原对象读权的相同请求重投只查回原效果，不重新取得写资格、不产生新效果。

## 实际检验与限制

[验证摘要](../verification/RSI-WORK-REPORTS.md)记录当前安装归档、源码范围、实际结果、必要限制及完整本地证据包 SHA-256。覆盖真实 SQLite、原生工具、MAS、原 Session 重开、分页增长和仓库外独立消费；模型调用限于本地确定性 provider。

本切片没有修改 MAS/Board、Agent、EI 或 Memo 产品能力，不要求上游增加 RSI 专属接口。保守扩大集合中的 Windows 子进程异常退出仍保留失败记录，不被定向通过或此前 reviewer 意见替换为整体通过。

## 后续消费边界

- 新报告列表/编辑界面、交接管线展示和跨 Session 过程浏览由 RSI 插件消费通用 WebUI 宿主能力；本切片只同步已有页面的状态调用，不宣称新 GUI 已实现。
- 是否停止 H、如何接续 J、是否并行以及是否采用某份报告属于可替换 workflow。贡献停用不是原生运行取消，MAS 接纳不是阅读完成，也不是工单关闭。
- 本切片没有重新委派独立 reviewer；原 History 候选的审查意见不能继承为新报告模型的复审结果。此次提交、推送和 PR 授权不包含合并或其他仓库操作。
