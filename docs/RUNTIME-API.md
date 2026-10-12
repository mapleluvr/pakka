# Conversation runtime API（`@pakka/agent@0.4.0`）

M1 增加 `createRuntime(options)`：受信任 bootstrap 在一个 Durable Harness/storage 中管理多个 Conversation。M2 的同 Session MAS 服务通过该 runtime 的受控 catalog port 装配；MAS 的 client、membership 和 A2A 语义见 [MAS-API.md](MAS-API.md)。`createHost()` 继续提供单 Conversation 兼容入口，使用原有 strategy journal namespace。两者不是可互换的 storage 开启方式：legacy host 不得重开 managed runtime storage，managed runtime 也不隐式采用旧 host storage/journal。

实现与验收状态以 [迁移计划](MONOREPO-MIGRATION-PLAN.md) 和 [验证记录](VERIFICATION.md) 为准。Runtime API 本身不授予 agent 创建/控制资源的权限。M3 的跨 Session A2A、worker 与真实进程隔离通过上层 [BROKER-API.md](BROKER-API.md) 装配，已验收（[范围与残余项](MIGRATION-M3-ACCEPTANCE.md)）；DevPack 和对外 RPC 尚未实现。

## 创建与访问

```ts
import { createRuntime } from "@pakka/agent";

const runtime = await createRuntime({
	cwd: process.cwd(),
	dataDir: "/absolute/project/.pakka",
	endpoint: "http://127.0.0.1:1234/v1",
	model: "your-local-model",
	apiKey: "local-only",
	limits: {
		maxConversations: 8,
		maxPrimaryAttempts: 100,
		maxAuxiliaryAttempts: 20,
	},
	profiles: [{ id: "reviewer", systemPrompt: "Review the requested work." }],
});
try {
	const root = runtime.root();
	const ref = await runtime.createConversation({ key: "reviewer", profile: "reviewer" });
	const reviewer = await runtime.conversation(ref);
	const input = reviewer.connect("operator", ["input.submit"]);
	await input.submit({ key: "review-1", text: "Inspect the requested design." });
	await reviewer.waitForIdle();
	console.log(root.view().conversationId, reviewer.view().conversationId);
} finally {
	await runtime.close();
}
```

`Runtime` 是 bootstrap 控制对象；`Host` 是一个 Conversation 的控制对象。每个 Host 分别连接 principal、激活 strategy 和绑定工具 invocation。调用方只获得冻结的 DTO 与身份绑定的命令 closure。Pi 的 Harness、Session、Conversation、Registry、Models 和 Tx 不通过公开接口返回。

bootstrap 必须给出三项正的有限整数配额。额外 profile 只接受允许的 `id`、instructions 和配置的工具；profile 不允许输入任意 model、credentials、cwd、storage path 或原始 extensions。默认 profile 沿用 HostOptions。创建相同 key/profile 返回已有 resource；同 key 的不同 profile 被拒绝。

## 身份、作用域与 journal

- `sessionId` 保留现有 Pakka storage/provenance ID 的含义；`durableSessionId` 显式指向同一存储域。
- `conversationId` 是原生 Conversation ID；`providerSessionId` 是 `pi.provider` 的 provider affinity identity，两者独立。
- `ConversationRef` 包含 `key/sessionId/conversationId/incarnation/profile`。它是受检地址，不是可以序列化转交的权限。复制不能提升权限；替换或 fork 后的旧 reference 被拒绝。
- 同名 principal/strategy 不共享 scope。managed journal v2 的物理 namespace 包含 Session、Conversation、strategy 和 journal kind；legacy journal v1 保留不动。
- navigation 创建 native fork，发布新的 Conversation/incarnation/provider identity。既有 Host closure 继续代表该 key 的当前 Conversation，调用方通过 `runtime.view()` 取新的 resource reference。

M1 提供 `migrateLegacy: { expectedSessionId, expectedConversationId }` 的显式映射，必须同时指定 `reopenSessionFile`。只接受已关闭、无 pending task/submission、可证明唯一 ownerless root 的 Pakka storage；错误身份、fork 历史、未知 journal/intent/completion/adoption、未批准的 inference strategy 及不足以承接已消费记录的 limits 均拒绝。普通 managed reopen 仍拒绝 legacy storage。

