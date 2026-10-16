import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { PNG } from "pngjs";
import { createRuntime, type Runtime } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketBrowser } from "../src/pocket-browser.ts";

async function setup() {
	let actions = 0,
		forbidden = 0;
	const outsidePaths: string[] = [];
	const outside = createServer((request, response) => {
		outsidePaths.push(request.url ?? "");
		forbidden++;
		response.end("FORBIDDEN-ORIGIN");
	});
	await new Promise<void>((resolve) => outside.listen(0, "127.0.0.1", resolve));
	const outer = outside.address();
	assert.ok(outer && typeof outer !== "string");
	const outsideOrigin = "http://127.0.0.1:" + outer.port;
	const page = createServer((request, response) => {
		if (request.url === "/effect") {
			actions++;
			response.end("ACTION-RECORDED");
			return;
		}
		if (request.url === "/redirect") {
			response.writeHead(302, { location: outsideOrigin + "/redirect-target" });
			response.end();
			return;
		}
		response.setHeader("content-type", "text/html; charset=utf-8");
		response.end(
			`<!doctype html><html><title>Owned browser fixture</title><body><h1>APPROVED-PAGE</h1><input id="text"><button id="record" onclick="fetch('/effect').then(()=>document.querySelector('#result').textContent='REAL-ACTION:'+document.querySelector('#text').value)">Record action</button><output id="result"></output><button id="escape" onclick="location.href='${outsideOrigin}/escape'">Unapproved navigation</button><button id="popup" onclick="window.open('${outsideOrigin}/popup')">Popup</button><img src="${outsideOrigin}/unapproved-resource"></body></html>`,
		);
	});
	await new Promise<void>((resolve) => page.listen(0, "127.0.0.1", resolve));
	const address = page.address();
	assert.ok(address && typeof address !== "string");
	const origin = "http://127.0.0.1:" + address.port;
	const m = await runtimeFixture();
	let browser: Awaited<ReturnType<typeof createPocketBrowser>> | undefined;
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "owned.people" }),
			ownerSession = await people.initializeOwner("Owner"),
			owner = await people.authenticate(ownerSession.token),
			workspace = createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog: { namespace: "owned.workspace", maxDeliveries: 4, maxPending: 1 },
				profileCeiling: () => ["default"],
			}),
			ref = await workspace
				.bind(owner)
				.create({ requestId: "browser", name: "Owned browser", profile: "default" }),
			hidden = await workspace
				.bind(owner)
				.create({ requestId: "private", name: "Private", profile: "default" });
		const resources = [ref.conversationId];
		browser = await createPocketBrowser({
			runtime: m.runtime,
			people,
			namespace: "owned.browser",
			executable: "C:/Program Files/Google/Chrome/Application/chrome.exe",
			origins: [origin],
			resources,
		});
		const invite = await people.invite(owner, {
			requestId: "view",
			role: "viewer",
			resources: [ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const session = await people.redeem(invite.token, "Viewer"),
			viewer = await people.authenticate(session.token);
		return {
			m,
			people,
			ownerSession,
			resources,
			owner,
			viewer,
			ref,
			hidden,
			browser,
			origin,
			outsideOrigin,
			actions: () => actions,
			forbiddenPaths: () => [...outsidePaths],
			forbidden: () => forbidden,
			close: async () => {
				await browser?.close();
				await m.close();
				page.closeAllConnections();
				outside.closeAllConnections();
				await Promise.all([
					new Promise<void>((resolve) => page.close(() => resolve())),
					new Promise<void>((resolve) => outside.close(() => resolve())),
				]);
			},
		};
	} catch (error) {
		await browser?.close();
		await m.close();
		page.closeAllConnections();
		outside.closeAllConnections();
		page.close();
		outside.close();
		throw error;
	}
}

test("Pocket owned browser: approved resource configuration is detached from later caller mutation", async () => {
	const f = await setup();
	try {
		f.resources.push(f.hidden.conversationId);
		await assert.rejects(f.browser.bind(f.owner).snapshot(f.hidden), /denied/);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.close();
	}
});
for (const unconfirmed of [false, true])
	test(
		`Pocket owned browser: ${unconfirmed ? "restored running intent" : "completed click"} survives writer reopen without another page effect`,
		{ timeout: 20000 },
		async () => {
			const f = await setup();
			let runtime: Runtime | undefined, reopened: Awaited<ReturnType<typeof createPocketBrowser>> | undefined;
			try {
				const client = f.browser.bind(f.owner);
				await client.navigate(f.ref, { requestId: "original-navigation", url: f.origin });
				await client.click(f.ref, { requestId: "original-click", selector: "#record" });
				assert.equal(f.actions(), 1);
				await f.browser.close();
				if (unconfirmed) {
					const store = f.m.runtime.store({ namespace: "owned.browser", maxBytes: 262144 }),
						snapshot = await store.snapshot();
					assert.ok(Array.isArray(snapshot.data.rows));
					const rows = snapshot.data.rows.map((row) => {
						assert.ok(row && typeof row === "object" && !Array.isArray(row));
						return { ...row, ...(row.requestId === "original-click" ? { state: "running" } : {}) };
					});
					await store.compareAndSet(snapshot.version, { ...snapshot.data, rows }, () => {});
				}
				const file = f.m.runtime.view().sessionFile;
				await f.m.runtime.close();
				runtime = await createRuntime({ ...f.m.config, reopenSessionFile: file });
				const people = await createPocketPeople({ runtime, namespace: "owned.people" }),
					actor = await people.authenticate(f.ownerSession.token);
				reopened = await createPocketBrowser({
					runtime,
					people,
					namespace: "owned.browser",
					executable: "C:/Program Files/Google/Chrome/Application/chrome.exe",
					origins: [f.origin],
					resources: [f.ref.conversationId],
				});
				const bound = reopened.bind(actor);
				assert.equal((await bound.snapshot(f.ref)).open, false);
				assert.equal(
					(await bound.click(f.ref, { requestId: "original-click", selector: "#record" })).state,
					unconfirmed ? "unknown" : "done",
				);
				assert.equal(f.actions(), 1);
				assert.equal((await bound.snapshot(f.ref)).open, false);
				assert.equal(f.m.f.requests.length, 0);
			} finally {
				await reopened?.close();
				await runtime?.close();
				await f.close();
			}
		},
	);

test(
	"Pocket owned browser: real isolated page controls, actual screenshot decode and viewer/resource checks",
	{ timeout: 20000 },
	async (t) => {
		const f = await setup();
		try {
			const client = f.browser.bind(f.owner),
				viewer = f.browser.bind(f.viewer);
			assert.equal((await client.snapshot(f.ref)).open, false);
			await assert.rejects(
				async () => viewer.navigate(f.ref, { requestId: "viewer-nav", url: f.origin }),
				/denied/i,
			);
			await assert.rejects(client.snapshot(f.hidden), /denied/i);
			assert.equal((await client.navigate(f.ref, { requestId: "open", url: f.origin })).state, "done");
			await t.waitFor(async () => assert.match((await client.snapshot(f.ref)).text, /APPROVED-PAGE/));
			assert.equal(
				(await client.fill(f.ref, { requestId: "text", selector: "#text", text: "HUMAN-INPUT" })).state,
				"done",
			);
			assert.equal((await client.click(f.ref, { requestId: "record", selector: "#record" })).state, "done");
			await t.waitFor(() => assert.equal(f.actions(), 1));
			await t.waitFor(async () =>
				assert.match((await viewer.snapshot(f.ref)).text, /REAL-ACTION:HUMAN-INPUT/),
			);
			const frame = await viewer.frame(f.ref),
				decoded = PNG.sync.read(Buffer.from(frame.base64, "base64"));
			assert.equal(frame.type, "image/png");
			assert.ok(decoded.width > 0 && decoded.height > 0);
			assert.equal(f.forbidden(), 0);
			assert.equal((await client.click(f.ref, { requestId: "record", selector: "#record" })).state, "done");
			assert.equal(f.actions(), 1, "same action identity is never replayed");
			const snapshot = await viewer.snapshot(f.ref);
			assert.doesNotMatch(JSON.stringify(snapshot), /devtools|websocket|user-data-dir|AppData|local-only/i);
			assert.equal(f.m.f.requests.length, 0);
		} finally {
			await f.close();
		}
	},
);

test(
	"Pocket owned browser: disallowed direct navigation redirects subresources and popup never reach another origin",
	{ timeout: 20000 },
	async (t) => {
		const f = await setup();
		try {
			const client = f.browser.bind(f.owner);
			await assert.rejects(client.navigate(f.ref, { requestId: "outside", url: f.outsideOrigin }), /denied/i);
			await client.navigate(f.ref, { requestId: "first", url: f.origin });
			await t.waitFor(async () => assert.match((await client.snapshot(f.ref)).text, /APPROVED-PAGE/));
			await client.click(f.ref, { requestId: "popup", selector: "#popup" });
			await client.click(f.ref, { requestId: "leave", selector: "#escape" });
			await client.navigate(f.ref, { requestId: "redirect", url: f.origin + "/redirect" });
			assert.equal(f.forbidden(), 0, "origin filtering: " + JSON.stringify(f.forbiddenPaths()));
			assert.equal(f.actions(), 0);
			assert.equal(f.m.f.requests.length, 0);
		} finally {
			await f.close();
		}
	},
);

test(
	"Pocket owned browser: invalidated interfaces and service shutdown seal old clients",
	{ timeout: 20000 },
	async (t) => {
		const f = await setup();
		try {
			let enabled = true;
			const client = f.browser.bind(f.owner, () => {
				if (!enabled) throw Error("Browser interface ended");
			});
			await client.navigate(f.ref, { requestId: "page", url: f.origin });
			await t.waitFor(async () => assert.match((await client.snapshot(f.ref)).text, /APPROVED-PAGE/));
			enabled = false;
			await assert.rejects(
				async () => client.click(f.ref, { requestId: "old-callback", selector: "#record" }),
				/ended/i,
			);
			assert.equal(f.actions(), 0);
			await f.browser.close();
			await assert.rejects(f.browser.bind(f.owner).snapshot(f.ref), /closed|unavailable/i);
			assert.equal(f.forbidden(), 0);
		} finally {
			await f.close();
		}
	},
);
