# MAS DevPack API（M4，accepted with notes）

固定配对：`@pakka/agent@0.5.0`、`@pakka/mas@0.3.0`、`@pakka/mas-devpack@0.1.0`、private `@pakka/server@0.2.0`。继续使用原 `pi-durable 1.0.3-pakka.1`，没有新增下游补丁。Dynamite 保持 [deferred](DEFERRED-DYNAMITE-COMPATIBILITY.md)，M5 公共 transport 和 CLI 尚未实现。

## 可选 Web 产品 facets

Pakka-Pocket P4 已通过公开 Backend/Client/WebUI 子入口提供 MAS Board 和 member panel，保留原 Agent-only 入口及其 headless 依赖图。实际组装、独立 profile 选择、人类权限、原生 reply、facet 移除与恢复的契约和验证见 [P4 记录](PAKKA-POCKET-P4.md)。Runtime 的固定批准 profile 集保持原契约；关闭 Agent contribution 使用已批准的无工具 profile 和真实 owner configure，不通过改写重开配置放宽身份校验。

## 安装边界

```ts
import { createMasDevPack } from "@pakka/mas-devpack";
import type { MasClient } from "@pakka/mas";

let client: MasClient; // 宿主 bootstrap 之后赋值；模型不能选择这个 principal/grant。
const pack = createMasDevPack({
	resolve: () => client,
	operationTimeoutMs: 30_000,
	// sessions: () => approvedSessions, // 可选，宿主组装的有限 template slots。
});
const profile = { id: "researcher", tools: pack.tools, systemPrompt: pack.instructions };
// 将 profile 交给 createRuntime 的批准 profiles；之后 bootstrap MAS，再赋值 client。
```

这是宿主 tool/instruction contribution，不是另一个 Harness，也不是 stock Pi CLI 的自动安装插件。`DurableAdapter` 使用公开 `defineExtension` 注册它；Pi 可变对象不跨出 adapter。import/factory 不启动 server、Session、其他 agent，不读取用户凭据。包版本、精确 peers 和 public factory contract 定义安装版本，不另造一个无人消费的 descriptor 协议。

每次 execute 都重新获取批准 client，组合 contribution/cancellation/timeout 检查，再绑定真实当前 `ToolInvocationScope`。复制、序列化、peer scope 和结束的 invocation 不构成 authority。resolver 是受信任 composition root：多成员宿主必须为来源选择既有批准 lease，不能根据模型参数重新授予权限。

## Wire tools

逻辑名称 `mas.*` 使用 completions 兼容的 `mas_*` function names；所有 mode 都走原生 admission，不模拟成串行 prompt。

| Wire tool                 | 输入/结果                                                        | 权限边界                                                                   |
| ------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `mas_discover`            | 成员 reference/phase                                             | discover，不含 peer transcript                                             |
| `mas_inspect`             | target → 当前生命周期 metadata                                   | observe，不提供 raw Session/Conversation                                   |
| `mas_inbox`               | 自己收到的 receipt metadata                                      | reply；无 payload/full transcript，提供真实 reply ID                       |
| `mas_send`                | target、requestId、text、mode                                    | send；steer 另需 steer grant；followUp 原生排队                            |
| `mas_ask`                 | 与 send 相同，等待 generation receipt                            | 不是应用层回答，不证明外部效果完成                                         |
| `mas_reply`               | receiptId、requestId、text                                       | reply；真实 incoming source/target proof，不允许指定 sender                |
| `mas_spawn`               | current key/profile/lifetime，或批准 template/requestId/location | spawn，不允许 endpoint、path、credential、owner、task、budget 或 tool code |
| `mas_abort`、`mas_retire` | target                                                           | grant + owner；retire 是 tombstone，不是物理删除                           |
| `mas_configure`           | target、批准 profile                                             | grant + owner；不能修改任意配置                                            |
| `mas_fork`                | target、key、entryId                                             | grant + owner，指定原生历史 cutoff                                         |

同 Session 的 mode 为 `prompt | steer | followUp`。reference 只是数据，复制/猜测不赋予权限。工具 schema 不接受凭据或 authority tokens；执行后的结果是 JSON metadata/receipt，不含 native handles。

## 创建与通信

