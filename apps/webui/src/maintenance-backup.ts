import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { opendir, lstat, mkdir, open, readFile, rename, realpath, access } from "node:fs/promises";
import { join, dirname, relative, resolve, isAbsolute, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createInterface } from "node:readline";
import { openStorageMaintenance } from "@pakka/agent";
import type { StorageMaintenance } from "@pakka/agent";
import { backupProducer, decodeBackupProducer, type BackupProducer } from "./maintenance-producer.ts";
import { maintenanceGateFile, productMaintenanceGate, type MaintenanceTarget } from "./maintenance.ts";
import {
	assertPlainPath,
	privateDirectory,
	writePrivateJson,
	readPrivateJson,
	verifyPrivatePath,
} from "./private-files.ts";

export type BackupFile = { root: number; path: string; size: number; sha256: string };
export type BackupDomain = {
	root: number;
	path: string;
	sessionId: string;
	kind: "runtime" | "compresser";
	cwd?: string;
};
export interface ProductBackup {
	schema: 1;
	id: string;
	createdAt: number;
	producer: BackupProducer;
	control: MaintenanceTarget;
	roots: string[];
	domains: BackupDomain[];
	files: { count: number; bytes: number; sha256: string };
	external: {
		workspaces: string[];
		piConfiguration: "excluded";
		modelCredentials: "excluded";
		trustedHostModule: "not-executed";
	};
}
const ephemeral = new Set(["pakka-writer.json", "pakka-maintenance.json"]);
function inside(root: string, path: string) {
	const rel = relative(root, path);
	return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}
