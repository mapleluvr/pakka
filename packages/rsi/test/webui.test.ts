import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { startPocket } from "../../../apps/webui/src/bootstrap.ts";
import { ownedBrowser } from "../../../apps/webui/test/browser.ts";
import { openConversations, settleFrontend } from "../../../apps/webui/test/frontend-controls.ts";
import { createTicketService, type NativeTicketService } from "@pakka/rsi";
import { createMasTicketDispatcher } from "@pakka/rsi/mas";
import { createMas } from "@pakka/mas";
import { readTicketResult, TicketCallError } from "@pakka/rsi/client";
import type { ExtensionJson } from "@pakka/webui/extension";

async function backend(): Promise<typeof import("../src/backend.ts")> {
	const module = await import(new URL("../src/backend.ts", import.meta.url).href).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
			return {};
		},
	);
	assert.equal(typeof module.ticketExtensionService, "function", "Ticket public Backend service is missing");
	return module;
}

test(
	"tickets UI: lost submission response is reconciled without duplicates; edits and reports reopen on desktop and mobile",
	{ timeout: 45000 },
	async () => {
		const module = await backend(),
			m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined,
			service!: NativeTicketService;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "product") },
				owner: "Owner",
				initial: [],
				extensions: [
					{
						root: fileURLToPath(new URL("../dist/", import.meta.url)),
						facets: ["backend", "client", "webui"],
					},
				],
				extensionServices: async (context) => {
					service = await createTicketService({ runtime: context.runtime, namespace: "tickets" });
					return { tickets: module.ticketExtensionService(context, service) };
				},
			});
			const ownerAuthority = await app.people.authenticate(app.initialOwner!.token);
			const mobileInvite = await app.people.invite(ownerAuthority, {
				requestId: "mobile-admin",
				role: "admin",
				resources: "*",
				ttlMs: 60000,
			});
			const mobileSession = await app.people.redeem(mobileInvite.token!, "Mobile owner");
			browser = await ownedBrowser(join(m.f.root, "ticket-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner!.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-interface=rsi-tickets]")');
			await page.click("[data-interface=rsi-tickets]");
			await page.wait('document.querySelector("[data-ticket-new]")');
			await page.click("[data-ticket-new]");
			await page.wait('document.querySelector("[name=ticket-title]")');
			await page.type("[name=ticket-title]", "Lightweight collaboration filesystem");
			await page.type("[name=ticket-body]", "Compare costs using real agent workspaces.");
			await page.evaluate(`(() => {
			const realFetch = window.fetch.bind(window); let dropped = false;
			window.fetch = async (url, options) => {
				let request; try { request = JSON.parse(options?.body || "null"); } catch { request = null; }
				const response = await realFetch(url, options);
				if (!dropped && request?.command?.call?.action === "submit") {
					await response.clone().text(); dropped = true; throw new TypeError("Owned test dropped the committed response");
				}
				return response;
			};
		})()`);
			await page.click("[data-ticket-save]");
			await page.wait(
				'document.querySelector(".rsi-pending button") && !document.querySelector(".rsi-pending button").disabled',
			);
			const manager = service.connect({ id: "test-manager", role: () => "manager", check() {} });
			assert.equal((await manager.list()).items.length, 1);
			await page.click(".rsi-pending button");
			await page.wait(
				'document.querySelector("[data-ticket-detail]")?.textContent.includes("Compare costs")',
			);
			assert.equal((await manager.list()).items.length, 1, "reconciliation did not submit another ticket");
			const first = (await manager.list()).items[0]!;
			assert.equal(first.title, "Lightweight collaboration filesystem");
			assert.equal(m.f.requests.length, 0);
			await page.click("[data-ticket-edit]");
			await page.wait('document.querySelector("[name=ticket-title]")');
			await page.evaluate(
				'(()=>{const node=document.querySelector("[name=ticket-body]");node.value="";node.dispatchEvent(new Event("input",{bubbles:true}));})()',
			);
			await page.type("[name=ticket-body]", "Retain concurrent-write evidence.");
			await page.click("[data-ticket-save]");
			await page.wait(
				'document.querySelector("[data-ticket-detail]")?.textContent.includes("Retain concurrent-write evidence")',
			);
			await page.type("[name=ticket-report]", "An existing tool is sufficient.");
			await page.evaluate(
				'(()=>{const n=document.querySelector("[name=ticket-state]");n.value="closed";n.dispatchEvent(new Event("change",{bubbles:true}));})()',
			);
			await page.click("[data-ticket-report]");
			await page.wait('document.querySelector("[data-ticket-state=closed]")');
			const saved = await manager.get(first.id);
			assert.equal(saved.ticket.revisions.length, 2);
			assert.equal(saved.ticket.state, "closed");
			let revision = saved.ticket.version;
			for (let i = 0; i < 45; i++)
				revision = (
					await manager.edit({
						requestId: `history-${i}`,
						id: first.id,
						expectedVersion: revision,
						title: `Historical ${i}`,
						body: `BODY-${i}`,
						sources: [],
					})
				).version;
			await page.click(`[data-ticket-row="${first.id}"]`);
			await page.wait('document.querySelector("[data-ticket-history=revisions]")');
			await page.evaluate('document.querySelector("details.rsi-section").open = true');
			assert.equal(await page.evaluate('document.querySelectorAll(".rsi-revision").length'), 32);
			await page.click('[data-ticket-history="revisions"]');
			await page.wait('document.querySelector(".rsi-revision h4")?.textContent.startsWith("Revision 15")');
			assert.equal(await page.evaluate('document.querySelectorAll(".rsi-revision").length'), 15);
			assert.equal(
				await page.evaluate('document.querySelector("[data-ticket-detail] > h2").textContent'),
				"Historical 44",
			);
			const last = await manager.get(first.id);
			await manager.edit({
				requestId: "restore-body",
				id: first.id,
				expectedVersion: last.ticket.version,
				title: "Lightweight collaboration filesystem",
				body: "Retain concurrent-write evidence.",
				sources: [],
			});
			const artifacts = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "ticket-ui");
			await mkdir(artifacts, { recursive: true });
			await writeFile(join(artifacts, "desktop.png"), await page.screenshot());
			const mobile = await browser.page(app.http.origin + "/#signin=" + mobileSession.token, {
				width: 390,
				height: 650,
			});
			await mobile.wait('document.querySelector("[data-action=signin]")');
			await mobile.click("[data-action=signin]");
			await mobile.wait('document.querySelector("[data-interface=rsi-tickets]")');
			await openConversations(mobile);
			await mobile.click("[data-interface=rsi-tickets]");
			await mobile.wait('document.querySelector("[data-ticket-row]")');
			await settleFrontend(mobile);
			await mobile.click("[data-ticket-row]");
			await mobile.wait('document.querySelector("[data-ticket-detail]")');
			assert.equal(
				await mobile.evaluate(
					'document.querySelector("[data-ticket-detail]").textContent.includes("Retain concurrent-write evidence")',
				),
				true,
			);
			assert.equal(
				await mobile.evaluate(
					'(()=>{const n=document.querySelector("[data-rsi-tickets]");return n.scrollWidth<=n.clientWidth+1;})()',
				),
				true,
			);
			await writeFile(join(artifacts, "mobile.png"), await mobile.screenshot());
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);

