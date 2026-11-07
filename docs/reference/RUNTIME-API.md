# Conversation runtime API（`@pakka/agent@0.7.0`）

`createRuntime(options)` 让受信任 bootstrap 在一个 Durable Harness/SQLite storage 中管理多个 Conversation。同 Session MAS 服务通过 runtime 的受控 catalog port 装配；MAS 的 client、membership 和 A2A 语义见 [MAS-API.md](MAS-API.md)。`createHost()` 提供单 Conversation 入口。每个入口依据持久 runtime 身份重开所属存储，保留原资源与额度。新建文件为 `main.sqlite`，`storage.json` 声明 backend/schema 与 WAL/FULL 策略；存储与恢复细则见 [SQLite 场景](../../openspec/changes/archive/2026-11-02-adopt-dynamite-sqlite-persistence/specs/conversation-runtime/spec.md)。

Runtime API 只供受信任宿主装配；跨 Session A2A 与 worker 见 [Broker API](BROKER-API.md)，模型工具见 [DevPack API](MAS-DEVPack-API.md)，HTTP/CLI 入口见[应用指南](../guides/MAS-APPLICATION-API.md)。remote refs 不能转交 Runtime authority。

## 创建与访问

主模型可由可信宿主通过 `models: Models | (() => Models)` 注入。getter 在使用时读取当前目录；模型引用使用 `modelChoices()` 返回的 `key`（`encodeURIComponent(provider) + "/" + modelId`），不以 Agent profile 别名代替。`model: ""` 表示尚未选择模型，可以打开和管理 Session；选择与认证满足后才可生成。`thinkingLevel` 独立保存。WebUI 的 Pi 原生配置加载器属于产品装配，独立 SDK 不自动读取 Coding Agent 的配置。

以下例子演示保留的显式 endpoint/model/apiKey 兼容装配；原生 Models 模式无需这套 endpoint/凭据字段。

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

bootstrap 必须给出三项正的有限整数初始配额。额外 profile 接受允许的 `id`、instructions、配置的工具，以及可选的 `model`、`thinkingLevel`、批准 `cwd` 与 `execution`。省略模型时沿用宿主默认；原生 Models 模式支持跨 provider 的完整模型引用，兼容模式使用显式装配的单 provider 模型 ID。profile 不接管 credentials 或 storage path。创建相同 key/profile 返回已有 resource；同 key 的不同 profile 被拒绝。

整组 profile 配置在同一 native commit 更新相关模型、instructions 和 tools，原 incarnation 作废。人类的 profile ceiling 约束整组工具/指令预设；独立模型选择按原生目录与 Conversation 配置权限校验，不要求为每个模型新增 profile。新增批准 profile 可登记到原 Session，已登记执行定义仍按持久指纹核对。设置、模型刷新与认证见 [WebUI 使用指南](../guides/WEBUI-GUIDE.md)。

### 执行环境

`HostOptions.execution` / `RuntimeOptions.execution` 接受 `ExecutionConfiguration`；profile 可覆盖，省略时继承默认配置。配置提供稳定的版本 ID、`open(target)` 和显式 `tools`（read/write/edit/bash/powershell）。目标包含实际 Session/Conversation/profile/cwd，managed 目标还有 incarnation。环境及工具选择进入重开配置核对，配置错误和名称冲突在存储建立前拒绝。

`createLocalExecutionEnvironment()` 提供显式本机驱动；合作工具通过 `executionFor(scope)` 得到冻结的文件/命令能力。它不赋予 owner cleanup 权限，也不把直接调用宿主 fs 的插件变成沙箱代码。环境取得失败使用原生 block 阻止主模型 HTTP；模型权限仍独立执行。完整签名、数据、取消与资源寿命见[执行环境指南](../guides/EXECUTION-ENVIRONMENT.md)及[状态声明](../state/execution-environment.md)。

### 主模型目录与凭据来源

原生 Models 模式由传入的 Pi provider 负责凭据解析、模型能力与请求兼容；Pakka 不复制它的认证 schema。产品使用公开 ModelRuntime 读取 Pi 模型/认证目录，并通过原生 login/logout 管理凭据。以下 resolver 与单主密钥覆盖仅属于显式 legacy 装配。

