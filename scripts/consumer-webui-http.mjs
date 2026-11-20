import assert from "node:assert/strict";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { decodeExtensionResponse } from "@pakka/protocol/extension-rpc";
import { WEBUI_SERVICE_API, decodeWebUiResponse } from "@pakka/protocol/webui";

/** Installed consumers use the same exchange, identity headers and closed decoders as the WebUI. */
export async function loginHttp(origin, token, kind = "session", name = undefined) {
	const response = await fetch(origin + "/pakka-webui/exchange", {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: JSON.stringify({ kind, token, ...(name ? { name } : {}) }),
	});
	assert.equal(response.status, 200, "Installed login exchange");
	const cookies = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	return connectHttp(origin, cookies);
}

export async function connectHttp(origin, cookies) {
	const csrf = /pakka_csrf=([^;]+)/.exec(cookies)?.[1];
	assert.ok(csrf);
	const headers = {
		Origin: origin,
		"Content-Type": "application/json",
		Cookie: cookies,
		"X-Pakka-CSRF": csrf,
	};
	let binding;
	async function request(path, envelope, decode) {
		const requestId = crypto.randomUUID();
		const response = await fetch(origin + path, {
			method: "POST",
			headers,
			body: JSON.stringify({ ...envelope, requestId }),
		});
		const decoded = decode(await response.json(), requestId);
		if (!("result" in decoded)) {
			throw Object.assign(new Error(`Installed HTTP refusal: ${decoded.error.code}`), decoded.error);
		}
		assert.equal(response.status, 200);
		return { result: decoded.result, serverId: decoded.serverId };
	}
	const rpc = async (command) =>
		(await request("/pakka-webui/rpc", { version: 2, command }, decodePocketResponse)).result;
	const hello = await request(
		"/pakka-webui/rpc",
		{ version: 2, command: { op: "hello" } },
		decodePocketResponse,
	);
	assert.equal(hello.result.kind, "hello");
	binding = { personId: hello.result.person.id, serverId: hello.serverId };
	headers["X-Pakka-Person"] = binding.personId;
	headers["X-Pakka-Server"] = binding.serverId;
	const extensions = async (command) =>
		(await request("/pakka-webui/extensions/rpc", { version: 3, command }, decodeExtensionResponse)).result;
	return {
		origin,
		cookies,
		headers,
		person: hello.result.person,
		rpc,
		extensions,
		services: async (command) =>
			(
				await request(
					"/pakka-webui/services",
					{ api: WEBUI_SERVICE_API, binding, command },
					decodeWebUiResponse,
				)
			).result,
		async call(extension, action, input = {}, target = undefined, requestId = crypto.randomUUID()) {
			const listed = await extensions({ op: "list", ...(target ? { target } : {}) });
			const row = listed.registrations.find(
				(entry) => entry.manifest.id === extension && entry.facet === "backend",
			);
			assert.ok(row, `Installed Backend ${extension}`);
			return (
				await extensions({
					op: "call",
					call: {
						extension,
						action,
						input,
						requestId,
						generation: row.generation,
						...(target ? { target } : {}),
					},
				})
			).operation;
		},
		async operationByRequest(extension, requestId, target = undefined) {
			return (
				await extensions({
					op: "operationByRequest",
					request: { extension, requestId, ...(target ? { target } : {}) },
				})
			).operation;
		},
	};
}
