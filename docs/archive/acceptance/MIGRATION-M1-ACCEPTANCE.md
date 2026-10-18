# M1 acceptance — Conversation-scoped runtime

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前产品状态](../../PAKKA-POCKET-STATUS.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

M1 已完成并经两轮独立只读复审收敛，`@pakka/agent@0.2.0`。实现提交以本文件的 Git history 为准；验证输入为 `feat/monorepo-mas-migration` 上 `cfcb10f` 后的 M1 diff。Dynamite 专项仍 **deferred / 未处理**，完整 DC-01–DC-12 目标和恢复条件保留在 [延期记录](../investigations/DEFERRED-DYNAMITE-COMPATIBILITY.md)。本记录不代表 M2–M6 完成。

| 验证                                     | 实际结果与证据                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`、`build`、`format:check` | 通过；`artifacts/migration-m1/gate-*-final.log` 及 `gate-format.log`                                                                                                                         |
| `npm test`                               | 156/156，0 fail/skip/cancel/todo；`gate-tests-final.log`                                                                                                                                     |
| 本地 provider 与真实 JSONL               | 最终 manifest 228 fixtures，831 HTTP requests，0 server errors；`final-manifest.jsonl` 指向 `artifacts/integration/` 下 requests、view、原 storage 与 journals                               |
| `npm run smoke:package`                  | 仓库外安装真实 tarball，无 root overrides；公共 NodeNext declarations、依赖 graph 和 private subpath 拒绝通过；legacy 7 HTTP（64/128 caps），managed 3 HTTP，inspection/reopen 零新 dispatch |
| 固定 tarball                             | `pakka-agent-0.2.0.tgz` SHA-256 `0942aff05f0e75a6d2657be1385c200d5ab5b07769cc7512bce7ace4ce8799ad`；完整 SHA/integrity、source hashes 与工具链在 `artifacts/migration-m1/identity.json`      |
| Durable patch                            | 仍为 `1.0.3-pakka.1`，SHA-256 `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7`；未改 patch，未重复无变化的独立重建矩阵                                                     |
| 复审                                     | fresh-context 首轮 runtime/validation，两次同角色 follow-up；最终均 OK/converged，无剩余权限/持久化阻塞。报告与 disposition 在 `artifacts/migration-m1/review/`                              |

M1 增加受信任 `createRuntime()`，一个 Harness/storage 下每个 Conversation 各有 Kernel、上下文、projection permit、source job、工具 invocation、C2 receipt 和物理 journal；相同 principal/strategy 名称不能跨域取得 authority。View/Frame/Ref 显式记录 native Conversation 和 provider identity，保留 storage `sessionId` 兼容含义。

Session 汇总与 strategy+Session attempt reservations 在 dispatch 前持久提交，并在并发、fork/reopen 后保留。物理 journal/adoption/commit unknown 封闭整个所属 Session；局部已归因的 provider/run 错误不撤销 peer。`cancelQueued()` 先返回 unknown，仅精确无 entry 的 Durable withdrawal 可变为 released；原测试现在验证真实确认时序。foreign jobScope、迟到 source job、scope 拷贝、限流、writer 重入和物理 corruption 都有实际反例。

`migrateLegacy` 只显式映射匹配身份、已关闭、无 pending work、唯一 ownerless root 的 legacy storage。原 journal schema/hash chain/transaction/adoption 字节保留；同一次 commit 写映射与 prefix hash receipt，并继承 consumed budgets。Durable 会回收 terminal checkpoint sidecar，因此主调用历史按 generation task marker **保守扣占**，不是精确 HTTP 计数。损坏、unknown intent/adoption、fork 历史、未批准 strategy 与不足预算拒绝迁移，零新 dispatch、原 source 不改写。

复审原文保持不可改写。第二轮报告里 root 常量的字面值与“精确历史调用”措辞不作为证据；源码使用公共 `ROOT_CONVERSATION_ID`，计数契约以保守 marker 规则为准。所有代码修复由父执行者完成，reviewer 只有只读权限。

M1 限制：跨重启 A2A admission 尚未实现；旧 Host C2 ledger 仍是进程内。legacy 与 managed 的 pending-fork busy 兼容差异见 [runtime API](../../reference/RUNTIME-API.md)。崩溃遗留 writer claim 不自动抢占，需要可证明原 writer 已结束的后续恢复路径；M1 仅验收已知 close/reopen。新 Harness 不提供 process isolation。MAS policy、跨 Session enrollment、worker、DevPack、认证 transport 与产品 CLI 属于后续阶段。