function safeRelative(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.includes("\\") &&
		!value.includes(":") &&
		!value.startsWith("/") &&
		value.split("/").every((v) => v !== "" && v !== "." && v !== "..")
	);
}
function parseJson(value: string): Record<string, unknown> {
	try {
		return record(JSON.parse(value));
	} catch {
		throw new Error("Invalid backup JSON metadata");
	}
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid backup record");
	return value as Record<string, unknown>;
}
async function exists(path: string) {
	try {
		await access(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
export async function* walk(
	root: string,
	prefix = "",
): AsyncGenerator<{ path: string; relative: string; directory: boolean }> {
	const directory = await opendir(join(root, prefix));
	for await (const entry of directory) {
		const rel = prefix ? prefix + "/" + entry.name : entry.name,
			path = join(root, ...rel.split("/")),
			stat = await lstat(path);
		if (entry.isSymbolicLink() || stat.isSymbolicLink())
			throw new Error("Backup refuses symbolic/reparse files");
		if (!safeRelative(rel) || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1))
			throw new Error("Unsupported backup file identity");
		if (stat.isDirectory()) {
			yield { path, relative: rel, directory: true };
			yield* walk(root, rel);
		} else yield { path, relative: rel, directory: false };
	}
}
export async function storageDescriptor(path: string, relativePath: string): Promise<boolean> {
	if (relativePath.split("/").at(-1) !== "storage.json") return false;
	if (await exists(join(dirname(path), "main.sqlite"))) return true;
	const stat = await lstat(path);
	if (stat.size > 65536) return false;
	try {
		const row = record(JSON.parse(await readFile(path, "utf8")));
		return typeof row.schema === "string" && row.schema.startsWith("pakka.storage.");
	} catch {
		return false;
	}
}
export async function digest(path: string) {
	const hash = createHash("sha256");
	let size = 0;
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk);
		size += chunk.length;
	}
	return { sha256: hash.digest("hex"), size };
}
export async function streamCopy(source: string, destination: string) {
	const before = await lstat(source);
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
		throw new Error("Backup source identity refused");
	const hash = createHash("sha256");
	let size = 0;
	await pipeline(
		createReadStream(source),
		new Transform({
			transform(chunk: Buffer, _encoding, done) {
				hash.update(chunk);
				size += chunk.length;
				done(null, chunk);
			},
		}),
		createWriteStream(destination, { flags: "wx", mode: 0o600 }),
	);
	const file = await open(destination, "r+");
	try {
		await file.sync();
	} finally {
		await file.close();
	}
	const after = await lstat(source);
	if (
		before.ino !== after.ino ||
		before.dev !== after.dev ||
		before.size !== after.size ||
		before.mtimeMs !== after.mtimeMs
	)
		throw new Error("Backup source changed during copy");
	return { sha256: hash.digest("hex"), size };
}
export async function declaredRoots(target: MaintenanceTarget): Promise<string[]> {
	const roots = [target.dataDir],
		declaration = join(target.dataDir, "maintenance-stores.json");
	if (await exists(declaration)) {
		await assertPlainPath(declaration);
		const stat = await lstat(declaration);
		if (stat.size > 131072) throw new Error("Storage declaration too large");
		const value = record(parseJson(await readFile(declaration, "utf8")));
		if (
			value.schema !== 1 ||
			!Array.isArray(value.roots) ||
			value.roots.some((root) => typeof root !== "string" || !isAbsolute(root))
		)
			throw new Error("Invalid declared storage roots");
		roots.push(...(value.roots as string[]));
	}
	for (const root of roots) await assertPlainPath(root);
	const canonical = await Promise.all(roots.map((root) => realpath(root)));
	if (canonical.some((root, index) => canonical.some((other, n) => n !== index && inside(other, root))))
		throw new Error("Overlapping backup storage roots");
	return roots;
}
export async function createProductBackup(
	target: MaintenanceTarget,
	destination: string,
	heldGates?: readonly { readonly path: string; readonly nonce: string }[],
): Promise<ProductBackup> {
	const roots = await declaredRoots(target),
		out = resolve(destination);
	await assertPlainPath(dirname(out));
	if (roots.some((root) => inside(resolve(root), out) || inside(out, resolve(root))))
		throw new Error("Backup destination overlaps live storage");
	if (await exists(out)) throw new Error("Backup destination already exists; no overwrite");
	const id = randomUUID(),
		gates: Awaited<ReturnType<typeof productMaintenanceGate>>[] = [],
		owners: StorageMaintenance[] = [];
	const domains: BackupDomain[] = [],
		byPath = new Map<string, StorageMaintenance>();
	const stage = out + "." + id + ".partial";
	try {
		for (const root of roots) {
			const existing = heldGates?.find((gate) => gate.path === maintenanceGateFile(root));
			if (existing) {
				const current = parseJson(await readFile(existing.path, "utf8"));
				if (current.nonce !== existing.nonce || current.pid !== process.pid)
					throw new Error("Borrowed maintenance gate identity mismatch");
			} else gates.push(await productMaintenanceGate(root, "backup:" + id));
		}
		for (let index = 0; index < roots.length; index++)
			for await (const item of walk(roots[index])) {
				if (item.directory || !(await storageDescriptor(item.path, item.relative))) continue;
				const folder = dirname(item.path),
					owner = await openStorageMaintenance({
						storageDir: folder,
						stores:
							folder === dirname(target.sessionFile)
								? [{ namespace: "pocket.sessions", maxBytes: 65536 }]
								: [],
					});
				owners.push(owner);
				byPath.set(join(folder, "main.sqlite"), owner);
				domains.push({
					root: index,
					path: relative(roots[index], folder).replaceAll("\\", "/"),
					sessionId: owner.identity.sessionId,
					kind: owner.identity.kind,
					...(owner.identity.cwd ? { cwd: owner.identity.cwd } : {}),
				});
			}
		if (roots.some((_root, index) => !domains.some((domain) => domain.root === index)))
			throw new Error("Declared storage root has no valid durable Session; inventory incomplete");
		const control = owners.find(
			(owner) =>
				owner.identity.sessionId === target.sessionId &&
				owner.identity.storageDir === dirname(target.sessionFile),
		);
		if (!control) throw new Error("Original control Session is missing from backup inventory");
		const registry = await control.snapshot("pocket.sessions");
		if (registry.version) {
			const value = registry.data;
			if (value.schema !== 1 || !Array.isArray(value.registrations))
				throw new Error("Invalid managed Session registry");
			for (const raw of value.registrations) {
				const row = record(raw);
				if (
					typeof row.id !== "string" ||
					!domains.some((domain) => domain.root === 0 && domain.sessionId === row.id)
				)
					throw new Error("Registered child Session missing; complete backup refused");
			}
		}
		await privateDirectory(stage);
		await mkdir(join(stage, "roots"), { mode: 0o700 });
		const indexFile = await open(join(stage, "files.jsonl"), "wx", 0o600),
			indexHash = createHash("sha256");
		let count = 0,
			bytes = 0;
		try {
			for (let root = 0; root < roots.length; root++) {
				const output = join(stage, "roots", String(root));
				await mkdir(output, { mode: 0o700 });
				for await (const item of walk(roots[root])) {
					const name = item.relative.split("/").at(-1)!;
					const ownStorage = byPath.has(join(dirname(item.path), "main.sqlite"));
					const ownSqliteSidecar =
						(name.endsWith("-wal") || name.endsWith("-shm")) && byPath.has(item.path.slice(0, -4));
					const productMarker =
						dirname(item.path) === roots[root] &&
						["pakka-product-maintenance.json", "pakka-restored-hold.json"].includes(name);
					if (!item.directory && ((ownStorage && ephemeral.has(name)) || ownSqliteSidecar || productMarker))
						continue;
					const file = join(output, ...item.relative.split("/"));
					if (item.directory) {
						await mkdir(file, { mode: 0o700 });
						continue;
					}
					const domain = byPath.get(item.path);
					let proof: { size: number; sha256: string };
					if (domain) {
						await domain.backup(file);
						proof = await digest(file);
					} else {
						if (/\.(sqlite|sqlite3|db)$/.test(name))
							throw new Error("Undeclared database file; backup inventory incomplete");
						proof = await streamCopy(item.path, file);
					}
					const line = JSON.stringify({ root, path: item.relative, ...proof }) + "\n";
					await indexFile.writeFile(line);
					indexHash.update(line);
					count++;
					bytes += proof.size;
				}
			}
			await indexFile.sync();
		} finally {
			await indexFile.close();
		}
		const manifest: ProductBackup = {
			schema: 1,
			id,
			createdAt: Date.now(),
			producer: await backupProducer(),
			control: target,
			roots,
			domains,
			files: { count, bytes, sha256: indexHash.digest("hex") },
			external: {
				workspaces: [...new Set(domains.flatMap((domain) => (domain.cwd ? [domain.cwd] : [])))],
				piConfiguration: "excluded",
				modelCredentials: "excluded",
				trustedHostModule: "not-executed",
			},
		};
		await writePrivateJson(join(stage, "manifest.json"), manifest);
		await verifyProductBackup(stage);
		await rename(stage, out);
		await verifyPrivatePath(out);
		return manifest;
	} finally {
		let clean = true;
		for (const owner of owners.reverse()) {
			try {
				await owner.close();
			} catch {
				clean = false;
			}
		}
		if (clean) for (const gate of gates.reverse()) await gate.close();
	}
}
export async function readBackupManifest(path: string): Promise<ProductBackup> {
	await verifyPrivatePath(path);
	const value = record(await readPrivateJson(join(path, "manifest.json")));
	if (
		value.schema !== 1 ||
		typeof value.id !== "string" ||
		!Array.isArray(value.roots) ||
		value.roots.some((root) => typeof root !== "string" || !isAbsolute(root)) ||
		!Array.isArray(value.domains)
	)
		throw new Error("Invalid backup manifest");
	const control = record(value.control),
		files = record(value.files);
	if (
		control.version !== 1 ||
		typeof control.sessionId !== "string" ||
		typeof control.dataDir !== "string" ||
		value.roots[0] !== control.dataDir ||
		typeof files.sha256 !== "string" ||
		!Number.isSafeInteger(files.count) ||
		!Number.isSafeInteger(files.bytes)
	)
		throw new Error("Invalid backup inventory identity");
	const roots = value.roots.map((root) => {
		if (typeof root !== "string" || !isAbsolute(root)) throw new Error("Invalid backup root");
		return root;
	});
	if (
		typeof control.sessionFile !== "string" ||
		control.sessionFile !== join(control.dataDir, "sessions", control.sessionId, "main.sqlite") ||
		!Number.isSafeInteger(value.createdAt) ||
		Number(value.createdAt) <= 0 ||
		Number(files.count) < 0 ||
		Number(files.bytes) < 0 ||
		!/^[0-9a-f]{64}$/.test(files.sha256)
	)
		throw new Error("Invalid backup identity");
	const domains: BackupDomain[] = value.domains.map((raw) => {
		const domain = record(raw);
		if (
			!Number.isInteger(domain.root) ||
			Number(domain.root) < 0 ||
			Number(domain.root) >= roots.length ||
			(domain.path !== "" && !safeRelative(domain.path)) ||
			typeof domain.path !== "string" ||
			typeof domain.sessionId !== "string" ||
			!["runtime", "compresser"].includes(String(domain.kind)) ||
			(domain.cwd !== undefined && (typeof domain.cwd !== "string" || !isAbsolute(domain.cwd)))
		)
			throw new Error("Invalid backup domain identity");
		return {
			root: Number(domain.root),
			path: domain.path,
			sessionId: domain.sessionId,
			kind: domain.kind === "runtime" ? "runtime" : "compresser",
			...(typeof domain.cwd === "string" ? { cwd: domain.cwd } : {}),
		};
	});
	const external = record(value.external);
	if (
		!Array.isArray(external.workspaces) ||
		external.workspaces.some((path) => typeof path !== "string" || !isAbsolute(path)) ||
		external.piConfiguration !== "excluded" ||
		external.modelCredentials !== "excluded" ||
		external.trustedHostModule !== "not-executed"
	)
		throw new Error("Invalid external dependency declaration");
	return {
		schema: 1,
		id: value.id,
		createdAt: Number(value.createdAt),
		producer: decodeBackupProducer(value.producer),
		control: {
			version: 1,
			dataDir: control.dataDir,
			sessionId: control.sessionId,
			sessionFile: control.sessionFile,
		},
		roots,
		domains,
		files: { count: Number(files.count), bytes: Number(files.bytes), sha256: files.sha256 },
		external: {
			workspaces: external.workspaces.map((path) => String(path)),
			piConfiguration: "excluded",
			modelCredentials: "excluded",
			trustedHostModule: "not-executed",
		},
	};
}
export async function* backupFiles(
	path: string,
	manifest: Pick<ProductBackup, "roots">,
): AsyncGenerator<BackupFile> {
	const input = createReadStream(join(path, "files.jsonl")),
		lines = createInterface({ input, crlfDelay: Infinity });
	const seen = new Set<string>();
	let metadataBytes = 0;
	try {
		for await (const line of lines) {
			if (line.length > 16384) throw new Error("Backup inventory row too large");
			const value = record(parseJson(line));
			if (
				!Number.isInteger(value.root) ||
				Number(value.root) < 0 ||
				Number(value.root) >= manifest.roots.length ||
				!safeRelative(value.path) ||
				!Number.isSafeInteger(value.size) ||
				Number(value.size) < 0 ||
				typeof value.sha256 !== "string" ||
				!/^[0-9a-f]{64}$/.test(value.sha256)
			)
				throw new Error("Invalid backup file identity");
			const key = String(value.root) + ":" + value.path;
			metadataBytes += Buffer.byteLength(key);
			if (metadataBytes > 16 * 1024 * 1024) throw new Error("Backup inventory memory budget exceeded");
			if (seen.has(key)) throw new Error("Duplicate backup file identity");
			seen.add(key);
			yield { root: Number(value.root), path: value.path, size: Number(value.size), sha256: value.sha256 };
		}
	} finally {
		lines.close();
		input.destroy();
	}
}
export async function verifyProductBackup(path: string): Promise<ProductBackup> {
	const manifest = await readBackupManifest(path),
		index = await digest(join(path, "files.jsonl"));
	if (index.sha256 !== manifest.files.sha256) throw new Error("Backup inventory digest mismatch");
	let count = 0,
		bytes = 0;
	for await (const row of backupFiles(path, manifest)) {
		const file = join(path, "roots", String(row.root), ...row.path.split("/"));
		await assertPlainPath(file);
		const proof = await digest(file);
		if (proof.sha256 !== row.sha256 || proof.size !== row.size)
			throw new Error("Backup file hash/integrity mismatch");
		count++;
		bytes += row.size;
	}
	if (count !== manifest.files.count || bytes !== manifest.files.bytes)
		throw new Error("Backup inventory totals mismatch");
	return manifest;
}
