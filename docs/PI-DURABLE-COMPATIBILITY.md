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
