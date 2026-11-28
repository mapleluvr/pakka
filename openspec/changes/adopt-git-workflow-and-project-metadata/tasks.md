# Tasks

## 采用与文档

- [x] 阅读 GitRules、state-evo、现有规范及实际 dev 初始化身份。
- [x] 从成功 fetch 的 origin/dev 建立独立工作树和工作分支。
- [x] 编写完整 Git 协作正文、贡献指南与 PR 模板。
- [x] 同步交付 state、验证方法和前端开发方法的适用条件。
- [x] 更新 README、AGENTS、OpenSpec context、文档索引与简短 OVERVIEW。
- [x] 记录来源、初始化事实、delta 和文档分工。

## 检查与交付

- [x] 对照 GitRules 核对四类分支操作、PR 内容及权限。
- [x] 检查相对链接、锚点、Markdown/YAML 格式和 YAML 解析。
- [x] 确认产品、依赖与固定证据无差异，检查 git diff。
- [x] 在独立分支提交、推送并核对远端 SHA，创建或更新到 dev 的 PR。

本轮选用纯文档/协作元数据检查，未选用模型调用、产品全量回归、独立 GUI 或对抗审查。集成与发布的强制条件由本次采用的 Git 规范承接；工作 PR 交付不代表已合并或发布。

## 2026-11-07 检查记录

基线为 `065823c8ae7bc99530af77098c0182001211901c`。本次范围为 18 个 Markdown 文件与 `openspec/config.yaml`，使用 Node、现有 Prettier 3.6.2、YAML parser、yamllint 与 OpenSpec 1.14.3 检查。

- 逐项复读 GitRules 的四条流程：分支确认、日常建支/复用、PR 去重与语义、批量集成授权/门禁、发布授权/汇总均有对应维护位置；初始化的用户指定来源另留形成记录。
- 167 个相对文件/目录链接与 8 个 Markdown 标题锚点检查通过，19 个文件的 Prettier 检查通过。YAML 解析、行宽/换行检查通过，既有 OpenSpec rules 与 archive guidance 解析值保留。
- `openspec validate adopt-git-workflow-and-project-metadata --strict --no-interactive --json`：1 个 change 通过，issues 为空。
- `git diff --check` 通过；相对基线的 apps、packages、scripts、integrations、patches、package/lock 与 docs/verification diff 为空。

原始本机检查输出和只读辅助器在 `docs/.temp/`，本记录保留检查方法、版本、范围与实际结论。

## 工作分支交付

主体文档提交为 `5efb5e188efbec3e04f66d44b78615a42d80dc26`，已推送 `pakka/git-workflow-docs` 并通过实际远端引用核对；[PR #2](https://github.com/mapleluvr/pakka/pull/2) 以 dev 为 base。随后同步本任务与 OVERVIEW 的交付状态。当前等待 PR 评审/集成，未合入 dev 或 main，OpenSpec change 保留活动状态。
