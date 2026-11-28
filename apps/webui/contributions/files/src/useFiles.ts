import { useEffect, useMemo, useRef, useState } from "react";
import type { UiViewProps } from "@pakka/webui-sdk";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import * as api from "./service.ts";
import * as store from "./pending.ts";

export function useFiles({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
	const key = store.storageKey(bindings),
		target = bindings.target!;
	const lifetime = useMemo(() => new AbortController(), [ui, bindings]);
	const signal = useMemo(
		() => AbortSignal.any([ui.signal, bindings.signal, lifetime.signal]),
		[ui, bindings, lifetime],
	);
	const [roots, setRoots] = useState<api.FileRoot[]>([]);
	const [root, setRoot] = useState("");
	const [tree, setTree] = useState<api.FileListing | null>(null);
	const [file, setFile] = useState<api.FileView | null>(null);
	const [draft, setDraft] = useState<store.FileDraft | "unreadable" | null>(() => store.draft(key));
	const [pending, setPending] = useState(() => store.pending(key, target));
	const [git, setGit] = useState<api.GitView | null>(null);
	const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
	const [tab, setTab] = useState<"files" | "git">("files");
	const [busy, setBusy] = useState(false),
		lock = useRef(false);
	const [error, setError] = useState(""),
		[notice, setNotice] = useState("");
	const urls = useRef(new Set<string>());
	const currentRoot = roots.find((value) => value.id === root);
	const matchingDraft =
		draft && draft !== "unreadable" && file?.root === draft.root && file.path === draft.path ? draft : null;
	const dirty = draft === "unreadable" || (!!draft && draft.text !== draft.original);
	const blocked = busy || !!pending || draft === "unreadable";
	const text = matchingDraft?.text ?? file?.text ?? "";
	useEffect(
		() =>
			store.watch(key, () => {
				setPending(store.pending(key, target));
				setDraft(store.draft(key));
			}),
		[key, target],
	);
	function releaseUrls() {
		for (const url of urls.current) URL.revokeObjectURL(url);
		urls.current.clear();
	}
	function clearView() {
		setRoots([]);
		setFile(null);
		setTree(null);
		setGit(null);
		setDiff(null);
		releaseUrls();
	}
	async function run<T>(effect: () => Promise<T>): Promise<T | undefined> {
		if (signal.aborted || lock.current) return;
		lock.current = true;
		setBusy(true);
		setError("");
		try {
			return await effect();
		} catch (reason) {
			if (!signal.aborted) {
				if (reason instanceof Error && "outcome" in reason && reason.outcome === "denied") clearView();
				setError(api.failure(reason));
			}
			return undefined;
		} finally {
			lock.current = false;
			if (!signal.aborted) setBusy(false);
		}
	}
	async function refreshRoots() {
		const approved = await api.roots(bindings, signal);
		setRoots(approved);
		return approved;
	}
	async function showFile(id: string, path: string) {
		const value = await api.file(bindings, { root: id, path }, signal);
		setRoot(id);
		setFile(value);
		setDiff(null);
		setTab("files");
		return value;
	}
	async function showListing(id: string, path: string) {
		const value = await api.listing(bindings, { root: id, path }, signal);
		setRoot(id);
		setTree(value);
		return value;
	}
	async function loadInitial() {
		const approved = await refreshRoots();
		const savedDraft = store.draft(key),
			saved = store.pending(key, target);
		const input = saved && saved !== "unreadable" && isRecord(saved.input) ? saved.input : null;
		const preferred = savedDraft && savedDraft !== "unreadable" ? savedDraft.root : input?.root;
		const selected = approved.find((value) => value.id === preferred) ?? approved[0];
		if (!selected) return;
		let path =
			savedDraft && savedDraft !== "unreadable" && savedDraft.root === selected.id
				? savedDraft.path
				: input?.root === selected.id && typeof input.path === "string"
					? input.path
					: null;
		await showListing(selected.id, path?.split("/").slice(0, -1).join("/") ?? "");
		if (path) await showFile(selected.id, path);
	}
	useEffect(() => {
		void run(loadInitial);
		return () => {
			lifetime.abort();
			releaseUrls();
		};
	}, [lifetime]);
	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);
	function canLeave() {
		if (dirty) {
			setError("请先保存或明确放弃当前文件草稿。");
			return false;
		}
		return true;
	}
	function edit(value: string) {
		if (!file || file.text === undefined || blocked || !currentRoot?.writable) return;
		try {
			const latest = store.draft(key);
			if (JSON.stringify(latest) !== JSON.stringify(draft))
				throw new Error("另一实例已修改草稿，请重新读取本地草稿后编辑。");
			store.saveDraft(key, {
				root: file.root,
				path: file.path,
				sha256: matchingDraft?.sha256 ?? file.sha256,
				original: matchingDraft?.original ?? file.text,
				text: value,
			});
		} catch (reason) {
			setError(api.failure(reason));
		}
	}
	function discard() {
		if (busy || pending || !dirty || !window.confirm("放弃此文件尚未保存的草稿？")) return;
		try {
			store.saveDraft(key, null);
			setNotice("已放弃本地草稿。");
		} catch (reason) {
			setError(api.failure(reason));
		}
	}
	async function applyReceipt(original: store.PendingFile, receipt: api.FileReceipt) {
		if (receipt.state === "unknown") {
			setNotice("原请求结果仍未确认；保留草稿和原请求。");
			return false;
		}
		store.clear(key, original);
		if (receipt.state === "conflict") {
			setNotice(
				original.action === "write"
					? "原请求因冲突未执行；草稿保留。请读取当前文件后处理差异。"
					: "原请求因冲突未执行；请刷新当前文件或 Git 状态后核对。",
			);
			return false;
		}
		setNotice("原请求已确认完成。");
		const input = isRecord(original.input) ? original.input : null;
		const savedDraft = store.draft(key);
		if (
			original.action === "write" &&
			input &&
			savedDraft &&
			savedDraft !== "unreadable" &&
			savedDraft.root === input.root &&
			savedDraft.path === input.path &&
			savedDraft.sha256 === input.expectedSha256 &&
			savedDraft.text === input.text
		)
			store.saveDraft(key, null);
		// The receipt settles the write. A later read error must not be treated as a rejected write.
		if (input && typeof input.root === "string") {
			if (typeof input.path === "string") {
				await showListing(input.root, input.path.split("/").slice(0, -1).join("/"));
				await showFile(input.root, input.path);
			} else {
				setFile(null);
				setDiff(null);
				setGit(await api.git(bindings, input.root, signal));
				setRoot(input.root);
				setTab("git");
			}
		}
		return true;
	}
	async function submit(action: api.FileMutation, input: ExtensionJson) {
		if (draft === "unreadable") {
			setError("本地草稿不可读，请保留记录后核对。");
			return false;
		}
		return !!(await run(async () => {
			const original: store.PendingFile = {
				version: 1,
				requestId: crypto.randomUUID(),
				action,
				input: api.inputFor(action, input),
				target,
			};
			store.retain(key, original);
			setNotice("");
			let operation;
			try {
				operation = await bindings.call(action, original.input, { signal, requestId: original.requestId });
			} catch (reason) {
				if (!signal.aborted && reason instanceof Error && "outcome" in reason && reason.outcome === "denied")
					store.clear(key, original);
				throw reason;
			}
			signal.throwIfAborted();
			if (operation.state !== "done") {
				setNotice("操作结果未确认。请核对原请求，不会自动重提。");
				return false;
			}
			return applyReceipt(
				original,
				store.confirmed(original, operation, api.fileReceipt(action, operation.value)),
			);
		}));
	}
	function save() {
		if (!file || file.text === undefined || blocked || !currentRoot?.writable) return Promise.resolve(false);
		if (new TextEncoder().encode(text).length > 65536) {
			setError("编辑保存最多 64 KiB；草稿已保留。");
			return Promise.resolve(false);
		}
		return submit("write", {
			root: file.root,
			path: file.path,
			expectedSha256: matchingDraft?.sha256 ?? file.sha256,
			text,
		});
	}
	function reconcile() {
		return run(async () => {
			const original = store.pending(key, target);
			if (!original || original === "unreadable") throw new Error("本地原请求不可核对，请保留记录。");
			return applyReceipt(original, await store.reconcile(bindings, original, signal));
		});
	}
	async function upload(chosen: File) {
		if (blocked || !root || !currentRoot?.writable || !canLeave()) return;
		if (chosen.size > 65536) {
			setError("上传最多 64 KiB。");
			return;
		}
		try {
			const bytes = new Uint8Array(await chosen.arrayBuffer());
			signal.throwIfAborted();
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return await submit("upload", {
				root,
				path: tree?.path ? `${tree.path}/${chosen.name}` : chosen.name,
				base64: btoa(binary),
			});
		} catch (reason) {
			if (!signal.aborted) setError(api.failure(reason));
		}
	}
	function download() {
		if (!file) return;
		void run(async () => {
			const value = await api.exported(bindings, { root: file.root, path: file.path }, signal);
			if (value.sha256 !== file.sha256) throw new Error("文件已变化，请重新读取后导出。");
			releaseUrls();
			const url = URL.createObjectURL(new Blob([value.bytes], { type: "application/octet-stream" }));
			urls.current.add(url);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = file.path.split("/").at(-1)!;
			anchor.click();
			setNotice("已导出当前读取版本的原始字节。");
		});
	}
	return {
		roots,
		root,
		tree,
		file,
		draft,
		text,
		pending,
		git,
		diff,
		tab,
		busy,
		blocked,
		dirty,
		error,
		notice,
		currentRoot,
		edit,
		discard,
		save,
		upload,
		download,
		reconcile,
		resetFeedback() {
			setError("");
			setNotice("");
		},
		browse(id: string, path: string) {
			if (!canLeave()) return;
			void run(async () => {
				await showListing(id, path);
				setFile(null);
				setDiff(null);
				setTab("files");
			});
		},
		open(path: string) {
			if (canLeave()) void run(() => showFile(root, path));
		},
		refresh() {
			void run(async () => {
				await refreshRoots();
				if (tab === "git") {
					setGit(await api.git(bindings, root, signal));
					setDiff(null);
				} else {
					await showListing(root, tree?.path ?? "");
					if (file) await showFile(root, file.path);
				}
			});
		},
		showGit() {
			if (canLeave())
				void run(async () => {
					setGit(await api.git(bindings, root, signal));
					setDiff(null);
					setTab("git");
				});
		},
		showFiles() {
			setTab("files");
		},
		showDiff(path: string) {
			void run(async () => setDiff(await api.diff(bindings, { root, path }, signal)));
		},
		changeBranch(name: string, create: boolean) {
			if (!canLeave()) return Promise.resolve(false);
			return submit("switch-branch", { root, name: name.trim(), create });
		},
		addWorktree(name: string, branch: string) {
			return submit("add-worktree", { root, name: name.trim(), branch: branch.trim() });
		},
		removeWorktree(name: string, force: boolean) {
			return submit("remove-worktree", { root, name, force });
		},
	};
}
export type FilesState = ReturnType<typeof useFiles>;
