import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve, dirname, isAbsolute, basename } from "node:path";
import { readFile, lstat, mkdir, open, unlink, rename } from "node:fs/promises";
import { openStorageMaintenance, recoverStorageWriter } from "@pakka/agent";
import type { StorageMaintenance } from "@pakka/agent";
import { inspectPocketOwner, recoverPocketOwner } from "@pakka/server/pocket";
import {
	assertPlainPath,
	privateDirectory,
	writePrivateJson,
	readPrivateJson,
	verifyPrivatePath,
} from "./private-files.ts";

export type MaintenanceTarget = { version: 1; dataDir: string; sessionId: string; sessionFile: string };
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid maintenance record");
	return value as Record<string, unknown>;
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
async function json(path: string) {
	await assertPlainPath(path);
	const stat = await lstat(path);
	if (!stat.isFile() || stat.size > 131072) throw new Error("Invalid maintenance metadata");
	try {
		return object(JSON.parse(await readFile(path, "utf8")));
	} catch {
		throw new Error("Invalid maintenance JSON encoding or syntax");
	}
}
export async function saveMaintenanceTarget(home: string, target: MaintenanceTarget) {
	const path = join(home, "maintenance-target.json"),
		temp = path + "." + randomUUID() + ".tmp";
	await mkdir(home, { recursive: true, mode: 0o700 });
	await writeMetadata(temp, target);
	await rename(temp, path);
}
async function writeMetadata(path: string, data: unknown) {
	const file = await open(path, "wx", 0o600);
	try {
		await file.writeFile(JSON.stringify(data) + "\n");
		await file.sync();
	} finally {
		await file.close();
	}
}
async function targetFor(home: string, dataDir?: string): Promise<MaintenanceTarget> {
	let pointer: Record<string, unknown> | undefined;
	if (!dataDir && (await exists(join(home, "maintenance-target.json"))))
		pointer = await json(join(home, "maintenance-target.json"));
	if (!dataDir && pointer) {
		if (pointer.version !== 1 || typeof pointer.dataDir !== "string" || !isAbsolute(pointer.dataDir))
			throw new Error("Invalid saved maintenance target");
		dataDir = pointer.dataDir;
	}
	if (!dataDir) {
		const launch = await json(join(home, "launch.json")),
			config = object(launch.config);
		if (launch.version !== 1) throw new Error("Invalid saved launcher identity");
		if (config.kind === "local") dataDir = join(home, "data");
		else if (config.kind === "json" && typeof config.path === "string") {
			const host = await json(config.path),
				runtime = object(host.runtime);
			if (typeof runtime.dataDir !== "string") throw new Error("Missing original dataDir");
			dataDir = resolve(dirname(config.path), runtime.dataDir);
		} else throw new Error("Trusted module is not executed in maintenance; explicitly provide --data-dir");
	}
	dataDir = resolve(dataDir);
	await assertPlainPath(dataDir);
	const state = await json(join(dataDir, "launcher-state.json"));
	if (
		state.version !== 1 ||
		typeof state.sessionId !== "string" ||
		!/^[0-9a-f-]{36}$/.test(state.sessionId) ||
		state.sessionFile !== join(dataDir, "sessions", state.sessionId, "main.sqlite")
	)
		throw new Error("Original Session identity unavailable");
	if (pointer && (pointer.sessionId !== state.sessionId || pointer.sessionFile !== state.sessionFile))
		throw new Error("Saved target and original Session identity differ");
	await assertPlainPath(String(state.sessionFile));
	return { version: 1, dataDir, sessionId: state.sessionId, sessionFile: String(state.sessionFile) };
}
function parse(args: readonly string[]) {
	const command = args[0],
		action = command === "recover" ? args[1] : undefined,
		values = new Map<string, string>();
	const allowed = [
		"--confirm",
		"--data-dir",
		"--recovery-id",
		"--session",
		"--out",
		"--from",
		"--to",
		"--resume",
		"--rollback",
		"--review-work",
	];
	for (let n = command === "recover" ? 2 : 1; n < args.length; n++) {
		const key = args[n],
			value = args[++n];
		if (
			!allowed.includes(key) ||
			values.has(key) ||
			!value ||
			value.startsWith("--") ||
			/[\x00-\x1f\x7f]/.test(value)
		)
			throw new Error("Invalid maintenance arguments");
		values.set(key, value);
	}
	if (command === "recover" && !["login", "writer", "maintenance", "check"].includes(action ?? ""))
		throw new Error("Usage: pakka recover login|writer|maintenance [--confirm <Session or operation ID>]");
	return { command, action, values };
}
export function maintenanceGateFile(dataDir: string) {
	return join(dirname(dataDir), basename(dataDir) + ".pakka-maintenance.json");
}
export async function productMaintenanceGate(dataDir: string, operation: string) {
	const path = maintenanceGateFile(dataDir),
		nonce = randomUUID();
	await assertPlainPath(dirname(dataDir));
	await writeMetadata(path, { schema: 1, operation, pid: process.pid, nonce });
	return ownedGate(path, nonce);
}
function ownedGate(path: string, nonce: string) {
	let released = false;
	return {
		path,
		nonce,
		async close() {
			if (released) return;
			const current = await json(path);
			if (current.nonce !== nonce) throw new Error("Maintenance gate changed; release refused");
			await unlink(path);
			released = true;
		},
	};
}
/** Resume exactly the same interrupted publication, keeping the safety fence continuously present. */
export async function resumeMaintenanceGate(dataDir: string, operation: string) {
	try {
		return await productMaintenanceGate(dataDir, operation);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const path = maintenanceGateFile(dataDir),
		original = await readFile(path, "utf8"),
		claim = await json(path);
	if (claim.operation !== operation || typeof claim.nonce !== "string")
		throw new Error("Different maintenance operation already owns this storage");
	exited(claim.pid);
	const guard = path + ".reconcile",
		guardNonce = randomUUID();
	await writeMetadata(guard, { pid: process.pid, nonce: guardNonce });
	try {
		exited(claim.pid);
		if ((await readFile(path, "utf8")) !== original)
			throw new Error("Maintenance identity changed during reconciliation");
		const nonce = randomUUID(),
			temp = path + "." + nonce + ".tmp";
		await writeMetadata(temp, { schema: 1, operation, pid: process.pid, nonce });
		if ((await readFile(path, "utf8")) !== original)
			throw new Error("Maintenance identity changed before publication");
		await rename(temp, path);
		return ownedGate(path, nonce);
	} finally {
		if ((await json(guard)).nonce !== guardNonce) throw new Error("Maintenance reconciliation claim changed");
		await unlink(guard);
	}
}
function exited(pid: unknown) {
	if (!Number.isSafeInteger(pid) || Number(pid) <= 0) throw new Error("Invalid original process identity");
	try {
		process.kill(Number(pid), 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
		throw new Error("Original process liveness unknown");
	}
	throw new Error("Original process is alive/running; maintenance refused");
}
async function writer(target: MaintenanceTarget, confirm: string | undefined, selected: string | undefined) {
	const sessionId = selected ?? target.sessionId;
	if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new Error("Invalid original Session identity");
	const storageDir = join(target.dataDir, "sessions", sessionId);
	await assertPlainPath(storageDir);
	const provenance = await json(join(storageDir, "provenance.json"));
	if (provenance.sessionId !== sessionId) throw new Error("Original writer Session identity mismatch");
	const path = join(storageDir, "pakka-writer.json"),
		claim = await json(path);
	const preview = { operation: "writer", sessionId, storageDir, pid: claim.pid, nonce: claim.nonce };
	if (!confirm) return preview;
	if (confirm !== sessionId) throw new Error("Confirmation must match original Session identity");
	if (claim.schema !== "pakka.writer.v1" || typeof claim.pid !== "number" || typeof claim.nonce !== "string")
		throw new Error("Invalid original writer identity");
	return recoverStorageWriter({ storageDir, expectedClaim: { pid: claim.pid, nonce: claim.nonce } });
}
async function login(
	home: string,
	target: MaintenanceTarget,
	confirm: string | undefined,
	recoveryId: string | undefined,
) {
	if (confirm && confirm !== target.sessionId)
		throw new Error("Confirmation must match original Session identity");
	const id = recoveryId ?? randomUUID();
	if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid recovery operation identity");
	const gate = await productMaintenanceGate(target.dataDir, "login:" + id);
	let maintenance: StorageMaintenance | undefined;
	try {
		maintenance = await openStorageMaintenance({
			storageDir: dirname(target.sessionFile),
			expectedSessionId: target.sessionId,
			stores: [
				{ namespace: "pocket.bootstrap", maxBytes: 65536 },
				{ namespace: "pocket.people", maxBytes: 262144 },
				{ namespace: "pocket.recovery." + id, maxBytes: 4096 },
			],
		});
		const owner = await inspectPocketOwner(maintenance);
		if (!confirm)
			return {
				operation: "login",
				...owner,
				dataDir: target.dataDir,
				requiresConfirmation: target.sessionId,
			};
		const directory = join(home, "maintenance");
		await mkdir(home, { recursive: true, mode: 0o700 });
		await privateDirectory(directory);
		const own = join(directory, id);
		await privateDirectory(own);
		const prepared = join(own, "credential.json");
		let delivery: Record<string, unknown>;
		if (await exists(prepared)) delivery = object(await readPrivateJson(prepared));
		else {
			delivery = {
				schema: 1,
				recoveryId: id,
				sessionId: target.sessionId,
				ownerId: owner.ownerId,
				token: randomBytes(32).toString("base64url"),
			};
			await writePrivateJson(prepared, delivery);
		}
		if (
			delivery.schema !== 1 ||
			delivery.recoveryId !== id ||
			delivery.sessionId !== target.sessionId ||
			delivery.ownerId !== owner.ownerId ||
			typeof delivery.token !== "string"
		)
			throw new Error("Prepared recovery identity mismatch");
		const receipt = await recoverPocketOwner(maintenance, { recoveryId: id, token: delivery.token });
		await verifyPrivatePath(prepared);
		const receiptPath = join(own, "receipt.json");
		if (!(await exists(receiptPath))) await writePrivateJson(receiptPath, receipt);
		else if (JSON.stringify(await readPrivateJson(receiptPath)) !== JSON.stringify(receipt))
			throw new Error("Private issuance receipt conflict");
		return {
			operation: "login",
			sessionId: target.sessionId,
			ownerId: owner.ownerId,
			recoveryId: id,
			file: prepared,
			expiresAt: receipt.expiresAt,
		};
	} finally {
		try {
			await maintenance?.close();
		} finally {
			await gate.close();
		}
	}
}
export async function runMaintenance(args: readonly string[]): Promise<number> {
	try {
		const flags = parse(args),
			home = resolve(process.env.PAKKA_HOME || join(homedir(), ".pakka"));
		if (flags.command === "backup" && flags.values.has("--from")) {
			const { verifyProductBackup } = await import("./maintenance-backup.ts");
			const manifest = await verifyProductBackup(resolve(flags.values.get("--from")!));
			process.stdout.write(
				JSON.stringify({
					status: "verified",
					id: manifest.id,
					sessionId: manifest.control.sessionId,
					files: manifest.files.count,
					bytes: manifest.files.bytes,
				}) + "\n",
			);
			return 0;
		}
		if (flags.command === "restore" && flags.values.has("--from")) {
			const { readBackupManifest } = await import("./maintenance-backup.ts");
			const source = resolve(flags.values.get("--from")!);
			const manifest = await readBackupManifest(source);
			let target: MaintenanceTarget;
			try {
				target = await targetFor(home, flags.values.get("--data-dir"));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				const pointer = await json(join(home, "maintenance-target.json"));
				if (
					pointer.version !== 1 ||
					pointer.sessionId !== manifest.control.sessionId ||
					pointer.sessionFile !== manifest.control.sessionFile ||
					pointer.dataDir !== manifest.control.dataDir ||
					(flags.values.has("--data-dir") &&
						resolve(flags.values.get("--data-dir")!) !== manifest.control.dataDir)
				)
					throw new Error("Interrupted publication has no matching original product pointer");
				target = manifest.control;
			}
			const { restoreProduct } = await import("./maintenance-restore.ts");
			const result = await restoreProduct(home, source, target, flags.values.get("--confirm"));
			process.stdout.write(JSON.stringify(result) + "\n");
			return 0;
		}
		const target = await targetFor(home, flags.values.get("--data-dir"));
		let result: unknown;
		if (flags.command === "restore") {
			const id = flags.values.get("--resume");
			if (!id) throw new Error("Usage: pakka restore --from <backup> or --resume <restore ID>");
			const { resumeRestoredProduct } = await import("./maintenance-restore.ts");
			result = await resumeRestoredProduct(
				home,
				target,
				id,
				flags.values.get("--confirm"),
				flags.values.get("--review-work"),
			);
		} else if (flags.command === "upgrade") {
			const release = await import("./maintenance-release.ts");
			if (flags.values.has("--rollback"))
				result = await release.rollbackProduct(
					home,
					target,
					flags.values.get("--rollback")!,
					flags.values.get("--confirm"),
				);
			else {
				const path = flags.values.get("--to");
				if (!path || !path.endsWith(".json"))
					throw new Error(
						"Explicit verified local release manifest required; version labels/latest are not accepted",
					);
				result = await release.upgradeProduct(home, target, resolve(path), flags.values.get("--confirm"));
			}
		} else if (flags.command === "backup") {
			const out = flags.values.get("--out");
			if (!out) throw new Error("Usage: pakka backup --out <new directory> [--confirm <Session ID>]");
			if (!flags.values.has("--confirm"))
				result = {
					operation: "backup",
					...target,
					out: resolve(out),
					requiresConfirmation: target.sessionId,
				};
			else {
				if (flags.values.get("--confirm") !== target.sessionId)
					throw new Error("Confirmation must match original Session identity");
				const { createProductBackup } = await import("./maintenance-backup.ts");
				const manifest = await createProductBackup(target, resolve(out));
				result = {
					status: "complete",
					id: manifest.id,
					out: resolve(out),
					sessionId: target.sessionId,
					files: manifest.files.count,
					bytes: manifest.files.bytes,
				};
			}
		} else if (flags.action === "check") {
			if (flags.values.get("--confirm") !== target.sessionId)
				throw new Error("Offline health check requires original Session confirmation");
			const { checkProductStorage } = await import("./maintenance-release.ts");
			result = await checkProductStorage(target);
		} else if (flags.action === "writer")
			result = await writer(target, flags.values.get("--confirm"), flags.values.get("--session"));
		else if (flags.action === "login")
			result = await login(home, target, flags.values.get("--confirm"), flags.values.get("--recovery-id"));
		else if (flags.action === "maintenance") {
			const path = maintenanceGateFile(target.dataDir),
				gate = await json(path);
			if (!flags.values.get("--confirm")) result = { operation: "maintenance", ...gate };
			else {
				if (flags.values.get("--confirm") !== gate.nonce)
					throw new Error("Confirmation must match original maintenance identity");
				exited(gate.pid);
				// Interrupted restore/upgrade publication has its own reconciliation; do not clear its safety fence.
				if (
					typeof gate.operation !== "string" ||
					!["login:", "backup:"].some((prefix) => String(gate.operation).startsWith(prefix))
				)
					throw new Error("Publication requires its original operation reconciliation");
				const before = await readFile(path, "utf8");
				if ((await json(path)).nonce !== gate.nonce || (await readFile(path, "utf8")) !== before)
					throw new Error("Maintenance identity changed");
				await unlink(path);
				result = { status: "released", nonce: gate.nonce };
			}
		} else throw new Error("Maintenance operation not implemented");
		process.stdout.write(JSON.stringify(result) + "\n");
		return 0;
	} catch (error) {
		// Errors contain no credential or configuration body. File/target metadata is the only CLI output.
		process.stderr.write(
			"PAKKA_MAINTENANCE: " + (error instanceof Error ? error.message : "Operation failed") + "\n",
		);
		return 1;
	}
}
