import { strict as assert } from "node:assert";
import { decodePocketEvent } from "@pakka/protocol/pocket";

export async function stream(origin: string, id: string, cookie: string, cursor?: string) {
	const abort = new AbortController();
	const response = await fetch(origin + "/pocket/events?conversationId=" + encodeURIComponent(id), {
		headers: { Cookie: cookie, ...(cursor ? { "Last-Event-ID": cursor } : {}) },
		signal: abort.signal,
	});
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
	const reader = response.body!.getReader(),
		decoder = new TextDecoder("utf-8", { fatal: true });
	let buffered = "";
	return {
		close: () => abort.abort(),
		next: async () => {
			const timeout = setTimeout(() => abort.abort(), 3000);
			try {
				while (true) {
					const at = buffered.indexOf("\n\n");
					if (at >= 0) {
						const event = buffered.slice(0, at);
						buffered = buffered.slice(at + 2);
						const data = event.split("\n").find((line) => line.startsWith("data: "));
						if (data) return decodePocketEvent(JSON.parse(data.slice(6)) as unknown);
					}
					const chunk = await reader.read();
					if (chunk.done) return null;
					buffered += decoder.decode(chunk.value, { stream: true });
					assert.ok(buffered.length <= 2 * 1024 * 1024 + 1024);
				}
			} finally {
				clearTimeout(timeout);
			}
		},
	};
}
