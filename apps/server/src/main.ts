#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { MAX_WIRE_BYTES } from "@pakka/protocol";
import { bootstrapServer, decodeBootstrap } from "./bootstrap.ts";

export async function runServer(args: readonly string[]): Promise<number> {
	let app: Awaited<ReturnType<typeof bootstrapServer>> | undefined;
	try {
		if (
			args[0] !== "--config" ||
			!args[1] ||
			!(args.length === 2 || (args.length === 3 && args[2] === "--control-stdin"))
		)
			throw new Error("Explicit config required");
		const bytes = await readFile(args[1]);
		if (bytes.byteLength > MAX_WIRE_BYTES) throw new Error("Configuration too large");
		const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		app = await bootstrapServer(decodeBootstrap(value));
		process.stdout.write(
			JSON.stringify({ endpoint: app.server.endpoint, serverId: app.server.serverId }) + "\n",
		);
		await new Promise<void>((resolveStop) => {
			process.once("SIGINT", resolveStop);
			process.once("SIGTERM", resolveStop);
			// Trusted owner control is opt-in and local to this process pipe, not an RPC operation.
			if (args[2] === "--control-stdin") {
				let input = "";
				process.stdin.setEncoding("utf8");
				process.stdin.on("data", (chunk: string) => {
					input += chunk;
					if (input.length > 128 || input.includes("\n")) {
						if (input.trim() === "stop" || input.length > 128) resolveStop();
					}
				});
				process.stdin.once("end", resolveStop);
				process.stdin.resume();
			}
		});
		process.stdin.pause();
		await app.close();
		return 0;
	} catch {
		if (app) {
			try {
				await app.close();
			} catch {
				/* An unconfirmed close is not storage takeover permission. */
			}
		}
		process.stderr.write("Server startup/control unconfirmed; explicit configuration required.\n");
		return 1;
	}
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
	process.exitCode = await runServer(process.argv.slice(2));
