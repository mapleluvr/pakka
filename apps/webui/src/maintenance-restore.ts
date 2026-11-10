import { mkdir, lstat, readFile, rename, unlink, access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { openStorageMaintenance, recoverStorageWriter, type StorageMaintenanceWork } from "@pakka/agent";
import { createHash } from "node:crypto";
import { revokeRestoredPocketAccess } from "@pakka/server/pocket";
import { resumeMaintenanceGate, type MaintenanceTarget } from "./maintenance.ts";
import {
	privateDirectory,
	writePrivateJson,
	readPrivateJson,
	replacePrivateJson,
	assertPlainPath,
} from "./private-files.ts";
import { verifyProductBackup, backupFiles, streamCopy, declaredRoots, digest } from "./maintenance-backup.ts";
import { preserveOriginalBytes } from "./maintenance-preserve.ts";

type RestorePhase = "prepared" | "staged" | "publishing" | "held" | "resuming" | "resumed";
interface RestoreJournal {
	schema: 1;
	id: string;
	backupId: string;
	backup: string;
	sessionId: string;
	dataDir: string;
	preserved: string;
	roots: { source: string; stage: string; parked: string; published: boolean; missing: boolean }[];
	phase: RestorePhase;
	workReview?: {
		fingerprint: string;
		pendingTasks: number;
		queuedInputs: number;
		pendingRecords: number;
		reviewedAt: number;
	};
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid restore record");
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
function uuid(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}
function journal(value: unknown): RestoreJournal {
	const row = object(value);
	if (
		row.schema !== 1 ||
		!uuid(row.id) ||
		!uuid(row.backupId) ||
		!uuid(row.sessionId) ||
		typeof row.backup !== "string" ||
		typeof row.dataDir !== "string" ||
		typeof row.preserved !== "string" ||
		!Array.isArray(row.roots) ||
		!["prepared", "staged", "publishing", "held", "resuming", "resumed"].includes(String(row.phase))
	)
		throw new Error("Invalid restore operation identity");
	const roots = row.roots.map((value) => {
		const root = object(value);
		if (
			typeof root.source !== "string" ||
			root.stage !== root.source + ".restore." + row.id ||
			root.parked !== root.source + ".before-restore." + row.id ||
			typeof root.published !== "boolean" ||
			typeof root.missing !== "boolean"
		)
			throw new Error("Invalid restore publication paths");
		return {
			source: root.source,
			stage: root.stage,
			parked: root.parked,
			published: root.published,
			missing: root.missing,
		};
	});
	if (roots[0]?.source !== row.dataDir) throw new Error("Restore root mismatch");
	let workReview: RestoreJournal["workReview"];
	if (row.workReview !== undefined) {
		const review = object(row.workReview);
		const pendingRecords = review.pendingRecords === undefined ? 0 : review.pendingRecords;
		if (
			typeof review.fingerprint !== "string" ||
			!/^[0-9a-f]{64}$/.test(review.fingerprint) ||
			![review.pendingTasks, review.queuedInputs, pendingRecords, review.reviewedAt].every(
				(value) => Number.isSafeInteger(value) && Number(value) >= 0,
			)
		)
			throw new Error("Invalid persisted work review");
		workReview = {
			fingerprint: review.fingerprint,
			pendingTasks: Number(review.pendingTasks),
			queuedInputs: Number(review.queuedInputs),
			pendingRecords: Number(pendingRecords),
			reviewedAt: Number(review.reviewedAt),
		};
	}
	return {
		schema: 1,
		id: row.id,
		backupId: row.backupId,
		backup: row.backup,
		sessionId: row.sessionId,
		dataDir: row.dataDir,
		preserved: row.preserved,
		roots,
		phase: row.phase as RestorePhase,
		...(workReview ? { workReview } : {}),
	};
}
async function operationDirectory(home: string, id: string) {
	if (!uuid(id)) throw new Error("Invalid restore operation ID");
	await privateDirectory(join(home, "maintenance"));
	const folder = join(home, "maintenance", "restore-" + id);
	await privateDirectory(folder);
	return folder;
}
function stores() {
	return [
		{ namespace: "pocket.bootstrap", maxBytes: 65536 },
		{ namespace: "pocket.people", maxBytes: 262144 },
	];
}
async function recoverStagedClaim(storageDir: string) {
	const path = join(storageDir, "pakka-writer.json");
	if (!(await exists(path))) return;
	let value: Record<string, unknown>;
	try {
		value = object(JSON.parse(await readFile(path, "utf8")));
	} catch {
		throw new Error("Staged writer identity unavailable");
	}
	if (value.schema !== "pakka.writer.v1" || typeof value.pid !== "number" || typeof value.nonce !== "string")
		throw new Error("Staged writer identity invalid");
	await recoverStorageWriter({ storageDir, expectedClaim: { pid: value.pid, nonce: value.nonce } });
}
export async function restoreProduct(
	home: string,
	source: string,
	target: MaintenanceTarget,
	confirm?: string,
) {
	const manifest = await verifyProductBackup(source);
	if (manifest.control.sessionId !== target.sessionId || manifest.control.dataDir !== target.dataDir)
		throw new Error("Backup does not belong to original Session/location");
	if (!confirm)
		return {
			operation: "restore",
			backupId: manifest.id,
			sessionId: target.sessionId,
			roots: manifest.roots,
			requiresConfirmation: target.sessionId,
			external: manifest.external,
		};
	if (confirm !== target.sessionId) throw new Error("Confirmation must match original Session identity");
	const folder = await operationDirectory(home, manifest.id),
		recordPath = join(folder, "operation.json");
	let state: RestoreJournal;
	if (await exists(recordPath)) {
		state = journal(await readPrivateJson(recordPath));
		if (
			state.backup !== resolve(source) ||
			state.backupId !== manifest.id ||
			state.sessionId !== target.sessionId ||
			state.dataDir !== target.dataDir
		)
			throw new Error("Restore operation conflict");
		if (["held", "resumed"].includes(state.phase))
			return {
				status: state.phase,
				restoreId: state.id,
				preserved: state.preserved,
				sessionId: target.sessionId,
			};
	} else {
		if (await exists(target.dataDir)) {
			const live = await declaredRoots(target);
			if (JSON.stringify(live) !== JSON.stringify(manifest.roots))
				throw new Error("Current and backup storage declarations differ");
		}
		const present = await Promise.all(manifest.roots.map(exists));
		state = {
			schema: 1,
			id: manifest.id,
			backupId: manifest.id,
			backup: resolve(source),
			sessionId: target.sessionId,
			dataDir: target.dataDir,
			preserved: join(folder, "current-data"),
			roots: manifest.roots.map((root, n) => ({
				source: root,
				stage: root + ".restore." + manifest.id,
				parked: root + ".before-restore." + manifest.id,
				published: false,
				missing: !present[n],
			})),
			phase: "prepared",
		};
		for (const root of state.roots)
			if ((await exists(root.stage)) || (await exists(root.parked)))
				throw new Error("Restore staging or preservation path already exists");
		await writePrivateJson(recordPath, state);
	}
	const gates: Awaited<ReturnType<typeof resumeMaintenanceGate>>[] = [];
	let safeRelease = false;
	const save = () => replacePrivateJson(recordPath, state);
	try {
		for (const root of state.roots)
			gates.push(await resumeMaintenanceGate(root.source, "restore:" + state.id));
		await preserveOriginalBytes(
			state.roots.map((root) => root.source),
			state.preserved,
			state.id,
			state.sessionId,
		);
		if (state.phase === "prepared") {
			for (const root of state.roots) if (!(await exists(root.stage))) await privateDirectory(root.stage);
			for await (const row of backupFiles(source, manifest)) {
				const file = join(state.roots[row.root].stage, ...row.path.split("/"));
				await mkdir(dirname(file), { recursive: true, mode: 0o700 });
				if (await exists(file)) {
					// Interrupted staging never overwrites an unknown file; repeat with this operation's verified copy only.
					const original = join(source, "roots", String(row.root), ...row.path.split("/"));
					const left = await lstat(file),
						right = await lstat(original);
					if (left.size !== right.size)
						throw new Error("Interrupted staging file differs; explicit reconciliation required");
					if ((await digest(file)).sha256 !== row.sha256)
						throw new Error("Interrupted staging digest differs");
				} else {
					const proof = await streamCopy(
						join(source, "roots", String(row.root), ...row.path.split("/")),
						file,
					);
					if (proof.sha256 !== row.sha256 || proof.size !== row.size)
						throw new Error("Backup changed during restore");
				}
			}
			for (const domain of manifest.domains) {
				const storageDir = join(state.roots[domain.root].stage, ...domain.path.split("/"));
				await recoverStagedClaim(storageDir);
				const owner = await openStorageMaintenance({
					storageDir,
					expectedSessionId: domain.sessionId,
					stores: domain.sessionId === target.sessionId ? stores() : [],
				});
				try {
					await owner.work();
					if (domain.sessionId === target.sessionId) await revokeRestoredPocketAccess(owner);
				} finally {
					await owner.close();
				}
			}
			for (let root = 0; root < state.roots.length; root++) {
				const hold = join(state.roots[root].stage, "pakka-restored-hold.json");
				if (!(await exists(hold)))
					await writePrivateJson(hold, {
						schema: 1,
						restoreId: state.id,
						sessionId: target.sessionId,
						root,
						backupId: manifest.id,
					});
			}
			state.phase = "staged";
			await save();
		}
		state.phase = "publishing";
		await save();
		for (const root of state.roots) {
			await assertPlainPath(dirname(root.source));
			const sourceExists = await exists(root.source),
				stageExists = await exists(root.stage),
				parkedExists = await exists(root.parked);
			if (!root.missing && sourceExists && stageExists && !parkedExists) {
				await rename(root.source, root.parked);
				await rename(root.stage, root.source);
			} else if (!sourceExists && stageExists && (parkedExists || root.missing))
				await rename(root.stage, root.source);
			else if (sourceExists && !stageExists && (parkedExists || root.missing)) {
				const hold = object(await readPrivateJson(join(root.source, "pakka-restored-hold.json")));
				if (hold.restoreId !== state.id) throw new Error("Published restore identity mismatch");
			} else throw new Error("Restore publication state unknown; storage remains fenced");
			root.published = true;
			await save();
		}
		state.phase = "held";
		await save();
		safeRelease = true;
		return {
			status: "held",
			restoreId: state.id,
			sessionId: target.sessionId,
			preserved: state.preserved,
			parked: state.roots.filter((root) => !root.missing).map((root) => root.parked),
			next: "recover login, then restore --resume <restore ID> --confirm <Session ID> after external-effect review",
		};
	} finally {
		if (safeRelease) for (const gate of gates.reverse()) await gate.close();
	}
}
export async function resumeRestoredProduct(
	home: string,
	target: MaintenanceTarget,
	id: string,
	confirm?: string,
	reviewWork?: string,
) {
	if (!uuid(id)) throw new Error("Invalid original restore identity");
	if (confirm && confirm !== target.sessionId)
		throw new Error("Confirmation must match original Session identity");
	if (reviewWork !== undefined && !/^[0-9a-f]{64}$/.test(reviewWork))
		throw new Error("Invalid exact persisted-work review identity");
	const folder = join(home, "maintenance", "restore-" + id),
		path = join(folder, "operation.json"),
		state = journal(await readPrivateJson(path));
	if (state.id !== id || state.sessionId !== target.sessionId || state.dataDir !== target.dataDir)
		throw new Error("Restore target identity conflict");
	if (state.phase === "resumed") return { status: "resumed", restoreId: id, sessionId: target.sessionId };
	if (!["held", "resuming"].includes(state.phase))
		throw new Error("Restore publication is incomplete; reconcile the original restore first");
	const manifest = await verifyProductBackup(state.backup),
		gates: Awaited<ReturnType<typeof resumeMaintenanceGate>>[] = [];
	let safeRelease = false;
	try {
		for (const root of state.roots) gates.push(await resumeMaintenanceGate(root.source, "restore:" + id));
		const domains: { sessionId: string; work: StorageMaintenanceWork }[] = [];
		for (const domain of manifest.domains) {
			const owner = await openStorageMaintenance({
				storageDir: join(state.roots[domain.root].source, ...domain.path.split("/")),
				expectedSessionId: domain.sessionId,
				stores: [],
			});
			try {
				domains.push({ sessionId: domain.sessionId, work: await owner.work() });
			} finally {
				await owner.close();
			}
		}
		let holdsComplete = true;
		for (let n = 0; n < state.roots.length; n++) {
			const hold = join(state.roots[n].source, "pakka-restored-hold.json");
			if (await exists(hold)) {
				const value = object(await readPrivateJson(hold));
				if (value.restoreId !== id || value.root !== n) throw new Error("Restored hold identity changed");
			} else if (state.phase !== "resuming") throw new Error("Restored hold unexpectedly missing");
			else holdsComplete = false;
		}
		// Known preview/refusal can release the transient fences only while every durable execution hold remains.
		safeRelease = holdsComplete;
		const pendingTasks = domains.reduce((sum, value) => sum + value.work.pendingTasks, 0),
			queuedInputs = domains.reduce((sum, value) => sum + value.work.queuedInputs, 0),
			pendingRecords = domains.reduce((sum, value) => sum + value.work.pendingRecords, 0),
			hasWork = pendingTasks > 0 || queuedInputs > 0 || pendingRecords > 0;
		const fingerprint = createHash("sha256")
			.update(
				JSON.stringify({
					restoreId: id,
					domains: domains.map((value) => ({
						sessionId: value.sessionId,
						fingerprint: value.work.fingerprint,
					})),
				}),
			)
			.digest("hex");
		if (!confirm)
			return {
				operation: "resume",
				restoreId: id,
				sessionId: target.sessionId,
				phase: state.phase,
				requiresConfirmation: target.sessionId,
				pendingTasks,
				queuedInputs,
				pendingRecords,
				domains,
				...(hasWork ? { reviewWork: fingerprint } : {}),
				externalEffects:
					"Independently review post-backup effects before acknowledging this exact work set. No native task or receipt is reset.",
			};
		const acknowledged = reviewWork ?? state.workReview?.fingerprint;
		if (hasWork && acknowledged !== fingerprint)
			throw new Error(
				"Persisted work requires independent external-effect review: preview restore --resume " +
					id +
					", then acknowledge its exact --review-work fingerprint; restored execution stays held",
			);
		if (reviewWork !== undefined && reviewWork !== fingerprint)
			throw new Error("Persisted-work review changed; original restore remains held");
		if (hasWork)
			state.workReview = {
				fingerprint,
				pendingTasks,
				queuedInputs,
				pendingRecords,
				reviewedAt: state.workReview?.fingerprint === fingerprint ? state.workReview.reviewedAt : Date.now(),
			};
		safeRelease = false;
		state.phase = "resuming";
		await replacePrivateJson(path, state);
		for (const root of state.roots) {
			const hold = join(root.source, "pakka-restored-hold.json");
			if (await exists(hold)) await unlink(hold);
		}
		state.phase = "resumed";
		await replacePrivateJson(path, state);
		safeRelease = true;
		return {
			status: "resumed",
			restoreId: id,
			sessionId: target.sessionId,
			...(state.workReview ? { workReview: state.workReview } : {}),
		};
	} finally {
		if (safeRelease) for (const gate of gates.reverse()) await gate.close();
	}
}
