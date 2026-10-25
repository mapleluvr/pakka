import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import type { PocketServiceContext } from "../src/backend.ts";
import type { RuntimeOptions } from "@pakka/agent";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { decodePocketProduct } from "../src/main.ts";

async function setup(profiles?: RuntimeOptions["profiles"]) {
	const m = await runtimeFixture({
		profiles: profiles ?? [
			{
				id: "alternate-preset",
				model: "catalog-local-model",
				cwd: process.cwd(),
				systemPrompt: "ALTERNATE-AGENT-PRESET-MUST-NOT-BE-APPLIED",
			},
			{ id: "same-model-other-preset", model: "catalog-local-model", systemPrompt: "OTHER-PRESET" },
		],
	});
	await m.runtime.close();
	let context: PocketServiceContext | undefined;
	const options = {
		...decodePocketProduct({
			runtime: { ...m.config, dataDir: join(m.f.root, "catalog-product") },
			owner: "Owner",
			// Restrict full Agent presets, not the independently selected model.
			profiles: ["default"],
			initial: [{ name: "Project", profile: "default" }],
		}),
		extensionServices: (value: PocketServiceContext) => {
			context = value;
			return {};
		},
	};
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		app = await startPocket(options);
		assert.ok(context && app.initialOwner);
		const token = app.initialOwner.token;
		const actor = await context.people.authenticate(token);
		const client = context.workspace.bind(actor);
		const ref = (await client.list())[0]!;
		return {
			m,
			app,
			options,
			context,
			token,
			actor,
			client,
			ref,
			currentContext: () => context!,
			close: async () => {
				await app?.close();
				await m.close();
			},
		};
	} catch (error) {
		await app?.close();
		await m.close();
		throw error;
	}
}

// Reapplying the full-preset ceiling here would hide an otherwise configured model.
test("Model catalogue: unique configured models are visible without a second WebUI model allowlist or preset cwd metadata", async () => {
	const p = await setup();
	try {
		assert.deepEqual((await p.client.configuration(p.ref)).choices, [
			{ id: "default", model: "local-model" },
			{ id: "alternate-preset", model: "catalog-local-model" },
		]);
		assert.equal(p.m.f.requests.length, 0);
		assert.equal(p.app.runtime.view().budget.primaryAttempts, 0);
	} finally {
		await p.close();
	}
});