test("tickets Backend: refreshing a native run remains readable for a ticket with large progress history", async () => {
	const module = await backend(),
		m = await runtimeFixture();
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined, service!: NativeTicketService;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "product") },
			owner: "Owner",
			initial: [],
			extensions: [
				{ root: fileURLToPath(new URL("../dist/", import.meta.url)), facets: ["backend", "client", "webui"] },
			],
			extensionServices: async (context) => {
				const mas = await createMas({
					runtime: context.runtime,
					namespace: "mas",
					maxDeliveries: 8,
					maxPending: 2,
				});
				await mas.bootstrap([{ key: "worker", owner: "operator" }]);
				await mas.activate();
				const target = (await mas.view()).members[0]!.ref;
				const client = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
				service = await createTicketService({
					runtime: context.runtime,
					namespace: "tickets",
					handlers: [{ id: "worker", label: "Worker", actorId: "worker" }],
					dispatcher: createMasTicketDispatcher({ routes: [{ handlerId: "worker", target, client }] }),
				});
				return { tickets: module.ticketExtensionService(context, service) };
			},
		});
		const manager = service.connect({ id: "manager", role: () => "manager", check() {} });
		const created = await manager.submit({
			requestId: "create",
			title: "Long evidence",
			body: "Read workload",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "assign",
			id: created.id,
			expectedVersion: 1,
			handlerId: "worker",
		});
		const dispatched = await manager.dispatch({
			requestId: "dispatch",
			id: created.id,
			expectedVersion: assigned.version,
		});
		await app.runtime.waitForIdle();
		const ticket = (await manager.get(created.id)).ticket;
		await manager.report({
			requestId: "large-report",
			id: created.id,
			expectedVersion: ticket.version,
			state: "active",
			text: "据".repeat(12000),
			links: [],
		});
		const owner = await app.people.authenticate(app.initialOwner!.token),
			registration = app.extensions.list(owner).find((row) => row.manifest.id === "rsi")!;
		const result = await app.extensions.call(owner, {
			extension: "rsi",
			generation: registration.generation,
			action: "refresh",
			requestId: "refresh-run",
			input: { id: created.id, runId: dispatched.runId },
		});
		assert.equal(
			result.state,
			"done",
			"large progress history must remain transport-readable after a native observation",
		);
		assert.equal(readTicketResult("refresh", result.value).ticket.runs[0]!.state, "done");
		assert.equal((await manager.get(created.id)).ticket.state, "active");
		assert.equal(m.f.requests.length, 1);
	} finally {
		await app?.close();
		await m.close();
	}
});

