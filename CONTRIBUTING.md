# 贡献指南

Pakka 的日常贡献在独立工作分支完成，通过 PR 汇入 `dev`；阶段发布通过获明确授权的 `dev → main` PR。完整授权条件与操作步骤见 [Git 分支与 PR 协作](docs/development/GIT-WORKFLOW.md)。

## 开始工作

1. 阅读 [OVERVIEW](docs/OVERVIEW.md)、相关 [state](docs/state/README.md) 和所属 OpenSpec tasks。已有 `docs/.temp/active-plan.md` 时接续其中的本机安排；缺失时从已跟踪任务恢复。
2. 确认当前分支、工作树和已有改动。新任务成功 fetch 后从最新 `origin/dev` 建立独立分支，如 `pakka/<task-slug>`；已有专属分支继续承载原任务。
3. 使用 Node 24+、npm 11，按 [README](README.md#安装与构建) 安装与构建。项目代码、SDK、权限和持久化要求见 [AGENTS](AGENTS.md) 及 [开发规范](docs/development/README.md)。

```sh
git branch --show-current
git status --short --branch
git fetch origin
git switch -c pakka/<task-slug> --no-track origin/dev
```

## 实施与文档

根据采用的契约修改实现，核对原身份、权限及 unknown 效果边界。新增测试使用真实 Pi 和隔离的本地确定性 provider；真实模型试跑需相应的明确授权。

文档沿用 state-evo 与 OpenSpec 的分工：

| 内容                                | 维护位置                                                       |
| ----------------------------------- | -------------------------------------------------------------- |
| 产物的当前预期、对象与条件          | `docs/state/` 及映射的 API/场景规范                            |
| 形成条件、采用理由与任务            | `openspec/changes/<change>/`；`docs/changes/` 提供完整引用摘要 |
| 当前工作及可接续的差距              | 简短的 `docs/OVERVIEW.md` 与所属 tasks                         |
| 本机计划、草稿、探针和日志          | 已忽略的 `docs/.temp/`                                         |
| 固定候选、实际结果与证据包整体 hash | `docs/verification/` 的关键信息；原始证据本地打包保留          |

采用预期调整时，同步声明、形成记录和任务；普通实现修复只更新实际受影响的内容。README 介绍产品及使用入口，历史结果保留在其原记录。详细方法见[文档维护](docs/development/README.md#文档维护)。

## 检查、提交与 PR

日常检查按任务目标和风险选用，记录实际命令与结果；纯文档通常检查规则一致性、链接/锚点、格式和 diff。代码、类型、构建、浏览器及安装消费的方法见[验证工作方式](docs/development/VERIFICATION.md)。

每次提交以及创建/更新 PR 前，都按 [完整产物检查](docs/development/GIT-WORKFLOW.md#提交与-pr-产物检查)审查文件清单、diff 规模和大文件；PR 检查覆盖实际 base 的完整范围。`verification` 只提交关键信息与本地证据包的整体 SHA-256，原始证据及证据包不上 GitHub，云端存储由用户处理。提交前执行 `git diff --check`。提交和推送只针对独立工作分支，远端引用核对后再报告成功。阶段完成时，查询是否已有该分支指向 `dev` 的 Open PR：已有则推送更新，否则创建。PR 使用 **Intent / Mechanism / Verification** 描述具体目标、核心机制和实际检查。

`main` 禁止直接 commit/push；`dev` 的直接提交和推送只在明确授权的批量集成中使用。批量集成推送前必须检查合入后的本地 `dev`，确认无编译错误、核心测试通过。创建 `dev → main` PR 需要明确的“PR 到 main”指令，并汇总实际吸纳的 PR 与发布候选验证。

收尾时更新所属 tasks 和工作入口，保留未完成或受阻事项的接续位置。工作分支 PR 的创建、集成、阶段发布和 OpenSpec 归档分别记录。
