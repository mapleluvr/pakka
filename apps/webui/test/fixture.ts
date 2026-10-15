import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople, createPocketWorkspace } from "@pakka/server/pocket";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { createPocketHttp } from "../src/http.ts";

export async function fixture() {
	const m = await runtimeFixture();
	const people = await createPocketPeople({ runtime: m.runtime, namespace: "people" });
	const session = await people.initializeOwner("Owner");
	const actor = await people.authenticate(session.token);
	const workspace = createPocketWorkspace({
		runtime: m.runtime,
		people,
		catalog: { namespace: "pocket", maxDeliveries: 32, maxPending: 8 },
		profileCeiling: () => ["default"],
	});
	const client = workspace.bind(actor),
		ref = await client.create({ requestId: "one", name: "Work", profile: "default" });
	const http = await createPocketHttp({ runtime: m.runtime, people, workspace, pollMs: 20 });
	async function exchange(token: string, kind: "session" | "invite", name?: string) {
		const response = await fetch(http.origin + "/pocket/exchange", {
			method: "POST",
			headers: { Origin: http.origin, "Content-Type": "application/json" },
			body: JSON.stringify({ kind, token, ...(name ? { name } : {}) }),
		});
		const cookies = response.headers
			.getSetCookie()
			.map((c) => c.split(";")[0]!)
			.join("; ");
		return { response, cookies, csrf: /pakka_csrf=([^;]+)/.exec(cookies)?.[1] ?? "" };
	}
	const admin = await exchange(session.token, "session");
	assert.equal(admin.response.status, 200);
	async function rpc(command: object, auth = admin) {
		const requestId = crypto.randomUUID();
		const response = await fetch(http.origin + "/pocket/rpc", {
			method: "POST",
			headers: {
				Origin: http.origin,
				Cookie: auth.cookies,
				"X-Pakka-CSRF": auth.csrf,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ version: 2, requestId, command }),
		});
		const decoded = decodePocketResponse(await response.json(), requestId);
		return { response, decoded };
	}
	const signedIn = await people.authenticate(/pakka_pocket=([^;]+)/.exec(admin.cookies)![1]!);
	return {
		...m,
		people,
		workspace,
		actor: signedIn,
		client: workspace.bind(signedIn),
		ref,
		http,
		admin,
		exchange,
		rpc,
		close: async () => {
			await http.close();
			await m.close();
		},
	};
}
