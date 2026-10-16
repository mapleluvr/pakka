import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import type { Runtime } from "@pakka/agent";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace, type PocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketHooks } from "../src/pocket-hooks.ts";

export const hookNamespace = "tested.webhooks";
export async function hooksFixture(
	wrap: (workspace: PocketWorkspace) => PocketWorkspace = (workspace) => workspace,
	runtimeForHooks: (runtime: Runtime) => Runtime = (runtime) => runtime,
) {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "hooks.people" }),
			session = await people.initializeOwner("Owner"),
			owner = await people.authenticate(session.token);
		const workspace = wrap(
			createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog: { namespace: "hooks.workspace", maxDeliveries: 64, maxPending: 8 },
				profileCeiling: () => ["default"],
			}),
		);
		const target = await workspace
				.bind(owner)
				.create({ requestId: "project", name: "Project", profile: "default" }),
			hidden = await workspace
				.bind(owner)
				.create({ requestId: "hidden", name: "Hidden", profile: "default" });
		const invited = await people.invite(owner, {
			requestId: "driver",
			role: "driver",
			resources: [target.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invited.token);
		const driverSession = await people.redeem(invited.token, "Driver"),
			driver = await people.authenticate(driverSession.token);
		const hooks = await createPocketHooks({
			runtime: runtimeForHooks(m.runtime),
			people,
			workspace,
			namespace: hookNamespace,
			githubWriters: ["approved-writer"],
		});
		return {
			m,
			people,
			owner,
			ownerToken: session.token,
			workspace,
			target,
			hidden,
			driver,
			driverSession,
			hooks,
		};
	} catch (error) {
		await m.close();
		throw error;
	}
}
export function signedBody(
	secret: string,
	body: Uint8Array,
	delivery = "github-delivery-one",
	event = "push",
) {
	return {
		"content-type": "application/json",
		"x-github-event": event,
		"x-github-delivery": delivery,
		"x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
	};
}
