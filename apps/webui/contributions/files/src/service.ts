import { decodeManifest, decodeValue, isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import definition from "../manifest.json" with { type: "json" };

const manifest = decodeManifest(definition);
const invalid = (): never => {
	throw new Error("文件服务返回了无法确认的数据。");
};
export const object = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : invalid());
const text = (value: unknown) => (typeof value === "string" ? value : invalid());
const number = (value: unknown) =>
	typeof value === "number" && Number.isSafeInteger(value) ? value : invalid();
const boolean = (value: unknown) => (typeof value === "boolean" ? value : invalid());
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : invalid());
export function declaration(action: string) {
	const found = manifest.actions.find((item) => item.id === action);
	if (!found) throw new Error("未知文件操作。");
	return found;
}
export const inputFor = (action: string, input: unknown) => decodeValue(declaration(action).input, input);
export function outputFor(action: string, value: unknown) {
	return object(decodeValue(declaration(action).output, value));
}
export type FileAddress = { root: string; path: string };
export type FileRoot = { id: string; writable: boolean; git: boolean };
export type FileEntry = { name: string; path: string; kind: "file" | "directory"; bytes: number };
export type FileView = FileAddress & {
	bytes: number;
	sha256: string;
	type: string;
	text?: string;
	base64?: string;
};
export type FileListing = FileAddress & { entries: FileEntry[]; truncated: boolean };
export type GitBranch = { name: string; current: boolean; commit: string };
export type GitTree = { name: string; branch: string };
export type GitChange = { path: string; status: string; previousPath?: string };
export type GitView = { changes: GitChange[]; branches: GitBranch[]; worktrees: GitTree[] };
export type FileReceipt = {
	requestId: string;
	state: "done" | "conflict" | "unknown";
	value?: { path?: string; sha256?: string; name?: string; branch?: string };
};
export const mutations = ["write", "upload", "switch-branch", "add-worktree", "remove-worktree"] as const;
export type FileMutation = (typeof mutations)[number];
export const isMutation = (value: unknown): value is FileMutation =>
	mutations.some((action) => action === value);
export const failure = (reason: unknown) =>
	reason instanceof Error ? reason.message : "文件操作结果无法确认。";
export function fileReceipt(action: string, value: unknown): FileReceipt {
	const row = outputFor(action, value);
	if (row.state !== "done" && row.state !== "conflict" && row.state !== "unknown") return invalid();
	const result: FileReceipt = { requestId: text(row.requestId), state: row.state };
	if (row.value !== undefined) {
		const fields = object(row.value);
		result.value = {
			...(fields.path === undefined ? {} : { path: text(fields.path) }),
			...(fields.sha256 === undefined ? {} : { sha256: text(fields.sha256) }),
			...(fields.name === undefined ? {} : { name: text(fields.name) }),
			...(fields.branch === undefined ? {} : { branch: text(fields.branch) }),
		};
	}
	return result;
}
export async function read(
	service: ExtensionServiceBinding,
	action: string,
	input: ExtensionJson,
	signal: AbortSignal,
) {
	const result = await service.call(action, inputFor(action, input), { signal });
	signal.throwIfAborted();
	if (result.state !== "done") throw new Error("本次读取未确认，请重新读取。");
	return outputFor(action, result.value);
}
export async function roots(service: ExtensionServiceBinding, signal: AbortSignal): Promise<FileRoot[]> {
	const value = await read(service, "roots", {}, signal);
	return array(value.roots).map((value) => {
		const row = object(value);
		return { id: text(row.id), writable: boolean(row.writable), git: boolean(row.git) };
	});
}
export async function listing(
	service: ExtensionServiceBinding,
	address: FileAddress,
	signal: AbortSignal,
): Promise<FileListing> {
	const value = await read(service, "list", address, signal);
	return {
		root: text(value.root),
		path: text(value.path),
		truncated: boolean(value.truncated),
		entries: array(value.entries).map((value) => {
			const row = object(value);
			if (row.kind !== "file" && row.kind !== "directory") return invalid();
			return { name: text(row.name), path: text(row.path), bytes: number(row.bytes), kind: row.kind };
		}),
	};
}
export async function file(
	service: ExtensionServiceBinding,
	address: FileAddress,
	signal: AbortSignal,
): Promise<FileView> {
	const row = await read(service, "read", address, signal);
	return {
		root: text(row.root),
		path: text(row.path),
		bytes: number(row.bytes),
		sha256: text(row.sha256),
		type: text(row.type),
		...(row.text === undefined ? {} : { text: text(row.text) }),
		...(row.base64 === undefined ? {} : { base64: text(row.base64) }),
	};
}
export async function git(
	service: ExtensionServiceBinding,
	root: string,
	signal: AbortSignal,
): Promise<GitView> {
	const [changes, branches, worktrees] = await Promise.all([
		read(service, "changes", { root }, signal),
		read(service, "branches", { root }, signal),
		read(service, "worktrees", { root }, signal),
	]);
	return {
		changes: array(changes.files).map((value) => {
			const row = object(value);
			return {
				path: text(row.path),
				status: text(row.status),
				...(row.previousPath === undefined ? {} : { previousPath: text(row.previousPath) }),
			};
		}),
		branches: array(branches.branches).map((value) => {
			const row = object(value);
			return { name: text(row.name), current: boolean(row.current), commit: text(row.commit) };
		}),
		worktrees: array(worktrees.worktrees).map((value) => {
			const row = object(value);
			return { name: text(row.name), branch: text(row.branch) };
		}),
	};
}
export async function diff(service: ExtensionServiceBinding, address: FileAddress, signal: AbortSignal) {
	const row = await read(service, "diff", address, signal);
	return { path: text(row.path), text: text(row.text) };
}
export async function exported(service: ExtensionServiceBinding, address: FileAddress, signal: AbortSignal) {
	const row = await read(service, "export", address, signal);
	const bytes = Uint8Array.from(atob(text(row.base64)), (character) => character.charCodeAt(0));
	const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	if (
		text(row.root) !== address.root ||
		text(row.path) !== address.path ||
		bytes.length !== number(row.bytes) ||
		digest !== text(row.sha256)
	)
		return invalid();
	signal.throwIfAborted();
	return { bytes, sha256: digest };
}
