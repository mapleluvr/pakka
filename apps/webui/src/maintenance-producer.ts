import { readFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export interface BackupProducer {
	maintenanceProtocol: 1;
	node: string;
	webuiVersion: string;
	agentVersion: string;
	webuiEntrySha256: string;
	agentEntrySha256: string;
	durableDependency: string;
	releaseId: string | null;
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid installed package identity");
	return value as Record<string, unknown>;
}
async function metadata(url: URL) {
	const file = fileURLToPath(url);
	if ((await lstat(file)).size > 131072) throw new Error("Installed package metadata exceeds budget");
	return object(JSON.parse(await readFile(file, "utf8")));
}
export function decodeBackupProducer(value: unknown): BackupProducer {
	const row = object(value),
		fields = ["node", "webuiVersion", "agentVersion", "durableDependency"] as const;
	if (
		row.maintenanceProtocol !== 1 ||
		fields.some(
			(field) => typeof row[field] !== "string" || !row[field] || String(row[field]).length > 1024,
		) ||
		typeof row.webuiEntrySha256 !== "string" ||
		!/^[0-9a-f]{64}$/.test(row.webuiEntrySha256) ||
		typeof row.agentEntrySha256 !== "string" ||
		!/^[0-9a-f]{64}$/.test(row.agentEntrySha256) ||
		(row.releaseId !== null && (typeof row.releaseId !== "string" || !/^[0-9a-f]{64}$/.test(row.releaseId)))
	)
		throw new Error("Invalid backup producer identity");
	return {
		maintenanceProtocol: 1,
		node: String(row.node),
		webuiVersion: String(row.webuiVersion),
		agentVersion: String(row.agentVersion),
		durableDependency: String(row.durableDependency),
		webuiEntrySha256: row.webuiEntrySha256,
		agentEntrySha256: row.agentEntrySha256,
		releaseId: row.releaseId,
	};
}
async function entryDigest(path: string) {
	const hash = createHash("sha256");
	for await (const bytes of createReadStream(path)) hash.update(bytes);
	return hash.digest("hex");
}
export async function backupProducer(): Promise<BackupProducer> {
	const agentEntry = new URL(import.meta.resolve("@pakka/agent")),
		ownPackage = await metadata(new URL("../package.json", import.meta.url)),
		agentPackage = await metadata(new URL("../package.json", agentEntry)),
		dependencies = object(agentPackage.dependencies);
	const extension = import.meta.url.endsWith(".ts") ? "ts" : "js",
		ownEntry = new URL("./launcher." + extension, import.meta.url);
	const [own, agent] = await Promise.all([
		entryDigest(fileURLToPath(ownEntry)),
		entryDigest(fileURLToPath(agentEntry)),
	]);
	return decodeBackupProducer({
		maintenanceProtocol: 1,
		node: process.versions.node,
		webuiVersion: ownPackage.version,
		agentVersion: agentPackage.version,
		durableDependency: dependencies["@earendil-works/pi-durable"],
		webuiEntrySha256: own,
		agentEntrySha256: agent,
		releaseId: process.env.PAKKA_RELEASE_ID ?? null,
	});
}
