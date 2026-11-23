# MAS Telegraph 验证

本记录覆盖默认关闭的 reasoning/communication 提示选项、按 profile 的 Server/worker 装配及版本化 Skill 归档加载。基线为 `origin/dev@0a466ea18948dbf45d7d4ad80f81744fc9cebefe`，候选为独立 `pakka/mas-telegraph` 工作树中与本记录一起交付的代码、测试与消费脚本；这些受检文件的 SHA-256 清单整体摘要为 `b1da8d368525c8b409c8ef5b0d2f2d7eedb4e7f5439230a498cda24b764629c5`。清单、源码快照和逐归档身份只保存在本地证据包。

环境为 Linux x64、Node 24.19.0、npm 11.17.0、OpenSpec 1.14.3。依赖通过当前工作树的 `npm ci --ignore-scripts` 安装；自动用例使用隔离 HOME/数据、真实 Pi Durable 和本地确定性 HTTP provider，没有读取用户模型凭据或调用外部模型。

| 检查                                           | 实际结果                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`                                | 退出 0；全 workspace 及 WebUI facets 构建完成后才打包                                                                                            |
| `npm run check`                                | 退出 0；Durable 身份检查及 TypeScript 通过                                                                                                       |
| 精确选择六个测试文件                           | 退出 0；25/25 通过，0 fail/cancel/skip                                                                                                           |
| 真实归档消费                                   | Agent、MAS、DevPack、Protocol、Server 五个归档在仓库外独立安装，随后 `npm ci --ignore-scripts` 通过；未共享 node_modules，安装包目录不是 symlink |
| 安装后的 public types / `consumer-devpack.mjs` | 退出 0；公开 Skill 路径与正文、所选提示、真实工具、撤权、temporary worker，共 8 次本地 HTTP                                                      |
| 制品字节核对                                   | 安装 Skill 与源码一致；消费归档内 Server/DevPack manifest 和直接 dist 文件与当前构建逐字节一致                                                   |
| Pi 公共 Skill loader                           | `loadSkills` 零诊断；Skill 显式可用且 `formatSkillsForPrompt` 不自动广告；无 Session/模型调用                                                    |
| CRLF 探针                                      | 候选模块的隔离副本读取 CRLF Skill，得到与 LF 相同的所选提示；没有修改已安装依赖                                                                  |
| 格式 / OpenSpec / diff                         | 相关 Prettier、`openspec validate add-mas-telegraph --strict --no-interactive --json`、`git diff --check` 通过                                   |

精确测试命令：

```sh
npm test -- --files packages/mas-devpack/test/telegraph.test.ts,packages/mas-devpack/test/devpack.test.ts,packages/mas-devpack/test/boundaries.test.ts,apps/server/test/worker-validation.test.ts,apps/server/test/devpack-worker.test.ts,apps/server/test/product.test.ts
```

测试分类及各故障边界见 [tasks](../../openspec/changes/add-mas-telegraph/tasks.md)。现有归档消费脚本已更新，后续完整 package gate 可继续使用；本次只运行上述限定消费范围，没有将其称为完整产品安装验收。

首轮类型探针错误地从包根导入未导出的 `WorkerConfiguration`；改用既有公开 `WorkerManagerOptions["placements"][string]` 后通过，产品没有因此新增接口。首轮 OpenSpec strict 因一条 requirement 超过建议长度返回失败；拆短正文、保留场景语义后零问题通过。首轮 API 文档格式检查也在格式化后通过。原始失败与后续结果均保留。

自审消除了消费用例对 peer HTTP 出现顺序的依赖，并补上 CRLF 规范化。最终代码重新执行全仓构建、类型检查、25 项回归和新一轮归档消费；首轮归档与结果独立留存。完整 release、GUI、真实 Windows 平台与无关存储故障测试未选用；既有 `unknown.test.ts` SQLite lock 问题未重跑，未声称修复。

本次 Worker 会话按授权试用紧凑工作推理/协作表达，面向人的报告保持可读。这是定性提示实践，没有对照组、外部模型 benchmark 或推理 token/总成本收益结论。提示也不保证模型遵从或无损。

父会话已直接审阅 staged tree `7b7f0dafee6e4dedf3342a1f517c626172d73d4c` 的完整 diff 与证据，独立重算 14 个受检文件、源码清单和证据包的 SHA-256，均匹配，未发现本次范围的实现阻断。本轮没有另起独立 subagent review。随后仅更新进度文案并检查格式/diff，保留原受检源码和固定证据包，不重复运行代码测试或构建。本地 commit 因 Git 作者身份未配置未完成；按父会话决定保留 25 个 staged 文件，不修改身份配置。远端交付待后续。

本地证据包为 `20261123-mas-telegraph-rc0lfk10/mas-telegraph-evidence.tar.gz`，大小 **31,234,796 bytes**，SHA-256：

```text
2ea7c96638585035df2a8f6d223ca23dec1a831704c6db8835a4ecb4cd48ee4b
```

该包已核对可读取，并在工作区外的受限 `.backups/` 目录保全；不提交 Git 或上传。它包含构建、测试、两轮归档消费、首次失败、Pi/CRLF 探针和受检源码身份。证据冻结后的最终文档、index 与提交检查在交付报告中登记，不反写已固定的包。
