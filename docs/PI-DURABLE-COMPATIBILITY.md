# Pi Durable Compatibility Ledger

本文件是 Pakka 对 `@earendil-works/pi-durable` 及其相关 Pi 包的兼容性账本。

它不是普通设计文档，也不是可随意改写的当前结论。依赖升级后，Agent 必须读取本文件，运行兼容性检查，并在文件末尾追加一条记录。旧记录不能被重写；发现旧结论不完整或错误时，追加 `supersedes` 记录。

## 目标

Pakka 不追随 Pi Durable 的内部实现细节，而是固定自己必须保持的适配器契约：

- 权限拒绝不能因为普通 hook 异常语义而变成 provider dispatch。
- 已提交的输入、生成任务、重试、恢复和 source snapshot 的状态必须可区分。
- provider dispatch 的次数、请求身份和工具副作用必须可由测试观察。
- Durable 更新后，Agent 能根据可复核的证据选择适配层补丁、上游补丁或暂停升级。

## 当前事实

截至本账本建立时，Pakka 的 headless adapter 使用 Pi `1.0.3` 的 `AgentSession` / `SessionManager`，并遵守仓库规则：不使用 Pi 私有 import、不修改 Pi 源码、不 monkey-patch SDK 对象。

Pi Durable 是另一套 Harness、任务和持久化模型。Pakka 不能把 `package-lock.json` 中的版本相等当成行为相等；必须同时记录：

- npm 包版本；
- 上游 git commit（若可取得）；
- `package-lock.json` 的 resolved/integrity；
- 实际检查的导出类型和源码路径；
- 兼容性测试的结果。

## 什么算失效

任何一个条件成立，当前账本中针对 Durable 的“已验证”状态自动失效，必须新增一条升级记录：

1. `package-lock.json` 中 `@earendil-works/pi-durable` 或 `@earendil-works/pi-ai` 的版本、resolved URL 或 integrity 改变。
2. Durable 的 git commit 改变，即使 npm 版本号不变。
3. `GenerationHooks`、`ToolHooks`、`CompactionHooks`、`Models` 或 Harness submit/task API 的导出声明改变。
4. 以下任一持久化或调度语义改变：提交去重、重试、恢复、取消、fork、compaction、task receipt、provider session identity。
5. 兼容性测试出现失败、测试通过但 provider call 数、持久化 receipt、任务终态或工具执行次数改变。
6. 上游 release note、变更日志或源码显示普通 hook 的异常处理路径、模型调用路径或任务错误分类改变。

“测试还通过”不能单独解除失效标记；必须重新记录实际版本和行为证据。

## 记录格式

每次升级或发现兼容性变化，在本文末尾追加一个不可变条目。推荐使用以下字段：

```text
ID: DURABLE-YYYY-MM-DD-N
发现时间:
上游版本: npm version / git commit / lockfile integrity
升级范围: from -> to
状态: detected | patched | verified | blocked | superseded
影响等级: compile | semantic | persistence | dispatch | security
影响面: 文件、导出符号、任务或 provider 路径
当前行为: 升级前已验证的真实行为
变化证据: 类型差异、源码位置、测试输出或 provider trace
失效条件: 哪个不变量不再成立
拟议变化: Pakka 适配器或上游 API 的最小变化
补丁位置: 具体文件和符号
验证命令:
验证结果:
关联条目: supersedes / related
```

条目必须包含**变更前后代码状态**。代码片段应来自实际仓库或实际依赖版本；示意代码必须明确标注 `illustrative`，不能伪装成已经存在的 API。

## Agent 升级流程

### 1. 固定输入

先记录升级前的基线，不要先改适配器：

```powershell
node --version
npm ls @earendil-works/pi-durable @earendil-works/pi-ai --all
git rev-parse HEAD
git diff -- package.json package-lock.json
```

将依赖版本、lockfile integrity、上游 commit 和当前条目 ID 写进新的 `detected` 条目。

### 2. 先跑旧行为基线

使用真实 Pi-ai 类型和本地确定性 HTTP provider，至少记录：

- 普通输入和同 `requestId` 重试；
- 同 `requestId` 不同 payload；
- `beforeRequest` 的异常、返回新 messages 和多 hook 顺序；
- `beforeTool` block 与工具实际执行次数；
- 重试、恢复、取消、compaction、fork；
- source 变化时旧任务的终态；
- 工具调用参数改写时的 HTTP 次数、工具次数和输入 receipt。

先保存 provider payload/response 和 Durable task/submission receipt，再修改代码。只看最终文本不足以判定兼容性。

### 3. 检查公共边界和语义边界

Agent 必须同时检查：

```powershell
rg -n "GenerationHooks|beforeRequest|beforeTool|beforeCompact|Models|streamSimple|completeSimple|fetchDeferred|submit\(" `
  node_modules/@earendil-works/pi-durable `
  node_modules/@earendil-works/pi-ai
npm run check
npm test
```

类型没有变化时，也要复跑语义测试。Pi Durable 的 breaking change 可能只改变异常报告、任务状态或 dispatch 时机，不一定造成 TypeScript 错误。

