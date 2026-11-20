import assert from "node:assert/strict";
import { decodePocketResponse, type PocketCommand } from "@pakka/protocol/pocket";
import { decodeExtensionResponse, type ExtensionCommandEnvelope } from "@pakka/protocol/extension-rpc";

/** Actual public HTTP login and hello, also usable with a child executable that exposes no in-process objects. */
export async function loginHttpSession(origin: string, token: string) {
	const response = await fetch(origin + "/pakka-webui/exchange", {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "session", token }),
	});
	assert.equal(response.status, 200);
	const cookies = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0]!)
		.join("; ");
	return connectHttpSession(origin, cookies);
}

export async function connectHttpSession(origin: string, cookies: string) {
	const csrf = /pakka_csrf=([^;]+)/.exec(cookies)?.[1];
	assert.ok(csrf);
	const headers: Record<string, string> = {
		Origin: origin,
		"Content-Type": "application/json",
		Cookie: cookies,
		"X-Pakka-CSRF": csrf,
	};
	async function workbench(command: PocketCommand) {
		const requestId = crypto.randomUUID();
		const response = await fetch(origin + "/pakka-webui/rpc", {
			method: "POST",
			headers,
			body: JSON.stringify({ version: 2, requestId, command }),
		});
		return { response, decoded: decodePocketResponse(await response.json(), requestId) };
	}
	const hello = await workbench({ op: "hello" });
	assert.equal(hello.response.status, 200);
	assert.ok("result" in hello.decoded && hello.decoded.result.kind === "hello");
	headers["X-Pakka-Server"] = hello.decoded.serverId;
	headers["X-Pakka-Person"] = hello.decoded.result.person.id;
	return {
		cookies,
		headers,
		workbench,
		person: hello.decoded.result.person,
		async extensions(command: ExtensionCommandEnvelope) {
			const requestId = crypto.randomUUID();
			const response = await fetch(origin + "/pakka-webui/extensions/rpc", {
				method: "POST",
				headers,
				body: JSON.stringify({ version: 3, requestId, command }),
			});
			return { response, decoded: decodeExtensionResponse(await response.json(), requestId) };
		},
	};
}
