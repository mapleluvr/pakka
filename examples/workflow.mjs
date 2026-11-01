// Input -> {Conversation A, Conversation B} -> MAS 交流 -> X 生成 C -> A && B finished.
// 工作流定义就是本文件；运行状态和 C 通过 RuntimeStore 保存到同一 Session 的 SQLite。
// 在仓库根目录先 npm run build，再 node examples/workflow.mjs "写一份简短的协作指南"。
// 配置：PAKKA_ENDPOINT、PAKKA_MODEL、PAKKA_API_KEY、PAKKA_WORKFLOW_DIR。
// 指定 PAKKA_REOPEN_FILE 时只核对原运行，不重新投递输入或恢复任意 JS 调用栈。
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRuntime } from "@pakka/agent";
import { createMas } from "@pakka/mas";
import { createMasProfilePacks } from "@pakka/mas-devpack/agent";

const input = process.argv[2] ?? "写一份简短的协作指南，由 A 起草、B 校对并保存。";
const directory = resolve(process.env.PAKKA_WORKFLOW_DIR ?? "artifacts/workflow-example");
const reopenSessionFile = process.env.PAKKA_REOPEN_FILE;
const catalogOptions = { namespace: "workflow-team", maxDeliveries: 32, maxPending: 8 };
let runtime, mas, catalog, store;
let members = {},
	writes = Promise.resolve(),
	storageError;

// 这段队列只串行化本地状态提交；A、B 的模型请求仍可并行。
function update(change, check = () => {}) {
	const pending = writes.then(async () => {
		if (storageError) throw storageError;
		check();
		const saved = await store.snapshot();
		const next = change(structuredClone(saved.data));
		try {
			const committed = await store.compareAndSet(saved.version, next, check);
			return committed.data;
		} catch (error) {
			storageError = error;
			throw error;
		} // 未确认的写入不自动重试。
	});
	writes = pending.catch(() => {});
	return pending;
}

// role 来自宿主装配，不从模型参数读取；每次提交重新核对真实工具调用身份。
function businessTool(role, name, description, properties, change) {
	return {
		name,
		description,
		parameters: {
			type: "object",
			properties,
			required: Object.keys(properties),
			additionalProperties: false,
		},
		async execute(args, signal, invocation) {
			const check = () => {
				signal?.throwIfAborted();
				catalog.checkInvocation(members[role], invocation);
			};
			const state = await update((state) => {
				if (state.phase !== "running") throw new Error("Workflow is not accepting changes");
				return change(state, args);
			}, check);
			return JSON.stringify({ artifact: state.artifact, finished: state.finished });
		},
	};
}

const finish = (role) =>
	businessTool(
		role,
		"workflow_finish",
		"确认本次工作已完成；C 必须已经存在。之后停止发送消息。",
		{ artifactId: { type: "string", enum: ["C"] } },
		(state, args) => {
			if (args.artifactId !== "C" || !state.artifact) throw new Error("Artifact C is not committed");
			state.finished[role] = true;
			return state;
		},
	);
const X = businessTool(
	"B",
	"X",
	"将 A、B 共同形成的最终正文保存为产物 C。只允许一次确定内容。",
	{ content: { type: "string", minLength: 1, maxLength: 8192 } },
	(state, args) => {
		if (typeof args.content !== "string" || !args.content.trim() || args.content.length > 8192)
			throw new Error("Invalid C content");
		if (state.artifact && state.artifact.content !== args.content)
			throw new Error("C is already sealed with different content");
		state.artifact = { id: "C", content: args.content };
		return state;
	},
);
const packs = createMasProfilePacks(
	{ profiles: { A: ["discover", "send", "reply"], B: ["discover", "send", "reply"] } },
	() => mas,
);
const profile = (role, instructions, tools) => ({
	id: role,
	systemPrompt: `WORKFLOW_ROLE_${role}\n${instructions}\n${packs.get(role).instructions}\n向对方发消息使用 followUp，避免对方忙时 prompt 被拒绝。为每个逻辑消息使用稳定 requestId。完成后不要继续发送消息。`,
	tools: [...packs.get(role).tools, ...tools],
});