`HostOptions.resolveApiKey?: () => string | Promise<string>` 是可选、仅由受信任宿主提供的主模型凭据来源。不传时继续使用显式 `apiKey`；传入时，每次原生主请求解析凭据都会调用它，resolver 拒绝或返回非法值时失败封闭，不回退、发现环境凭据或发出 provider HTTP。对外只保留通用错误，原异常中的私密文本不进入原生输出。这是 adapter 对公开 auth callback 的配置，不修改 Durable，也不序列化到 browser/worker 配置。辅助 inference 的既有独立配置不受它隐式改写。

pakka-webui 保留宿主已有 resolver 作为初始来源，仅全局管理员的专用 replace/clear 操作建立覆盖；clear 后正常重开仍不回退原值。已解析凭据或已开始的请求不会被 retroactive 撤销，已准备的调用不因凭据失败退还额度。服务端私密存储和备份必须按凭据数据保护：清除当前来源不承诺物理擦除持久历史或加密。

`runtime.profileChoices()` 向受信任宿主返回冻结的 `{ id, model, cwd }[]`，不包含 instructions、工具代码或密钥。`await runtime.modelChoices()` 独立返回原生模型 DTO：完整 key、provider/model/name、输入种类、上下文/输出上限、thinking levels、目录声明价格及认证可用提示。`modelAllowed(key)` 只检查当前目录成员资格，不授予权限或解析凭据；available 也不是服务端认证成功的保证。

受控 catalog 的 `CatalogEnroll.configuration?: { model?: string; cwd?: string; thinkingLevel?: ModelThinkingLevel }` 将初始配置与新 Conversation 在同一原生提交中建立。非空变更对象只允许这三个字段：模型必须来自当前目录，cwd 必须通过批准 roots，thinking 必须是支持的等级。它不替换基础预设的工具或 instructions，不接纳首条模型输入；继承保留模型、目录和 thinking。WebUI 创建端口另以原请求身份和指纹核对参数。

## 受信任的当前上下文贡献

`RuntimeOptions.contextSources` 接受宿主明确选择的 `RuntimeContextSource[]`。每个来源声明稳定的 `id`、正整数 `version` 和获准的 `profiles`；只有所选 profile 的主请求调用它。注册表在打开 storage 前复制并验证，来源身份参与这些 profile 的持久身份，正常重开拒绝未确认的定义替换。更改 renderer 实现时，宿主应显式更改定义版本。

`render({ target, cwd, signal })` 接收冻结的精确 `ConversationRef`、当前原生 Conversation 的批准工作目录与取消信号，可以异步读取宿主服务，返回 `{ text, check }`。`text: null` 明确省略本次贡献；单源最多 32768 个 UTF-16 code units，全部来源合计最多 65536。`check()` 必须同步完成并返回 `undefined`，重新校验读取时捕获的状态；异步/thenable 返回、额外结果字段、非法文本或私密来源错误都阻止实际 provider dispatch。检查覆盖异步凭据解析之后的效果边界；已准备的 attempt 不因迟到失效退还。

这些文本只装入当前主请求的临时 system sections，不改写 raw Conversation history，也不成为永久重放的 instructions。历史中的用户内容或真实工具结果仍保留原始含义。调用方不会取得 Pi Harness、Conversation、Tx、provider 凭据或可伪造的原生 scope。通过原有公开准备 callback 保留既有的权限、projection、receipt 与配额检查。

可选 memory 的真实消费见 [`consumer-pocket-memory.mjs`](../../scripts/consumer-pocket-memory.mjs)：`createPocketMemory()` 分别提供 `.tools`、`.source` 和 `.attach()`；宿主在 Runtime 里显式选择前两者，并在首次工作前绑定受控服务。只安装 Backend/Client/WebUI 不会自动安装工具或来源。项目范围、人类审批与恢复语义见 [WebUI 开发契约](../development/WEBUI-DEVELOPMENT.md)。

## 身份、作用域与 journal

- `sessionId` 保留现有 Pakka storage/provenance ID 的含义；`durableSessionId` 显式指向同一存储域。
- `conversationId` 是原生 Conversation ID；`providerSessionId` 是 `pi.provider` 的 provider affinity identity，两者独立。
- `ConversationRef` 包含 `key/sessionId/conversationId/incarnation/profile`。它是受检地址，不是可以序列化转交的权限。复制不能提升权限；替换或 fork 后的旧 reference 被拒绝。
- 同名 principal/strategy 各自绑定 scope。单 Conversation journal 的 namespace 为 strategy 和 journal kind；managed journal v2 的地址组合 Session、Conversation、strategy 和 journal kind。
- navigation 创建 native fork，发布新的 Conversation/incarnation/provider identity。既有 Host closure 继续代表该 key 的当前 Conversation，调用方通过 `runtime.view()` 取新的 resource reference。

