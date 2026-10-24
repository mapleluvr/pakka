# Compressor Conversation 独立计数与原生并发

2026-10-24；显式库试行，非默认产品接入。用户纠正了代理的误解：两类错误按单个 Compressor Conversation 累计和封存，不按共享 Session 累加；原文窗口任务独立并发，跨任务 P2/P3 由额外异步机制合并。

## 固定身份

| 产物 | 版本 | SHA-256 |
| --- | --- | --- |
| Host | `@pakka/agent@0.7.0` | `c5c7fffddf9b644426ef86bba6ae03c67f813d68f10eb4f6901a052700047981` |
| Strategy | `@pakka/dynamite@0.5.0` | `185fe5b5563e1f89834db80fcf19b29d80dfb55a32ecb9b6d41bd67b68591cdd` |

SDK 保持 `pi-durable@1.4.0-pakka.1`，其归档 SHA-256 为 `7fd9f3310dfa003a9077139a25faf93567922a065461fa3767dd5a1066efa891`，Pi AI/Chord/Telemetry 及 Durable 必需的 pi-codemode 为 1.4.0。没有修改 SDK 补丁或手改安装依赖。Windows、Node 24.18.0，独立临时 profile、真实 localhost OpenAI-completions provider；不读取用户凭据、不调用付费模型。

工作起点为 Host `5dcc4cd`、Dynamite `279eb83`。固定工作副本在[source manifest](evidence/compressor-conversation-isolation/source-manifest.json)逐文件记录；两个归档的全部自身 dist 文件与当时构建输出逐字节相同。安装消费独立的 tgz、compiled exports 与公开 declarations，没有 workspace link、根 overrides 或生产 oracle。机器身份在[新配对](../../integrations/dynamite/compresser-conversation-pairing.json)。

[上一版 aggregate-policy 试行](COMPRESSER-SESSION-TRIAL-ISOLATION.md)及其[机器配对](../../integrations/dynamite/compresser-trial-pairing.json)保留原范围；Dynamite 的 [0.4.0 pairing](../../../pakka-dynamite/integrations/pakka/0.4.0-pairing.json)保留原字节。旧版的共享封存不是新契约的验收。早一轮安装通过的 Dynamite 归档 `b695629fcd0e68a7f7b0158f125be2b92ef05f979a58b40eee4f2aec0ef89954` 仅对应当时包内文档；改正当前验证链接后重新打包，并以表中最终字节完整重跑 68 项，未沿用旧安装结果。

## 结果

| 检查 | 实际结果 |
| --- | --- |
| Host 全仓最终源码 | 607 项，605 passed，0 failed，2 个原有 POSIX 专用条件跳过 |
| Host 原生会话聚焦 | 31/31 |
| Dynamite 源码 | 381/381 |
| Dynamite 原生生产路径 | 12/12 |
| 最终仓库外安装矩阵 | 68/68，436 次真实本地 HTTP，0 unexpected fixture errors |
| 编译与产物 | Host check/审计 build-pack、Dynamite typecheck/build、外部 strict declarations 均通过 |
| 契约 | compressor change 与 1.4 cohort change 的 OpenSpec strict 通过 |

HTTP 400/429/503 是部分用例预设的错误输入；0 fixture errors 不表示模型从未失败。主请求、辅助请求与故障纠错都是真实 HTTP，未以 stub completion、自述状态或最后一轮 usage 代替实际生产路径。主动 LSP 查询没有报告 error，但部分 push-only／超时文件未确认 clean；不把空诊断当成全覆盖，类型结果由上述实际 compiler/外部消费者支撑。

原始命令输出、安装清单、抽样真实 JSONL/业务 journals、请求和观察保存在[证据目录](evidence/compressor-conversation-isolation/)，对应[汇总](evidence/compressor-conversation-isolation/summary.json)与[逐文件哈希](evidence/compressor-conversation-isolation/sha256.json)。Dynamite 自身的安装产物和并发原始记录在[其验证目录](../../../pakka-dynamite/docs/verification/evidence/compressor-conversation-isolation/)。为避免 Windows Git 长路径，每例的存储目录以 `storage.tar.gz` 无损保存，保留原相对路径；25 例共 908 个原始存储文件已解包并逐文件比对 `storage-sha256.json`。观察、请求、frames 和日志仍可直接阅读。解包时选用短的隔离目标路径，不把证据当作活动 writer 存储。

