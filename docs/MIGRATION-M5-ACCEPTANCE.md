# M5 Acceptance — Authenticated MAS applications

状态：**M5 accepted with documented notes**。基线为已验收 M4 `601430c`，分支 `feat/monorepo-mas-migration`；最终提交以本文件所在 Git commit 为准。完整第一轮指定复审为 BLOCK，最小修复后第二轮两份结构化 opinion 与 closing verdict 均为 OK with notes，无 P0/P1、无未解析 verdict。M6 尚未完成；Dynamite 保持 deferred，不装配、不标记兼容。

## 交付和实际入口

- `@pakka/protocol@0.1.0`：browser-safe version-1 closed request/response decoder；有限 JSON、完整受检引用、Session-scoped snapshot 与 delivery receipts，无 Pi/Node/storage 依赖。
- `@pakka/client@0.1.0`：Node/browser 共享 fetch 实现；严格响应关联、fatal UTF-8、有限大小和 deadline，取消/丢响应保留 unknown；不自动重试 mutation。重连获取新的 hello/snapshot 并验证同一 server/Session，不制造跨 Session global revision。
- `@pakka/cli@0.1.0`：实际 `pakka` executable，只读取操作员显式给出的 connection/command 文件，经共享 client 完成业务命令。exit 0/1/2/3 区分受检结果、本地无效、远端 denied、unknown。
- private `@pakka/server@0.3.0`：实际 `pakka-server` executable、显式 JSON bootstrap、IPv4 loopback `/rpc`、有限 host/origin/role/expiry/capacity；principal/source/grants 在服务端绑定。保留此前 worker app，不开放远端 worker/endpoint/storage/config 管理。
- `@pakka/mas@0.4.0`：四类本地确定 pre-effect guard 共享 `MasRequestDenied`；opaque admission 异常保持 unconfirmed。broker nested receipt 加 shape 和 relay request/source/target correlation，不把结构合法当作 actual delivery proof。
- 搭配 `@pakka/agent@0.5.0` 和 `@pakka/mas-devpack@0.2.0`。所有包仍不发布。DevPack 的可选 library/worker contribution 不由本阶段自动变成 JSON server 的默认能力。

操作员启动、配置 schema、wire/client 示例及限制见 [MAS-APPLICATION-API.md](MAS-APPLICATION-API.md)。调用方向为 CLI/browser → client/protocol → server-bound MAS client → gate → Durable adapter；远端 ref 是地址，不是 capability。模型凭据、原生对象、bootstrap 控制对象均不进入客户端 graph。

## 执行门禁与证据

Windows / Node **24.18.0** / npm **11.16.0**。被测模型仅使用真实 production path、本地确定性 HTTP 和独立 Durable storage；不读取用户凭据，不调用付费测试 provider。reviewer 模型调用不是被测能力证据。

| Gate                                      | 最终结果                                                                          | 本地证据：`artifacts/migration-m5/`                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 无 node_modules/dist 的离线 clean staging | install/build/check/format passed                                                 | `clean-staging-final-result.log`、`clean-{install,build,check,format}.log`    |
| 当前 source build/check/format            | passed，固定 Durable hash verified                                                | `build-review-final.log`、`check-review-final.log`、`format-review-final.log` |
| 完整串行 suite                            | **242/242**，0 fail/skip/todo/cancel                                              | `tests-review-final.log`                                                      |
| M5 定向 suite                             | **26/26**，0 fail/skip/todo/cancel                                                | `targeted-review-final.log`                                                   |
| 拒绝与实际 effect 控制组                  | **13/13**                                                                         | `guard-review-red.log`、`guard-review-green.log`                              |
| 隔离安装真实 tarballs                     | legacy/runtime/MAS/broker/DevPack/apps **7/3/3/3/8/2 次 HTTP**                    | `package-review-final.log`、`package-review-final/`                           |
| 浏览器声明与实际连接                      | DOM-only compile，无 Node globals 的 owned Chrome 实际认证/snapshot/delivery/wait | `consumer-browser.ts`、browser 定向/完整 suite；原始 browser 失败日志保留     |
| changed paths LSP                         | 8 个修复路径 active probe clean                                                   | 当前会话 `lens_diagnostics`，不是空 session cache                             |
| 指定 adversarial-review                   | 完整 pass 1 BLOCK → pass 2 OK with notes                                          | `review-pass1/`、`review-pass2/`、两份 disposition                            |
| 严格 spec / 文档 links / archive          | 提交前完成，无 bypass                                                             | `spec-review-final.log` 及后续 archive/link/format 日志                       |

