# M4 Acceptance — Optional MAS DevPack

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前产品状态](../../PAKKA-POCKET-STATUS.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

状态：**M4 accepted with documented notes；两轮指定对抗复审完成**。分支 `feat/monorepo-mas-migration`，基线为已验收 M3 `2af55a5`；最终提交以本文件所在 Git commit 为准。Dynamite 仍 deferred，不装配；M5–M6 不由本阶段推定完成。

## 交付范围

- `@pakka/agent@0.5.0`：catalog 的受控 own incoming receipt metadata；native scopes/handles/documents/凭据仍只在 `durable-adapter.ts`。
- `@pakka/mas@0.3.0`：只能检查既有 grant 的 `authorize`、只收窄的 `withAuthority`、保留父 lease 检查的 invocation 绑定、own inbox；固定批准 template/slot 的 Session service，复用 M3 coordinator CAS/broker/target admission。
- `@pakka/mas-devpack@0.1.0`：可选 public factory，提供 `mas_*` tools/instructions contribution，经 adapter 的公开 `defineExtension` 装配。不是 stock Pi CLI 自动安装插件，不在 import/factory 启动 Session、server 或读取用户凭据。
- private `@pakka/server@0.2.0`：实际 worker 可配置有限 profile/grant/deadline JSON；本地 bootstrap 装配 contribution，模型不能选 principal 或任意 code/config。后代 grant 上限与完整 capability-owner 祖先链相交，native task ownership 独立管理 lifetime。
- current Session、host-approved existing/new Session，以及原生 task-bound/temporary/background/persistent 边界；没有配置 Session service 的 worker 明确拒绝 existing/new Session 申请，不替代分配 storage。

逻辑 `mas.*` 使用 completions 兼容的 `mas_*` wire names。send/steer/followUp 保持 native timing；reply 从真实 received receipt 推导 source，不使用 prompt markers。观察不暴露 peer transcript。详细 schema、安装和限制见 [MAS-DEVPack-API.md](../../reference/MAS-DEVPack-API.md)。

## 执行证据

环境：Windows / Node **24.18.0** / npm **11.16.0**。被测模型全部走真实 production path、本地确定性 HTTP 和独立 storage；不读取用户凭据，不调用付费模型。reviewer 模型调用与被测 provider 能力证据分开。

| Gate                                                   | 结果                                                                  | 本地原始证据（`artifacts/migration-m4/`）                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 离线 clean staging `npm ci --ignore-scripts --offline` | passed；独立源码树，无预存 node_modules/dist，使用正常 workspace 配置 | `clean-final-install.log`、`clean-final-staging-result.log`                |
| clean build/check/format                               | passed；实际 workspace 与测试声明                                     | `clean-final-build.log`、`clean-final-check.log`、`clean-final-format.log` |
| 当前工作树 build/check/format                          | passed；固定 patch hash verified                                      | `build-final.log`、`check-final.log`、`format-final.log`                   |
| 全量 `npm test`                                        | **216/216**，0 fail/skip/todo/cancel                                  | `tests-final.log`                                                          |
| M4 定向                                                | **20/20**，0 fail/skip/todo/cancel                                    | `targeted-final.log`                                                       |
| 新复审修复回归                                         | **8/8**                                                               | `review-regressions-green.log`                                             |
| 隔离 tarball consumers                                 | legacy/runtime/MAS/broker/DevPack **7/3/3/3/8 次 HTTP**               | `package-final.log`、`package-final/`                                      |
| changed source/test LSP                                | 六个本轮修复路径 active probe clean                                   | `lens_diagnostics` 当前会话输出                                            |
| 严格 spec                                              | passed；archive 后另复验                                              | `spec-final.log`                                                           |
| 指定 adversarial-review                                | 两轮 A/B/opinion/closing **OK with notes**；0 P0/P1                   | `review-pass1/`、`review-pass2/`、两轮 `review-pass*-disposition.md`       |

打包消费者位于仓库之外，安装真实 agent/mas/devpack/server tarballs，不携带根 overrides、workspace paths 或 oracle。consumer 编译公开类型及两项拒绝错误 contract；真实 native tool 向 peer 投递、revoke 后零额外 peer dispatch、真实 worker PID 与临时成员 ended-owner refusal 共 8 次 HTTP。最终 consumer 的 parent/worker PID 为 **3824 / 33044**，这是一次执行证据，不是配置常量或 sandbox 证明。

### 最终 tarball identity

| 产物                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `@pakka/agent@0.5.0`            | `aba0ff00f818aa0c0de18cb77d6820db37085e4e9719b48903d4b4a067a209f2` |
| `@pakka/mas@0.3.0`              | `2e17500ede80721e8e023468e5e169562cf7a5ad15e85f7250fe5ec44874dfa5` |
| `@pakka/mas-devpack@0.1.0`      | `2671452392304a2eb5459a9bb16e9b67c87e6d225485aab2f61229ccb36b68c1` |
| private `@pakka/server@0.2.0`   | `677cb02473f9485eac6642c5e24436b9298d67e20cd7d04e8de772bcad3a0b5f` |
| bundled Durable `1.0.3-pakka.1` | `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7` |

tarball/integrity、source hashes、请求/PID JSON、dependency tree、storage 与测试身份保存于 `identity-final.json` 和 `package-final/`。fixture manifest 是多轮累计归档，不冒充单测试次数。ignored artifacts 不进入 release，可执行测试和 consumer scripts 是持久复现入口。SDK/source patch/build inputs 未变，仅复验 hash 和受影响矩阵；未重跑的历史 patch 105/105 不冒充本轮结果。

## 失败先行、复审与修复

1. factory/inbox/Session service/worker optional config 均由缺失接口 red 转到真实 tool/HTTP/storage/PID 路径。prepared storage 回执丢失保留 unknown，在同一 slot/storage 恢复，不补建。
2. ask 最初无 deadline；真实输入已 placed 但 caller 卡住。有限 deadline 覆盖 resolver/service 等待，结束后关闭旧 check；不 withdraw、不释放 budget/admission。已投递后故意丢 service response 的测试保持 unknown，目标实际一次 HTTP。
3. worker 曾遗漏 contribution IPC；真实 worker 无工具的失败定位并修复 forwarding。更深的反例证明低 profile 可以选高 grant profile child 后投递 **1 次未授权 peer HTTP**；完整祖先 grant intersection 修复后 **0 次**，未放宽 ownership 或 gate。
4. profile removal 的历史 prompt 被误判为残留 active section；实际 request 证明旧 positional system update 后已有新 profile update。回归验证当前 tools/sections、强制旧工具执行被拒绝，保留不可变历史，不伪造遗忘。
5. pass-one B-1：未配置 Session service 的 worker spawn/inbox 与 reservation conflict 返回 unknown，确定无效果拒绝语义不准确。真实 red logs retained；使用受信任、仅 pre-effect 的 `MasRequestDenied`，不匹配错误字符串。
6. 分类修复的新增反例：send 已造成实际 HTTP 后，wait-only preflight refusal 曾把整个 ask 返回 denied。真实 red 保留，修复将 post-send wait 异常视为 unconfirmed。service 的无效果异常只描述该调用，不能否认前一步 effects。
7. distinct-template 真实 CAS：40 兼容 slot 原来 **32 created / 8 rejected**。只串行同一 service 的 reservation commits，dequeue/commit 重验 authority；不串行 provisioning，其他实例仍用 bounded CAS。最终一/两个 service 各保留 40 独立 Conversation/claim、零 HTTP。不是无限公平性或跨进程 multi-writer 声明。
8. 保留中间失败：workspace source/dist 异常类身份混用导致 `instanceof` 未匹配；tool consumer 测试改用同一 public package graph，未使用 name/string brand 绕过。owner 最后一条 user 计数回归先因历史 user 重复而错；后续类型门禁发现 `findLast` 超出当前 lib，改为同语义的 `filter(...).at(-1)`，不提高编译目标。一次与 dist 重建重叠的 worker gate 未被冒充已证实环境根因，最终静止构建串行门禁独立通过。

第一轮两方引用/method 争议及自我更正保留：单 template/不同 requestId 不能测量兼容 CAS 争用，A 接受 B 的 distinct slot 方法；B 撤回自己的部分行号解释。第二轮确认 typed refusal 不跨越已 send 的 ask，queue 保留逐次验权；B 修正两个引用，并撤回对规定的 `No issues found.` 空结果措辞的异议。完整结构化 A/B opinion 均为 OK with notes，closing 同意，无未解析 verdict；B 输出预览仅含 schema-correction，不作为最终意见。执行 gate 和机械 workflow verdict 均不是无瑕疵 review 或全部能力证据。

两项最终 report-only P2 留档：

- **测试 graph hygiene**：四个 sibling DevPack 测试仍消费 MAS source；typed-denial/Session-tools 消费同一 public dist graph。前者当前的 denied 断言发生在 attempted action 前，不读取异常类身份，实际消费者/declarations 均通过。未来添加 typed-denial 用例时必须保持同一包构建图，不能借 name/string 放宽授信。
- **未批准 template 状态分流**：有 Session service 时，spawn/inbox 通过 selected 校验返回 denied；send/ask/reply 在 claims 不 confirmed 时保守 unknown，不到达 endpoint/目标。没有 service 或 slot 已被别的请求占用的明确 pre-effect refusal 已修复；后续 wait 失败不能否定已发送。这不是 silent success 或权限旁路，详细分流写入 API。

## 残余限制与未支持范围

- 不提供 hostile Node/tenant sandbox、任意 native Pi plugin、stock CLI extension auto-discovery、任意 endpoint/path/credential/tool/config、物理删除、跨 Session 原子撤权/回滚、exactly-once effects、automatic lock theft 或完整 forced-crash recovery。
- 第二轮剩余两项 P2 已按上文留档；没有第三轮循环或对新生产修复的隐式放行。
- ask 是 bounded generation receipt 等待，不是应用回答。typed denial 仅来自批准 producer 的确定 pre-effect 拒绝；重复包/非标准 bundler 的类不匹配保守 unknown，不靠字符串授信。
- local reservation queue 不给不可信 storage 自行加 timeout/release；未知挂起/commit 不能绕过 single writer。其他服务 CAS 32 次上限、有限 slot/record retention 和 Session limits 继续生效；一/两个实例上的 40-slot 测量不证明任意竞争规模或 fairness。
- private worker 当前仅本地同 Session contribution。宿主 profile 可组合 approved service，模型不能自行把 worker 升级成 remote broker。长期任务只保存 ref/receipt，不保存结束的 invocation。
- M3 的 nested native receipt decoder、协议 fault 后显式关闭、固定初始化 rejection latch 仍按历史验收限制保留；M5 引入不可信数据前须验证相关 decoder，不以本阶段自动解除。
- GUI/public auth/client/CLI 属于 M5–M6；Dynamite 兼容另待核心迁移完成，原始失败和 DC-01–DC-12 留档不变。
