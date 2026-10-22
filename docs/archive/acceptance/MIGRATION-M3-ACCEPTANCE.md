# M3 Acceptance — Multi-Session Broker and Workers

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前工作](../../OVERVIEW.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

状态：**已验收，带明确限制与 report-only notes**。分支 `feat/monorepo-mas-migration`，实现基线为 M2 commit `3656b308561bb6aa9c9b35cb6bd12a7111c8287d`；最终提交以本文件所在 Git commit 为准。Dynamite 继续 deferred，M4–M6 不因本阶段通过而视为完成。

## 交付范围

- `@pakka/agent@0.4.0`：Session-scoped、有限 JSON 容量的 coordinator store；冻结 snapshot、明确版本和 CAS command，commit line 重验版本及同步 authority check。非 JSON/超容量/撤权是已确认拒绝；未知物理提交封闭所属 Session。Pi handles、documents、Tx 与模型凭据仍在 `durable-adapter.ts`。
- create-once `reservedSessionId` storage 地址与明确 reopen；reservation 使用 adapter 的 lowercase UUID grammar，不覆盖已有目录、不用替代 Session 掩盖未知启动结果。
- `@pakka/mas@0.2.0`：固定 approved placements、持久 plan/roster、准备与激活、principal/source/incarnation 绑定的 outbox、原生 target admission 与回执 reconciliation。公开入口为 root 和实际被消费者使用的 `@pakka/mas/broker`。
- `inProcessPlacement` 复用 M2 catalog/原生准入；它不是进程隔离。跨 Session 业务调用经过 broker active barrier；没有分布式原子提交或回滚。
- private `@pakka/server@0.1.0` / `apps/server`：实际 Node worker/manager，固定 bootstrap presets、独占 storage writer、不同 OS PID、版本/generation/request correlation、有限 JSON 和命令 allowlist。正常关闭后重开保留 Session/Conversation/admission identity，命令 authority 重新构造。
- dedup 复用目标持久 ledger 与原 native submission；input/target/mode 冲突拒绝。已确认 `done`/`unanswered` 单调保留，不能被迟到 wait/admission 错误降级。

MAS 组织资源，gate 执行权限与预算；未引入第二套 scheduler/persistence engine 或新外部 runtime dependency。原生 steer/followUp 沿用 M2/Durable placement，不转为串行 prompt。新 Harness、Session 与 OS process 是不同边界。

## 执行证据

环境：Windows，Node **24.18.0**，npm **11.16.0**。全部模型测试使用真实生产路径、本地确定性 HTTP 与独立 profile/storage；不读取用户凭据、不调用付费模型。独立 reviewer 的模型调用不是被测 provider 能力证据。

| Gate                      | 结果                                                                                                                          | 本地原始证据                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `npm ci --ignore-scripts` | passed；只关闭已确认属于本仓库的 TypeScript LSP locks                                                                         | `artifacts/migration-m3/install-clean.log`                |
| `npm run check`           | passed                                                                                                                        | `check-final.log`                                         |
| `npm run build`           | 三个 workspace passed，patch hash verified                                                                                    | `build-clean.log`、`package-review.log`                   |
| `npm run format:check`    | passed                                                                                                                        | `format-final.log`                                        |
| 全量 `npm test`           | **196/196**，0 fail/skip/todo/cancel                                                                                          | `tests-final.log`                                         |
| M3 定向回归               | **20/20**，0 fail/skip/todo/cancel                                                                                            | `targeted-final.log`                                      |
| 隔离 tarball consumer     | legacy/runtime/MAS/broker **7/3/3/3 次 HTTP**                                                                                 | `package-review.log`、`package-final/`                    |
| 严格 spec 校验            | passed                                                                                                                        | `spec-final.log`                                          |
| changed source/test LSP   | active probe clean；一个历史 node:crypto cache finding以当前 definition/compiler/consumer反证并标记 stale，无源码 suppression | active `lens_diagnostics` / definition 结果               |
| 指定 adversarial-review   | 两个 bounded passes，最终 A/B/closing 均 **OK with notes**，0 P0/P1                                                           | `review-pass1/`、`review-pass2/`、`review-disposition.md` |

消费者位于仓库之外，安装真实 agent/mas/server tarballs，不依赖 workspace source、root overrides 或 oracle。消费者验证 actual dependency graph/public declarations、真实 PID、原始请求与 storage：丢失已准入回执后，coordinator 和实际 worker 均关闭重开，仍复用原 admission，**零额外 HTTP**。无法确认 writer 的 forced exit 保留 crash claim，旧 endpoint 封闭，另一 worker 仍完成请求；不以 PID/timeout 抢占。

### 最终 tarball identity

| 产物                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `@pakka/agent@0.4.0`            | `dd624f2d486880d2475eb837fd55563b92afa782a9bcd8964003ff46e4e4d8a9` |
| `@pakka/mas@0.2.0`              | `286a09c74a04801988de1720b451513ad62bfd4c2e313b91417996940b941c5d` |
| private `@pakka/server@0.1.0`   | `fa32fa3fe591e06adece6beb16be65fd607cf23ee9786158a0af212dd160456d` |
| bundled Durable `1.0.3-pakka.1` | `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7` |

原始 tarball、dependency tree、实际 worker PID/receipt JSON、三份 worker/coordinator storage 和 integrity/source hashes保存在 `artifacts/migration-m3/package-final/` 与 `identity-final.json`。fixture manifest 的 HTTP 汇总是该 manifest 的累计归档，不冒充单项测试次数。ignored artifacts不进入 release；可执行测试与 consumer scripts是持久复现入口。Pi upstream/patch/build inputs没有变化；按迁移计划只验证固定 hash/受影响真实矩阵，不把未重跑的历史 105/105 冒充本轮结果。

## 失败先行与复审处置

1. coordinator store、broker、worker 入口均先出现缺失 API 的 red；继而使用实际 Durable/HTTP/OS processes验证 CAS、authority、unknown、准备中断、丢回执、重开、容量、协议拒绝与单 writer。
2. pass-one B-1：真实 worker完成后 force-stop，再 wait 返回 unknown；并发 wait 与迟到 admission response亦覆盖已有 done。修复 terminal shortcut + CAS-line terminal preservation，catch返回已确认的 committed value。旧实现三类反例失败，修复后目标仍各仅一 HTTP；unanswered/blocked generation在目标关闭后亦保留、零 HTTP。
3. pass-one B-2：四种非法 reserved ID在构造时未拒绝。补与 adapter 相同的 lowercase UUID校验，放在 path derivation/child spawn之前；反例由 red转 green。
4. 保留中间失败记录：第一次 green worker测试加载旧 MAS `dist`，源码 cases已通过；重建实际 workspace后 **11/11**。新增 unanswered case最初使用 artifact-only hook，正确被 precise `real_context.write` lease拒绝；修正测试装配后 **20/20**，未放宽 gate或断言。
5. native wait仅观察已有准入：addressed receiver无 send grant可 wait completion，但 send与unknown replay仍拒绝；没有额外 provider dispatch。观察能力不等于管理或重放能力。

### 最终残余项与复审质量

- in-process initialization rejection绑定固定 Runtime/config并保持 latch；已确认静态错误或未知初始化不自动清除。恢复要求 trusted explicit reconstruction。
- protocol-faulted worker slot立即封闭命令与 replacement allocation，保留 writer claim；进程在 explicit stop/close时终止。sealing不声称取消已准入的外部 effects。
- broker decode未完整验证持久 `receipt.native` 子对象。当前只有 trusted broker producer与target SDK/validated private worker transport写入它；raw coordinator store是privileged bootstrap port。两 reviewer定为 P2 report-only，非正常 M3 路径可构造；这**不是任意恢复数据/外部 receipt已充分验证的声明**。将来引入不可信 restore/对外 transport必须先补完整 decoder。保留原报告，不称零残余风险。
- 两轮 workflow机制已完整执行，但第二轮 B把部分历史 A-1/A-2/A-3当成当前 A的 claim（当前 A首份报告为 No issues found），后续对话亦延续此混淆；多处引用行号不准确。主管以当前源码和执行证据重核事实，并保留原报告与更正。不能把机械 verdict合成当作无瑕疵的 review方法证据，也不能把 reviewer读到日志说成其执行了测试。

## 不支持的范围

没有 shared-storage多 writer、automatic stale-lock theft、完整 forced-crash recovery、distributed transaction、exactly-once provider/tool/file effects、TTL/unsafe dedup expiry、物理删除、默认 Dynamite、DevPack、public HTTP/auth/client/CLI/GUI 或 hostile Node/filesystem sandbox。不同 PID证明进程级故障边界，不证明 tenant/permission/container isolation。POSIX特定信号与故障注入未在本轮 Windows环境独立验证。

M4需通过真实 model tool invocation验收 agent-facing interfaces；M5需另验 public schema/auth/reconnect/browser graph；M6才是产品装配 gate。本阶段不解除这些门禁。
