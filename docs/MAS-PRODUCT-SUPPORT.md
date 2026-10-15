# Integrated MAS product — M6 support boundary

M6 已在本文范围内验收（带 notes），证据、固定产物和复审结论见 [MIGRATION-M6-ACCEPTANCE.md](MIGRATION-M6-ACCEPTANCE.md)。核心产品使用真实 `pakka-server`/`pakka` executable、共享 client 和可选模型侧 DevPack。Dynamite 的历史失败仍 [留档](DEFERRED-DYNAMITE-COMPATIBILITY.md)，核心迁移后的显式可选产品配对已带 notes 验收，见 [固定身份与限制](DYNAMITE-PRODUCT-ACCEPTANCE.md) 和 [配置 API](DYNAMITE-PRODUCT-API.md)；默认策略仍是 native context，GUI 本轮不创建。

## 1. Operator startup and model authority

按 [应用 API](MAS-APPLICATION-API.md) 准备并保护显式 server/connection JSON，先 `npm run build`，再运行 server 与 CLI。新增的可信启动字段如下；它们在 server config 中，不属于 RPC command：

```json
{
	"runtime": {
		"profiles": [{ "id": "helper", "systemPrompt": "Host-approved helper instructions" }]
	},
	"devpack": {
		"profiles": {
			"default": ["discover", "spawn", "send", "reply", "observe", "retire"],
			"helper": ["send", "reply", "observe"]
		},
		"operationTimeoutMs": 2000
	}
}
```

以上是合并进完整 server config 的片段。需要显式 `systemPrompt` 的 profiles 只接受 `id/systemPrompt`；没有任意 tools、functions、extensions 或插件路径。默认 profile 为 `default`。只有 `devpack.profiles` 选中的 profile 安装 tools/instructions；未选择 profile 的工具集明确为空，不继承 default 的 DevPack。模型本身不会获得 token、runtime、broker、worker manager 或 credential。

- Model principal 由受控 member ref 派生；每次调用重新绑定真实 native invocation，不相信模型声明的 caller/owner。
- 子成员的有效 grants 是自己的批准 profile 与完整 capability-owner 祖先链的交集。选择高权限 profile 不扩大祖先权限；缺失或循环祖先拒绝。
- Capability ownership 和 native task ownership 不同：persistent 可以有能力 owner 而无 task lifetime；temporary/task-bound 的实际 owner 是创建它的 native tool task。
- `devpack` 模式 **禁止任意 RPC role 持有 `spawn/configure/fork`**，配置会在打开 storage 前拒绝。这防止 remote profile selection 成为模型权限放大路径。RPC 仍可按 role 使用 send/observe/owner controls，但通信 grant 不取得管理所有权。
- 不安装 DevPack 的普通 M5 模式保留原有批准的 RPC persistent spawn/configure/fork；它不会因此自动获得模型工具。
- Tools 注册不证明某 agent 有对应 grant；grant 拒绝、迟到撤权及 effects unknown 的细节见 [DevPack API](MAS-DEVPack-API.md) 和应用 API。

## 2. Support matrix

| Surface / combination        | Current supported path                                                                                                                                        | What is not implied                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Same-Session product         | One explicit server bootstrap, CLI/shared client, actual model tools, native A2A/reply, finite Session quota                                                  | Not a stock Pi CLI/extension sandbox                                                                  |
| Persistent model child       | Current Session, approved profile, owner grant intersection; verified normal closed reopen                                                                    | No arbitrary storage/profile/grant input                                                              |
| Temporary / task-bound       | Real creating tool-task ownership; after that tool ends, `inspect` is ended and late input fails closed                                                       | Not a scratch Conversation lasting the whole generation or next prompt; no physical history deletion  |
| Background child             | Survives creating tool boundary; explicit authorized owner retire drains native anchor                                                                        | No unlimited lifetime/process isolation or external effect rollback                                   |
| Existing/new Session request | Trusted programmatic `ApprovedSessions` with fixed templates/slots, tested separately through installed DevPack/broker consumers                              | Not exposed by product JSON/RPC; a model request without the service is refused, not auto-provisioned |
| Same-process multi-Session   | Explicit trusted runtime/broker composition and installed broker path                                                                                         | Not a new fault-isolated process; not one global transaction/revision                                 |
| Independent worker           | Trusted private worker manager/preset, native process IPC, installed real-PID tests                                                                           | No remote arbitrary process/configuration launch, no automatic forced-exit writer-claim release       |
| Strategy                     | Native/default context; explicit controlled ports. Explicit optional Dynamite is accepted in the bounded static-member slice ([API](DYNAMITE-PRODUCT-API.md)) | Not default activation, worker/dynamic-child provisioning or arbitrary module loading from JSON/RPC   |
| Browser / GUI                | Browser-safe shared client, real owned-Chrome validation in M5/full gate                                                                                      | No GUI app delivered; protocol/client is the future GUI boundary                                      |

