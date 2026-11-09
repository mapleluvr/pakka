# 交付与验证

## 产物与身份

交付物是可通过公开入口在仓库外安装和使用的包/应用。版本、公开 exports、Pi cohort、下游 Durable artifact、原始来源与资产许可证均可核对；安装消费者通过所交付归档和声明依赖运行。

固定候选包含实际源码、必要的未提交/未跟踪文件、构建和检查 helper、交付资产。打包与安装入口的身份 preflight 核对源码完整性、归档内容、lock 与消费者安装身份；身份拒绝在对应构建或安装动作前终止该操作。

## 分支与集成

独立工作分支承载一项任务的产物和记录，以 `dev` 为 PR 目标；`dev` 汇集可集成候选，`main` 接收阶段发布。提交、分支操作和 PR 管理先核对当前分支；新任务基于成功 fetch 后的远端开发基线。

日常 PR 说明 Intent、Mechanism 和 Verification。直接在 `dev` 集成以操作者明确要求处理多个 PR 为条件，推送前检查合入后的本地候选，确认无编译错误、核心测试通过。`main` 的更新通过阶段发布 PR；创建 `dev → main` PR 以明确发布指令、干净的远端对齐工作树和最新候选验证为条件，正文汇总阶段结果与实际吸纳的 PR。

分支与远端核对、初始建支、权限条件和具体步骤由 [Git 协作规范](../development/GIT-WORKFLOW.md)维护，贡献入口在 [CONTRIBUTING](../../CONTRIBUTING.md)。

## Verification 的选用

日常开发中的 Verification 按任务目标和风险选用。所属任务明确本次检查及其范围；跳过时在所属任务或变更记录一次，后续通过该记录追溯。批量集成 `dev` 的推送前检查和阶段发布的候选验证按上述条件执行。

每次提交及创建/更新 PR 均审查完整产物清单、diff 规模和大文件；PR 以实际 base 的全部差异为范围，包含继承提交。这项产物检查独立于是否选用运行时 Verification。

实际执行的检查保留候选、环境、范围与结果。源码测试、真实 provider、浏览器、独立实操、审查与设备检查分别提供各自范围的依据。

## 方法与证据

| 方法       | 结论的成立条件                                                                           |
| ---------- | ---------------------------------------------------------------------------------------- |
| 源码与类型 | 相应 check/build/语法与回归的实际输出，区分局部和全量                                    |
| 行为与权限 | 实际服务的动作、结果/拒绝、效果时撤权、原请求核对、private canary 及请求/效果计数        |
| 前端符合性 | 相同实际 viewport 的候选与参考、直接看图、结构/几何和完整差图                            |
| 仓库外安装 | 实际归档、独立于根 workspace/overrides 的消费者、公开声明及所检查的 executable/资产/操作 |
| 独立 GUI   | 固定候选、独立 worktree、唯一 agent-workspace-linux desktop、指定模型和真实 Computer Use |
| 独立审查   | 指定 adversarial-review 工作流、双方意见/争议及作者 closing                              |
| 远程/设备  | 实际 TLS/proxy、人员/设备和部署身份，以及目标设备上的显示与操作结果                      |

选用本地浏览器回归和独立 GUI 时，分别按[开发契约第 9 节](../development/WEBUI-DEVELOPMENT.md#9-实际开发与验证路径)与[第 10 节](../development/WEBUI-DEVELOPMENT.md#10-分阶段-computer-use-实操验收)执行。

## 结果的适用条件

- 测试使用显式本地确定性 provider；账户、凭据、HOME/profile 和数据均为隔离资源。
- 实际执行项记录 PASS、FAIL、BLOCKED、取消等对应结果，结论按所检查的版本与范围解释。
- 候选及运行环境有明确身份；历史结果用于注明版本与环境的对照。环境归因使用干净基线、相同条件和有判别力的实验。
- 接纳回执、输入持久化、generation、应用回复与工具/外部效果分别确认；业务完成结论由对应的实际结果支持。
- Git 中的验证记录仅含候选、环境、范围、实际结果、必要限制等关键信息，以及完整本地证据包的包名、字节大小和整体 SHA-256。
- 原始日志/TAP、截图、逐文件打包输出、完整依赖树、中间候选与完整证据在受限本地目录打包保全。原始证据及证据包不提交 Git，也不上传 GitHub 附件、Release 或 Actions artifacts；云端存储由用户处理。
- 证据包身份绑定实际检查对象与结果，最终包变更形成新 hash；产品安装归档与可复现补丁的身份独立核对。保全位置、校验与交接方法见[验证记录与本地证据包](../development/VERIFICATION.md#验证记录与本地证据包)。

执行命令、环境设置与采集方法见[验证方法](../development/VERIFICATION.md)。独立模型、工作流和快照职责见开发契约及 AGENTS。采用经过见[补丁与选用规则变更](../changes/durable-1-4-0-and-verification.md)、[Git 协作与项目元数据](../changes/git-workflow-and-project-metadata.md)和[本地验证证据与提交检查](../changes/local-verification-evidence.md)。