`pakka.runtime` document schema v3 保存 Session 配额、累计消费、strategy attempt totals、批准 profile 身份、Conversation resources 和预算政策版本。预算政策、按版本审计与原请求索引保存在独立原生 documents。v1/v2 仅在消费可归因时升级；新版缺失政策记录会拒绝重开，不作为旧版自动补齐。

## 调度、预算与失败

同一 Harness 的 task scheduler 和 storage commit line 被共享；每个 Conversation 有独立上下文、控制 kernel、receipt、strategy owner、projection permit、source job 和 tool invocation。steer/followUp 使用 native Durable submission timing。

主调用与辅助调用在 dispatch 前分别提交 Session 汇总 attempt reservation；`InferencePolicy.maxCalls` 另由同一次 commit 对 strategy+Session 累计，新 Conversation/fork/reopen 不扩大它。每个 Conversation 的 job 上限和独立 inference audit 继续执行；取消、未知结果、调用在实际 HTTP 之前失效均不退还已提交的 reservation。数字表示保守调用尝试上限，不是账单、token 总额或精确 HTTP 次数。

普通 provider/run 失败保留原生错误轨迹与原回执，回到 idle 后允许显式的新输入或配置修正，不自动重放旧请求。另一成员可继续工作；同 Session 的未知 storage、commit/adoption、未分类 report 则封闭所有成员。一个新 Harness 仍在同一 Node 进程，不能隔离进程退出或 OOM。