原 journal 的 header、hash chain、transaction ID 和 adoption 字节保持不动；同一次 Durable commit 记录新的 runtime metadata、namespace 映射与 `journalMigration` receipt。receipt 包含原存储/各 journal 的 SHA-256、前缀长度与版本。该 Conversation 使用已审计 legacy namespace，新成员使用 v2 namespace；旧 capability 不复活。主额度从持久 generation task 的 checkpoint marker 保守扣占：terminal sidecar 已回收时不猜测精确 HTTP 次数，每个 marker 占一额度；辅助/strategy 额度从原 reservation 继承，不退还 unknown 成本。重开和映射 journal 的后续访问校验原前缀。没有 bulk import 或多 Conversation 归属猜测。

`pakka.runtime` document schema v2 增加 Session strategy attempt totals。未发布的 v1 开发记录仅在无辅助花费，或已含明确 totals 时可安全升级；缺少 totals 且有花费时拒绝，不重置预算。

## 调度、预算与失败

同一 Harness 的 task scheduler 和 storage commit line 被共享；每个 Conversation 有独立上下文、控制 kernel、receipt、strategy owner、projection permit、source job 和 tool invocation。steer/followUp 使用 native Durable submission timing。

主调用与辅助调用在 dispatch 前分别提交 Session 汇总 attempt reservation；`InferencePolicy.maxCalls` 另由同一次 commit 对 strategy+Session 累计，新 Conversation/fork/reopen 不扩大它。每个 Conversation 的 job 上限和独立 inference audit 继续执行；取消、未知结果、调用在实际 HTTP 之前失效均不退还已提交的 reservation。数字表示保守调用尝试上限，不是账单、token 总额或精确 HTTP 次数。

可归因的 provider/run 失败留在该 Conversation。另一成员可继续工作；同 Session 的未知 storage、commit/adoption、未分类 report 则封闭所有成员。一个新 Harness 仍在同一 Node 进程，不能隔离进程退出或 OOM。

`Host.dispose()/reload()` 只处理该 Conversation；managed Host 的 `newSession()` 被拒绝。managed 的 pending fork 在 `busy` 中可见；legacy 兼容入口保留同步连续 branch/ABA 的观察语义，调用方等待 `waitForIdle()` 后再确认 native fork 完成。`Runtime.close()` 管理共享 Harness/storage 关闭。运行时不允许第二个 writer 重开同一 storage：使用 `pakka-writer.json` 的独占 claim。只有已知 writer 成功关闭后才删除 claim；发现旧 claim 时 fail closed，不依据 PID 或超时自动抢占。崩溃后的 claim 回收尚未由 M1 提供。

## 取消与重开

`cancelQueued()` 保持同步签名，返回请求时的 `unknown` 快照。只有精确的 Durable submission 记录确认 `unanswered/aborted` 且没有 entry，回执才变为 `released`。已 placed 的输入保持 committed；撤回结果无法确认时不释放，不触发重试。

通过 Host receipt event 或 `client.receipt(id)` 观察撤回确认。相同 key 重试必须保持原 text/mode，且前一 admission 已 released；换 mode 是幂等冲突。

`createRuntime({ ...options, reopenSessionFile })` 验证 provenance、持久 runtime profile identity 与 limits，恢复所有现存成员的 authority 后才允许 progress。纯重开/inspection 不发送 HTTP。Session quotas 与 Conversation identity 保留，旧 capability、lease、tool scope、Host closure 不复活。M1 的 Host C2 ledger 仍是进程内状态；不要把这条兼容路径用作跨重启 A2A 去重。

## M3 coordinator store 与明确 storage 地址

受信任 bootstrap 使用 `runtime.store({ namespace, maxBytes })` 获得冻结 JSON snapshot 与 CAS 命令。`snapshot()` 返回明确版本；`compareAndSet(expectedVersion, data, check)` 在 Session commit line 重验版本与授权 callback。非 JSON、非有限数、容量超限或已撤权均拒绝；未知物理提交封闭所属 Session。store 不是业务 agent 的通用写权，也不暴露 Tx 或 Durable document handles。

`reservedSessionId` 是受信任 bootstrap 选择的 lowercase UUID storage/provenance 地址，不是 provider identity。它具有 create-once 语义；已存在目录不会被覆盖。重开必须明确指定同一 owned storage 的 `reopenSessionFile`，且 provenance、runtime 配置与 reservation 均匹配。worker manager 使用这条接口恢复固定 placement；未知初始化和遗留 writer claim 不允许分配替代目录或自动抢占。

Dynamite 保持 [deferred](DEFERRED-DYNAMITE-COMPATIBILITY.md)。历史 pin 与 `@pakka/agent@0.4.0` 不等价；核心迁移不修改外部 mapper/算法，也不默认装配它。
