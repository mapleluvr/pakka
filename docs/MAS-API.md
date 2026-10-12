# Same-Session MAS API（`@pakka/mas@0.2.0`）

当前服务消费 `@pakka/agent@0.4.0` 公开控制端口；同 Session 契约在 M2 已验收，M3 复用它作为跨 Session 的原生准入路径。调用方向为 composition root → MAS service → gate → Durable adapter。业务 agent 只接收冻结的 `MasClient`；`Mas`、`Runtime`、catalog、model endpoint、凭据和原始 Pi handles 留在受信任装配层。实现与验收状态以 [迁移计划](MONOREPO-MIGRATION-PLAN.md) 为准。

## 使用

先按 [RUNTIME-API.md](RUNTIME-API.md) 创建 runtime，再明确装配服务；import 不创建 Session 或 server。

```ts
import { createMas } from "@pakka/mas";

const mas = await createMas({ runtime, namespace: "crew", maxDeliveries: 64, maxPending: 4 });
await mas.bootstrap([
	{ key: "coordinator", owner: "operator" },
	{ key: "worker", owner: "operator", profile: "reviewer" },
]);
await mas.activate();
const [coordinator, worker] = (await mas.view()).members;
const caller = mas.connect({
	principal: "coordinator",
	source: coordinator.ref,
	grants: ["discover", "send", "reply"],
});
const sent = await caller.send(worker.ref, { requestId: "review-1", text: "Review this task." });
console.log(await caller.wait(sent.id));
```

`bootstrap` 原子创建 Conversation、批准的 profile 配置及 membership；随后真实 gate attachment/readiness 更新 `preparing → ready`。`activate` 通过 readiness barrier，一次 CAS commit 更新全部待激活成员。纯创建、inspection 和 reopen 不调度模型。已提交而 attachment 未完成的成员保留 preparing；不自动当作 rollback，也不接收业务工作。

## 权限与身份

`Mas.connect()` 由宿主固定 principal、来源 Conversation reference 与 grants；操作参数不能选择新的 caller。`ConversationRef` 是受检地址，序列化或复制不能产生权限。owner 是 MAS policy；原生 task ownership 控制资源寿命，二者独立。

| grant                                     | 允许的操作与约束                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `discover`                                | membership 地址/状态缓存，不返回 transcript                                         |
| `send` / `reply`                          | 受 recipient admission policy 的发送；reply 只能使用当前收件来源与回执的原始 source |
| `observe`                                 | 资源状态，不返回 Host 或完整上下文                                                  |
| `steer`                                   | 发送 steer 另外需要 send 或 reply                                                   |
| `spawn`                                   | 批准 profile 的创建；新资源 owner 固定为 caller                                     |
| `configure` / `fork` / `abort` / `retire` | 同时要求对应 grant 和目标 owner                                                     |

`mas.revoke(principal)` 撤销该服务实例已发行 client closure；重新授予由宿主显式 `connect`。service instance 是 authority issuer，不能把另一个独立实例当作同一 issuer 的撤权通道。Session 关闭或 scope 结束时旧 closure 失效；重开不恢复旧权限。

工具调用通过 `client.forInvocation(scope)` 绑定实际 native invocation，scope 来自 gate 配置的 tool executor。复制、foreign Conversation 和过期 scope 无效。M4 再提供 agent-facing extension 装配，当前 API 由受信任业务代码消费。

## A2A 与回执

identity 为 namespace + principal + source incarnation + requestId，payload fingerprint 包括完整 source、target、text 和 mode。相同请求复用原生 admission；相同 identity 下变更内容、模式或目标拒绝。记录保留整个 Session 生命周期，`maxDeliveries` 是不可回收的 retention 上限；`maxPending` 对每名收件人的 queued/placed 记录限流。达到容量时拒绝新 admission，不删除旧回执来允许重放。

忙碌收件人要求明确 `steer` 或 `followUp`，原生 post-tools/final placement 仍由 Durable 处理。idle 输入的 fingerprint、UserEntry、native submission、GenerationTask 和 LiveDoc 在同一次 commit 中创建。预算、投影和工具 invocation 继续走 gate。

`DeliveryReceipt.status` 保留 `queued | placed | done | unanswered | unknown`，`entryId` 区分已置入 transcript，`reason` 保留 native terminal 原因。done 表示输入得到回答，不证明工具外部副作用完成。`withdraw` 仅在 native queued 记录确认未 placement 时撤回；已 placed 的输入与 entry 继续保留。wait 的取消或超时只停止等待，不证明未送达。unknown 不退还 admission 或调用花费。

关闭、重开和相同 requestId 重试会沿用持久 catalog/native admission，inspection 本身不发送 HTTP。Host 的进程内 C2 ledger 仍独立；MAS 去重依赖目标 Session 的 durable catalog。

## 生命周期、配置与失败

| lifetime                   | 原生归属与历史                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `persistent`               | ownerless Conversation，长期存在                                                                                                       |
| `task-bound` / `temporary` | 当前已证明 native tool task 的子 Conversation，owner task 结束后拒绝新工作；temporary 是逻辑寿命，历史仍保存                           |
| `background`               | 当前来源 Conversation 拥有的原生 background anchor task；父 Conversation 普通 abort 不跨此边界，explicit retirement abort/drain anchor |

没有 invocation 证明时拒绝非 persistent 创建。普通子树与 background boundary 用真实 tool call 和 child provider 请求验收。owner task 的状态是 admission 检查的一部分，不能由 LLM 文本声明替代。

configure 只选择 runtime 批准的 profile，要求 idle active 成员，发布新的 incarnation；fork 限 ownerless、idle source 和该 Conversation 中的合法 cutoff，原子登记新成员。old ref 不能被用于新命令。

retire 先停止 admission，再 native abort/drain，最后保存 retired tombstone；原始 transcript、delivery 与花费记录保留。未知 persistence 封闭整个对应 Session，MAS view 报 unknown；未确认 commit 不自动重建。Conversation 已归因的局部故障沿用 M1 故障策略。

本 API 只覆盖同 Session。同进程多 Session、独立 worker 与跨 Session outbox/reconciliation 由 [BROKER-API.md](BROKER-API.md) 的上层服务装配，M3 已验收（[范围与残余项](MIGRATION-M3-ACCEPTANCE.md)）；MAS DevPack 和对外协议仍按 M4–M5 实施。Dynamite 保持 [deferred](DEFERRED-DYNAMITE-COMPATIBILITY.md)。
