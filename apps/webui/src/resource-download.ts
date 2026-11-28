import type { ServerResponse } from "node:http";
import type { PocketAuthority, PocketPeople } from "@pakka/server/pocket";
import { decodeWebUiRequest, WEBUI_SERVICE_API } from "@pakka/protocol/webui";
import type { WebUiServices } from "./webui-services.ts";
import { WebUiServiceRefusal } from "./service-refusal.ts";
import { streamOriginalContent } from "./content-download.ts";

/** Same resource/content authority as RPC, streamed directly to the browser download sink. */
export async function streamResourceDownload(options: {
	readonly query: URLSearchParams;
	readonly actor: PocketAuthority;
	readonly people: PocketPeople;
	readonly serverId: string;
	readonly services: WebUiServices;
	readonly response: ServerResponse;
	readonly signal: AbortSignal;
}) {
	const { query, actor, people, serverId, services, response, signal } = options;
	const raw = query.get("request");
	if (query.size !== 1 || query.getAll("request").length !== 1 || !raw || raw.length > 8192)
		throw new WebUiServiceRefusal("INVALID_REQUEST");
	let parsed;
	try {
		parsed = decodeWebUiRequest(JSON.parse(raw));
	} catch {
		throw new WebUiServiceRefusal("INVALID_REQUEST");
	}
	const command = parsed.command;
	if (
		parsed.api !== WEBUI_SERVICE_API ||
		command.op !== "resource.content" ||
		command.range.offset !== 0 ||
		command.range.length !== 65536
	)
		throw new WebUiServiceRefusal("INVALID_REQUEST");
	const check = () => {
		signal.throwIfAborted();
		try {
			if (parsed.binding.serverId !== serverId || parsed.binding.personId !== people.current(actor).id)
				throw new WebUiServiceRefusal("FORBIDDEN");
			people.checkReadGrant(actor, command.reference);
		} catch {
			throw new WebUiServiceRefusal("FORBIDDEN");
		}
	};
	check();
	await streamOriginalContent({
		response,
		signal,
		reference: command.content,
		check,
		read: async (offset, current) => {
			current();
			const result = await services.execute(actor, { ...command, range: { offset, length: 65536 } }, signal);
			current();
			if (
				result.kind !== "resource-content" ||
				result.reference.sessionId !== command.reference.sessionId ||
				result.reference.conversationId !== command.reference.conversationId
			)
				throw new WebUiServiceRefusal("UNSUPPORTED");
			return result.chunk;
		},
	});
}