test("tickets Backend: current people roles filter records, reject foreign edits and revoke held bindings", async () => {
	const module = await backend(),
		m = await runtimeFixture();
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined, service!: NativeTicketService;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "product") },
			owner: "Owner",
			initial: [],
			extensions: [
				{ root: fileURLToPath(new URL("../dist/", import.meta.url)), facets: ["backend", "client", "webui"] },
			],
			extensionServices: async (context) => {
				service = await createTicketService({ runtime: context.runtime, namespace: "tickets" });
				return { tickets: module.ticketExtensionService(context, service) };
			},
		});
		const owner = await app.people.authenticate(app.initialOwner!.token);
		const invitation = await app.people.invite(owner, {
			requestId: "invite",
			role: "sender",
			resources: "*",
			ttlMs: 60000,
		});
		const session = await app.people.redeem(invitation.token!, "Other author"),
			other = await app.people.authenticate(session.token);
		const registration = app.extensions.list(owner).find((r) => r.manifest.id === "rsi")!;
		const call = (actor: typeof owner, action: string, requestId: string, input: ExtensionJson) =>
			app!.extensions.call(actor, {
				extension: "rsi",
				generation: registration.generation,
				action,
				requestId,
				input,
			});
		const first = await call(owner, "submit", "owner-submit", {
			title: "Private canary",
			body: "OWNER-PRIVATE-CONTENT",
			sources: [],
		});
		assert.equal(first.state, "done");
		const ticketId = readTicketResult("submit", first.value).id;
		const list = await call(other, "list", "other-list", {});
		assert.equal(JSON.stringify(list).includes("OWNER-PRIVATE-CONTENT"), false);
		assert.equal(readTicketResult("list", list.value).items.length, 0);
		const denied = await call(other, "edit", "steal", {
			id: ticketId,
			expectedVersion: 1,
			title: "Changed",
			body: "Changed",
			sources: [],
		});
		assert.throws(
			() => readTicketResult("edit", denied.value),
			(error) => error instanceof TicketCallError && error.status === "denied",
		);
		const own = await call(other, "submit", "own", { title: "Mine", body: "OTHER-CONTENT", sources: [] });
		assert.equal(readTicketResult("submit", own.value).state, "open");
		assert.equal(
			(await service.connect({ id: "reader", role: () => "manager", check() {} }).list()).items.length,
			2,
		);
		await app.people.revokePerson(owner, session.person.id);
		await assert.rejects(call(other, "list", "revoked", {}));
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.close();
	}
});
