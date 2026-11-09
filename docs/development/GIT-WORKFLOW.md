# Git 分支与 PR 协作

本规范适用于 Pakka 仓库的提交、分支和 PR 操作。贡献入口见 [CONTRIBUTING](../../CONTRIBUTING.md)，交付关系见[交付声明](../state/delivery.md)。

## 分支职责与操作前核对

| 分支                                 | 职责                               | 写入条件                                                        |
| ------------------------------------ | ---------------------------------- | --------------------------------------------------------------- |
| 独立工作分支，如 `pakka/<task-slug>` | 保存一项任务的实现、文档和验证记录 | 日常提交、推送；阶段完成时向 `dev` 提 PR                        |
| `dev`                                | 汇集工作分支，形成可集成候选       | 通过工作分支 PR 集成；直接 commit/push 仅用于明确授权的批量集成 |
| `main`                               | 接收阶段发布                       | 通过获明确授权的 `dev → main` PR；禁止直接 commit/push          |

每次提交、分支操作或 PR 管理前，先运行 `git branch --show-current`，同时核对工作区、HEAD、upstream 和 worktree。命令在目标仓库或工作树中执行：

```sh
git branch --show-current
git status --short --branch
git rev-parse HEAD
git rev-parse --abbrev-ref '@{upstream}'
git worktree list --porcelain
```

新分支尚无 upstream 时，记录这一状态；首次推送设置对应的远端工作分支。`main` 与 `dev` 的角色是协作约定，远端实际保护配置需另行核对。

保留已有改动及工作树的独立任务。并行写入使用不同工作树；切换或新建分支前核对当前改动归属。Git clean 状态不代表被忽略的本地数据可以删除。

## 日常工作分支

### 从 dev、main 或没有独立工作分支的状态开始

先成功 fetch，再以实际 `origin/dev` 创建独立分支。网络失败时，缓存引用不能称为最新远端：

```sh
git branch --show-current
git fetch origin
git rev-parse origin/dev
git switch -c pakka/<task-slug> --no-track origin/dev
```

需要独立工作树时，可用 `git worktree add -b pakka/<task-slug> --no-track <path> origin/dev`。记录实际基线 SHA，避免让工作分支误跟踪 `origin/dev`。

远端尚无 `dev` 时，以成功 fetch 后的 `origin/main` 初始化 `dev`，再创建工作分支；这是首次建支路径，不是日常直接向 `dev` 提交的入口。操作者明确指定初始化来源时采用该来源并记录 SHA，遇到已存在的不同 `dev` 先核对，禁止覆盖。初始化完成后适用正常集成规则。

### 已在独立分支或专属 worktree

继续在该分支保存所属任务。阶段完成或操作者要求提 PR 时，检查该 head 是否已有指向 `dev` 的 Open PR：已有则推送更新，没有则新建。后续独立任务从最新 `origin/dev` 建立自己的工作分支。

提交前复读 diff 和文件清单，运行 `git diff --check`，核对暂存区仅含交付内容。凭据、数据库、会话数据、依赖目录和原始验证证据留在各自受保护的本地位置；产品必需的 vendor、源码补丁和构建锁按交付契约核对。

推送前核对 remote URL 与完整 refspec。普通推送保留已发布历史；远端前进或拒绝时先核对差异，不用 force 绕过。成功后通过 `git ls-remote --heads origin <ref>` 读取实际远端 SHA，再报告完成。

## 提交与 PR 产物检查

每次提交及创建/更新 PR 前，必须检查完整产物；这项提交卫生检查独立于是否选用 Verification。提交检查暂存区，PR 检查相对实际 base 的完整范围，包含继承提交，而不只是最后一笔提交。

```sh
git status --short
git diff --cached --name-status
git diff --cached --numstat
git diff --cached --stat
git diff --cached --check
git diff --name-status origin/dev...HEAD
git diff --numstat origin/dev...HEAD
git diff --stat origin/dev...HEAD
```

成功 fetch 后使用实际 PR base；发布 PR 则检查 `origin/main...HEAD`。逐项确认文件职责，检查大文件的字节大小与正文，解释行数突增、重复候选、生成文件和二进制内容。不能只凭扩展名、路径、总行数或既有 ignore 规则判定可提交。

