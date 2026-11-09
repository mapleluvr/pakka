import { randomUUID, createHash } from "node:crypto";
import { mkdir, lstat, open, rename, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { digest, streamCopy, walk, backupFiles } from "./maintenance-backup.ts";
import { privateDirectory, writePrivateJson, readPrivateJson, verifyPrivatePath } from "./private-files.ts";

interface Preservation {
	schema: 1;
	kind: "unverified-original-bytes";
	operationId: string;
	sessionId: string;
	roots: string[];
	missingRoots: number[];
	files: { count: number; bytes: number; sha256: string };
}
async function exists(path: string) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid original-data preservation record");
	return value as Record<string, unknown>;
}
function exitedWriter(pid: number) {
	try {
		process.kill(pid, 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
		throw new Error("Original storage writer liveness cannot be confirmed; preservation refused", {
			cause: error,
		});
	}
	throw new Error("Original storage writer is active; stop it before preserving bytes");
}
async function captureExitedWriter(path: string) {
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
		throw new Error("Original storage writer record is unknown");
	const bytes = await readFile(path, "utf8"),
		row = object(JSON.parse(bytes));
	if (
		row.schema !== "pakka.writer.v1" ||
		!Number.isSafeInteger(row.pid) ||
		Number(row.pid) <= 0 ||
		typeof row.nonce !== "string" ||
		!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(row.nonce)
	)
		throw new Error("Original storage writer identity is unknown");
	const pid = Number(row.pid);
	exitedWriter(pid);
	return { path, bytes, pid };
}
/** Preserve damaged data too: this is a byte archive, not a claim that the original database is healthy. */
export async function preserveOriginalBytes(
	roots: string[],
	destination: string,
	operationId: string,
	sessionId: string,
) {
	if (await exists(destination)) return verifyOriginalBytes(destination, roots, operationId, sessionId);
	const missingRoots: number[] = [];
	const claims: Awaited<ReturnType<typeof captureExitedWriter>>[] = [];
	for (let root = 0; root < roots.length; root++) {
		if (!(await exists(roots[root]))) {
			missingRoots.push(root);
			continue;
		}
		for await (const item of walk(roots[root])) {
			if (item.directory || item.relative.split("/").at(-1) !== "pakka-writer.json") continue;
			if (await exists(join(dirname(item.path), "storage.json")))
				claims.push(await captureExitedWriter(item.path));
		}
	}
	const stage = destination + "." + randomUUID() + ".partial";
	await privateDirectory(stage);
	await mkdir(join(stage, "roots"), { mode: 0o700 });
	const index = await open(join(stage, "files.jsonl"), "wx", 0o600),
		hash = createHash("sha256");
	let count = 0,
		bytes = 0;
	try {
		for (let root = 0; root < roots.length; root++) {
			if (missingRoots.includes(root)) continue;
			const output = join(stage, "roots", String(root));
			await mkdir(output, { mode: 0o700 });
			for await (const item of walk(roots[root])) {
				const file = join(output, ...item.relative.split("/"));
				if (item.directory) {
					await mkdir(file, { mode: 0o700 });
					continue;
				}
				const proof = await streamCopy(item.path, file),
					line = JSON.stringify({ root, path: item.relative, ...proof }) + "\n";
				await index.writeFile(line);
				hash.update(line);
				count++;
				bytes += proof.size;
			}
		}
		await index.sync();
	} finally {
		await index.close();
	}
	// The source claim is never deleted or re-authorized; it is retained in the byte archive and parked original.
	for (const claim of claims) {
		exitedWriter(claim.pid);
		if ((await readFile(claim.path, "utf8")) !== claim.bytes)
			throw new Error("Original storage writer changed while preserving bytes");
	}
	const manifest: Preservation = {
		schema: 1,
		kind: "unverified-original-bytes",
		operationId,
		sessionId,
		roots,
		missingRoots,
		files: { count, bytes, sha256: hash.digest("hex") },
	};
	await writePrivateJson(join(stage, "preservation.json"), manifest);
	await verifyOriginalBytes(stage, roots, operationId, sessionId);
	await rename(stage, destination);
	return manifest;
}
async function verifyOriginalBytes(
	path: string,
	roots: string[],
	operationId: string,
	sessionId: string,
): Promise<Preservation> {
	await verifyPrivatePath(path);
	const row = object(await readPrivateJson(join(path, "preservation.json"))),
		files = object(row.files);
	if (
		row.schema !== 1 ||
		row.kind !== "unverified-original-bytes" ||
		row.operationId !== operationId ||
		row.sessionId !== sessionId ||
		JSON.stringify(row.roots) !== JSON.stringify(roots) ||
		!Array.isArray(row.missingRoots) ||
		row.missingRoots.some((n) => !Number.isInteger(n) || Number(n) < 0 || Number(n) >= roots.length) ||
		!Number.isSafeInteger(files.count) ||
		!Number.isSafeInteger(files.bytes) ||
		typeof files.sha256 !== "string"
	)
		throw new Error("Original-data preservation identity conflict");
	const proof = await digest(join(path, "files.jsonl"));
	if (proof.sha256 !== files.sha256) throw new Error("Original-data preservation inventory changed");
	// The inventory reader only needs root count; no database health or restore authority is implied.
	const inventory = { roots };
	let count = 0,
		bytes = 0;
	for await (const item of backupFiles(path, inventory)) {
		const actual = await digest(join(path, "roots", String(item.root), ...item.path.split("/")));
		if (actual.sha256 !== item.sha256 || actual.size !== item.size)
			throw new Error("Original-data preservation bytes changed");
		count++;
		bytes += item.size;
	}
	if (count !== files.count || bytes !== files.bytes)
		throw new Error("Original-data preservation totals differ");
	return {
		schema: 1,
		kind: "unverified-original-bytes",
		operationId,
		sessionId,
		roots,
		missingRoots: row.missingRoots.map(Number),
		files: { count, bytes, sha256: files.sha256 },
	};
}
