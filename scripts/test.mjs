import { spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	openSync,
	closeSync,
	unlinkSync,
	appendFileSync,
	createWriteStream,
} from "node:fs";
import { freemem } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { inventory, select } from "./test-selection.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
async function main() {
	const plan = select(inventory(root), process.argv.slice(2));
	if (plan.list) {
		console.log(JSON.stringify(plan, null, 2));
		return;
	}
	const area = join(root, "artifacts", "test-runs");
	mkdirSync(area, { recursive: true });
	// Some existing browser tests still write fixed workspace paths. Serialize
	// invocations in this worktree; per-file scheduling below owns all children.
	const lock = join(area, "active.json");
	let fd;
	try {
		fd = openSync(lock, "wx");
	} catch (error) {
		if (error.code === "EEXIST")
			throw Error(
				"Test run owns " + lock + "; inspect recorded PID/run and descendants before clearing a stale lock",
			);
		throw error;
	}
	const run = realpathSync.native(mkdtempSync(join(area, "run-")));
	writeFileSync(fd, JSON.stringify({ pid: process.pid, run }));
	closeSync(fd);
	const active = new Map();
	let cancelled = false,
		minFreeBytes = freemem();
	const event = (value) =>
		appendFileSync(
			join(run, "progress.jsonl"),
			JSON.stringify({ at: new Date().toISOString(), ...value }) + "\n",
		);
	const cancel = () => {
		if (cancelled) return;
		cancelled = true;
		event({ kind: "cancel-requested" });
		for (const child of active.keys()) {
			if (process.platform === "win32") {
				const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
				killer.on("error", (error) => event({ kind: "cleanup-error", message: error.message }));
			} else {
				try {
					process.kill(-child.pid, "SIGTERM");
				} catch (error) {
					event({ kind: "cleanup-error", message: error.message });
				}
			}
		}
	};
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	const sample = setInterval(() => {
		const free = freemem();
		minFreeBytes = Math.min(minFreeBytes, free);
		event({ kind: "memory", freeBytes: free, active: active.size });
	}, 2000);
	const results = [];
	console.log("run=" + run);
	console.log(
		`selected=${plan.selected.length} excluded=${plan.excluded.length} suite=${plan.suite} lightWorkers=${plan.workers} heavyWorkers=1`,
	);
	writeFileSync(join(run, "selection.json"), JSON.stringify(plan, null, 2));
	async function execute(file) {
		const index = plan.selected.indexOf(file) + 1;
		const worker = join(run, "workers", String(index).padStart(4, "0")),
			home = join(worker, "pakka-test-profile-" + index),
			temp = join(home, "tmp"),
			artifacts = join(worker, "artifacts"),
			metrics = join(worker, "metrics");
		for (const path of [temp, artifacts, metrics]) mkdirSync(path, { recursive: true });
		const env = {};
		for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "PAKKA_TEST_CHROME"])
			if (process.env[key]) env[key] = process.env[key];
		Object.assign(env, {
			HOME: home,
			USERPROFILE: home,
			PI_CODING_AGENT_DIR: home,
			TEMP: temp,
			TMP: temp,
			TMPDIR: temp,
			DO_NOT_TRACK: "1",
			PI_OFFLINE: "1",
			NO_COLOR: "1",
			PAKKA_TEST_ARTIFACTS: artifacts,
			PAKKA_TEST_METRICS: metrics,
		});
		const started = Date.now();
		event({ kind: "start", file, worker });
		console.log("start " + file);
		const log = createWriteStream(join(worker, "output.tap"));
		const child = spawn(
			process.execPath,
			[
				"--experimental-strip-types",
				"--expose-gc",
				"--import",
				new URL("./test-monitor.mjs", import.meta.url).href,
				"--test",
				"--test-reporter=tap",
				"--test-concurrency=1",
				...plan.nodeArgs,
				file,
			],
			{ cwd: root, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] },
		);
		active.set(child, file);
		child.stdout.pipe(log, { end: false });
		child.stderr.pipe(log, { end: false });
		let error;
		child.on("error", (e) => {
			error = e.message;
		});
		const outcome = await new Promise((resolve) =>
			child.on("close", (code, signal) => resolve({ code, signal })),
		);
		await new Promise((resolve) => log.end(resolve));
		active.delete(child);
		const samples = readdirSync(metrics).map((name) => JSON.parse(readFileSync(join(metrics, name), "utf8")));
		const output = readFileSync(join(worker, "output.tap"), "utf8");
		const counts = Object.fromEntries(
			[...output.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)/gm)].map((m) => [m[1], Number(m[2])]),
		);
		const result = {
			file,
			...outcome,
			error,
			elapsedMs: Date.now() - started,
			workerMaxRssBytes: samples.length ? Math.max(...samples.map((x) => x.maxRssBytes)) : null,
			counts,
			// Node 24 counts an empty filtered file itself as one passing test.
			empty: counts.tests === 0 || (counts.tests === 1 && /^1\.\.0$/m.test(output)),
		};
		results.push(result);
		event({ kind: "end", ...result });
		console.log(`end ${file} code=${outcome.code} signal=${outcome.signal} ms=${result.elapsedMs}`);
	}
	const started = Date.now();
	try {
		const queues = { light: plan.light.slice(), heavy: plan.heavy.slice() };
		async function consume(kind) {
			let waited = 0;
			while (queues[kind].length && !cancelled) {
				if (kind === "heavy" && freemem() < 1024 ** 3) {
					if (waited === 0) event({ kind: "memory-paused", freeBytes: freemem() });
					if (waited >= 30000) {
						event({ kind: "memory-blocked", files: queues[kind] });
						break;
					}
					await new Promise((r) => setTimeout(r, 1000));
					waited += 1000;
					continue;
				}
				waited = 0;
				await execute(queues[kind].shift());
			}
		}
		await Promise.all([consume("heavy"), ...Array.from({ length: plan.workers }, () => consume("light"))]);
		const pending = plan.selected.filter((f) => !results.some((r) => r.file === f));
		const status = cancelled
			? "cancelled"
			: pending.length
				? "blocked"
				: results.some((r) => r.code !== 0 || r.signal || r.empty)
					? "failed"
					: "passed";
		const summary = {
			status,
			elapsedMs: Date.now() - started,
			minFreeBytes,
			files: results,
			pending,
			cleanup: cancelled
				? "unverified-after-cancellation; inspect descendants before clearing lock"
				: "workers-closed",
		};
		writeFileSync(join(run, "summary.json"), JSON.stringify(summary, null, 2));
		console.log(`status=${status} ms=${summary.elapsedMs}`);
		process.exitCode = status === "passed" ? 0 : 1;
	} finally {
		clearInterval(sample);
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
		// A cancellation request and a direct child exit do not prove descendant cleanup.
		if (active.size === 0 && !cancelled) unlinkSync(lock);
	}
}
main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
