# Git 协作与文档分工

## 要求与观察

2026-11-07，操作者先要求读取工作区 `GitRules.md` 并直接以 `feat/webui-launcher` 初始化 dev，随后要求将规则并入开发/贡献规范并按 state-evo 更新项目元数据和 README。

规则来源为工作区 `GitRules.md`，采纳时原字节 SHA-256 为 `e33043b3463e62855f74ca2e4b3470334d1e0d90779013892f5ce9d4c486ac88`。其四类条件分别为：从受保护分支建立独立工作分支；已有工作分支提交并向 dev 提 PR；明确批量集成授权下直接处理 dev；明确发布 PR 授权下创建 dev → main 汇总。工作 PR 必须说明 Intent、Mechanism、Verification，集成推送前必须检查本地候选。完整有效规则在[开发正文](../../../docs/development/GIT-WORKFLOW.md)，克隆仓库后的贡献者可直接使用。

实际初始化：交付先提交为 `065823c8ae7bc99530af77098c0182001211901c`，然后本地/远端 dev 与 feat 同指该提交。远端 main 为 `547c4968b9414ecff774edb7071687539895e8e8`；该初始化未合 main，未产生无差异 PR。这是用户指定来源的一次初始化事实，不是把工作分支直接写入 dev 的日常权限。

本次成功 fetch 并读取远端 dev 后，以 `065823c` 建立 `pakka/git-workflow-docs` 工作树。托管平台默认分支仍是 main，因此工作 PR 需要明确 base=dev。仓库原先没有 CONTRIBUTING 或 PR 模板；OpenSpec context 仍把产品首先描述为 headless，OVERVIEW 的当前工作区包含大量历史检查数字。

## 采用的组织

| 对象                               | 维护职责                                       |
| ---------------------------------- | ---------------------------------------------- |
| `docs/development/GIT-WORKFLOW.md` | 完整 Git 操作条件、分支路径、PR 内容与远端核对 |
| `CONTRIBUTING.md`、PR 模板         | 贡献者的执行入口和日常 PR 正文结构             |
| `docs/state/delivery.md`           | 分支、候选身份与门禁关系，映射详细操作规范     |
| README、AGENTS、OpenSpec context   | 产品与开发入口、Agent 接续和生成上下文         |
| OVERVIEW                           | 简短的当前工作及未完成领域入口                 |
| 本 change、changes 摘要            | 来源、采用理由、delta 与实际检查/交付记录      |

已有 state/API/OpenSpec 映射继续使用；Git 操作细节集中在开发正文，其他入口保留必要条件和链接。PR 模板默认工作分支到 dev；明确发布时改为阶段概览与吸纳 PR 清单。Git 协作权限是仓库工作约定，不据此声称已配置 GitHub branch protection。

## 验证选用关系

日常开发仍按任务选择检查；批量集成明确要求检查合入后的本地 dev，并在推送前确认无编译错误、核心测试通过。发布 PR 要求最新待发布候选已有高可用验证。这些条件同步到交付声明、验证方法、前端开发方法及贡献入口，避免同一操作得到冲突指引。

本次是日常文档/元数据任务，选用规则覆盖、链接/锚点、Markdown/YAML 格式与解析、diff 和产品/固定证据字节核对。没有修改运行时，未选用模型调用、产品全量回归、独立 GUI 或对抗审查。具体结果在 tasks 中记录；先前产品验证仍按其原候选解释。

## 历史与剩余事项

OVERVIEW 中的已完成入口由现有 changes、verification 和领域 tasks 承接，旧正文仍可从基线提交查阅。固定验证报告中的“当时未提交”保留为运行身份，后续提交号与 dev 初始化另在本记录说明。

工作区的 GitRules.md 保留原文件；当前规范的仓库内维护位置是开发正文。没有修改工作区文件、其他仓库规则、远端默认分支、远端保护或发布历史。后续合并、发布与 OpenSpec 归档各自记录，任务 checkbox 不代表已合入或发布。