## 失败先行与修正

- 初始 6 个真实 HTTP 反例全部失败：tool、stop、provider 错误串到下一条 Conversation；A 封存误拒 B 的在途请求、已返回候选的精确 adoption receipt，以及正常 reopen 后的新任务。现按各 Conversation 独立累计，自己的封存不会被重复 admission 重置。
- 来源审计文件在真实 HTTP 后置为只读，复现原先误毒化共享容器。修正后保留该来源的未确认 reservation、原字节与实际原因，仅 quarantine 该工作；另一外部 Session 的健康 job 继续完成。重开曾覆盖实际原因的 RED 同样保留，最终 snapshot 保持原原因、计数与 seal。
- 共享 Compresser JSONL 真正写入失败仍阻止所有来源的新请求。它与上一项来源局部故障分别由真实存储实验验证，不以一个通用 error 例子替代两个故障域。
- 人工构造的旧 aggregate-policy store 原先能被隐式当作新状态接收；反例为 Missing expected rejection。schema-v2 policy/job 文档现在拒绝无归属计数的隐式迁移，而不是清零或平均分摊。
- 多窗口首轮 HTTP 不重叠的 RED 证明 runtime 逐窗口 await。新 native 路径在第一条响应释放前已进入第二条 HTTP；包含首窗封存和全部成功两个分支。每个任务仍只有自己的局部图／注释，不等待别的任务输出。
- 并发时复现多个成功窗口使用同一预分配 blockId、导致产物不可见。ID 分配移到带新 frame/version 的原子提交队列；所有成功 run/block 对应不同 blockId、正确 runId 和精确回执，flush 后仍可读取。生成没有被该提交队列串行化。
- 后续公开 job admission 被确定拒绝时，缺少 drain 会在首条真实 HTTP 仍在途时提前结束批次。RED 后恢复等待所有已启动 native work，首条成功产物仍被正常采用，才释放批次所有权。
- 真正终止持有者进程后，旧 writer claim 先拒绝打开；测试确认进程退出再显式解除。未确认 child 保持 quarantined、sealed 且不重放旧请求，同容器中的新授权任务能完成。

全量源码首轮另有一个版本常量仍为 0.4.0 的失败；修正到 manifest 的 0.5.0 后重跑 381/381，原失败日志未改写。未运行或替代用户已停用的 adversarial-review，不声称独立双审通过。

## 实际产物与剩余范围

长期 Compresser Session 保存 registry／配置；各内部 Conversation 分别保存 transcript、job、incidents、两类计数、lastError 与 seal。外部业务 Session 原子保存 `run + block`：`block.text` 是 P1；`block.artifacts` 的一个 version-1 bundle 包含 P2 图、图内 P3 注释、P4 clues、unresolved 及 tool-call identity；run 记录来源、结果和可确认的累计 usage。后继主请求仍仅投影 P1。

本轮没有实现跨任务 P2/P3 异步 merge 算法、四套独立存储、分层衰减、主动检索或语义质量验证。原生并发修正在 handlesCorrections 路径，旧 primitive 的逐 job retry/fallback 行为保留。长期保留／物理 GC、旧 aggregate store 的授权迁移、历史 SQLite 转换、跨 store 崩溃原子性、未知效果自动恢复及新 pair 的 optional server/worker 装配不在本次接受范围。一个 Harness/Session 也不提供进程隔离。

当前预期在[state](../state/compressor-session.md)，采用依据与完整形成链在[changes](../changes/compressor-repair-session.md)及[tasks §5](../../openspec/changes/add-compressor-repair-session/tasks.md#5-correct-conversation-isolation-and-native-concurrency)。保留历史失败配对和既有产品边界，不默认启用或发布任何包。