- `docs/verification/` 只跟踪关键信息与完整本地证据包的整体 SHA-256；原始日志/TAP、截图、npm pack 逐文件输出、完整依赖树、中间候选和重复清单留在本地证据包。
- 原始证据和证据包不提交 Git，也不上传 GitHub 附件、Release 或 Actions artifacts；云端存储由用户处理。不得 `git add -f` 绕过此要求。
- 核对暂存区及完整 PR diff 中没有证据包、原始证据、凭据、数据库或会话数据。产品必需的代码、测试、许可、vendor、源码补丁和构建锁按其交付契约核对，不与验证过程输出混淆。
- 仓库中的验证记录保留候选、环境、范围、实际结果、必要限制，以及本地包名、字节大小和整体 SHA-256；不复制包内逐文件清单或原始控制台输出。包的形成与本地保全见[验证记录与本地证据包](VERIFICATION.md#验证记录与本地证据包)。

## 工作分支 → dev PR

PR 以 `dev` 为 base，即使托管平台默认分支是 `main`，也应明确指定。PR 标题和正文描述最终变更及其行为，正文包含：

- **Intent**：具体问题、触发条件或目标。
- **Mechanism**：核心逻辑、状态流、结构或文档关系如何改变。
- **Verification**：实际执行的检查、候选与范围；失败、受阻或未选用的检查按实记录。

文件清单可作补充，不能代替上述语义说明。[PR 模板](../../.github/pull_request_template.md)提供默认结构。

```sh
git branch --show-current
git push -u origin HEAD:refs/heads/pakka/<task-slug>
gh pr list --state open --head pakka/<task-slug> --base dev
gh pr create --head pakka/<task-slug> --base dev --title "变更目标" --body-file <body-file>
```

将完整正文写入临时文件后传给 `--body-file`。新建前确认现有 PR，避免重复。创建 PR、合并到 `dev` 和阶段发布分别记录；提交或推送工作分支不自动执行合并。

## 明确授权的批量集成

触发条件是操作者明确要求“处理多个到 `dev` 的 PR”。仅在该指令范围内，可直接在 `dev` 解决冲突、生成 merge/fixup commit 并推送。

1. 核对待处理 PR 的 base、head 和完整提交范围；在干净工作树中检出并同步最新 `origin/dev`。
2. 依次普通合并待处理分支，解决冲突并保留各 PR 对应的结果。默认保留提交历史，不 squash 或改写已发布历史。
3. **推送前必须在本地合入后的 `dev` 运行测试套件、构建或静态检查**。按影响面选择能确认编译状态和核心功能的检查组合，记录实际命令、候选和结果。必须确认无编译错误、核心测试通过；失败或未取得所需结果时停止推送。
4. 核对明确 refspec，推送 `dev`，再读取远端 SHA 确认。
5. 核对哪些 PR 已进入目标提交，再关闭或整理这些 PR。分支、工作树和本地数据的删除另按其授权与保全要求处理。

这里的检查是集成门禁，日常开发中按需选用 Verification 的规则不能代替它。相关执行方法见[验证工作方式](VERIFICATION.md)。

## 明确授权的阶段发布 PR

触发条件是操作者明确要求“PR 到 `main`”。此指令允许创建 `dev → main` 的阶段汇总 PR，后续合并遵循另行的发布授权。

1. fetch 后确认本地发布工作树与 `origin/dev` 对齐，工作区干净且无冲突；最新待发布提交已有覆盖其范围的高可用验证。
2. 比较 `origin/main..origin/dev` 的合并历史及实际已合入 PR，确认发布范围。
3. 检查已有 `dev → main` Open PR，新建或更新同一个发布 PR。正文采用以下结构：
   - **阶段概览**：本周期完成的整体演进和用户可见结果。
   - **吸纳的 PR 清单**：每条列出 `PR 链接 (#ID)` 和一句语义说明。
   - **Verification**：对应发布候选的验证与必要限制。
4. 对初始化等没有 PR 的实际来源单列提交和原因，不编造 PR 编号。发布摘要概括变化，底层实现细节由工作 PR 承接。

## 文档与接续

采用的分支职责与门禁由[交付声明](../state/delivery.md)映射到本规范；README 和 CONTRIBUTING 提供用户与贡献者入口。AGENTS 与 OpenSpec context 引用相同规则。

预期调整、来源和初始化事实进入[变更记录](../changes/git-workflow-and-project-metadata.md)，任务及实际检查进入所属 OpenSpec tasks。`docs/OVERVIEW.md` 只定位当前工作与剩余差距，本地执行安排在忽略的 `docs/.temp/`。
