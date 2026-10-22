# OpenSpec 对齐与工作树清理

## 范围

基线为 `dde6012`，在 `feat/devin-like-frontend` worktree 内执行；没有合并 main。用户要求保留 OpenSpec、让 changes 总结完整引用 change＋spec，并将完成重归类的旧稿和无用临时材料备份后移除。

完整决定见[文档变更及全部 spec](../changes/2026-10-21-documentation-system.md)。本轮不是新的产品候选或产品验收；R2 的 FAIL、cancel、skip 与独立 GUI BLOCKED 保持原范围。

## 实际整理

- docs/changes 只保留摘要，逐项列出 OpenSpec change 目录、proposal/design/tasks、所有 delta 和相关主 spec；七项核心归档和两项既有活动变更均有完整索引。
- 原 R2 记录移入 `adopt-devin-frontend/design.md`，MAS 第二稿移入 `mas-board-relationship-workbench/design.md`。新记录说明其回溯身份，不冒称当初已有这些 OpenSpec 文件。
- 外置并移除 82 个旧文档/示意/元数据文件（69 个 tracked、13 个原未跟踪），包括重复 plans、旧 MAS 试写/复核/图稿、旧状态、过时整理报告及 R1 视觉材料。逐项记录见[移除清单](evidence/documentation-cleanup/removed-documents.json)。
- 本地旧实验归档后移除 174 个入口，共 76578 个普通文件、12 个链接、845412440 字节源内容；不跟随链接目标。归档有 95187 个含目录的条目，全部逐项核验，删除前复核源身份，未发生锁/变化例外。
- 保留当前 candidate-004 本地材料、当前正式候选/样式门禁证据，以及可复用演示启动脚本。`.cu/@locks`、workspace 元数据和现用 active-plan 不清理。
- `devin-reference.test.ts` 仍读取 R2 oracle manifest，当前候选也链接其草案，因此保留 `devin-frontend-r2` 原参考目录，不能按旧日期删除。早期 adoption 草案仅修正一处指向已迁入 OpenSpec 的设计链接；与备份比较确认是纯链接变更。137 个受保护证据/账本文件字节不变，当前候选和原始日志/截图/JSON 未改。
- M1–M6/P0–P5、历史失败配对及必要 Linux/兼容性记录继续保留；M3–M5 三个兼容跳转被不可变账本使用，未删除或重写账本。

产品行为源码、测试、依赖和门禁脚本不变。包内 NOTICE 与两份 integrations README 只调整已移除文档的引用/采用来源；这些 Markdown 在编辑前另行备份，身份比较明确列为文档例外，不声称全部 432 个原始 product-path 文件都未变。

## 备份与恢复

开发机备份根：`D:/Projects/kappa/backups/pakka-1021/cleanup-20261021-212301/`。

- `before/`：330 个原始 tracked 文档/配置；另补 3 个包/集成 Markdown 及 13 个原未跟踪视觉元数据文件。
- `before-manifest.json`、`supplemental-manifest.json`：原路径、字节数、SHA-256；备份复制后核对，移除前再次确认。
- `removed-documents.json`、`selection.json`：移除项及保留理由。
- `stale-worktree.tar`、`stale-manifest.json`：本地旧实验原字节、路径、类型/链接目标和逐项哈希。
- `operations/`、`archive.log`：盘点、归档、校验/移除和恢复 helper。完整大索引不复制回已清理工作树。
- 备份文件身份见[backup identity](evidence/documentation-cleanup/backup-identity.json)。归档 SHA-256：`7fc5f3b8d13a371d1e92dd99ac368ca86ad77d55279856d3b27b8a8a38b6b6aa`。

先恢复到另一空目录检查，不直接覆盖现用工作树。例如：

```powershell
$backup = 'D:/Projects/kappa/backups/pakka-1021/cleanup-20261021-212301'
python "$backup/operations/restore.py" --path docs/plans --target D:/Projects/kappa/backups/pakka-1021/restore-preview
```

恢复 helper 验证文件哈希，不覆盖已有文件；归档里的链接仅输出待审核的目标清单，不自动建立或跟随。整个 tar 不应盲目解压回正在运行的目录。原 tracked 文档也可按基线 Git 提交查看。

## Git ignore

已核对：`docs/.temp/`、artifacts、`.cu/`、node_modules 和构建输出已有忽略规则。本轮不添加宽泛规则，不忽略 OpenSpec 的 proposal/design/tasks/specs/config 或正式证据；清理不改变 runner 输出路径。暂存身份检查发现根 `*.log` 会漏掉新归档的原始日志，因此仅在本次正式证据目录添加 `!*.log` 的局部例外，并再次逐文件检查 Git 索引字节。

## 检查

| 检查                        | 本轮实际结果                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------- |
| 全工作树 Markdown 链接/锚点 | 137 份 Markdown、635 个本地引用，无缺失                                               |
| changes 完整性              | 11 项 change、20 个 delta spec、79 个应列引用，全部覆盖                               |
| 产品路径比较                | 432 个原始文件中 429 个字节不变；3 个文档例外逐项列出，无运行时代码/测试/依赖变化     |
| 当前证据/账本               | 137 个字节不变；1 个早期草案仅修正设计链接，精确比对通过                              |
| 主 specs 正文               | requirement/scenario 全文不变；只填写两个 Purpose                                     |
| 备份与移除                  | 82 个文档/资产备份一致且源已移除；174 个本地入口无锁/变化例外；归档整文件哈希复核通过 |
| 恢复演练                    | 文档前缀及 tar 普通文件回读哈希一致；已存在文件拒绝覆盖；不自动创建链接               |
| OpenSpec 1.14.3             | 两项新 change strict 各通过；全量 8/11，三项旧长度警告在 strict 下仍未通过            |
| npm run check               | PASS，Durable patch 和 TypeScript                                                     |
| 参考依赖回归                | Node 24 原生测试 1/1，固定 LF CSS 和保留的 oracle manifest 可用                       |

原始结果与文件身份在 [evidence](evidence/documentation-cleanup/)。最初误用未安装的 tsx 启动测试，加载器在执行用例前失败；该命令错误日志保留，随后使用原生 Node 24 执行通过，未改依赖。46 份修改/新增 Markdown 与 YAML 格式检查及 git diff --check 通过；未将历史全量格式告警隐去。

OpenSpec 1.14.3 初始 strict 为 5/9 通过、4 项未通过：两个 Purpose 占位和三个过长 requirement（其中一项两者都有）。Purpose 已填写；原 requirement/scenario 全文保持，不为降低警告数裁剪或拆分规范。

本轮没有重跑浏览器/付费模型/完整产品矩阵，不更新旧产品候选通过数。下一项实际工作仍见[实施状态](../PAKKA-POCKET-STATUS.md)。
