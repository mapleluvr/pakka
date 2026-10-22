// Local manual review composition. Real Pakka/Pi/MAS, deterministic loopback provider only.
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile, access } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const repo = resolve(import.meta.dirname, "..");
await mkdir(join(repo, "artifacts"), { recursive: true });
const base = await mkdtemp(join(repo, "artifacts", "mas-devin-live-"));
const home = join(base, "home");
await mkdir(home, { recursive: true });
Object.assign(process.env, {
	HOME: home,
	USERPROFILE: home,
	PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
	PI_OFFLINE: "1",
	TEMP: realpathSync.native(tmpdir()),
	TMP: realpathSync.native(tmpdir()),
});
const [{ startPocket }, { createMas }, { createMasProfilePacks }, { masExtensionRoot, masWorkbenchService }] =
	await Promise.all([
		import("@pakka/webui"),
		import("@pakka/mas"),
		import("@pakka/mas-devpack/agent"),
		import("@pakka/mas-devpack/backend"),
	]);
let requests = 0;
const provider = createServer((req, res) => {
	void (async () => {
		if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
			res.writeHead(404);
			res.end();
			return;
		}
		let raw = "";
		for await (const chunk of req) {
			raw += chunk;
			if (raw.length > 4 * 1024 * 1024) throw Error("Demo request too large");
		}
		let payload;
		try {
			payload = JSON.parse(raw);
		} catch {
			res.writeHead(400);
			res.end("Invalid local request");
			return;
		}
		const n = ++requests;
		const system = JSON.stringify(payload.messages.filter((m) => m.role === "system"));
		const last = [...payload.messages].reverse().find((m) => m.role === "user");
		const input = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
		const role = system.includes("DEMO-RESEARCHER")
			? "Researcher"
			: system.includes("DEMO-REVIEWER")
				? "Reviewer"
				: "Coordinator";
		const content =
			role === "Researcher"
				? "【本地确定性演示 · Researcher】\n已接收：" +
					input.slice(-500) +
					"\n\n建议观察：节点活动、通信方向与 Log 中的原始消息。该回复由本地固定规则生成，不是付费模型结果。"
				: role === "Reviewer"
					? "【本地确定性演示 · Reviewer】\n已接收：" +
						input.slice(-500) +
						"\n\n检查结论：这是真实持久化 Conversation；图层、拖动和隐藏属于个人视图，不会重放模型工作。"
					: "【本地确定性演示 · Coordinator】\n已接收：" +
						input.slice(-500) +
						"\n\n可选择成员 → Open Conversation 查看完整对话；More → Agent controls 可以继续发送、steer / followUp 或退役成员。此实例仅连接本机固定回复服务。";
		await writeFile(join(base, "provider-count.json"), JSON.stringify({ requests, lastRole: role }, null, 2));
		res.writeHead(200, { "content-type": "text/event-stream" });
		const chunk = (delta, finish_reason = null) =>
			res.write(
				"data: " +
					JSON.stringify({
						id: "demo-" + n,
						object: "chat.completion.chunk",
						created: 1,
						model: "local-demo",
						choices: [{ index: 0, delta, finish_reason }],
					}) +
					"\n\n",
			);
		chunk({ role: "assistant" });
		await delay(650);
		for (const part of content.match(/.{1,36}(?:\n|$)|[\s\S]{1,36}/gu) ?? [content]) {
			if (res.destroyed) break;
			chunk({ content: part });
			await delay(45);
		}
		if (!res.destroyed) {
			chunk({}, "stop");
			res.end("data: [DONE]\n\n");
		}
	})().catch((error) => {
		console.error("Local provider:", error);
		res.destroy();
	});
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
let mas;
const pack = createMasProfilePacks(
	{ profiles: { team: ["discover", "spawn", "send", "reply", "steer"] } },
	() => mas,
).get("team");
await Promise.all([mkdir(join(base, "workspace")), mkdir(join(base, "data"))]);
let app;
try {
	app = await startPocket({
		owner: "Local demo owner",
		profiles: ["plain"],
		initial: [],
		runtime: {
			cwd: join(base, "workspace"),
			dataDir: join(base, "data"),
			endpoint: "http://127.0.0.1:" + provider.address().port + "/v1",
			apiKey: "local-demo-not-a-real-key",
			model: "local-demo",
			limits: { maxConversations: 16, maxPrimaryAttempts: 256, maxAuxiliaryAttempts: 16 },
			profiles: [
				{ id: "team", tools: pack.tools, systemPrompt: "DEMO-COORDINATOR. " + pack.instructions },
				{ id: "researcher", tools: [], systemPrompt: "DEMO-RESEARCHER. Deterministic local UI review." },
				{ id: "reviewer", tools: [], systemPrompt: "DEMO-REVIEWER. Deterministic local UI review." },
				{ id: "plain", tools: [], systemPrompt: "Deterministic local UI review." },
			],
		},
		transport: { host: "127.0.0.1", port: 0 },
		extensions: [{ root: masExtensionRoot, facets: ["backend", "webui", "client"] }],
		extensionServices: async (context) => {
			mas = await createMas({
				runtime: context.runtime,
				namespace: "devin.manual.team",
				maxDeliveries: 1024,
				maxPending: 16,
			});
			await mas.bootstrap([{ key: "Coordinator", owner: context.ownerId, profile: "team" }]);
			await mas.activate();
			const root = (await mas.view()).members[0];
			const admin = mas.connect({
				principal: context.ownerId,
				source: null,
				grants: ["send", "observe"],
				initiator: { kind: "human", id: context.ownerId },
			});
			const lead = mas.connect({
				principal: context.ownerId,
				source: root.ref,
				grants: ["spawn", "send", "reply"],
				initiator: { kind: "human", id: context.ownerId },
			});
			const researcher = await lead.spawn({
				key: "Researcher",
				profile: "researcher",
				lifetime: "persistent",
			});
			const reviewer = await lead.spawn({ key: "Reviewer", profile: "reviewer", lifetime: "persistent" });
			// Each displayed edge is produced by a real MAS delivery; no injected graph/history rows.
			const kickoff = await admin.send(root.ref, {
				requestId: "demo-kickoff",
				text: "查看新的 Devin-like 主题下的 MAS Board。",
			});
			await admin.wait(kickoff.id);
			const task = await lead.send(researcher.ref, {
				requestId: "demo-research",
				text: "检查成员关系图与完整 Conversation 的往返交互。",
			});
			await lead.wait(task.id);
			const review = await lead.send(reviewer.ref, {
				requestId: "demo-review",
				text: "审阅新主题下的 Graph、Activity、Agents 和独立 Agent controls。",
			});
			await lead.wait(review.id);
			const responder = mas.connect({
				principal: context.ownerId,
				source: researcher.ref,
				grants: ["reply"],
				initiator: { kind: "human", id: context.ownerId },
			});
			const answer = await responder.reply(task.id, {
				requestId: "demo-research-reply",
				text: "已准备真实交互示例，可进入 Conversation 或继续在 Agent controls 中输入。",
			});
			await responder.wait(answer.id);
			return { mas: masWorkbenchService({ ...context, mas }) };
		},
	});
	if (!app.initialOwner) throw Error("Fresh isolated owner missing");
	const origin = app.http.origin,
		link = origin + "/#signin=" + encodeURIComponent(app.initialOwner.token);
	await writeFile(join(base, "owner-link.txt"), link + "\n");
	const ready = {
		origin,
		root: base,
		pid: process.pid,
		sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
		sourceDirty: Boolean(
			execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim(),
		),
		theme: "Devin frontend adoption R2",
		provider: "deterministic loopback only",
		requests,
		members: (await mas.view()).members.map((m) => ({ key: m.key, phase: m.phase })),
	};
	await writeFile(join(base, "ready.json"), JSON.stringify(ready, null, 2));
	await writeFile(join(repo, "artifacts", "mas-devin-current.json"), JSON.stringify(ready, null, 2));
	console.log(JSON.stringify(ready));
	console.log("Local sign-in link: " + join(base, "owner-link.txt"));
	console.log("Stop gracefully by creating " + join(base, "STOP"));
	let stopping = false;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		clearInterval(timer);
		await app.close();
		provider.closeAllConnections();
		await new Promise((r) => provider.close(r));
		console.log("Demo stopped, persistent data retained: " + base);
	};
	const timer = setInterval(() => {
		void access(join(base, "STOP"))
			.then(stop)
			.catch((error) => {
				if (error.code !== "ENOENT") console.error(error);
			});
	}, 1000);
	process.once("SIGINT", () => void stop());
	process.once("SIGTERM", () => void stop());
} catch (error) {
	await app?.close();
	provider.closeAllConnections();
	provider.close();
	throw error;
}