### 4. 选择补丁层级

按以下顺序选择，不得直接改 `node_modules`：

1. Pakka 适配器可以表达且不改变 Durable 语义：只改 `packages/agent/src/`，追加兼容性测试。
2. 需要 provider dispatch 前的强制语义，但公共模型入口足以覆盖全部路径：使用明确命名的 `PolicyModels` / `ModelGateway` 适配层，并记录其覆盖的入口。
3. 需要 Durable task 的新终态或新的 hook 返回值：提交或维护一个小的上游 Durable 变更，锁定 commit，并在本账本记录 upstream patch；不要把 task scheduler 私有实现复制进 Pakka。
4. 无法证明所有实际路径都经过门禁：状态设为 `blocked`，停止升级切流，不以“主测试通过”替代证明。

临时 patch 必须有删除条件和对应的上游版本/commit。没有删除条件的 workaround 不是兼容性方案。

### 5. 补丁后复核

补丁完成后追加 `patched` 条目，并提供：

- before/after 代码片段；
- provider call count 和工具执行 count；
- 输入、任务、receipt 的持久化状态；
- 重试/恢复/并发下的结果；
- `npm run check`、`npm test` 和定向兼容性测试结果。

只有在升级后的包、锁文件和测试证据都被记录后，才把条目追加为 `verified`。

## 当前关键示例：Generation beforeRequest 门禁

### 变更前：Pakka 直觉上的写法

```ts
// illustrative: 说明当前危险契约，不表示应复制
hook(GenerationTask, {
	beforeRequest: async (request, api, context) => {
		const projected = await project(request.messages, api, context);
		if (!projected.allowed) {
			throw new Error("AUTHORIZATION_DENIED");
		}
		return { messages: projected.messages };
	},
});
```

当前 Durable `GenerationHooks.beforeRequest` 的结果形状是 `undefined` 或 `{ messages }`。在已审计版本中，普通 hook 抛错会被 report 后跳过，随后 generation 仍可进入 `models.streamSimple(...)`。

实测轨迹：

```json
{
	"messages": [
		{
			"role": "user",
			"content": [
				{
					"type": "text",
					"text": "不能改写已有工具调用的目标。"
				}
			]
		}
	]
}
```

宿主事件与模型消息分开记录：

```text
beforeRequest -> throw AUTHORIZATION_DENIED
Durable report -> hook error
GenerationTask -> continues
providerCalls -> 1
```

这违反 Pakka 的不变量：授权失败不能继续产生 provider dispatch。

### 不改 Durable 的适配器补丁

可以把模型调用包在显式的 `PolicyModels` / `ModelGateway` 中：

```ts
const models = createPolicyModels(realModels, {
	authorize({ model, context, operation }) {
		return policy.check({ model, context, operation });
	},
});

const harness = await Harness.open({
	models,
	// extensions and storage...
});
```

其职责必须覆盖实际使用的入口：

```text
streamSimple       主 generation
completeSimple     compaction 或同步生成
fetchDeferred      延迟响应获取
cancelDeferred     延迟响应取消
stream / complete  直接 API 路径（若被使用）
```

通过时调用真实 Pi-ai models；拒绝时在 HTTP 前终止。这个方案只有在授权上下文可以无隐式全局状态地传递，并且所有启用入口都有测试时才合格。它通常把拒绝表现为 task failure，而不是 Durable 原生的 `blocked` 终态，因此条目必须明确记录这个差异。

### 推荐的上游语义补丁

若 Pakka 需要原生、可持久化、可观察的拒绝结果，应在 Durable 的公共类型中增加显式结果，而不是依赖异常：

```ts
// proposed upstream API; not present in the audited baseline
export type BeforeRequestResult =
	| undefined
	| { readonly messages: readonly Message[] }
	| { readonly block: string };
```

Generation task 应在 `{ block }` 时：

```text
保持已提交的 input
→ 不调用 streamSimple
→ 记录 generation = blocked 及 reason
→ 返回稳定 receipt
→ 不把 block 当作普通 hook exception
```

期望的宿主轨迹：

```text
input submission -> committed
beforeRequest -> { block: "AUTHORIZATION_DENIED" }
generation -> blocked
providerCalls -> 0
host -> ready
```

这条上游改动必须有 Durable 自己的 task 状态、恢复、重试和 receipt 测试。Pakka 不应在本地复制 generation scheduler 来模拟它。

## 条目 0001：当前基线

ID: DURABLE-2026-10-10-1  
发现时间: 2026-10-10  
上游版本: 已审计的 pi-durable `1.0.2`、`1.1.0` 与 upstream main `e37cdc420669e48b4df4bbce0fb2617fc3c71328`  
升级范围: migration baseline  
状态: blocked  
影响等级: security / dispatch / semantic  
影响面: `GenerationHooks.beforeRequest`、`GenerationTask`、`Models.streamSimple`