独立消费者不使用 workspace/sibling source、根 overrides 或 oracle；实际 server/CLI 是不同 OS 进程。公共 client 与 CLI 向真实成员发送并回复，query/reconnect 与相同稳定 admission ID 不增加 provider dispatch。consumer 验证 foreign receipt denied、non-owner CLI abort exit 2，且 stdout/stderr/CLI 结果不含自建测试 credentials。原始 native storage 和应用 HTTP payload 已复制到最终 package evidence；reply 的 saved snapshot 是 admission，terminal 由实际 peer wait 独立断言，不冒充 saved receipt 已 terminal。

### 最终 tarball SHA-256

| 产物                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `@pakka/agent@0.5.0`            | `c5a7e7e1d2c9206baa67c0e0b3cbb479b991582b8e9a64803352d9efd8df3036` |
| `@pakka/mas@0.4.0`              | `83b7a3873aa1f634ac1b4e5b86c7f4482f051c305897dc54dd85369e44899584` |
| `@pakka/mas-devpack@0.2.0`      | `5a70dba1aa22255d820270343ffd2cb8dea6d0f2dc87fb498ca2eefe4ffa8e01` |
| `@pakka/protocol@0.1.0`         | `1d384eb8e1471d16a1e45c5ac59f65e24ac87651b80486e7c042df15427f821c` |
| `@pakka/client@0.1.0`           | `264ebf3f7cf448617bf6db7e723e79cf7c041334e5b4f04b13fae09f19f13bdd` |
| `@pakka/cli@0.1.0`              | `06965702518dc3a33f15c0ade1164c3e053ef0ac8b042e399e34dd1eacaf796b` |
| private `@pakka/server@0.3.0`   | `4015187f9f0aa88d9f92d60e19028c2896c446f7c3bfa382a577302f286f4e80` |
| bundled Durable `1.0.3-pakka.1` | `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7` |

`identity-review-final.json` 保存 tarball integrity、source hashes、counts 和 patch identity；独立放行/复审索引与它分开，不能靠改 execution identity 的 pending 字段制造审查结果。SDK/source patch/build lock 未变，本阶段复验 hash 与受影响矩阵，不把历史 patch 105/105 冒充本轮执行。ignored artifacts 是本地 evidence，不进入 release；可执行 tests/consumer scripts 是持久复现入口。

## 失败先行与有界复审

