# 验证工作方式

验证目标与选用关系见[交付声明](../state/delivery.md)；当前工作见 [OVERVIEW](../OVERVIEW.md)。本页维护检查的执行方法，集成与发布门禁见 [Git 协作规范](GIT-WORKFLOW.md)。固定结果由所属记录承接。

## 选用与记录

WebUI 重构初期采用[专门的少测试政策](FRONTEND-GUIDELINES.md#重构初期的测试政策)，优先于 Ockle TDD 与通用 test-first：尽量不以持久测试固定探索中的实现，只在极必要且已有检查不足时补测。类型／构建、真实页面直接检查和临时探索仍提供反馈；既有安全与恢复契约不降低，本页的方法清单也不是要求新增测试的清单。

日常开发中的 Verification 按任务目标和风险选择方法及覆盖范围。跳过时只在所属任务或变更记录一次，后续历史通过该记录追溯。明确授权的批量集成必须在推送前检查合入后的本地 `dev`，确认无编译错误、核心测试通过；创建阶段发布 PR 时，最新 `origin/dev` 候选须已有高可用验证。

实际开展的检查按运行版本、环境、范围和原始结果记录。选用某个流程时，按该流程的条件解释所得结论；方法清单本身不要求每个开发任务执行全部流程。打包工具的身份拒绝、权限与运行时闭锁仍是产物行为，和是否开展开发验证分别描述。

## 验证记录与本地证据包

`docs/verification/` 只提交关键信息：候选身份、环境、检查范围与方法、实际结果、必要失败/限制，以及完整本地证据包的包名、字节大小和整体 SHA-256。既有失败保持原结论，缺失或未执行项不写成通过；hash 证明包字节身份，不单独证明测试结果。

原始日志/TAP、截图、逐文件打包清单、完整依赖树、中间候选的源码清单与其他完整证据只在本地打包保留，不提交 Git，也不上传 GitHub 仓库、PR 附件、Release 或 Actions artifacts。云端存储由用户处理；Agent 不代为上传，也不在尚未交付时写成云端可获取。

1. 固定运行目录与检查对象，保留实际命令、版本、退出状态、结果和必要的重现信息。原始文件及包内清单留在本地；凭据、Cookie、用户会话和活动数据库按各自安全/一致性要求单独保全，不混入普通验证包。
2. 完成采集后在仓库外的受限本地保全目录创建新包，例如工作区 `.backups/<日期-验证事项>/`。只打包该次实际证据，不复制依赖树或与结论无关的产物；包名唯一，不覆盖旧包。
3. 核对归档内容可列出/读取，再对最终包字节计算整体 SHA-256，记录包名、大小、候选与结果。校验后的包保持不变；材料追加或修正形成新包与新 hash，不能把新身份倒写入旧结果。
4. 本地保全目录提供恢复/校验 README，原始材料和归档按敏感程度限制访问。证据包按长期材料保存，不能在清理临时工作树时随手删除；交付云端由用户接手。
5. 提交时只保留结果关键信息及包的整体 hash，不把包内清单搬进摘要。产品安装归档及可复现源码补丁的身份独立保留，不能用验证证据包 hash 替代。

提交及 PR 创建/更新前均执行[完整产物检查](GIT-WORKFLOW.md#提交与-pr-产物检查)，包括全部暂存文件、完整 base diff、行数和大文件；即使本轮不运行测试也要检查。

## 源码门禁

选用源码检查时，使用仓库要求的 Node/npm、本地确定性 provider 和隔离目录，按影响面选择对应命令：

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm run format:check
git diff --check
```

`npm test` 是默认核心集合，其结果只覆盖列出的文件。构建完成后可使用：

```sh
npm test -- --list
npm test -- --files packages/agent/test/runtime-records.test.ts
npm run test:affected -- --scope maintenance
npm run test:affected -- --scope rsi --list
npm run test:release
```

`--files` 接受逗号分隔的精确相对路径，可重复使用；路径不存在即拒绝。`--test-name-pattern=<正则>` 可进一步筛选文件内场景；没有匹配测试时返回失败。`--list` 输出完整选择与排除，执行时同一清单写入独立运行目录。未知选项及 release/scope 等冲突组合会被拒绝。

| 变化                                         | 选用入口                                                      |
| -------------------------------------------- | ------------------------------------------------------------- |
| 日常反馈                                     | core默认集合：权限、身份、records、MAS查询、恢复、并发边界    |
| 工单服务或扩展消费                           | affected rsi，含协议/client和扩展接缝                         |
| 维护、备份、恢复、CLI入口                    | affected maintenance                                          |
| WebUI/server/CLI消费与浏览器                 | affected webui                                                |
| 共享协议/Runtime或无法确定影响面的跨切面变化 | affected protocol/runtime或test:release，覆盖全部剩余源码测试 |
| exports、依赖、vendor、构建、资产或发布      | test:release加smoke:package，按需要增加平台专项               |
| 文档                                         | 链接、格式、差异与对象字节核对                                |

领域映射由 `scripts/test-selection.mjs` 维护，新增动态接缝时一并核对；它不是自动证明“不受影响”的依赖分析器。精确文件用于已明确的定位/回归，不替代未知影响面的扩大验证。

运行结果在 `artifacts/test-runs/run-*/`：`selection.json`、`progress.jsonl`、`summary.json` 及每文件 `output.tap`。CLI维护的 `maintenance-phases.jsonl` 记录启动/备份/恢复等阶段耗时与退出，不写凭据。每个worker使用独立HOME、USERPROFILE、Pi目录、TEMP/TMP和产物目录；旧证据保留。摘要记录Node进程高水位RSS（不是整个进程树总峰值）与定时采样的系统可用内存。

默认一个重型加一个轻型worker；`--workers 2|4` 只增加已审计的protocol/client轻型池；创建真实Runtime的 `packages/client/test/client.test.ts` 仍归重型。未知文件和浏览器保持单重型池。重型启动时可用内存低于1 GiB会暂停，30秒仍低则记录BLOCKED，不能解释为通过。额外并发依据同机测量选用。

同工作树的runner通过 `artifacts/test-runs/active.json` 拒绝重叠运行；不自动删除残留锁。取消后保留锁并记录后代进程清理未确认；取消/异常后先根据记录核对原PID、子进程及产物，再处理占用。该锁不替外部build、安装脚本或旧专项脚本调度；同一工作树内不要将其与测试并发运行，采用串行或独立工作树。

浏览器检查需要实际 Chrome/Chromium。非标准安装设置绝对路径 `PAKKA_TEST_CHROME`；使用新 profile，不读用户 Cookie、模型凭据或付费服务。已选用浏览器检查而缺少必要浏览器时，将该次检查记录为 BLOCKED；未选用的活动由本任务的选用记录承接。

Windows 独立命令需重新设置隔离 HOME/USERPROFILE/PI_CODING_AGENT_DIR、PI_OFFLINE，并将 TEMP/TMP 规范为 `fs.realpathSync.native(os.tmpdir())`；工具调用间不继承上一条命令的设置。局部浏览器回归可使用隔离 runner：

```powershell
./scripts/test-devin-r2.ps1 -EvidencePath artifacts/devin-r2/new-run -TestFiles apps/webui/test/mas-stylesheet-browser.test.ts
```

局部脚本的结果仅覆盖其实际范围；完整检查与独立 GUI 使用各自的执行流程。视口与触达目标见[前端声明](../state/frontend.md#响应式与可访问性)，不要用固定页面比例裁切真实画面。

界面功能取证同时保存实际触发动作、原生结果/拒绝与请求/效果计数；零额外请求只能支持相应无副作用判断，不能单独证明功能已触发。Team 样式回归通过受控挂起和错误响应核对加载边界，不以固定等待时长代替就绪判断。视觉取证保存相同 viewport 的参考/候选直接检查、几何与完整差图；差图指标按实际定义解释，不换算为“还原率”。

## 仓库外安装与产物身份

`npm run smoke:package` 生成并安装当前 workspace 的实际归档，运行公开声明、实际 executable、浏览器与消费者。选用仓库外安装检查时，执行身份 preflight，核对源码/门禁 helper/资产、归档/lock/安装逐文件内容及消费者结果。漏源码、损坏归档和身份篡改反例必须在 build/install 前被拒绝。

需要完整前端候选检查时使用 `scripts/verify-devin-r2.ps1`，在固定快照上串行保存 check、syntax、build、扩大、全量和 package 原始结果。失败退出、取消或 NOT_RUN 不覆盖为后续局部通过。

安装消费保留实际归档、公开入口/类型、代表性维护升级与平台行为；通用业务条件主要在源码服务层验证。文档或无关局部改动不机械执行全部安装阶段。

若检查失败，`artifacts/package-smoke/consumer-path.txt` 可能仍指向上次成功目录；从该次执行日志的实际 cwd、进程退出/signal 和原始状态定位，不单凭旧指针或 `exit=null` 推断业务原因。子进程控制台退出也不自动证明 native 效果终态。

## OpenSpec 校验范围

选用 OpenSpec 校验且有可用 CLI 时，按变更范围运行并保存相关或全量结果：

```sh
openspec validate pakka-webui --strict --no-interactive --json
openspec validate mas-board-relationship-workbench --strict --no-interactive --json
openspec validate --all --strict --no-interactive --json
```

已选用的 CLI 不可用时记录 BLOCKED；保存实际 CLI 版本和输出，不临时改依赖或用其他版本的结果替代。

## 独立实操与审查

选用本地确定性浏览器或独立实操时，按各自流程及 [WebUI 开发契约第 9/10 节](WEBUI-DEVELOPMENT.md#10-分阶段-computer-use-实操验收)和 AGENTS 的指定模型/工作流执行。固定候选、独立 worktree、唯一桌面、真实操作和 A/B 证据分别记录；缺环境保持 BLOCKED。

通知的 HTTP 接受、原生系统显示/点击和不同部署设备各自留证。

## 文档修改

只改文档时检查分工是否成立、链接/锚点、格式、差异和规范引用；对比产品树与固定证据字节，确认没有借整理改变被证明对象。记录本次选用范围及实际运行结果；未选用活动的原记录继续承接该决定，不机械重跑无变化的 Pi/模型矩阵。

当前预期不写候选结果，变更记录不冒充原始输出。正式记录保留关键信息及完整本地证据包的整体 hash，完整材料在本地长期保全；临时运行路径不替代归档，用户接管云端存储后再按实际交付情况登记。