当前行为：普通 `beforeRequest` 抛错会被报告并跳过，不能作为 Pakka 的 fail-closed provider 门禁。此前通过真实 Harness 和 faux provider 验证了 provider 仍可能 dispatch；`beforeTool` 则拥有独立的 blocking exception 语义。

失效条件：Pakka 把 `beforeRequest` 异常当成 provider 不会被调用，或把一次 task fault 当成正常 `denied` receipt。

当前决策：允许开始隔离适配实验；不允许在没有 `PolicyModels` 全路径证据或上游显式 block 语义的情况下切换生产路径。

验证基线：

```text
真实 Harness + faux provider：beforeRequest throw 后仍 dispatch
beforeTool throw：阻止工具路径
Models facade 拒绝 streamSimple：阻止已测试的 provider 路径
```

下一步：在升级到任一新的 Durable 版本后，追加新的 `detected` 条目，重新运行同一组基线，并明确该条目是 `supersedes: DURABLE-2026-10-10-1` 还是仅 `related`。

## 追加条目模板

以下内容复制到文件末尾，不要修改已有条目：

````md
## 条目 DURABLE-YYYY-MM-DD-N：简短标题

ID: DURABLE-YYYY-MM-DD-N  
发现时间: YYYY-MM-DD  
上游版本: npm / git / integrity  
升级范围: from -> to  
状态: detected  
影响等级: compile | semantic | persistence | dispatch | security  
影响面:

当前行为：

变化证据：

失效条件：

变更前代码：

```ts
// exact or clearly marked illustrative code
```
````

变更后代码：

```ts
// exact or clearly marked illustrative code
```

补丁位置：

验证命令：

验证结果：

关联条目: supersedes / related

```

## 条目 DURABLE-2026-10-11-2：默认生产路径决策

ID: DURABLE-2026-10-11-2
发现时间: 2026-10-11
上游版本: 继承 `DURABLE-2026-10-10-1` 的审计基线
升级范围: migration policy decision
状态: verified
影响等级: semantic / dispatch
影响面: Pakka runtime backend selection、legacy `AgentSession` adapter、Durable adapter rollout
关联条目: related `DURABLE-2026-10-10-1`

当前行为：Pakka 没有实际用户和需要保留的线上会话；旧的 `AgentSession` 路径不承担生产数据兼容责任。此前关于“必须保留旧路径作为生产回退”的判断来自错误的迁移成本假设。

变化证据：用户已确认实际切换成本等于实现成本，且 Pakka 当前没有实际用户。

失效条件：若 Pakka 在切换前出现真实用户、需要保留的持久会话或外部集成，必须追加新的迁移条目，重新评估数据迁移和回退要求。

决策：允许 Durable adapter 直接成为 Pakka 默认生产路径。旧 `AgentSession` adapter 只保留为测试 oracle 和行为对照，不做双写，不做生产运行时回退，不要求兼容旧会话格式。

执行顺序：

1. 固定 `pi-durable`、`pi-ai` 和相关 Pi 包的版本、commit 与 lockfile integrity。
2. 以 Durable Harness 建立默认 Pakka runtime，并先使用全新的数据库/会话数据。
3. 将旧 `AgentSession` adapter 移入对照测试，不再作为默认 backend。
4. 直接实现 Durable 原生的权限语义；`beforeRequest` 的显式 `block` 仍应作为上游补丁或正式 API 变更处理，不用 hack 伪造。
5. 每次 Durable 更新先追加 `detected` 条目，再运行兼容性套件；生成门禁条目未解决时，不得宣称权限语义已完成，但不阻止无用户场景下的默认路径开发和切换。

验证要求：默认路径必须通过正常 generation、tool、持久化恢复和基本权限轨迹；`beforeRequest` fail-open 仍记录为已知限制，直到 `providerCalls = 0` 且拒绝结果有明确 receipt/终态。

```

## 条目 DURABLE-2026-10-11-3：Pi Durable 默认生产路径完成与 PolicyModels 门禁验证

ID: DURABLE-2026-10-11-3  
发现时间: 2026-10-11  
上游版本: `@earendil-works/pi-durable@1.0.3` (sha512-ARA+YQcqiQJz2pqxLL2ZA4ayZoulSDu1cMCMIYiKBnByTryGVfBhkEv6pT+QOP+3NgXzs0zPi3FpvyuSJ9harg==), `@earendil-works/pi-ai@1.0.3` (sha512-p+/EUrbmfT0xWOtL/NJRtWOsyzcKKFSyiivHLDBMG0DUVpHdaIykd5jFibq0YZDFGBN/nv61zdOelMb+ylPfSg==)  
升级范围: migration completion (PiAdapter -> DurableAdapter 默认生产切换)  
状态: verified  
影响等级: security / dispatch / semantic / persistence  
影响面: `createHost`, `packages/agent/src/durable-adapter.ts`, `PolicyModels`, `ArtifactJournal`  
关联条目: supersedes `DURABLE-2026-10-10-1`, related `DURABLE-2026-10-11-2`

当前行为：

