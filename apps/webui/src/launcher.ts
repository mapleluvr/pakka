import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { startPocket, type PocketProductOptions } from "./bootstrap.ts";
import { decodePocketProduct, loadPocketModule } from "./main.ts";
import { createLocalProduct } from "./product-runtime.ts";

type Configuration = { kind: "json" | "module"; path: string } | { kind: "local"; cwd: string };
type StartupState = {
	version: 1;
	phase: "opening" | "ready";
	sessionId: string;
	sessionFile: string;
	port?: number;
};
class LaunchError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}
const usage = `Pakka — WebUI launcher

  pakka                                      Start or reopen the local WebUI
  pakka --config <host.json>                  Use and remember a host configuration
  pakka --config-module <trusted-host.mjs>    Use and remember trusted local host code
  pakka --no-open                            Do not open a browser
  pakka --recover                            Explicitly reopen the recorded original Session
  pakka --owner-file <private-file>          Choose the initial owner-link file
  pakka --connection <client.json> hello|snapshot|call --command <command.json>

Configuration: explicit flag > PAKKA_CONFIG > saved reference > PAKKA_HOME/config.json > built-in local.
PAKKA_HOME defaults to ~/.pakka; local Session data is under PAKKA_HOME/data.
Models and authentication use Pi's native directory (PI_CODING_AGENT_DIR or ~/.pi/agent).
No model or host JSON is required to open WebUI.
Local presets: default = read/write/edit + PowerShell (Windows) or Bash; read-only = read.
Local tools use your OS permissions, not a sandbox. Child commands do not inherit model credentials.
Instructions, skills and templates are local data; startup does not install packages or execute extensions.
--recover never clears writer locks, replaces missing storage or replays requests.
The WebUI manages Sessions and Conversations. Closing the browser does not stop work;
Ctrl+C stops this foreground host. --control-stdin accepts stop/EOF for automation.
`;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new Error("Invalid launcher record");
	return value as Record<string, unknown>;
}
async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
async function json(path: string): Promise<unknown> {
	const stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072)
		throw new Error("Invalid launcher input file");
	const bytes = await readFile(path);
	if (bytes.byteLength > 131072) throw new Error("Launcher input too large");
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new Error("Invalid launcher JSON encoding or syntax");
	}
}
async function replaceJson(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600, flush: true });
	await rename(temporary, path);
}
function parse(args: readonly string[]) {
	let config: Configuration | undefined;
	let ownerFile: string | undefined;
	let noOpen = false;
	let controlStdin = false;
	let recover = false;
	const seen = new Set<string>();
	for (let index = 0; index < args.length; index++) {
		const flag = args[index];
		if (seen.has(flag)) throw new LaunchError("PAKKA_ARGUMENTS", "重复参数；运行 pakka --help 查看用法。");
		seen.add(flag);
		if (flag === "--no-open") noOpen = true;
		else if (flag === "--recover") recover = true;
		else if (flag === "--control-stdin") controlStdin = true;
		else if (["--config", "--config-module", "--owner-file"].includes(flag)) {
			const value = args[++index];
			if (!value || value.startsWith("--") || /[\x00-\x1f\x7f]/.test(value))
				throw new LaunchError("PAKKA_ARGUMENTS", "缺少有效文件路径；运行 pakka --help 查看用法。");
			if (flag === "--owner-file") ownerFile = resolve(value);
			else {
				if (config) throw new LaunchError("PAKKA_ARGUMENTS", "--config 与 --config-module 只能选择一个。");
				config = { kind: flag === "--config" ? "json" : "module", path: resolve(value) };
			}
		} else
			throw new LaunchError("PAKKA_ARGUMENTS", "未知参数；运行 pakka --help 查看 WebUI 和协议客户端用法。");
	}
	return { config, ownerFile, noOpen, controlStdin, recover };
}
async function configuration(explicit: Configuration | undefined, home: string): Promise<Configuration> {
	if (explicit) return explicit;
	if (process.env.PAKKA_CONFIG) return { kind: "json", path: resolve(process.env.PAKKA_CONFIG) };
	const saved = join(home, "launch.json");
	if (await exists(saved)) {
		try {
			const value = record(await json(saved), ["version", "config"]);
			const config = record(value.config, ["kind", "path", "cwd"]);
			if (value.version !== 1) throw new Error("Invalid saved configuration version");
			if (config.kind === "local") {
				record(value.config, ["kind", "cwd"]);
				if (typeof config.cwd !== "string" || !isAbsolute(config.cwd) || /[\x00-\x1f\x7f]/.test(config.cwd))
					throw new Error("Invalid saved local workspace");
				return { kind: "local", cwd: config.cwd };
			}
			record(value.config, ["kind", "path"]);
			if (
				!["json", "module"].includes(String(config.kind)) ||
				typeof config.path !== "string" ||
				!isAbsolute(config.path)
			)
				throw new Error("Invalid saved configuration reference");
			return { kind: config.kind === "json" ? "json" : "module", path: config.path };
		} catch {
			throw new LaunchError(
				"PAKKA_CONFIG_REFERENCE_INVALID",
				"已保存的配置引用不可读；用 pakka --config <文件> 或 --config-module <文件> 显式指定，不会自动回退。",
			);
		}
	}
	const path = join(home, "config.json");
	if (await exists(path)) return { kind: "json", path };
	return { kind: "local", cwd: process.cwd() };
}
async function load(config: Configuration, home: string): Promise<PocketProductOptions> {
	try {
		if (config.kind === "local")
			return await createLocalProduct({ cwd: config.cwd, dataDir: join(home, "data") });
		const options =
			config.kind === "module"
				? await loadPocketModule(config.path)
				: decodePocketProduct(await json(config.path));
		const base = dirname(config.path);
		return {
			...options,
			runtime: {
				...options.runtime,
				cwd: resolve(base, options.runtime.cwd),
				dataDir: resolve(base, options.runtime.dataDir),
				...(options.runtime.reopenSessionFile
					? { reopenSessionFile: resolve(base, options.runtime.reopenSessionFile) }
					: {}),
				...(options.runtime.profiles
					? {
							profiles: options.runtime.profiles.map((profile) => ({
								...profile,
								...(profile.cwd ? { cwd: resolve(base, profile.cwd) } : {}),
							})),
						}
					: {}),
			},
		};
	} catch {
		throw new LaunchError(
			"PAKKA_CONFIG_INVALID",
			"WebUI 宿主配置不可用。检查文件路径、格式、运行目录和受信任模块；未输出配置内容或凭据。",
		);
	}
}
async function readState(path: string, dataDir: string): Promise<StartupState | undefined> {
	if (!(await exists(path))) return undefined;
	try {
		const state = record(await json(path), ["version", "phase", "sessionId", "sessionFile", "port"]);
		if (
			state.version !== 1 ||
			!["opening", "ready"].includes(String(state.phase)) ||
			typeof state.sessionId !== "string" ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(state.sessionId) ||
			state.sessionFile !== join(dataDir, "sessions", state.sessionId, "main.sqlite") ||
			(state.port !== undefined &&
				(!Number.isSafeInteger(state.port) || (state.port as number) < 1 || (state.port as number) > 65535))
		)
			throw new Error("Invalid startup state");
		return {
			version: 1,
			phase: state.phase === "opening" ? "opening" : "ready",
			sessionId: state.sessionId,
			sessionFile: state.sessionFile,
			...(state.port !== undefined ? { port: state.port as number } : {}),
		};
	} catch {
		throw new LaunchError(
			"PAKKA_STATE_INVALID",
			"launcher-state.json 无法核对。保留文件和 Session 数据，按原 sessionFile 检查恢复；不会自动创建新 Session。",
		);
	}
}
function stopSignal(controlStdin: boolean) {
	let requested = false;
	let finish!: () => void;
	const wait = new Promise<void>((done) => {
		finish = done;
	});
	const stop = () => {
		requested = true;
		finish();
	};
	let input = "";
	const data = (chunk: string) => {
		input += chunk;
		if (input.trim() === "stop" || input.length > 128) stop();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	if (controlStdin) {
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", data);
		process.stdin.once("end", stop);
		process.stdin.resume();
	}
	return {
		wait,
		get requested() {
			return requested;
		},
		dispose() {
			process.removeListener("SIGINT", stop);
			process.removeListener("SIGTERM", stop);
			if (controlStdin) {
				process.stdin.removeListener("data", data);
				process.stdin.removeListener("end", stop);
				process.stdin.pause();
			}
		},
	};
}
/** No shell interpolation or custom command execution; the URL is not printed. */
async function openBrowser(url: string): Promise<boolean> {
	const command =
		process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
	const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
	return new Promise<boolean>((done) => {
		const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
		const timer = setTimeout(() => {
			child.unref();
			done(true);
		}, 1000);
		child.once("error", () => {
			clearTimeout(timer);
			done(false);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			done(code === 0);
		});
	});
}

/** Foreground product entry. Model/provider configuration stays with the host, not an onboarding wizard. */
export async function runLauncher(args: readonly string[]): Promise<number> {
	if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
		process.stdout.write(usage);
		return 0;
	}
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	let stop: ReturnType<typeof stopSignal> | undefined;
	let ownedModels: PocketProductOptions["modelConfiguration"];
	try {
		const flags = parse(args);
		const home = resolve(process.env.PAKKA_HOME || join(homedir(), ".pakka"));
		const config = await configuration(flags.config, home);
		const options = await load(config, home);
		if (config.kind === "local") ownedModels = options.modelConfiguration;
		const dataDir = options.runtime.dataDir;
		const stateFile = join(dataDir, "launcher-state.json");
		let state = await readState(stateFile, dataDir);
		if (flags.recover && !state && !options.runtime.reopenSessionFile)
			throw new LaunchError(
				"PAKKA_RECOVERY_IDENTITY_REQUIRED",
				"没有可核对的原 Session 定位记录。保留原数据并明确指定原 reopenSessionFile；--recover 不创建或猜测 Session。",
			);
		if (
			state?.phase === "opening" &&
			!flags.recover &&
			options.runtime.reopenSessionFile !== state.sessionFile
		)
			throw new LaunchError(
				"PAKKA_STARTUP_UNCONFIRMED",
				"上次启动尚未确认。保留 launcher-state.json 和 Session 数据；核对原存储后运行 pakka --recover，或显式设置同一 reopenSessionFile；不会清锁、另建 Session 或重发工作。",
			);
		if (
			state &&
			((options.runtime.reopenSessionFile && options.runtime.reopenSessionFile !== state.sessionFile) ||
				(options.runtime.reservedSessionId && options.runtime.reservedSessionId !== state.sessionId))
		)
			throw new LaunchError(
				"PAKKA_STATE_CONFLICT",
				"配置与已保存 Session 不一致。使用原配置或明确分开的数据目录；不会替换原 Session。",
			);
		const ownerFile = flags.ownerFile ?? join(dataDir, "owner-link.txt");
		const reopening = state !== undefined || options.runtime.reopenSessionFile !== undefined;
		if (
			!state &&
			!options.runtime.reopenSessionFile &&
			(await exists(join(dataDir, "sessions"))) &&
			(await readdir(join(dataDir, "sessions"))).length
		)
			throw new LaunchError(
				"PAKKA_STATE_MISSING",
				"数据目录已有 Session，但缺少启动定位记录。请在宿主配置中显式指定原 reopenSessionFile；不会自动创建新 Session。",
			);
		if (!reopening && (await exists(ownerFile)))
			throw new LaunchError(
				"PAKKA_OWNER_FILE_EXISTS",
				"私密 owner 文件已存在；不会覆盖。请核对原数据或使用 --owner-file 明确指定新文件。",
			);
		const sessionId =
			state?.sessionId ??
			(options.runtime.reopenSessionFile
				? basename(dirname(options.runtime.reopenSessionFile))
				: (options.runtime.reservedSessionId ?? randomUUID()));
		const sessionFile = join(dataDir, "sessions", sessionId, "main.sqlite");
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId) ||
			(options.runtime.reopenSessionFile && options.runtime.reopenSessionFile !== sessionFile)
		)
			throw new LaunchError(
				"PAKKA_CONFIG_INVALID",
				"reopenSessionFile 必须明确指向该 dataDir 内的原 main.sqlite；不会替换或猜测路径。",
			);
		stop = stopSignal(flags.controlStdin);
		await mkdir(dataDir, { recursive: true, mode: 0o700 });
		if (!state) {
			state = { version: 1, phase: "opening", sessionId, sessionFile };
			// Reserve before any runtime side effect. A crash/race never silently allocates a replacement Session.
			await writeFile(stateFile, JSON.stringify(state) + "\n", { flag: "wx", mode: 0o600, flush: true });
		}
		app = await startPocket({
			...options,
			runtime: {
				...options.runtime,
				reservedSessionId: state.sessionId,
				...(reopening ? { reopenSessionFile: state.sessionFile } : {}),
			},
			...(state.port && !options.transport?.port && !options.transport?.publicOrigin
				? { transport: { ...options.transport, port: state.port } }
				: {}),
		});
		if (app.initialOwner)
			await writeFile(ownerFile, `${app.http.origin}/#signin=${app.initialOwner.token}\n`, {
				flag: "wx",
				mode: 0o600,
				flush: true,
			});
		const ready = {
			origin: app.http.origin,
			serverId: app.http.serverId,
			sessionFile: app.runtime.view().sessionFile,
		};
		const origin = new URL(app.http.origin);
		await replaceJson(stateFile, {
			...state,
			phase: "ready",
			sessionFile: ready.sessionFile,
			...(!options.transport?.publicOrigin
				? { port: Number(origin.port || (origin.protocol === "https:" ? 443 : 80)) }
				: {}),
		});
		await mkdir(home, { recursive: true, mode: 0o700 });
		await replaceJson(join(home, "launch.json"), { version: 1, config });
		if (flags.controlStdin) process.stdout.write(JSON.stringify(ready) + "\n");
		else process.stdout.write(`Pakka WebUI\n  ${ready.origin}\n  Session: ${ready.sessionFile}\n`);
		process.stderr.write(
			`WebUI 已启动。关闭网页不会停止任务；Ctrl+C 正常停止宿主。${app.initialOwner ? `\n首次 owner 登录链接已写入私密文件：${ownerFile}` : "\n使用已登录的浏览器；本次不会重新签发 owner 凭据。"}\n`,
		);
		if (!flags.noOpen && !stop.requested) {
			const url = app.initialOwner ? `${ready.origin}/#signin=${app.initialOwner.token}` : ready.origin;
			if (!(await openBrowser(url)))
				process.stderr.write(
					"无法自动打开浏览器；请手动打开上述地址（首次登录使用私密 owner 文件），或使用 --no-open。\n",
				);
		}
		await stop.wait;
		await app.close();
		app = undefined;
		await ownedModels?.close();
		ownedModels = undefined;
		return 0;
	} catch (error) {
		try {
			await app?.close();
		} catch {
			/* Keep state and unknown ownership for explicit recovery. */
		}
		try {
			await ownedModels?.close();
		} catch {
			/* The invocation still exits as unconfirmed below. */
		}
		const failure =
			error instanceof LaunchError
				? error
				: new LaunchError(
						"PAKKA_STARTUP_UNCONFIRMED",
						"WebUI 启动或停止未确认。检查已有实例、端口、配置及私密文件权限；保留 launcher-state.json/原 Session 数据，不会自动清理或另建 Session。",
					);
		process.stderr.write(`${failure.code}: ${failure.message}\n`);
		return 1;
	} finally {
		stop?.dispose();
	}
}
