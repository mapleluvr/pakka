# Conversation runtime API（`@pakka/agent@0.5.0`）

M1 增加 `createRuntime(options)`：受信任 bootstrap 在一个 Durable Harness/storage 中管理多个 Conversation。M2 的同 Session MAS 服务通过该 runtime 的受控 catalog port 装配；MAS 的 client、membership 和 A2A 语义见 [MAS-API.md](MAS-API.md)。`createHost()` 继续提供单 Conversation 兼容入口，使用原有 strategy journal namespace。两者不是可互换的 storage 开启方式：legacy host 不得重开 managed runtime storage，managed runtime 也不隐式采用旧 host storage/journal。

实现与验收状态以 [迁移计划](MONOREPO-MIGRATION-PLAN.md) 和 [验证记录](VERIFICATION.md) 为准。Runtime API 本身不授予 agent 创建/控制资源的权限。M3 的跨 Session A2A、worker 与真实进程隔离通过上层 [BROKER-API.md](BROKER-API.md) 装配，已验收（[范围与残余项](MIGRATION-M3-ACCEPTANCE.md)）；可选 [DevPack](MAS-DEVPack-API.md) 已在 M4 验收（[范围与 notes](MIGRATION-M4-ACCEPTANCE.md)）；有限 loopback MAS RPC 已在 M5 验收，见 [应用 API](MAS-APPLICATION-API.md) 与 [范围和 notes](MIGRATION-M5-ACCEPTANCE.md)；remote refs 不能转交 Runtime authority。

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

bootstrap 必须给出三项正的有限整数配额。额外 profile 接受允许的 `id`、instructions、配置的工具，以及可选的 `model` ID。省略 `model` 时沿用 HostOptions；显式值必须为 1–256 个 UTF-16 code units，不含控制字符或首尾空白。模型仍使用该 Runtime 固定的 provider、endpoint、宿主批准的凭据来源和主调用参数，profile 不能改写 credentials、cwd、storage path 或原始 extensions。创建相同 key/profile 返回已有 resource；同 key 的不同 profile 被拒绝。

例如 `{ id: "reviewer", model: "approved-review-model", systemPrompt: "Review the requested work." }` 在启动时注册该确切模型 ID。通过受控 catalog 的配置操作切换 profile 时，model、instructions 和 tools 在同一 native commit 更新；原 incarnation 作废，下一次实际 provider 请求采用新模型。人类只能选其 profile ceiling 内的配置；重开校验模型所属的 profile identity，并保留已消费额度。对应的设置界面与私密配置 replace/clear 已通过实际产品、provider 和仓库外安装门禁，见 [P5 阶段记录](PAKKA-POCKET-P5.md)；通知与其余可选界面继续实施。

### 主模型凭据来源

`HostOptions.resolveApiKey?: () => string | Promise<string>` 是可选、仅由受信任宿主提供的主模型凭据来源。不传时继续使用显式 `apiKey`；传入时，每次原生主请求解析凭据都会调用它，resolver 拒绝或返回非法值时失败封闭，不回退、发现环境凭据或发出 provider HTTP。对外只保留通用错误，原异常中的私密文本不进入原生输出。这是 adapter 对公开 auth callback 的配置，不修改 Durable，也不序列化到 browser/worker 配置。辅助 inference 的既有独立配置不受它隐式改写。

Pakka-Pocket 保留宿主已有 resolver 作为初始来源，仅全局管理员的专用 replace/clear 操作建立覆盖；clear 后正常重开仍不回退原值。已解析凭据或已开始的请求不会被 retroactive 撤销，已准备的调用不因凭据失败退还额度。服务端私密存储和备份必须按凭据数据保护：清除当前来源不承诺物理擦除持久历史或加密。

`runtime.profileChoices()` 只向受信任宿主返回冻结的 `{ id, model }[]`，不包含 instructions、工具代码或密钥。人类 API 在它之上按当前 profile ceiling 过滤；该列表本身不是授予配置权限。

## 受信任的当前上下文贡献（P5 开发快照）

`RuntimeOptions.contextSources` 接受宿主明确选择的 `RuntimeContextSource[]`。每个来源声明稳定的 `id`、正整数 `version` 和获准的 `profiles`；只有所选 profile 的主请求调用它。注册表在打开 storage 前复制并验证，来源身份参与这些 profile 的持久身份，正常重开拒绝未确认的定义替换。更改 renderer 实现时，宿主应显式更改定义版本。