1. `createHost()` 默认创建 `DurableAdapter`，只使用 Pi Durable 和公开 pi-ai 类型，旧 `PiAdapter` 从默认生产路径中移除，仅通过 `backend: "oracle"` 保留在测试 oracle fixture 中。
2. Generation 门禁由 `PolicyModels` (ModelGateway) 全面拦截 `streamSimple`：在 `GenerationTask` 的 `beforeRequest` 钩子中执行 `control.project()`，并将许可凭证与错误绑定到模型请求边界。若授权被拒绝、抛错或未获许可，`PolicyModels` 在实际 HTTP dispatch 前终止，确保证据链中 `providerCalls = 0`，输入保持 `committed`，宿主 phase 标记 `failed`。
3. Context 消息投影在 `beforeRequest` 前通过 `refreshCache()` 对齐最新物理转储，使得用户提交文本、截断 summary、上下文省略（`summary: null`）与内容补丁准确体现在 provider payload 中。
4. Artifact 写入实现 namespace writer 机制：各 strategy 绑定各自持有的 `(sessionId, strategyId, journalKind)` 独立 append，同 namespace 排他防重，跨 namespace 互不覆盖。
5. 物理持久化由 Node JSONL Storage 保证，reopen 具备完整的 provenance 校验，且破坏性故障注入均实现 fail-closed。

变更前代码（旧基线直觉写法）：

```ts
// illustrative: beforeRequest 异常被上游 report 并跳过，无法阻止后续 dispatch
hook(GenerationTask, {
	beforeRequest: async (request, api, context) => {
		const projected = await project(request.messages, api, context);
		if (!projected.allowed) {
			throw new Error("AUTHORIZATION_DENIED");
		}
		return { messages: projected.messages };
	},
});
```

变更后代码（DurableAdapter + PolicyModels 门禁）：

```ts
// packages/agent/src/durable-adapter.ts
const policyModels = new Proxy(rawModels, {
	get(target, prop, receiver) {
		if (prop === "streamSimple") {
			return (model, context, streamOpts) => {
				if (adapterRef?.hasPermitError) {
					throw adapterRef.consumePermitError();
				}
				const permit = adapterRef?.currentPermit;
				if (!permit) {
					throw new Error("Provider request has no host authorization");
				}
				permit.check();
				const origOnPayload = streamOpts?.onPayload;
				const wrappedOpts: SimpleStreamOptions = {
					...streamOpts,
					onPayload: async (payload, m) => {
						permit.check();
						return origOnPayload?.(payload, m);
					},
				};
				return target.streamSimple(model, context, wrappedOpts);
			};
		}
		return Reflect.get(target, prop, receiver);
	},
});
```

补丁位置：

- `packages/agent/src/durable-adapter.ts`
- `packages/agent/src/host.ts`
- `packages/agent/src/strategy-control.ts`
- `packages/agent/test/durable-integration.test.ts`
- `packages/agent/test/differential-oracle.test.ts`

验证命令：

```powershell
npm run check
npm run build
npm run format:check
npm test
npm run smoke:package
```

验证结果：

- `npm run check`: 0 errors
- `npm run build`: 成功生成 ESM + declaration artifacts
- `npm run format:check`: 全部文件符合 Prettier 标准
- `npm test`: 121 个测试全部通过（0 fail, 0 skipped），涵盖 A-01 至 A-11 全场景
- `npm run smoke:package`: 独立打包安装消费烟测通过，验证 1.0.3 cohort 与受控导出
- A-06 门禁证明：projector 阻断时 `providerCalls` 保持为 0，HTTP 请求未发出

## 7. 结构化差异清单（Durable vs Oracle Backend Differential Ledger）

依据 M6 交付物及 A-11 差分验收要求，记录 Pakka 默认生产后端（`DurableAdapter`）与保留测试参考后端（`PiAdapter` Oracle）之间的所有结构与运行差异：

