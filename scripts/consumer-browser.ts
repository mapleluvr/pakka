import { createClient, type ClientResult, type ClientOptions, RemoteError } from "@pakka/client";
import { decodeRequest, decodeResponse, type AgentRef, type Command } from "@pakka/protocol";
export function browserOnly(endpoint: string, token: string, ref: AgentRef) {
	const options: ClientOptions = { endpoint, token };
	const client = createClient(options);
	const command: Command = {
		op: "send",
		target: ref,
		input: { requestId: "browser-identity", text: "approved input" },
	};
	const response: Promise<ClientResult> = client.request(command, { signal: new AbortController().signal });
	const decoded = decodeRequest({ version: 1, requestId: "rpc", command });
	// @ts-expect-error Remote callers cannot declare another caller/source/principal.
	client.request({ ...command, principal: "forged" });
	// @ts-expect-error No model credential or mutable host config in browser client options.
	createClient({ ...options, apiKey: "forged" });
	return { response, decoded, decodeResponse, RemoteError, fresh: client.reconnect() };
}
