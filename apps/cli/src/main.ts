#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient, RemoteError } from "@pakka/client";
import type { ClientOptions } from "@pakka/client";
import { decodeRequest, MAX_WIRE_BYTES } from "@pakka/protocol";
import type { Command } from "@pakka/protocol";

async function readText(file: string): Promise<string> {
	const data = await readFile(file);
	if (data.byteLength > MAX_WIRE_BYTES) throw new Error("CLI input too large");
	return new TextDecoder("utf-8", { fatal: true }).decode(data);
}
function connection(value: unknown): ClientOptions {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!("endpoint" in value) ||
		typeof value.endpoint !== "string" ||
		!("token" in value) ||
		typeof value.token !== "string" ||
		Object.keys(value).some((key) => !["endpoint", "token", "timeoutMs"].includes(key)) ||
		("timeoutMs" in value && typeof value.timeoutMs !== "number")
	)
		throw new Error("Invalid connection config");
	return {
		endpoint: value.endpoint,
		token: value.token,
		...("timeoutMs" in value && typeof value.timeoutMs === "number" ? { timeoutMs: value.timeoutMs } : {}),
	};
}
/** Preserve the explicit protocol client; every other invocation belongs to the product launcher. */
export async function runCli(args: readonly string[]): Promise<number> {
	if (args[0] !== "--connection") {
		const { runLauncher } = await import("@pakka/webui/launcher");
		return runLauncher(args);
	}
	return runProtocolCli(args);
}

/** No bootstrap/MAS policy in protocol mode. */
async function runProtocolCli(args: readonly string[]): Promise<number> {
	try {
		if (args[0] !== "--connection" || !args[1] || !["hello", "snapshot", "call"].includes(args[2] ?? ""))
			throw new Error("Invalid arguments");
		const op = args[2];
		if (op === "call" ? args.length !== 5 || args[3] !== "--command" || !args[4] : args.length !== 3)
			throw new Error("Invalid arguments");
		const raw: unknown = JSON.parse(await readText(args[1]));
		const client = createClient(connection(raw));
		let command: Command;
		if (op === "call") {
			const input: unknown = JSON.parse(await readText(args[4]!));
			command = decodeRequest({ version: 1, requestId: "cli-validation", command: input }).command;
		} else command = { op: op === "hello" ? "hello" : "snapshot" };
		const result = await client.request(command);
		process.stdout.write(JSON.stringify(result) + "\n");
		return 0;
	} catch (error) {
		if (error instanceof RemoteError) {
			process.stderr.write(
				JSON.stringify({ code: error.code, outcome: error.outcome, requestId: error.requestId }) + "\n",
			);
			return error.outcome === "denied" ? 2 : 3;
		}
		process.stderr.write(
			"Usage: pakka --connection <explicit-client.json> hello|snapshot|call --command <command.json>\n",
		);
		return 1;
	}
}
const invokedFile = process.argv[1] ? await realpath(process.argv[1]).catch(() => undefined) : undefined;
if (invokedFile && pathToFileURL(invokedFile).href === import.meta.url)
	process.exitCode = await runCli(process.argv.slice(2));