| 差异维度                    | DurableAdapter (默认生产路径)                                                                                             | PiAdapter (测试 Oracle 路径)                                                                            | 语义评估 / 允许理由                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **底层运行时**              | `@earendil-works/pi-durable: 1.0.3` Harness + Conversation                                                                | `@earendil-works/pi-coding-agent: 1.0.3` `AgentSession`                                                 | 核心迁移目标，生产全面切换至 Durable，旧路径仅供对照                                     |
| **存储格式与布局**          | Node JSONL Document Store，多表/Doc 事务流 (`dataDir/sessions/<sessionId>/main.jsonl`)，含 DocFamily/DocumentCommitChange | 单一 SessionManager flat JSONL (`dataDir/sessions/<sessionId>/main.jsonl`)，按行追加 SessionEntry       | 存储物理布局差异已由 `trusted reopen` 契约抽象隔离，对外部透明                           |
| **条目标识 (Entry ID)**     | 递增数字序列（强类型 `EntryId`，对外部统一暴露字符串化形式）                                                              | 递增数字序列（SessionManager 原生 ID）                                                                  | Pakka `RawEntryDTO.id` 保持 `string`，两端外部 DTO 语义等价                              |
| **Provider 身份与模型注册** | 显式注册 `pakka-main` 与 `pakka-aux-<hash>` 命名空间 Provider                                                             | 注册 `pakka-summary-<hash>` 并复用 Pi 内置 default provider                                             | wire trace 上请求模型与消息对齐，仅 Provider ID 命名空间更清晰                           |
| **输入调度与队列机制**      | Durable 原生 `InboxDoc`，通过 `steeringMode` / `followUpMode` 在 `final` / `postTools` 事务放置                           | Pi 原生 `AgentMessage` 队列，通过 `Agent.steer` / `Agent.followUp` 调度                                 | 外部 `submit`、`cancelQueued`、`drain` 顺序完全一致，由 `lifecycle-queue.test.ts` 验证   |
| **Generation 门禁实现**     | `PolicyModels` (ModelGateway Proxy) 在公共 `Models` 调用边界做 Fail-Closed 门禁（`streamSimple` / `completeSimple` 等）   | `Agent.prepareRequest` 钩子链路直接拦截                                                                 | Durable 原生 hook 异常仅 report 不阻断，`PolicyModels` 保证 `providerCalls = 0` 安全等价 |
| **自动 Compaction / Retry** | 显式传入 `settings: { compaction: { enabled: false }, retry: { enabled: false } }` 彻底关闭                               | 通过 `SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } })` 彻底关闭 | 统一禁用非预期隐式副作用，由 Pakka 上层 Strategy 完全拥有截断与重试决策                  |
| **Artifact 写入范围**       | `(sessionId, strategyId, journalKind)` 多策略独立命名空间                                                                 | 全局单 writer 互斥占有                                                                                  | F-15 / A-05 改进，多策略并行写入无命名空间冲突                                           |

## 条目 DURABLE-2026-10-11-4：修复分页历史与 submission 等待竞态

- ID: DURABLE-2026-10-11-4
- 发现时间: 2026-10-11
- 上游版本: `@earendil-works/pi-durable@1.0.3`，`@earendil-works/pi-ai@1.0.3`
- 状态: patched
- 关联条目: supersedes the affected observations in `DURABLE-2026-10-11-3` without rewriting that entry
- 影响面: `DurableAdapter.refreshCache`, prompt settlement, `ContextFrame.entries`, `waitForIdle`

当前行为与失效证据：

1. `Conversation.entries()` 是 newest-first 分页 API；adapter 只读取第一页 1000 条，导致上下文仍有 1003 条时 raw frame 只有 1000 条。
2. `Conversation.submit()` 返回后，Durable scheduler 可能尚未把 generation task 放入 live 集合。此时直接调用 `Harness.waitForIdle()` 可以立即返回，造成调用者看到 `providerCalls = 0`，尽管提交已经在异步调度。
3. Durable entry 本身没有 Pakka 的 `parentId` 字段；adapter 之前把每一条 parent 都写成 `null`，丢失了当前 fork 线性的 entry 关系。

变更：

```ts
// 变更前：只读一页，且每个 parentId 都是 null
const page = await conversation.entries({}, 1000, undefined, context);
allEntries = [...page.items].reverse();
parentId: null;

// 变更后：消费 continuation cursor，并将当前线性历史映射为 parent chain
let cursor: Cursor | undefined;
const entries: EntryRecord[] = [];
do {
	const page = await conversation.entries({}, 1000, cursor, context);
	entries.push(...page.items);
	cursor = page.next;
} while (cursor !== undefined);
allEntries = entries.reverse();
parentId: index > 0 ? String(allEntries[index - 1].id) : null;

// 变更前：用可能提前返回的全局 idle 判定等待 prompt
await harness.waitForIdle(context);

// 变更后：等待该 submission 自身完成
const settled = await submission.wait(context);
```

同时清理 `idle()` 成功后的失败 waiter，避免长生命周期 host 累积不可达 resolver。

回归测试：

- `concurrent initial submissions do not let waitForIdle return before dispatch`
- `context views retain entries beyond Durable scan page size`
- `Durable entry frames preserve linear parentage`

验证结果：

- 501 次输入后 `view.entries.length = 1003`，不再截断为 1000；
- 64 个并发初始 submission 均观察到恰好 1 次 provider request；
- 最终完整 `npm test` 为 `124 passed, 0 failed`；
- `npm run check`、`npm run build`、`npm run format:check`、`npm run smoke:package` 均通过。

未解决的契约边界仍然有效：`beforeRequest` 还是 PolicyModels 适配层而非 Durable 原生 `block` receipt；Pi oracle 仍在生产包 import graph 中。这两个问题不能因本条修复而标记为完成。

## 条目 DURABLE-2026-10-11-5：原生 generation block 与生产 oracle 隔离

- ID: DURABLE-2026-10-11-5
- 发现时间: 2026-10-11
- 上游基线: `@earendil-works/pi-durable@1.0.3`，commit `d78dc83d633229d12f8b79631384c4c2717c399f`
- 下游版本: `1.0.3-pakka.1`
- 状态: patched
- 关联条目: supersedes the unresolved gate/oracle observations in `DURABLE-2026-10-11-3` and `DURABLE-2026-10-11-4` without rewriting those entries
- 影响等级: security / dispatch / persistence / packaging
- 影响面: `GenerationTask.beforeRequest`、Durable submission settlement、Pakka `DurableAdapter`、生产 package graph