- `location: current-session`（默认）：复用调用方 MAS catalog；支持 persistent、task-bound、temporary、background。task-bound/temporary 的 owner 是真实创建 tool task，结束后 native readiness 为 ended、拒绝新输入。background 有独立原生 anchor，须 owner 显式 retire。它们都不是 OS process isolation。
- `location: existing-session | new-session`：只能选择宿主 `createApprovedSessions()` 固定的 template 与稳定 `requestId`。每 template 一个持久 reservation slot，固定 source、principal、plan、placement、profile 和预算，不能在工具参数中覆写 current-member 参数。new-session 必须得到不同 storage Session identity。
- 远端返回 `BrokerAgentRef`；后续 send/ask/reply/inbox 使用 `sessionTemplate`。服务复用 M3 的 broker/outbox/目标原生 admission，不新造 transport。outbox/native request identity 继续使用 M3 的 retained-record 去重限制。
- startup/enrollment/回执不明时保留 pending/unknown，重试同一 slot/storage。冲突、已占 slot、旧来源 incarnation 或不匹配 template 拒绝，不自动分配替代 Session。配置来源是宿主固定角色；换角色必须显式重建，不隐式 enrollment。
- 同一 service 串行提交 reservation 写入，但不串行整个 provisioning；每次排队后和提交时重新验权。其他 service 实例仍靠 CAS，冲突最多重试 32 次，耗尽时拒绝继续，不覆盖或释放未知 slot。40 个 distinct template 在一/两个实例上的真实 storage 争用已验证；这不是无限并发或公平性保证。
- 没有跨 Session 原子事务或原子撤权保证。发出的远端 prepare/admission 可能已经生效；late rejection 不声称 rollback，不释放 reservation。

当前 membership `view()` 是持久 phase snapshot。原生 owner task 已结束时 `inspect()` 才给出 native readiness；`deliver` 在 commit line 仍会拒绝 ended owner，不因旧 snapshot 显示 active 而放行。

## 等待、撤权、移除

默认 operation deadline 为 **30,000 ms**，允许宿主选择有限整数 **1–120,000 ms**。deadline 包含 resolver 与服务等待。所有 racing promises 都被观察；返回之后旧 check 关闭，迟到 operation 不能再用该 lease 完成受控 commit。已发出的远端操作不因此被当作撤回。

- 已配置 Session service 但 template 未批准时，spawn/inbox 先执行 selected 校验并返回 denied；send/ask/reply 先核对 reservation，未 confirmed 时保守 unknown，不触发 endpoint。此分流是当前支持语义，不是已送达或成功的声明。
- 绑定前明确拒绝返回 denied。绑定后仅受信任 `MasRequestDenied` 表示本次 action 在 reservation/effect 之前已确定拒绝（如缺少 service、template 配置覆写、已占 slot）；不能按错误字符串推断。其他 action 异常或 deadline 返回 unknown。ask 一旦 send 返回 receipt，后续 wait 的拒绝也只能返回 unknown，不将整个 ask 误报为无效果。正常服务自己的精确 receipt 保持原值。
- ask timeout 只取消等待，不调用 withdraw/abort，不退还 quota。必要时以原 target/template + requestId 重试查询/等待原 admission。done 只表示 generation outcome；应用回复使用 receipt-linked reply。
- `pack.revoke()` 关闭 contribution 的后续 effect checks，但不伪称已经停止既有外部效果，也不立即改变被广告的 tool list。
- profile removal/configure 改变下一次请求的工具选择与当前 prompt sections，并拒绝旧工具执行。Durable 按公共契约保留历史 positional `pi.system` prompt updates；当前更新替代旧配置，不删除旧 transcript 或伪造遗忘。
- 每个独立撤销角色使用独立 contribution；共用 pack 就共用 revocation switch。长工作不保存 invocation handle，只保存逻辑 reference/receipt。

## Private worker 可选装配

`WorkerConfiguration.devpack` 可选配置批准 profile 到固定 grant 列表及 deadline。JSON IPC 不传函数、native scope、任意 code 或 resolver。worker 本地组装 public factory，principal 由 storage/Conversation identity 推导，模型成员名不能伪装 operator。

root grants 来自宿主 preset；模型创建后代的有效 grants 是自身批准 profile 与完整 capability-owner 祖先链的交集，缺失/循环 ancestry fail closed。选高权限 profile、反复创建或重配 child 不能扩大 root ceiling。原生 task ownership 与此 capability inheritance 仍是两个独立边界。

当前 private worker 内仅装配同 Session 工具。未配置跨 Session template service 的 worker 对 existing/new-session 请求明确拒绝；不会隐式启动 broker 或分配新的进程/storage。宿主 in-process profile 可接入批准的同进程或 M3 worker placement。支持范围以实际安装/HTTP/原生 ownership 验证为准，不从两个 Harness 推断进程隔离。

## 验证入口

- `packages/mas-devpack/test/`：真实 model tool call、权限/复制/迟到 scope、撤销、三种 location、own inbox/reply、bounded ask、可选移除。
- `packages/mas/test/approved-sessions.test.ts`：真实 storage 准备后丢回执，在原 slot 恢复；`session-contention.test.ts`：distinct slot 的真实 CAS 争用；`composed-authority.test.ts`：组合 check 不恢复撤销 lease。
- `apps/server/test/devpack-*.test.ts`：真实 PID、native temporary owner、旧输入拒绝、higher-profile grant 不能扩大。
- `scripts/consumer-devpack.mjs`：隔离真实 tarball 的 native tools、撤销零 peer effect 与 worker 生命周期。

M4 的执行门禁与两轮指定对抗复审已通过；产物身份、原始反例、两项 report-only P2 和支持限制见 [MIGRATION-M4-ACCEPTANCE.md](MIGRATION-M4-ACCEPTANCE.md)。这不是完整产品或 M5 远端 authority 的放行。
