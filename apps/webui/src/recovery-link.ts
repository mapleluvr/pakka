import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Runtime } from "@pakka/agent";
import { readPrivateJson, writePrivateJson, replacePrivateJson } from "./private-files.ts";
interface RecoveryCredential {
	schema: 1;
	recoveryId: string;
	sessionId: string;
	ownerId: string;
	token: string;
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid private recovery file");
	return value as Record<string, unknown>;
}
export async function readRecoveryCredential(path: string, sessionId: string): Promise<RecoveryCredential> {
	const row = object(await readPrivateJson(path));
	if (
		row.schema !== 1 ||
		row.sessionId !== sessionId ||
		typeof row.recoveryId !== "string" ||
		!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(row.recoveryId) ||
		typeof row.ownerId !== "string" ||
		typeof row.token !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(row.token)
	)
		throw new Error("Private recovery credential does not belong to the original Session");
	return { schema: 1, recoveryId: row.recoveryId, sessionId, ownerId: row.ownerId, token: row.token };
}
/** A private browser link is prepared for the actual listening origin, never printed or saved in Session history. */
export async function prepareRecoveryLink(runtime: Runtime, origin: string, file: string) {
	const sessionId = runtime.view().sessionId,
		credential = await readRecoveryCredential(file, sessionId);
	const receipt = (
		await runtime.store({ namespace: "pocket.recovery." + credential.recoveryId, maxBytes: 4096 }).snapshot()
	).data;
	const bootstrap = (await runtime.store({ namespace: "pocket.bootstrap", maxBytes: 65536 }).snapshot()).data;
	if (
		receipt.schema !== 1 ||
		receipt.sessionId !== sessionId ||
		receipt.ownerId !== credential.ownerId ||
		bootstrap.ownerId !== credential.ownerId ||
		receipt.tokenHash !== createHash("sha256").update(credential.token).digest("hex") ||
		typeof receipt.expiresAt !== "number" ||
		receipt.expiresAt <= Date.now()
	)
		throw new Error("Original recovery issuance is unavailable or expired");
	const url = origin + "/#signin=" + credential.token,
		path = join(dirname(file), "browser-link.json"),
		value = { schema: 1, sessionId, recoveryId: credential.recoveryId, url };
	let exists = false;
	try {
		await lstat(path);
		exists = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (exists) {
		const previous = object(await readPrivateJson(path));
		if (previous.sessionId !== sessionId || previous.recoveryId !== credential.recoveryId)
			throw new Error("Private browser delivery identity conflict");
		await replacePrivateJson(path, value);
	} else await writePrivateJson(path, value);
	return { url, file: path };
}