### 当前行为

上游普通 `beforeRequest` hook 异常采用 report-and-skip：抛出授权错误不会可靠地阻止 provider dispatch。Pakka 旧实现以 `Models` facade 和 adapter 实例共享 permit 作为过渡门禁；它可以挡住已测试的主路径，但不是 Durable 原生拒绝终态，也有共享状态串用风险。

旧 `PiAdapter` 是 `AgentSession` 对照实现，仍从生产 Host 静态 import，可通过公开 `backend: "oracle"` 选择，生产依赖带入旧 SDK。仅将 Durable 标为默认，未完成 oracle 隔离。

### 具体变更

1. 在精确上游 commit 上维护 downstream patch，扩展公开 hook result：

   ```ts
   // 变更前：异常只 report-and-skip
   beforeRequest: () => Promise.reject(new Error("policy denied"));

   // 变更后：显式拒绝，或返回单次请求的授权复核
   beforeRequest: () => ({ block: "policy denied" });
   beforeRequest: () => ({ messages, check: requestScopedGuard });
   ```

   第一个 block 获胜，空字符串也是合法 reason；`check` 在所有 hook 后和 provider `onPayload` 边界执行。拒绝在同一 Durable commit 中清理 live run、settle 已 placed 的 submissions，并完成 generation task。没有 synthetic assistant error。普通 hook 异常仍 report-and-skip。

2. Pakka 删除 Models Proxy、共享 `currentPermit/permitError`，改用上述 request-scoped result。projector 可明确返回 `{ status: "blocked", basis, reason }`。输入 receipt 仍是 `committed`，另外带有 `generation: { status: "blocked", reason }`；Host 保持 ready。非法 plan、过期 authority 和未知 storage 仍失败关闭。

3. 生产 `createHost` 只构造 Durable，并拒绝 oracle backend。旧 adapter 移到 `packages/agent/test/pi-adapter.ts`；fixture 经内部 source construction seam 注入，无可变全局注册表。package root、生产 dist 和外部 tarball 不导出/安装 oracle。

4. `pi-durable@1.0.3-pakka.1` 以 hash-verified tarball bundle 进入 `@pakka/agent`。基线、source patch、build lock、artifact hash、重建与删除条件见 [patch README](../patches/pi-durable/1.0.3-pakka.1/README.md)。`npm run pack:agent` 在隔离目录安装 production dependencies，再将发布 manifest 设为精确 bundled version；不使用会漏掉 hoisted bundle 的原始 workspace pack。

### 为什么需要

把授权拒绝表示为持久化 generation 结果，可以停止当前请求并保留已接收的输入，避免把一次正常 policy refusal 变成全 Host fault。请求级复核在重试/恢复时重新构造，避免依赖内存中的共享 permit。隔离 oracle 则让外部安装真正只依赖 Durable 默认运行时，而不让测试对照代码进入产品。

### 实际轨迹

来自 `generation-block.test.ts` 的第一条本地 HTTP 测试。拒绝发生时模型上下文是以下 pi-ai 形状，未发送到 provider：

```json
{
	"messages": [{ "role": "user", "content": "BLOCKED-INPUT" }]
}
```

宿主持久化与回执另列，不混入模型消息：

```json
{
	"durableSubmission": {
		"status": "unanswered",
		"reason": "blocked",
		"detail": "policy denied"
	},
	"durableGenerationOutcome": {
		"status": "completed",
		"result": { "blocked": "policy denied" }
	},
	"pakkaReceipt": {
		"state": "committed",
		"generation": { "status": "blocked", "reason": "policy denied" }
	},
	"hostPhase": "ready",
	"providerCalls": 0
}
```

移除拒绝 projector 并提交 `ALLOWED-INPUT` 后，恰好一次 HTTP、Host 仍 ready。blocked key 的重复提交返回原 receipt，不重执行；关闭/重开也不隐式重发 blocked generation。工具后的拒绝保留之前工具副作用，已 drain 的 steering 与主输入均得到 blocked 生成结果。

### 验收证据

- Durable 隔离构建：4 个测试文件、`105 passed, 0 failed`；首次 block、空 reason 的 first-wins、hook 后 guard、payload-time guard、SQLite reopen 和 interrupted recovery 重算授权均通过。
- Pakka 完整 suite：`127 passed, 0 failed`，无 skipped/cancelled；包含三条 block 集成测试、64 个并发 initial submission、501 输入全分页与线性 parentage。
- `npm ci --ignore-scripts`、`npm run check`：通过；新脚本验证 tarball/source patch/build-lock 三个 hash。
- 外部 tarball consumer：7 次实际 HTTP；正常 generation、reload projector、artifact journal、辅助 `max_tokens=64/128`、range omission、generation block 和拒绝后的下一次请求通过。
- 外部安装无 `pi-coding-agent`，oracle backend 和 private subpath 均拒绝；生产 dist 无 oracle import。
- 长历史契约仍是 `entries.length = 1003`、`context.length = 1003`。501-generation 场景的独立耗时探针约 73 秒，因此 timeout 为 180 秒。这是完成语义限时，不宣称性能等价。
- 本地证据：`artifacts/integration/manifest.jsonl` 和其关联 HTTP/JSONL/Host 快照；`artifacts/package-smoke/` 的 pack/install/declarations/dependency-tree/smoke 日志；上游隔离目录路径在补丁构建输出中。