`render({ target, signal })` 接收冻结的精确 `ConversationRef` 与取消信号，可以异步读取宿主服务，返回 `{ text, check }`。`text: null` 明确省略本次贡献；单源最多 32768 个 UTF-16 code units，全部来源合计最多 65536。`check()` 必须同步完成并返回 `undefined`，重新校验读取时捕获的状态；异步/thenable 返回、额外结果字段、非法文本或私密来源错误都阻止实际 provider dispatch。检查覆盖异步凭据解析之后的效果边界；已准备的 attempt 不因迟到失效退还。

这些文本只装入当前主请求的临时 system sections，不改写 raw Conversation history，也不成为永久重放的 instructions。历史中的用户内容或真实工具结果仍保留原始含义。调用方不会取得 Pi Harness、Conversation、Tx、provider 凭据或可伪造的原生 scope。通过原有公开准备 callback 保留既有的权限、projection、receipt 与配额检查。

可选 memory 的真实消费见 [`consumer-pocket-memory.mjs`](../scripts/consumer-pocket-memory.mjs)：`createPocketMemory()` 分别提供 `.tools`、`.source` 和 `.attach()`；宿主在 Runtime 里显式选择前两者，并在首次工作前绑定受控服务。只安装 Backend/Client/WebUI 不会自动安装工具或来源。项目范围、人类审批与恢复语义见 [P5 阶段记录](PAKKA-POCKET-P5.md)。

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

## Pocket P0 读取与显示端口（开发快照）

受信任 bootstrap 可以用 `runtime.readConversation(ref, check)` 取得冻结的 `ConversationSnapshot`：已提交消息、display records、live tools 和 usage。只投影当前引用的 Conversation，不返回原生 handles、system/config/provider identity 等内部字段。读取不启动工作或提交存储；异步 native watch 清理后还会重验 `check`，才发布结果。当前为有限 tail（最多 256 entries、JSON envelope 2 MiB），`truncated` 不等于完整历史；P1 将补充分页与人类资源服务。

`runtime.writeDisplay(ref, { namespace, actorId, requestId, kind: "card" | "chat", text }, check)` 在原生 commit line 绑定引用与授权。相同 scope/request/payload 稳定去重，正常 reopen 后保留 receipt；不同 actor/namespace 不共用请求。显示内容没有模型贡献，不推进 model head、不替换原 requester。每 Conversation 最多 512 个去重记录，text 最多 16384 个 UTF-16 code units；容量超限明确拒绝，不删除旧 receipt 来伪造新准入。

`check` 是宿主提供的同步检查，**拒绝时必须 throw**，不是浏览器传来的 grant 或返回 boolean 的 policy。两项命令都不是远端 API，不能直接交给模型或 Web 客户端。usage 的 token 值可展示，未提供权威价格时 `cost` 保持 `null`，不能把默认零价格说成免费。

阶段证明见 [P0 记录](PAKKA-POCKET-P0.md)；这不是 `@pakka/webui` 产品交付或通用后台 job 已完成的声明。已接受的可选 Dynamite [固定产品配对](DYNAMITE-PRODUCT-ACCEPTANCE.md) 仍以原 tarball SHA 为准，不自动覆盖新的开发快照；[历史失败配对](DEFERRED-DYNAMITE-COMPATIBILITY.md) 继续保留。

## 受控后台 job 与 checkpoint（P1 / P5 开发快照）

宿主在 `RuntimeOptions.jobs` 中批准有名称和版本的程序，再经 `runtime.jobs({ namespace, maxJobs, maxBytes })` 绑定当前人类/资源校验。浏览器不能提交可执行程序或恢复任意模块；收到的是冻结 job receipt，不是 native task。见 [P1 服务记录](PAKKA-POCKET-P1.md) 与 [P5 实际消费者](PAKKA-POCKET-P5.md)。

`RuntimeJobContext.advance(data)` 必须提交真正改变的 JSON checkpoint；对象键重排、重新分配相同对象、JSON 中等价的正负零都不算进展。适配器在排入新的 queued 状态前拒绝无进展数据；未由受信任程序处理的失败保存为 `unknown`，不留下 native 已 faulted、公开记录却仍声称可继续等待的新增任务。该保护不迁移历史 faulted job 的状态。

计划等待保留绝对 `nextDueAt`，并让每次等待 checkpoint 的有限序号递增；普通重开不会提前投递或改变本次投递身份。只有已提交的 checkpoint 可以继续，运行中未确认的效果不重放；原请求及保留容量继续占用，关闭 UI 等待不等于 native abort。计划 job 的 `done` 只表示本计划的输入已准入，不证明模型已回答；原生输入确认仍为 `unknown` 时，计划也保持 `unknown` 并停止后续周期。