1. 真实 coordinator 受控存储的 malformed nested native receipt 曾被发布；完整字段和 envelope correlation 拒绝坏 shape/关联，目标无额外调度。不宣称验证了任意恶意、shape-correct restore 的 namespace-derived principal。
2. decoder 最初错误要求逻辑 `Member.key === Member.ref.key`，实际 HTTP snapshot 暴露假设错误。删去错误关系但保留完整 ref scope 校验，独立 codec 回归固定逻辑 key 与 catalog opaque key 不同。
3. HTTP/client 曾替换 malformed UTF-8 为模型可见字符或可信 receipt 字符；字节级 red 后两方向 fatal decode。实际已发生 admission 的坏响应仍 unknown，不否认送达。
4. 实际 browser 在 full sanitized runner 中曾启动失败；Chrome stderr 证明 Windows known-folder 需要一致且实际存在的隔离 USERPROFILE/AppData。只给 owned Chrome 新隔离目录，未恢复宿主 profile/credentials，也未提高 10-second 启动 deadline；完整 suite 再通过。
5. 原 provider 503 使 workflow `0c3a2ec8` 在 A/B 协议开始时失败。已知 A 同模型恢复 `855cebc0` 只算 standalone report，保留其 P1/OK-with-notes 矛盾，不能放行。完整同工作流重启 `7ca5576e` 才算第一轮；两份 opinion 和 closing 均 BLOCK。
6. 第一轮四类 in-dispatch guard 被误判 unknown；真实公共 HTTP/CLI 反例先失败。owner、foreign receipt、inactive recipient、non-sender 明确 pre-effect 处统一 typed denial，CLI exit 2。没有 blanket read-only denial、错误字符串分类或 HTTP status 关联豁免。
7. parent 额外控制组证伪 reviewers 建议的第五类 callback 泛化：opaque callback 完成 **1 次真实 HTTP** 后抛 typed denial，修复前错误返回 denied。现在 callback 异常包装为 generic unconfirmed，false 也不证明回滚；两组均 unknown，目标仍不投递。物理 main.jsonl 写失败、迟到 revoke/expiry 继续 unknown，Session poison 不被解除。
8. 已有有界 JSON parse 后保留合法 descriptive requestId，invalid command/schema/version 仍拒绝。pre-body 拒绝不无界读取 overflow 请求以取 ID；client 不信任不关联的 error envelope。
9. 第二轮 `06b39475` 两份结构化 opinion 和 closing 均 OK with notes。保留 B 对 endpoint 覆盖、reachability、ID 契约的反驳与 A 的更正；B 的 text preview 不是 structured opinion。未执行第三轮，也未修改 production 去隐式清零剩余 P2。
10. clean staging 一次启动命令误触发 npm 解析 `node` 包，在 offline 模式 ENOTCACHED 失败关闭；修正为现有 Node 执行，未安装替代 runtime。一个 artifact collector 将 reply admission 当成 terminal 的错误也保留并纠正，未修改实际 consumer 的 terminal 断言。

## 最终 report-only P2 与支持限制

- **pre-body correlation**：Host/Origin/path/method/content-type/capacity 等早拒绝保留 `invalid` ID sentinel。支持路径上 capacity 可触发共享 client unknown；不承诺 client 得到 CAPACITY/denied。不是未经关联的 HTTP 4xx 就能证明无 effects。初始希望 correlated denial 的 capacity witness 仍 red，作为调查证据而非最终必需 gate。
- **reconnect ID ergonomics**：显式传入 requestId 时两次顺序 read 复用它；没有 global uniqueness/audit sequence 契约，不重放 mutation。
- **broker provenance**（A-3/B-1，同一边界）：codec 验 shape + relay request/source/target；`deliver` 由 trusted catalog 构造 principal，没有调用 endpoint `verifyReceipt`，`receipt/wait` 才精确核验 namespace-derived principal。任意 untrusted restore/public broker transport 未支持，不能从保存的结构化 receipt 推定已送达或权限。
- **超限 body 传输**：异步 iterator 拒绝可能无法发出 JSON envelope。parent 在实际本机路径 POST **131073 bytes** 得到 HTTP 400/INVALID_REQUEST/denied、目标 **0 次 HTTP**（`review/over-limit-probe.log`），不是所有平台/分片行为的保证；断连仍 unknown。
- **保留 ErrorCode**：VERSION_MISMATCH/UNSUPPORTED 只有 wire union/validator，本版 producer 对未知版本/command 返回 INVALID_REQUEST；不制造已实现的协商分支。
- **trusted config validation asymmetry**：JSON bootstrap 校验 canRevoke 为 boolean；程序化 createMasServer 的可选字段仍按 truthiness 使用。trusted caller 必须传 boolean，远端不能配置它；本轮不扩大动态、不可信配置支持。

只支持受信任 bootstrap、IPv4 loopback、有限 allowlisted commands、同 Session persistent RPC 创建和显式 role tokens。没有 TLS/public multi-tenant server、反向代理信任、任意 plugin/config/endpoint、远端跨 Session template allocation、physical delete、automatic lock theft、完整 forced-crash recovery 或 exactly-once effects。role revocation 当前是 issuer 实例的运行期状态；显式新 bootstrap 重授权不冒称跨重启永久撤权。取消 wait/disconnect 不 abort 目标或释放 admission/budget。M6 集成产品与 GUI 决策另行验收；Dynamite 原始失败和 DC-01–DC-12 完整保留。