### 失效与移除条件

上游 hook result、generation checkpoint、submission settlement、retry/recovery、provider stream/payload、package commit/integrity 或 Pakka receipt 映射改变时，重新验证本条；不要将 patch 模糊应用到新版本。

只有当上游正式版本提供等价的 block settlement、request/payload revalidation、reopen 行为，且同一组本地 HTTP、工具副作用、SQLite recovery 与外部 tarball 测试通过后，才移除 `1.0.3-pakka.1`。更新或删除补丁时追加新条目，不修改旧条目。本补丁尚未提交或合入上游。

覆盖范围是 Pakka 当前显式 OpenAI-completions 路径；自动 retry/compaction 禁用，不暴露 deferred generation 或任意 Durable 插件。辅助 inference 保留独立 allowlist、预算与 pre-payload source guard。本条不声明完整 C2 crash recovery 或所有 provider 的权限安全。

## 条目 DURABLE-2026-10-11-6：双契约修复最终验收

- ID: DURABLE-2026-10-11-6
- 状态: verified
- 关联条目: verifies `DURABLE-2026-10-11-5`；早期历史条目保留原文
- 基线: `pi-durable@1.0.3-pakka.1`，SHA-256 `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7`

完成的门禁：干净 `npm ci --ignore-scripts`、`check`、完整 Pakka `127/127`、隔离补丁回归 `105/105`、`build`、`format:check` 和外部 `smoke:package`。最终新消费者位于 `artifacts/package-smoke/consumer-path.txt` 指向的目录，运行日志为同目录的 `smoke.log`。

外部 smoke 实际记录 7 次 HTTP、辅助 caps `64/128`、拒绝 provider 增量为 0、receipt committed + generation blocked、Host ready，以及拒绝后的下一次请求成功。生产 oracle dependency 为 absent，public oracle backend 与 private subpath 均拒绝。

`npm pack --workspace @pakka/agent --dry-run` 的 prepack guard 已实测拒绝，指向 `npm run pack:agent`；隔离 pack 接收 source tarball、验证 bundle 并转换为精确发布版本。正常消费者安装无需 postinstall patch。未来升级仍按条目 5 的失效/移除条件重新验证；本条不授权跳过兼容性测试。

## 条目 DURABLE-M3-7：多 Session 与真实 worker 验收

- ID: DURABLE-M3-7
- 状态: verified with notes
- 关联条目: extends DURABLE-2026-10-11-6；不改写历史记录
- 基线: 同一 `pi-durable@1.0.3-pakka.1`，上游 `d78dc83d633229d12f8b79631384c4c2717c399f`；SHA-256 `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7`。
- Pakka 变更: agent `0.3.0 → 0.4.0`，mas `0.1.0 → 0.2.0`，新增 private server `0.1.0`；patch/source/build inputs没有变化，未手改 installed dependency。
- 影响面: 公开 defineDocFamily/Session.commit 上的有限 coordinator store；create-once storage 地址；跨 Session outbox/native admission reconciliation；不同 PID 的实际 worker。

变更前（M2）：同 Session catalog/准入与 task/background ownership已验收，缺少 coordinator store、固定多 Session placement 和实际 worker manager。

变更后（源码公开端口）：

```ts
// packages/agent/src/runtime.ts，生产 bootstrap delegation
store: (options: RuntimeStoreOptions) => port.store(options),
```

底层事务和 Pi mutable handles仍只在 adapter；broker/app仅消费冻结 DTO和命令闭包。既有 request/payload gate、投影、Session/strategy预算和原生 steer/followUp保持。未知 writer不被超时/PID复用抢占，跨 Session不宣称事务或 exactly-once effects。

验证命令：`npm ci --ignore-scripts`、`check`、`build`、`format:check`、`npm test`、`smoke:package`、strict OpenSpec；结果为全量 **196/196**、定向 **20/20**、真实独立 tarball/worker consumer HTTP **7/3/3/3**，重复 admission与重开零额外 HTTP。指定 adversarial-review两 bounded passes最终 OK with notes。完整固定产物身份、执行证据、P2处置及复审质量更正见 [MIGRATION-M3-ACCEPTANCE.md](MIGRATION-M3-ACCEPTANCE.md)。本轮没有重跑无变化的历史 patch 105/105，不将其冒充新结果。

