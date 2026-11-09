import type { ServerResponse } from "node:http";
import type { PocketWorkspaceClient } from "@pakka/server/pocket";
import type { AgentRef, PocketContentReference } from "@pakka/protocol/pocket";

/** Read-only streamed original delivery; no whole-body Buffer/Blob, no task progress API. */
export async function streamOriginalContent(options: {
	readonly response: ServerResponse;
	readonly signal: AbortSignal;
	readonly client: PocketWorkspaceClient;
	readonly target: AgentRef;
	readonly reference: PocketContentReference;
	readonly check: () => void;
}): Promise<void> {
	const { response: res, signal, client, target, reference } = options;
	const check = () => {
		if (signal.aborted || res.destroyed || res.writableEnded) throw new Error("Original download ended");
		options.check();
	};
	const read = (offset: number) => client.readContent(target, reference, { offset, length: 65536 }, check);
	// Acquire the first exact authorized range before publishing attachment/200 headers.
	let chunk = await read(0);
	check();
	const suffix = reference.encoding === "json" ? "json" : reference.encoding === "base64" ? "bin" : "txt";
	res.writeHead(200, {
		"Content-Type":
			reference.encoding === "base64"
				? "application/octet-stream"
				: reference.encoding === "json"
					? "application/json; charset=utf-8"
					: "text/plain; charset=utf-8",
		"Content-Disposition": `attachment; filename="original-${reference.entryId ?? "live"}.${suffix}"`,
	});
	let carry = "";
	try {
		for (;;) {
			check();
			let bytes: Buffer;
			if (reference.encoding === "base64") {
				if (!/^[A-Za-z0-9+/=]*$/.test(chunk.text)) throw new Error("Invalid original image encoding");
				const text = carry + chunk.text;
				const count = chunk.complete ? text.length : text.length - (text.length % 4);
				if (
					chunk.complete &&
					(text.length % 4 !== 0 ||
						!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))
				)
					throw new Error("Incomplete original image encoding");
				bytes = Buffer.from(text.slice(0, count), "base64");
				carry = text.slice(count);
			} else bytes = Buffer.from(chunk.text, "utf8");
			if (!res.write(bytes))
				await new Promise<void>((resolve, reject) => {
					const finish = (error?: Error) => {
						clearTimeout(timer);
						res.off("drain", drained);
						signal.removeEventListener("abort", aborted);
						error ? reject(error) : resolve();
					};
					const drained = () => finish(),
						aborted = () => finish(new Error("Original download ended"));
					const timer = setTimeout(() => finish(new Error("Slow original download ended")), 5000);
					res.once("drain", drained);
					signal.addEventListener("abort", aborted, { once: true });
					if (signal.aborted || res.destroyed) aborted();
				});
			check();
			if (chunk.complete) break;
			chunk = await read(chunk.nextOffset);
		}
		res.end();
	} catch (error) {
		// A failed/revoked/incomplete stream is not a successful truncated original file.
		res.destroy();
		throw error;
	}
}
