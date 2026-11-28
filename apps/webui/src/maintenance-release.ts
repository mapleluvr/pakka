import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, lstat, open, mkdir, unlink, rename } from "node:fs/promises";
import { join, dirname, resolve, isAbsolute } from "node:path";
import {
	digest,
	streamCopy,
	declaredRoots,
	createProductBackup,
	verifyProductBackup,
	walk,
	storageDescriptor,
} from "./maintenance-backup.ts";
import {
	assertPlainPath,
	privateDirectory,
	readPrivateJson,
	writePrivateJson,
	replacePrivateJson,
} from "./private-files.ts";
import { resumeMaintenanceGate, type MaintenanceTarget } from "./maintenance.ts";
import { openStorageMaintenance } from "@pakka/agent";

const names = ["agent", "mas", "mas-devpack", "protocol", "client", "cli", "server", "webui"].map(
	(name) => "@pakka/" + name,
);
interface ReleaseArchive {
	name: string;
	version: string;
	file: string;
	sha256: string;
	size: number;
}
export interface ProductRelease {
	schema: 1;
	maintenanceProtocol: 1;
	version: string;
	nodeMajor: number;
	packages: ReleaseArchive[];
}
interface ActiveRelease {
	schema: 1;
	id: string;
	version: string;
	entry: string;
	sha256: string;
}
interface UpgradeJournal {
	schema: 1;
	id: string;
	sessionId: string;
	dataDir: string;
	release: string;
	backup: string;
	previous: ActiveRelease | null;
	phase: "installed" | "backed-up" | "activated" | "failed-held" | "rolled-back";
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid release record");
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
function semver(value: unknown): value is string {
	return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value);
}
function hash(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
async function json(path: string) {
	await assertPlainPath(path);
	if ((await lstat(path)).size > 131072) throw new Error("Release metadata too large");
	try {
		return object(JSON.parse(await readFile(path, "utf8")));
	} catch {
		throw new Error("Invalid release JSON metadata");
	}
}
function decodeRelease(row: Record<string, unknown>): ProductRelease {
	if (
		row.schema !== 1 ||
		row.maintenanceProtocol !== 1 ||
		!semver(row.version) ||
		row.nodeMajor !== Number(process.versions.node.split(".")[0]) ||
		!Array.isArray(row.packages) ||
		row.packages.length !== names.length
	)
		throw new Error("Invalid/incompatible fixed release manifest");
	const packages = row.packages.map((value) => {
		const item = object(value);
		if (
			typeof item.name !== "string" ||
			!names.includes(item.name) ||
			!semver(item.version) ||
			typeof item.file !== "string" ||
			!/^[A-Za-z0-9_.-]+\.tgz$/.test(item.file) ||
			!hash(item.sha256) ||
			!Number.isSafeInteger(item.size) ||
			Number(item.size) < 1
		)
			throw new Error("Invalid fixed release archive identity");
		return {
			name: item.name,
			version: item.version,
			file: item.file,
			sha256: item.sha256,
			size: Number(item.size),
		};
	});
	if (
		new Set(packages.map((item) => item.name)).size !== names.length ||
		new Set(packages.map((item) => item.file)).size !== names.length ||
		packages.find((item) => item.name === "@pakka/cli")!.version !== row.version
	)
		throw new Error("Incomplete/duplicate release cohort");
	return { schema: 1, maintenanceProtocol: 1, version: row.version, nodeMajor: row.nodeMajor, packages };
}
export async function inspectProductRelease(path: string) {
	if (!isAbsolute(path) || !path.endsWith(".json"))
		throw new Error(
			"Explicit verified local release manifest required; version labels/latest are not accepted",
		);
	const row = await json(path),
		release = decodeRelease(row),
		id = createHash("sha256").update(JSON.stringify(release)).digest("hex");
	for (const archive of release.packages) {
		const file = join(dirname(path), archive.file);
		await assertPlainPath(file);
		const proof = await digest(file);
		if (proof.sha256 !== archive.sha256 || proof.size !== archive.size)
			throw new Error("Release archive digest/size mismatch");
	}
	return { release, id };
}
function decodeActive(value: unknown, home: string): ActiveRelease {
	const item = object(value);
	if (
		item.schema !== 1 ||
		!hash(item.id) ||
		!semver(item.version) ||
		typeof item.entry !== "string" ||
		item.entry !==
			join(home, "maintenance", "releases", item.id, "node_modules", "@pakka", "cli", "dist", "main.js") ||
		!hash(item.sha256)
	)
		throw new Error("Invalid active release selection");
	return { schema: 1, id: item.id, version: item.version, entry: item.entry, sha256: item.sha256 };
}
async function active(home: string) {
	const path = join(home, "active-release.json");
	return (await exists(path)) ? decodeActive(await json(path), home) : null;
}
async function publishActive(home: string, value: ActiveRelease | null) {
	const path = join(home, "active-release.json");
	if (value === null) {
		if (await exists(path)) await unlink(path);
		return;
	}
	const temp = path + "." + value.id + ".tmp",
		file = await open(temp, "wx", 0o600);
	try {
		await file.writeFile(JSON.stringify(value) + "\n");
		await file.sync();
	} finally {
		await file.close();
	}
	await rename(temp, path);
}
function safeEnvironment(home: string) {
	const env: NodeJS.ProcessEnv = {};
	for (const key of [
		"PATH",
		"PATHEXT",
		"SystemRoot",
		"WINDIR",
		"COMSPEC",
		"TEMP",
		"TMP",
		"HOME",
		"USERPROFILE",
		"APPDATA",
		"LOCALAPPDATA",
		"NPM_CONFIG_CACHE",
	])
		if (process.env[key]) env[key] = process.env[key];
	return { ...env, PAKKA_HOME: home, PI_OFFLINE: "1", DO_NOT_TRACK: "1" };
}
async function child(args: string[], cwd: string, env: NodeJS.ProcessEnv, timeout: number) {
	return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolveResult, reject) => {
		const task = spawn(process.execPath, args, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "",
			stderr = "",
			overflow = false,
			expired = false;
		const take = (value: Buffer, kind: "stdout" | "stderr") => {
			if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + value.length > 4 * 1024 * 1024) {
				overflow = true;
				task.kill();
				return;
			}
			if (kind === "stdout") stdout += value;
			else stderr += value;
		};
		task.stdout.on("data", (value) => take(value, "stdout"));
		task.stderr.on("data", (value) => take(value, "stderr"));
		const timer = setTimeout(() => {
			expired = true;
			task.kill();
		}, timeout);
		task.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		task.once("close", (code) => {
			clearTimeout(timer);
			if (overflow || expired) reject(new Error("Release subprocess exceeded output/time budget"));
			else resolveResult({ stdout, stderr, code });
		});
	});
}
async function npmEntry() {
	for (const candidate of [
		process.env.npm_execpath,
		join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
		resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
	]) {
		if (candidate && isAbsolute(candidate) && candidate.endsWith("npm-cli.js") && (await exists(candidate))) {
			await assertPlainPath(candidate);
			return candidate;
		}
	}
	throw new Error("Existing npm CLI unavailable; install npm for this Node runtime before upgrading");
}
async function installRelease(home: string, path: string, release: ProductRelease, id: string) {
	await privateDirectory(join(home, "maintenance"));
	await privateDirectory(join(home, "maintenance", "releases"));
	const folder = join(home, "maintenance", "releases", id);
	await privateDirectory(folder);
	const marker = join(folder, "installed.json"),
		entry = join(folder, "node_modules", "@pakka", "cli", "dist", "main.js");
	if (await exists(marker)) {
		const previous = object(await readPrivateJson(marker));
		if (previous.id !== id || previous.version !== release.version)
			throw new Error("Installed release identity conflict");
		const proof = await digest(entry);
		if (previous.sha256 !== proof.sha256) throw new Error("Installed release entry changed");
		return { folder, entry, sha256: proof.sha256 };
	}
	const archiveDir = join(folder, "archives");
	if (!(await exists(archiveDir))) await mkdir(archiveDir, { mode: 0o700 });
	for (const archive of release.packages) {
		const file = join(archiveDir, archive.file);
		if (await exists(file)) {
			const proof = await digest(file);
			if (proof.sha256 !== archive.sha256 || proof.size !== archive.size)
				throw new Error("Staged release archive identity conflict");
		} else {
			const proof = await streamCopy(join(dirname(path), archive.file), file);
			if (proof.sha256 !== archive.sha256 || proof.size !== archive.size)
				throw new Error("Release changed during staging");
		}
	}
	const packageFile = join(folder, "package.json");
	if (!(await exists(packageFile)))
		await writePrivateJson(packageFile, {
			name: "pakka-fixed-release",
			private: true,
			type: "module",
			dependencies: Object.fromEntries(
				release.packages.map((archive) => [archive.name, "file:./archives/" + archive.file]),
			),
		});
	const args = [
		await npmEntry(),
		"install",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		"--registry=https://registry.npmjs.org",
	];
	if (process.env.PAKKA_UPGRADE_OFFLINE === "1") args.push("--offline");
	const result = await child(args, folder, safeEnvironment(home), 600000);
	const log = join(folder, "install-result.json");
	if (!(await exists(log)))
		await writePrivateJson(log, { code: result.code, stdout: result.stdout, stderr: result.stderr });
	if (result.code !== 0)
		throw new Error(
			"Fixed release installation failed; current program/data unchanged (private installation log retained)",
		);
	for (const archive of release.packages) {
		const metadata = await json(join(folder, "node_modules", ...archive.name.split("/"), "package.json"));
		if (metadata.name !== archive.name || metadata.version !== archive.version)
			throw new Error("Installed release package/version mismatch");
	}
	const proof = await digest(entry);
	await writePrivateJson(marker, { id, version: release.version, sha256: proof.sha256 });
	return { folder, entry, sha256: proof.sha256 };
}
export async function checkProductStorage(target: MaintenanceTarget) {
	const roots = await declaredRoots(target);
	let domains = 0,
		pendingTasks = 0,
		queuedInputs = 0,
		control = false;
	for (const root of roots)
		for await (const item of walk(root)) {
			if (item.directory || !(await storageDescriptor(item.path, item.relative))) continue;
			const owner = await openStorageMaintenance({ storageDir: dirname(item.path), stores: [] });
			try {
				const work = await owner.work();
				pendingTasks += work.pendingTasks;
				queuedInputs += work.queuedInputs;
				domains++;
				if (
					owner.identity.sessionId === target.sessionId &&
					owner.identity.storageDir === dirname(target.sessionFile)
				)
					control = true;
			} finally {
				await owner.close();
			}
		}
	if (!control) throw new Error("Original control Session is absent from release health check");
	return {
		status: "healthy",
		maintenanceProtocol: 1,
		sessionId: target.sessionId,
		domains,
		pendingTasks,
		queuedInputs,
	};
}
export async function upgradeProduct(
	home: string,
	target: MaintenanceTarget,
	path: string,
	confirm?: string,
) {
	const { release, id } = await inspectProductRelease(path);
	if (!confirm)
		return {
			operation: "upgrade",
			releaseId: id,
			version: release.version,
			packages: release.packages.map((item) => ({ name: item.name, version: item.version })),
			sessionId: target.sessionId,
			requiresConfirmation: target.sessionId,
		};
	if (confirm !== target.sessionId) throw new Error("Confirmation must match original Session identity");
	const installed = await installRelease(home, path, release, id),
		directory = join(home, "maintenance", "upgrade-" + id);
	await privateDirectory(directory);
	const journalPath = join(directory, "operation.json");
	let state: UpgradeJournal;
	if (await exists(journalPath)) {
		const value = object(await readPrivateJson(journalPath));
		if (
			value.schema !== 1 ||
			value.id !== id ||
			value.sessionId !== target.sessionId ||
			value.dataDir !== target.dataDir ||
			value.release !== installed.entry ||
			value.backup !== join(directory, "before-upgrade") ||
			!["installed", "backed-up", "activated", "failed-held", "rolled-back"].includes(String(value.phase))
		)
			throw new Error("Original upgrade operation conflict");
		state = {
			schema: 1,
			id,
			sessionId: target.sessionId,
			dataDir: target.dataDir,
			release: installed.entry,
			backup: join(directory, "before-upgrade"),
			previous: value.previous === null ? null : decodeActive(value.previous, home),
			phase: value.phase as UpgradeJournal["phase"],
		};
		if (state.phase === "failed-held" || state.phase === "rolled-back")
			throw new Error("Failed/rolled-back upgrade requires explicit rollback/review, not automatic replay");
	} else {
		state = {
			schema: 1,
			id,
			sessionId: target.sessionId,
			dataDir: target.dataDir,
			release: installed.entry,
			backup: join(directory, "before-upgrade"),
			previous: await active(home),
			phase: "installed",
		};
		await writePrivateJson(journalPath, state);
	}
	const roots = await declaredRoots(target),
		gates: Awaited<ReturnType<typeof resumeMaintenanceGate>>[] = [];
	let safeRelease = false;
	try {
		for (const root of roots) gates.push(await resumeMaintenanceGate(root, "upgrade:" + id));
		if (state.phase === "installed") {
			if (await exists(state.backup)) await verifyProductBackup(state.backup);
			else await createProductBackup(target, state.backup, gates);
			state.phase = "backed-up";
			await replacePrivateJson(journalPath, state);
		} else await verifyProductBackup(state.backup);
		const result = await child(
			[installed.entry, "recover", "check", "--data-dir", target.dataDir, "--confirm", target.sessionId],
			installed.folder,
			{ ...safeEnvironment(home), PAKKA_RELEASE_ID: id },
			120000,
		);
		let health: Record<string, unknown> | undefined;
		try {
			health = object(JSON.parse(result.stdout));
		} catch {
			/* An invalid child response is a failed health check, never adoption. */
		}
		if (
			result.code !== 0 ||
			health?.status !== "healthy" ||
			health.sessionId !== target.sessionId ||
			health.maintenanceProtocol !== 1
		) {
			state.phase = "failed-held";
			await replacePrivateJson(journalPath, state);
			throw new Error(
				"Candidate offline health check failed; original upgrade backup retained and storage remains fenced; use upgrade --rollback " +
					id,
			);
		}
		await publishActive(home, {
			schema: 1,
			id,
			version: release.version,
			entry: installed.entry,
			sha256: installed.sha256,
		});
		state.phase = "activated";
		await replacePrivateJson(journalPath, state);
		safeRelease = true;
		return {
			status: "activated",
			releaseId: id,
			version: release.version,
			sessionId: target.sessionId,
			backup: state.backup,
			health,
			next: "Run pakka to open the original Sessions with this fixed release",
		};
	} finally {
		if (safeRelease) for (const gate of gates.reverse()) await gate.close();
	}
}
export async function rollbackProduct(home: string, target: MaintenanceTarget, id: string, confirm?: string) {
	if (!hash(id)) throw new Error("Invalid original upgrade identity");
	const path = join(home, "maintenance", "upgrade-" + id, "operation.json"),
		state = object(await readPrivateJson(path));
	if (
		state.schema !== 1 ||
		state.id !== id ||
		state.sessionId !== target.sessionId ||
		state.dataDir !== target.dataDir ||
		typeof state.backup !== "string"
	)
		throw new Error("Original upgrade rollback identity mismatch");
	const backup = await verifyProductBackup(state.backup);
	if (!confirm)
		return {
			operation: "rollback",
			releaseId: id,
			sessionId: target.sessionId,
			backup: state.backup,
			requiresConfirmation: target.sessionId,
		};
	if (confirm !== target.sessionId) throw new Error("Confirmation must match original Session identity");
	if (state.phase === "rolled-back")
		return {
			status: "already-rolled-back",
			releaseId: id,
			sessionId: target.sessionId,
			restoreId: backup.id,
		};
	const selected = await active(home);
	if (selected && selected.id !== id)
		throw new Error("Active release changed; refusing rollback of another operation");
	const roots = await declaredRoots(target),
		gates: Awaited<ReturnType<typeof resumeMaintenanceGate>>[] = [];
	for (const root of roots) gates.push(await resumeMaintenanceGate(root, "upgrade:" + id));
	// Hold markers survive release of the upgrade gates while restore acquires its own publication fences.
	for (let n = 0; n < roots.length; n++) {
		const hold = join(roots[n], "pakka-restored-hold.json");
		if (!(await exists(hold))) {
			const file = await open(hold, "wx", 0o600);
			try {
				await file.writeFile(
					JSON.stringify({ schema: 1, upgradeId: id, sessionId: target.sessionId, root: n }),
				);
				await file.sync();
			} finally {
				await file.close();
			}
		}
	}
	for (const gate of gates.reverse()) await gate.close();
	const { restoreProduct } = await import("./maintenance-restore.ts");
	const result = await restoreProduct(home, state.backup, target, confirm);
	const previous = state.previous === null ? null : decodeActive(state.previous, home);
	await publishActive(home, previous);
	await replacePrivateJson(path, { ...state, phase: "rolled-back" });
	return {
		status: "rolled-back-held",
		releaseId: id,
		sessionId: target.sessionId,
		restoreId: backup.id,
		result,
	};
}
export async function delegateActiveRelease(
	home: string,
	args: readonly string[],
): Promise<number | undefined> {
	if (process.env.PAKKA_RELEASE_ID || args[0] === "upgrade") return;
	const selected = await active(home);
	if (!selected) return;
	await assertPlainPath(selected.entry);
	if ((await digest(selected.entry)).sha256 !== selected.sha256)
		throw new Error("Selected release program digest changed");
	return new Promise<number>((done, reject) => {
		const task = spawn(process.execPath, [selected.entry, ...args], {
			env: { ...process.env, PAKKA_RELEASE_ID: selected.id },
			stdio: "inherit",
			windowsHide: true,
		});
		const interrupt = () => {
				if (process.platform !== "win32") task.kill("SIGINT");
			},
			terminate = () => task.kill("SIGTERM");
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		const cleanup = () => {
			process.off("SIGINT", interrupt);
			process.off("SIGTERM", terminate);
		};
		task.once("error", (error) => {
			cleanup();
			reject(error);
		});
		task.once("exit", (code) => {
			cleanup();
			done(code ?? 1);
		});
	});
}