失效条件：Durable公共 doc/commit/admission/task/ownership API、generation block或恢复语义、版本/hash/build inputs变化，或新增不可信 receipt restore/外部 transport，应重新运行对应矩阵并追加记录。M4–M6、完整 crash-claim恢复、POSIX故障矩阵与 Dynamite兼容仍未由本条授权。

## 条目 DURABLE-M4-8：可选 MAS contribution 与批准 Session 申请

- ID: DURABLE-M4-8
- 状态: verified with documented notes
- 关联条目: extends DURABLE-M3-7；不改写历史记录
- 基线: 同一 `pi-durable@1.0.3-pakka.1`；upstream `d78dc83d633229d12f8b79631384c4c2717c399f`；SHA-256 `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7`。
- Pakka 变更: agent `0.4.0 → 0.5.0`，mas `0.2.0 → 0.3.0`，新增 mas-devpack `0.1.0`，private server `0.1.0 → 0.2.0`。没有手改 installed dependency，没有新增 source patch 或 build input。
- 影响面: 使用 adapter 已有公开 `defineExtension` 注册明确批准的 tools/instructions；catalog 提供自身 incoming receipt metadata；有限固定 slot 申请复用 M3 public doc/commit/broker；实际 worker 的 native scope 与完整 capability-owner grant ceiling。

变更前：受信任 MAS client/worker 已验收，业务模型缺少可选 agent-facing contribution 和批准跨 Session 申请。变更后：public factory 仅提供受控 tool/instruction DTO；真实调用组合既有 client、contribution 与 native invocation 检查。endpoint/凭据/预算/任意 tool code 不进入模型参数，Pi mutable objects 仍只在 adapter。ask 是 bounded generation receipt，不等于应用回复或工具效果确认。profile removal 按原生 public section/update 语义替换当前配置，保留历史 positional messages。

验证：最终独立离线 clean staging `ci --ignore-scripts --offline`、build/check/format；完整 216/216、focused 20/20、复审修复 8/8；真实独立 tarball/native worker consumers HTTP 7/3/3/3/8；两轮指定 adversarial-review 均 OK with notes。旧实际 worker profile 提权从 1 次未授权 peer HTTP 修复为 0；distinct slot 一/两个实例的 40-slot real CAS 全部保留，没有 provider dispatch。完整 build identity、未处理的 report-only P2、原始失败与父级决定见 [MIGRATION-M4-ACCEPTANCE.md](MIGRATION-M4-ACCEPTANCE.md)。未重跑的历史补丁 105/105 不算本轮结果。

失效条件：public native invocation/tool/section/ownership/admission/recovery 契约变化，grant ceiling 或 typed no-effect refusal producer 变化，patch/hash/build inputs 变化，或引入不可信 remote decoder/capability transport 时，重跑受影响真实矩阵并追加记录。本条不授权 M5 public auth/CLI、完整 crash-claim恢复、hostile-code sandbox、任意负载 fairness 或 Dynamite兼容。

## 条目 DURABLE-M5-9：authenticated loopback 应用与受检恢复边界

- ID: DURABLE-M5-9
- 状态: verified with documented notes
- 关联条目: extends DURABLE-M4-8；不改写历史记录
- 基线: 同一 `pi-durable@1.0.3-pakka.1`；upstream `d78dc83d633229d12f8b79631384c4c2717c399f`；SHA-256 `535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7`。
- Pakka 变更: mas `0.3.0 → 0.4.0`、mas-devpack `0.1.0 → 0.2.0`、private server `0.2.0 → 0.3.0`；新增 protocol/client/cli `0.1.0`，agent 仍 `0.5.0`。未修改 installed SDK、source patch 或 build lock。
- 影响面: browser-safe finite wire schema/client、实际 server/CLI bootstrap、server-bound source/grants/expiry、原生取消/withdraw/receipt、nested broker shape/correlation；不序列化进程内 capability 或 Pi objects。

验证：最终离线 clean staging install/build/check/format、完整 242/242、focused 26/26、guard/effect 控制 13/13、实际 browser 和 tarball server/client/CLI；独立 consumers HTTP 7/3/3/3/8/2。第一轮指定 adversarial-review BLOCK 后修复四类确定本地拒绝，第二轮 A/B/closing 均 OK with notes。callback 实际产生 HTTP 后的拒绝、物理 native write failure、迟到 revoke/expiry 和丢回执仍 unknown；未以 HTTP status 放宽响应关联。完整 SHA、原始失败和 report-only P2 见 [MIGRATION-M5-ACCEPTANCE.md](MIGRATION-M5-ACCEPTANCE.md)。SDK 输入不变，历史 patch 105/105 未重跑，不算本轮结果。

失效条件：public admission/withdraw/invocation/commit/callback 契约或 SDK cohort/patch/hash/build lock 变化、deny producer 变化、不可信 broker restore/外部传输、hostile config 或新的 isolation/cancellation 组合，应重跑受影响真实矩阵并追加记录。本条只授权已验收 loopback/MAS 应用；不授权公网多租户、任意 host RPC、完整 crash claim恢复、M6 默认产品装配或 Dynamite兼容。