`Host.dispose()/reload()` 只处理该 Conversation；managed Host 的 `newSession()` 被拒绝。managed 的 pending fork 在 `busy` 中可见；legacy 兼容入口保留同步连续 branch/ABA 的观察语义，调用方等待 `waitForIdle()` 后再确认 native fork 完成。`Runtime.close()` 管理共享 Harness/storage 关闭。运行时不允许第二个 writer 重开同一 storage：使用 `pakka-writer.json` 的独占 claim。只有已知 writer 成功关闭后才删除 claim；发现旧 claim 时 fail closed，不依据 PID 或超时自动抢占。受信任宿主可调用 `recoverStorageWriter({ storageDir, expectedClaim: { pid, nonce } })`：排他维护门禁下只读核对数据库身份，确认原进程已退出且 claim 精确匹配后释放原 claim。命令不启动模型、不改写数据库／WAL；具体接口见 [维护命令](STRATEGY-API.md#trusted-writer-maintenance)。

### 预算政策与审计

- `budgetPolicy(check)` 返回 `{ version, limits, budget, conversationCount }`。
- `changeBudget({ actorId, requestId, expectedVersion, limits, reason }, check)` 在一个原生事务内提交政策、审计和原请求索引；相同请求及内容返回原回执，旧版本新请求或内容冲突拒绝。
- `budgetReceipt({ actorId, requestId }, check)` 核对原请求；`budgetHistory(query, check)` 按版本分页。宿主绑定实际 actor，浏览器不能自行授予该控制权。
- 提交前明确拒绝可由公开 `BudgetChangeRefusedError` 区分；存储未知或写后授权失效仍按所属失败域处理，不被解释为无效果。
- 提高或降低额度均保留累计消费。降至消费以下只阻止新预留；原 bootstrap 重开保留管理调整，明确变更 bootstrap limits 才形成新政策。

## 取消与重开

`cancelQueued()` 保持同步签名，返回请求时的 `unknown` 快照。只有精确的 Durable submission 记录确认 `unanswered/aborted` 且没有 entry，回执才变为 `released`。已 placed 的输入保持 committed；撤回结果无法确认时不释放，不触发重试。

通过 Host receipt event 或 `client.receipt(id)` 观察撤回确认。相同 key 重试必须保持原 text/mode，且前一 admission 已 released；换 mode 是幂等冲突。

`createRuntime({ ...options, reopenSessionFile })` 验证 provenance、已登记 profile、批准目录及预算政策，按受控配置演进登记新增 profile 或额度变化，恢复所有现存成员的 authority 后才允许 progress。纯重开/inspection 不发送 HTTP。Session quotas 与 Conversation identity 保留，旧 capability、lease、tool scope、Host closure 不复活。Host 的直接输入回执 ledger 仍是进程内状态；不要把这条兼容路径用作跨重启 A2A 去重。

## Coordinator store 与明确 storage 地址

受信任 bootstrap 使用 `runtime.store({ namespace, maxBytes })` 获得冻结 JSON snapshot 与 CAS 命令。`snapshot()` 返回明确版本；`compareAndSet(expectedVersion, data, check)` 在 Session commit line 重验版本与授权 callback。非 JSON、非有限数、容量超限或已撤权均拒绝；未知物理提交封闭所属 Session。store 不是业务 agent 的通用写权，也不暴露 Tx 或 Durable document handles。

`reservedSessionId` 是受信任 bootstrap 选择的 lowercase UUID storage/provenance 地址，不是 provider identity。它具有 create-once 语义；已存在目录不会被覆盖。重开必须明确指定同一 owned storage 的 `reopenSessionFile`，且 provenance、runtime 配置与 reservation 均匹配。worker manager 使用这条接口恢复固定 placement；未知初始化和遗留 writer claim 不允许分配替代目录或自动抢占。

## Conversation 读取与显示端口

受信任 bootstrap 使用 `runtime.readConversation(ref, check, { limit, beforeEntryId })` 取得冻结的 `ConversationSnapshot`：已提交消息、display records、live tools 和 usage。只投影所选 Conversation，不返回原生 handles、system/config/provider identity。异步读取完成后重验 `check`。每页最多 256 entries，JSON envelope 上限 2 MiB；`truncated` 表示当前页受限。使用响应的 `olderBeforeId` 作为下一页的 `beforeEntryId` 读取更早记录。读取只作授权观察，不启动模型或提交存储。

`runtime.writeDisplay(ref, { namespace, actorId, requestId, kind: "card" | "chat", text }, check)` 在原生 commit line 绑定引用与授权。相同 scope/request/payload 稳定去重，正常 reopen 后保留 receipt；不同 actor/namespace 不共用请求。显示内容没有模型贡献，不推进 model head、不替换原 requester。每 Conversation/display namespace 最多 4096 个去重记录，text 最多 16384 个 UTF-16 code units；容量超限明确拒绝，不删除旧 receipt 来伪造新准入。

`check` 是宿主提供的同步检查，**拒绝时必须 throw**，不是浏览器传来的 grant 或返回 boolean 的 policy。两项命令都不是远端 API，不能直接交给模型或 Web 客户端。usage 的 token 值可展示，未提供权威价格时 `cost` 保持 `null`，不能把默认零价格说成免费。

WebUI 通过受控服务装配这些宿主端口，见 [WebUI 开发契约](../development/WEBUI-DEVELOPMENT.md)。

## 受控后台 job 与 checkpoint

宿主在 `RuntimeOptions.jobs` 中批准有名称和版本的程序，再经 `runtime.jobs({ namespace, maxJobs, maxBytes })` 绑定当前人类/资源校验。浏览器不能提交可执行程序或恢复任意模块；收到的是冻结 job receipt，不是 native task。应用程序的流程与持久化安排见[协作流程指南](../guides/MAS-WORKFLOWS.md)。

`RuntimeJobContext.advance(data)` 必须提交真正改变的 JSON checkpoint；对象键重排、重新分配相同对象、JSON 中等价的正负零都不算进展。适配器在排入新的 queued 状态前拒绝无进展数据；未由受信任程序处理的失败保存为 `unknown`，不留下 native 已 faulted、公开记录却仍声称可继续等待的新增任务。已终结 job 保留其持久状态。

计划等待保留绝对 `nextDueAt`，并让每次等待 checkpoint 的有限序号递增；普通重开不会提前投递或改变本次投递身份。只有已提交的 checkpoint 可以继续，运行中未确认的效果不重放；原请求及保留容量继续占用，关闭 UI 等待不等于 native abort。计划 job 的 `done` 只表示本计划的输入已准入，不证明模型已回答；原生输入确认仍为 `unknown` 时，计划也保持 `unknown` 并停止后续周期。
