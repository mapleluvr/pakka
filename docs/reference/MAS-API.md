# Same-Session MAS API（`@pakka/mas`）

MAS 服务通过 `@pakka/agent` 的公开控制端口，管理同 Session 的成员与消息。调用方向为 composition root → MAS service → gate → Durable adapter。业务 agent 只接收冻结的 `MasClient`；`Mas`、`Runtime`、catalog、model endpoint、凭据和原始 Pi handles 留在受信任装配层。

## 使用

先按 [RUNTIME-API.md](RUNTIME-API.md) 创建 runtime，再明确装配服务；import 不创建 Session 或 server。

```ts
import { createMas } from "@pakka/mas";

const mas = await createMas({ runtime, namespace: "crew", maxPending: 4 });
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

工具调用通过 `client.forInvocation(scope)` 绑定实际 native invocation，scope 来自 gate 配置的 tool executor。复制、foreign Conversation 和过期 scope 无效。可选 [DevPack](MAS-DEVPack-API.md) 将批准的通信与管理能力提供为模型工具。`authorize(action)` 仅检查既有 grant；`withAuthority(check)` 只能收窄 lease，后续 `forInvocation` 和再组合继续保留原 check 链。`inbox()` 在 reply grant 下仅返回自己的 incoming receipt metadata，不返回 payload 或 peer transcript。

## A2A 与回执

identity 为 namespace + principal + source incarnation + requestId，payload fingerprint 包括完整 source、target、text 和 mode。相同请求复用原生 admission；相同 identity 下变更内容、模式或目标拒绝。记录按 ID 独立持久保存，累计完成数不限制新 admission。`maxPending` 对每名收件人的 queued/placed 记录限流，已完成历史保留原请求去重与回执核对能力。

`maxDeliveries?: number` 是已弃用的兼容字段，SDK 忽略其值；新配置只声明 namespace 与 maxPending。服务配置解析器若收到旧字段，仍要求它是正整数。namespace 和 maxPending 按持久配置核对；旧 maxDeliveries 的变化不阻止原 Session 重开。

Catalog v2 使用轻量接纳索引及独立投递文档。v1 存储可被只读核对；第一次受授权写入在同一原生事务中核对旧 fingerprint/submission 关系、提取投递记录并更新索引。身份、消费和原回执不变。迁移提交失败保留 unknown，禁止自动补建或重放；正常关闭后只能重开原存储核对。迁移后的 v2 Catalog 需要本版或支持该格式的 Runtime，回退旧程序前须恢复一致的迁移前备份。

忙碌收件人要求明确 `steer` 或 `followUp`，原生 post-tools/final placement 仍由 Durable 处理。idle 输入的 fingerprint、UserEntry、native submission、GenerationTask 和 LiveDoc 在同一次 commit 中创建。预算、投影和工具 invocation 继续走 gate。

`DeliveryReceipt.status` 保留 `queued | placed | done | unanswered | unknown`，`entryId` 区分已置入 transcript，`reason` 保留 native terminal 原因。done 表示输入得到回答，不证明工具外部副作用完成。`withdraw` 仅在 native queued 记录确认未 placement 时撤回；已 placed 的输入与 entry 继续保留。wait 的取消或超时只停止等待，不证明未送达。unknown 不退还 admission 或调用花费。

关闭、重开和相同 requestId 重试会沿用持久 catalog/native admission，inspection 本身不发送 HTTP。Host 的进程内直接输入回执 ledger 仍独立；MAS 去重依赖目标 Session 的 durable catalog。

`MasClient.lookup(target, { requestId, text, mode? })` 在当前 send grant 下纯查询原发送者的请求；匹配 namespace/principal/source incarnation/requestId 并核对完整 route、text 和 mode。返回原 delivery 或 null，不执行 admission hook、不接纳输入。null 只表示没有接纳记录，不能证明此前 admission hook 没有效果。需要回执 ID 才能查询的 `receipt(id)` 继续保留。

## 宿主持久观测

`Mas.history(query?, check?, accepts?)` 向受信任宿主返回最近优先的有界 delivery 页；每页最多 64 条，游标是原持久回执 ID。正文、实际发起者、时间与显式 `replyTo` 属于独立 observation；`DeliveryReceipt.status` 保持原生含义。原请求核对继续匹配原生输入身份及有效载荷，复用同一 admission 并保留首次提交的实际发起记录；新记录的显式回复关联也须一致。成员的 `creation` 保存真实创建来源和可选 fork 历史来源。旧记录缺少的信息保持缺失。

此接口位于宿主 `Mas` 服务。业务 `MasClient` 的 grants 与既有 own-inbox 范围保持原边界；人类 Board 由受控服务先执行双端 read 过滤，再分页与搜索，完成异步读取后重新验权。操作方式见 [MAS Board](../guides/MAS-BOARD.md)。

## 生命周期、配置与失败

| lifetime                   | 原生归属与历史                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `persistent`               | ownerless Conversation，长期存在                                                                                                       |
| `task-bound` / `temporary` | 当前已证明 native tool task 的子 Conversation，owner task 结束后拒绝新工作；temporary 是逻辑寿命，历史仍保存                           |
| `background`               | 当前来源 Conversation 拥有的原生 background anchor task；父 Conversation 普通 abort 不跨此边界，explicit retirement abort/drain anchor |

没有 invocation 证明时拒绝非 persistent 创建。普通子树由创建它的 native tool task 控制寿命；background 使用独立 anchor。owner task 的状态是 admission 检查的一部分，不能由 LLM 文本声明替代。

configure 只选择 runtime 批准的 profile，要求 idle active 成员，发布新的 incarnation；fork 限 ownerless、idle source 和该 Conversation 中的合法 cutoff，原子登记新成员。old ref 不能被用于新命令。

retire 先停止 admission，再 native abort/drain，最后保存 retired tombstone；原始 transcript、delivery 与花费记录保留。未知 persistence 封闭整个对应 Session，MAS view 报 unknown；未确认 commit 不自动重建。可归因的 Conversation 故障封闭该成员；共享存储故障封闭所属 Session。

同 Session 之外的进程内多 Session、独立 worker 和 outbox/reconciliation 由 [Broker API](BROKER-API.md) 装配；模型工具见 [DevPack API](MAS-DEVPack-API.md)，远端 client/CLI 装配见[应用指南](../guides/MAS-APPLICATION-API.md)。应用脚本可组合这些端口编写协作流程，见[协作流程指南](../guides/MAS-WORKFLOWS.md)。