await mkdir(join(directory, "workspace"), { recursive: true });
try {
	// 1. 宿主批准角色与工具；这个示例没有 shell、文件系统或任意代码工具。
	runtime = await createRuntime({
		cwd: join(directory, "workspace"),
		dataDir: join(directory, "data"),
		endpoint: process.env.PAKKA_ENDPOINT ?? "http://127.0.0.1:45010/v1",
		model: process.env.PAKKA_MODEL ?? "local-workflow",
		apiKey: process.env.PAKKA_API_KEY ?? "local-only",
		...(reopenSessionFile ? { reopenSessionFile } : {}),
		tools: [],
		limits: { maxConversations: 3, maxPrimaryAttempts: 24, maxAuxiliaryAttempts: 1 },
		profiles: [
			profile(
				"A",
				"你负责起草。收到 workflow-input 后，将草稿通过 mas_send 发给 members.B。等待 B 保存 C 并发来结果，再调用 workflow_finish({artifactId:'C'})。",
				[finish("A")],
			),
			profile(
				"B",
				"你负责校对。收到 workflow-input 后等待 A 的草稿。结合输入和草稿，调用 X({content:最终正文}) 保存 C，再通过 mas_send 告诉 members.A 结果，最后调用 workflow_finish({artifactId:'C'})。",
				[X, finish("B")],
			),
		],
	});
	if (runtime.view().phase !== "ready") throw new Error(runtime.view().lastError ?? "Runtime not ready");
	store = runtime.store({ namespace: "ab-workflow-v1", maxBytes: 65536 });
	catalog = runtime.catalog(catalogOptions);
	mas = await createMas({ runtime, ...catalogOptions });
	if (!reopenSessionFile)
		await mas.bootstrap([
			{ key: "A", owner: "operator", profile: "A", lifetime: "persistent" },
			{ key: "B", owner: "operator", profile: "B", lifetime: "persistent" },
		]);
	await mas.activate();
	members = Object.fromEntries((await mas.view()).members.map((member) => [member.key, member.ref]));
	if (!members.A || !members.B) throw new Error("Workflow members missing");
	mas.setAdmission(async ({ source, target }) => {
		const { data } = await store.snapshot();
		return (
			data.phase === "running" && !data.finished[target.key] && (!source || !data.finished[source.profile])
		);
	});

	const saved = await store.snapshot();
	if (!reopenSessionFile) {
		// 2. 先保存工作意图，再把同一 Input 并行交给 A、B。
		await update(() => ({
			definition: "ab-workflow-v1",
			phase: "running",
			input,
			finished: { A: false, B: false },
			artifact: null,
		}));
		const operator = mas.connect({ principal: "operator", source: null, grants: ["send"] });
		const kickoff = JSON.stringify({ kind: "workflow-input", input, members });
		await Promise.all(
			["A", "B"].map((role) => operator.send(members[role], { requestId: "input-" + role, text: kickoff })),
		);
		// 3. 接下来由 Agent 通过 DevPack 交流、调用 X，并分别标记完成。
		await runtime.waitForIdle();
	} else if (saved.data.definition !== "ab-workflow-v1" || saved.data.input !== input) {
		throw new Error("Reopen requires the same workflow definition and input");
	}

	// 4. 空闲不代表业务完成；明确检查 C && A.finished && B.finished。
	let state = (await store.snapshot()).data;
	if (storageError) throw storageError;
	const complete = Boolean(state.artifact && state.finished.A && state.finished.B);
	if (complete && state.phase !== "done") state = await update((state) => ({ ...state, phase: "done" }));
	const outputDirectory = join(directory, "exports", runtime.view().sessionId);
	await mkdir(outputDirectory, { recursive: true });
	const artifactFile = state.artifact ? join(outputDirectory, "C.md") : null;
	if (artifactFile) await writeFile(artifactFile, state.artifact.content); // SQLite 是原件；文件是阅读用导出。
	const history = await mas.history({ limit: 32 }, () => {});
	const report = {
		sessionFile: runtime.view().sessionFile,
		artifactFile,
		state,
		deliveries: history.items.map((item) => item.receipt),
	};
	await writeFile(join(outputDirectory, "run.json"), JSON.stringify(report, null, 2) + "\n");
	process.stdout.write(JSON.stringify(report, null, 2) + "\n");
	if (!complete) process.exitCode = 1; // 保留未完成状态，不自动重启对话或重发原输入。
} finally {
	await writes;
	for (const pack of packs.values()) pack.revoke();
	await runtime?.close();
}