仅程序化的组合不能标成 server/CLI 已公开的命令。产品用户需要完整原始 refs 和稳定 input.requestId，不能从 CLI 自报权限；A2A 的 source/reply provenance 来自已提交 receipt，不来自自然语言 sender 标记。

## 3. Normal reopen, not forced recovery

可信配置必须使用互不重复的初始 root key；decoder 尚未提前验证 uniqueness，不承诺 duplicate/full-roster 配置会走哪条恢复分支。这是已留档的 hardening note：fallback 严格 bootstrap/activate 和模型授权仍核验 readiness/祖先 grants，并非复审证明了 decoder 会拒绝重复值。

先排空工作、正常关闭原 server，然后在原配置的 `runtime.reopenSessionFile` 显式指定同 dataDir 的 `sessions/<sessionId>/main.jsonl`，再启动。新 listener 有新的 `serverId`，旧 client token 若被宿主重新声明是新发权，不是旧 lease/撤权的自动恢复。

- 保留 Session/Conversation/incarnation、原 admission ID、消息指纹和已消费 quota；reconnect 不自动重放 mutation。
- 没有动态模型子成员时，使用原有严格 MAS bootstrap。
- DevPack 创建了子成员时，product reopen 核对原始 roots 的 key/owner/profile/lifetime/active phase，以及每个 retained descendant 到这些 roots 的完整 owner 链；active persistent 成员还必须在 native readiness 上实际 ready。
- Product 只接回符合条件的已有 roster，不把原始 roots 改成完整成员列表，不新增、重写 owner、统一 activate 或复活 ended/retired 成员。错误 roots、孤立/cyclic owner、未确认成员状态拒绝。
- 动态 RPC 追加的非模型 owner 成员不属于上述自动 descendant 恢复：普通 M5 模式必须在可信配置中明确列出完整 persistent roster。不能通过给 DevPack reopen 混入新 owner 来接管成员。
- 活跃任务的 crash recovery、forced kill 后遗留 writer claim 和不确定启动结果不属于正常关闭恢复；继续 fail closed，不自动删除 claim 或分配替代 Session。
- Retire/tombstone、unknown 和 terminal receipts 继续占用其持久语义；没有物理 delete、容量补位或自动 GC。

## 4. Acceptance and follow-on work

源码 product 回归在 `apps/server/test/product.test.ts`；隔离消费者在 `scripts/consumer-product.mjs`，由 `npm run smoke:package` 安装实际 tarballs 并运行。它从真实 server/CLI 启动，核对 actual tool-call/results、批准 A2A/reply、权限拒绝、四种 lifetime、正常 reopen 与已消费 quota，保存独立的 HTTP 和原始 storage；不是成功 callback stub。完整门禁还保留各边界的实际 browser、同进程多 Session 和 real-worker 消费。

M6 完整 gate 和第一轮完整指定有界对抗复审已通过，核心 package/artifact identities 已固定，见验收记录。后续独立 Dynamite 仓库的 `0.2.0` 库兼容复审已收敛；产品验收暴露的无 inference receipt 修订为 `0.2.1`，其 345 项源码、47 项安装与 5 项实际产品消费者已通过执行门禁，完整指定产品复审已收敛，遗漏门禁脚本的身份链已 red/green 修正；产品预算正向拒绝观测缺口按 [验收记录](DYNAMITE-PRODUCT-ACCEPTANCE.md) 保留。默认策略改变不是兼容验收的隐含结果。

GUI 暂不新增 package/app：已有 client/protocol 是真实消费者边界，本轮没有 UI 使用需求或视觉验收。将来需要 GUI 时消费这些端口；是否独立 repo 按 [monorepo 规范](MONOREPO-CONVENTIONS.md) 的实际发布/团队边界再判断，不以本轮目录创建作为结论。
