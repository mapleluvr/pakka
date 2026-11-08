import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startPocket } from "@pakka/webui";
import { createMas } from "@pakka/mas";
import { createTicketService } from "@pakka/rsi";
import { createTicketTools } from "@pakka/rsi/agent";
import { createMasTicketDispatcher } from "@pakka/rsi/mas";
import { ticketExtensionService, rsiExtensionRoot } from "@pakka/rsi/backend";

/** Trusted composition example. No IM connector or research/deployment workflow is installed. */
export async function startTicketWorkbench({
	directory,
	endpoint,
	model,
	apiKey,
	port = 0,
	reopenSessionFile,
}) {
	let tickets, botRef, workerRef;
	const botActor = { id: "agent:inbox", role: () => "submitter", check() {} };
	const workerActor = { id: "agent:worker", role: () => "handler", check() {} };
	const bot = createTicketTools({
		resolve: (scope) => tickets.forInvocation({ actor: botActor, source: botRef }, scope),
	});
	const worker = createTicketTools({
		resolve: (scope) => tickets.forInvocation({ actor: workerActor, source: workerRef }, scope),
	});
	await mkdir(join(directory, "workspace"), { recursive: true });
	let app;
	try {
		app = await startPocket({
			owner: "Owner",
			profiles: ["ticket-bot"],
			initial: [{ name: "Idea inbox", profile: "ticket-bot" }],
			runtime: {
				cwd: join(directory, "workspace"),
				dataDir: join(directory, "data"),
				endpoint,
				model,
				apiKey,
				...(reopenSessionFile ? { reopenSessionFile } : {}),
				tools: [],
				limits: { maxConversations: 4, maxPrimaryAttempts: 32, maxAuxiliaryAttempts: 1 },
				profiles: [
					{
						id: "ticket-bot",
						model,
						systemPrompt:
							"Record ideas as tickets; continue the conversation once the ticket is saved. Never start work yourself. " +
							bot.instructions,
						tools: bot.tools,
					},
					{
						id: "ticket-worker",
						model,
						systemPrompt:
							"Handle the assigned ticket using ticket_get and ticket_report. Report what you actually found and reference the result. A generation finishing does not resolve the ticket. " +
							worker.instructions,
						tools: worker.tools,
					},
				],
			},
			extensions: [{ root: rsiExtensionRoot, facets: ["backend", "client", "webui"] }],
			extensionServices: async (context) => {
				botRef = context.runtime.view().conversations.find((ref) => ref.profile === "ticket-bot");
				if (!botRef) throw new Error("Original inbox Conversation is missing");
				const mas = await createMas({
					runtime: context.runtime,
					namespace: "rsi.team",
					maxDeliveries: 64,
					maxPending: 8,
				});
				if (!reopenSessionFile)
					await mas.bootstrap([
						{ key: "ticket-worker", owner: "operator", profile: "ticket-worker", lifetime: "persistent" },
					]);
				await mas.activate();
				workerRef = (await mas.view()).members.find((member) => member.key === "ticket-worker")?.ref;
				if (!workerRef) throw new Error("Original ticket worker is missing");
				const sender = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
				tickets = await createTicketService({
					runtime: context.runtime,
					namespace: "rsi.tickets",
					handlers: [{ id: "default", label: "Ticket worker", actorId: workerActor.id }],
					dispatcher: createMasTicketDispatcher({
						routes: [{ handlerId: "default", target: workerRef, client: sender }],
					}),
				});
				return { tickets: ticketExtensionService(context, tickets) };
			},
			transport: { port },
		});
		return {
			app,
			tickets,
			botRef,
			workerRef,
			async close() {
				bot.revoke();
				worker.revoke();
				await app.close();
			},
		};
	} catch (error) {
		bot.revoke();
		worker.revoke();
		await app?.close();
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const directory = resolve(process.env.PAKKA_RSI_DIR ?? "artifacts/rsi-workbench");
	const identityFile = join(directory, "session.json");
	let reopenSessionFile;
	try {
		const saved = JSON.parse(await readFile(identityFile, "utf8"));
		if (saved.schema !== 1 || typeof saved.sessionFile !== "string")
			throw Error("Invalid workbench identity");
		reopenSessionFile = saved.sessionFile;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const workbench = await startTicketWorkbench({
		directory,
		reopenSessionFile,
		endpoint: process.env.PAKKA_ENDPOINT ?? "http://127.0.0.1:45010/v1",
		model: process.env.PAKKA_MODEL ?? "local-ticket-model",
		apiKey: process.env.PAKKA_API_KEY ?? "local-only",
		port: Number(process.env.PAKKA_RSI_PORT ?? 0),
	});
	await writeFile(
		identityFile,
		JSON.stringify({ schema: 1, sessionFile: workbench.app.runtime.view().sessionFile }) + "\n",
	);
	const token = workbench.app.initialOwner?.token;
	console.log(workbench.app.http.origin + (token ? "/#signin=" + token : ""));
	console.log(
		"Tickets are ready. Agent execution uses the explicitly configured provider. Ctrl+C closes the workbench; records remain in its SQLite storage.",
	);
	let closing = false;
	const close = async () => {
		if (closing) return;
		closing = true;
		await workbench.close();
	};
	process.once("SIGINT", () => {
		void close().catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
	});
	process.once("SIGTERM", () => {
		void close().catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
	});
}