test("Model catalogue: the maximum JSON configuration publishes all 65 unique models through real authenticated HTTP", async () => {
	const p = await setup(
		Array.from({ length: 64 }, (_, index) => ({
			id: "model-" + index,
			model: "configured-model-" + index,
		})),
	);
	try {
		const origin = p.app.http.origin;
		const signedIn = await fetch(origin + "/pocket/exchange", {
			method: "POST",
			headers: { Origin: origin, "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "session", token: p.token }),
		});
		assert.equal(signedIn.status, 200);
		const cookies = signedIn.headers
			.getSetCookie()
			.map((cookie) => cookie.split(";")[0])
			.join("; ");
		const csrf = /pakka_csrf=([^;]+)/.exec(cookies)?.[1];
		assert.ok(csrf);
		const response = await fetch(origin + "/pocket/rpc", {
			method: "POST",
			headers: { Origin: origin, Cookie: cookies, "X-Pakka-CSRF": csrf, "Content-Type": "application/json" },
			body: JSON.stringify({
				version: 2,
				requestId: "catalog-capacity",
				command: { op: "configuration", target: p.ref },
			}),
		});
		const body = await response.json();
		assert.equal(response.status, 200, JSON.stringify(body));
		const decoded = decodePocketResponse(body, "catalog-capacity");
		assert.ok("result" in decoded && decoded.result.kind === "configuration", JSON.stringify(body));
		assert.equal(decoded.result.configuration.choices.length, 65);
		assert.equal(new Set(decoded.result.configuration.choices.map((choice) => choice.model)).size, 65);
		assert.ok(
			decoded.result.configuration.choices.every(
				(choice) => Object.keys(choice).sort().join(",") === "id,model",
			),
		);
		assert.equal(p.m.f.requests.length, 0);
	} finally {
		await p.close();
	}
});

// Selecting only a model must neither require nor apply the authority of its full Agent preset.
test("Model catalogue: model-only selection and inheritance reach the real provider and survive reopen without changing Agent presets", async () => {
	const p = await setup();
	let reopened: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		await assert.rejects(p.client.configure(p.ref, "alternate-preset"), /ceiling|denied/i);
		const changed = await p.client.configureAgent(p.ref, { model: "catalog-local-model" });
		assert.equal(changed.profile, "default");
		assert.notEqual(changed.incarnation, p.ref.incarnation);
		assert.deepEqual((await p.client.configuration(changed)).current, {
			model: "catalog-local-model",
			cwd: p.m.f.cwd,
		});
		const inherited = await p.client.create({
			requestId: "inherit-model",
			name: "Inherited Model",
			profile: "default",
			inherit: changed,
		});
		assert.equal(inherited.profile, "default");
		assert.deepEqual((await p.client.configuration(inherited)).current, {
			model: "catalog-local-model",
			cwd: p.m.f.cwd,
		});
		await assert.rejects(
			p.client.configureAgent(changed, { model: "not-configured-on-this-provider" }),
			/model|denied/i,
		);
		assert.equal(p.m.f.requests.length, 0);
		const receipt = await p.client.submit(changed, {
			requestId: "chosen-model",
			text: "USE-THE-SELECTED-MODEL",
			mode: "prompt",
		});
		assert.equal((await p.client.wait(receipt.id)).status, "done");
		assert.equal(p.m.f.requests.length, 1);
		assert.equal(p.m.f.requests[0]?.model, "catalog-local-model");
		assert.doesNotMatch(JSON.stringify(p.m.f.requests), /ALTERNATE-AGENT-PRESET-MUST-NOT-BE-APPLIED/);
		const sessionFile = p.app.runtime.view().sessionFile;
		await p.app.close();
		reopened = await startPocket({
			...p.options,
			runtime: { ...p.options.runtime, reopenSessionFile: sessionFile },
		});
		const context = p.currentContext();
		const restored = context.workspace.bind(await context.people.authenticate(p.token));
		assert.deepEqual((await restored.configuration(changed)).current, {
			model: "catalog-local-model",
			cwd: p.m.f.cwd,
		});
		assert.deepEqual((await restored.configuration(inherited)).current, {
			model: "catalog-local-model",
			cwd: p.m.f.cwd,
		});
		assert.equal(reopened.runtime.view().budget.primaryAttempts, 1);
		assert.equal((await restored.receipt(receipt.id)).status, "done");
		assert.equal(p.m.f.requests.length, 1);
	} finally {
		await reopened?.close();
		await p.close();
	}
});

// A driver was incorrectly offered configuration even though the real write path rejects manage.
test("Model catalogue: configuration hints agree with existing resource write authority", async () => {
	const p = await setup();
	try {
		assert.equal((await p.client.configuration(p.ref)).canConfigure, true);
		for (const role of ["viewer", "sender", "driver"] as const) {
			const invite = await p.context.people.invite(p.actor, {
				requestId: "invite-" + role,
				role,
				resources: [p.ref.conversationId],
				ttlMs: 60000,
			});
			const session = await p.context.people.redeem(invite.token!, role);
			const client = p.context.workspace.bind(await p.context.people.authenticate(session.token));
			assert.equal((await client.configuration(p.ref)).canConfigure, false, role);
			await assert.rejects(client.configureAgent(p.ref, { model: "local-model" }), /denied/i);
		}
		assert.equal(p.m.f.requests.length, 0);
	} finally {
		await p.close();
	}
});
