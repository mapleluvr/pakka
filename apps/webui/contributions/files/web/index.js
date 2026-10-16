import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { Button, Notice } from "@pakka/webui/components";
import { fileCall } from "./client.js";
const html = htm.bind(h);

function FileViewer({ file, writable, working, draft, setDraft, status, save, download, discard }) {
	if (!file)
		return html`<article class="workspace-file-content">
			<${Notice}>Select a file to view, edit or export.<//>
		</article>`;
	let content;
	if (file.text !== undefined)
		content = html`<textarea
			data-file-editor
			aria-label="File content"
			spellcheck="false"
			value=${draft}
			readonly=${!writable}
			disabled=${working}
			onInput=${(e) => setDraft(e.currentTarget.value)}
		/>`;
	else if (file.type.startsWith("image/"))
		content = html`<img
			class="workspace-file-image"
			alt=${file.path}
			src=${`data:${file.type};base64,${file.base64}`}
		/>`;
	else content = html`<${Notice}>Binary file. Export preserves its original bytes.<//>`;
	const dirty = file.text !== undefined && draft !== file.text;
	return html`<article class="workspace-file-content">
		<header>
			<h3>${file.path}</h3>
			<small>${file.bytes} bytes · SHA-256 ${file.sha256.slice(0, 12)}</small>
			<div>
				<${Button} data-file-export disabled=${working} onClick=${download}>Export original<//>${file.text !==
					undefined &&
				writable &&
				html`<${Button} data-file-save disabled=${working || !dirty} onClick=${save}>Save changes<//
					><${Button} disabled=${working || !dirty} onClick=${discard}>Discard draft<//>`}
			</div>
		</header>
		${content}<output data-file-status role="status">${status}</output>
	</article>`;
}
function FileTree({ tree, file, writable, working, upload, openFile }) {
	return html`<aside class="workspace-file-tree">
		<h3>Project tree</h3>
		${writable &&
		html`<label class="workspace-file-upload"
			>Upload file<input data-file-upload type="file" disabled=${working} onChange=${upload}
		/></label>`}${tree?.truncated && html`<${Notice}>Only the first 500 directory entries are shown.<//>`}
		<nav aria-label="Files">
			${tree?.entries.map(
				(row) =>
					html`<button
						type="button"
						data-file-path=${row.path}
						disabled=${working}
						class=${file?.path === row.path ? "selected" : ""}
						onClick=${() => openFile(row)}
					>
						<span aria-hidden="true">${row.kind === "directory" ? "▸" : "·"}</span
						><span>${row.name}</span>${row.kind === "file" && html`<small>${row.bytes} B</small>`}
					</button>`,
			)}
		</nav>
	</aside>`;
}
function GitView({
	git,
	diff,
	writable,
	working,
	branch,
	setBranch,
	worktree,
	setWorktree,
	worktreeBranch,
	setWorktreeBranch,
	force,
	setForce,
	openDiff,
	switchBranch,
	createTree,
	removeTree,
}) {
	return html`<div class="workspace-files-git">
		<section>
			<h3>Changed files</h3>
			${!git.changes.length && html`<p>Working tree is clean.</p>`}${git.changes.map(
				(row) =>
					html`<button
						type="button"
						data-change-path=${row.path}
						disabled=${working}
						onClick=${() => openDiff(row.path)}
					>
						<code>${row.status}</code> ${row.path}
					</button>`,
			)}${diff && html`<pre data-file-diff>${diff.text}</pre>`}
		</section>
		<section>
			<h3>Branches</h3>
			<p data-current-branch>Current: ${git.branches.find((row) => row.current)?.name ?? "detached"}</p>
			<ul>
				${git.branches.map(
					(row) =>
						html`<li>
							<code>${row.name}</code>${!row.current &&
							writable &&
							html`<${Button} disabled=${working} onClick=${() => switchBranch(row.name, false)}>Switch<//>`}
						</li>`,
				)}
			</ul>
			${writable &&
			html`<label
					>New branch<input
						name="branch"
						value=${branch}
						disabled=${working}
						onInput=${(e) => setBranch(e.currentTarget.value)} /></label
				><${Button}
					data-branch-create
					disabled=${working || !branch}
					onClick=${() => switchBranch(branch, true)}
					>Create & switch<//
				>`}
			<p class="secondary">Branch changes require a clean, idle approved workspace.</p>
		</section>
		<section>
			<h3>Isolated worktrees</h3>
			<p class="secondary">
				Creates a real sibling working tree. This does not silently move the Agent's working directory.
			</p>
			${git.worktrees.map(
				(row) =>
					html`<div data-worktree-name=${row.name}>
						<code>${row.name} · ${row.branch}</code>${writable &&
						html`<${Button}
							data-worktree-remove=${row.name}
							disabled=${working}
							onClick=${() => removeTree(row.name)}
							>Remove worktree<//
						>`}
					</div>`,
			)}${writable &&
			html`<div class="workspace-worktree-form">
				<label
					>Worktree folder<input
						name="worktree"
						value=${worktree}
						disabled=${working}
						onInput=${(e) => setWorktree(e.currentTarget.value)} /></label
				><label
					>New worktree branch<input
						name="worktree-branch"
						value=${worktreeBranch}
						disabled=${working}
						onInput=${(e) => setWorktreeBranch(e.currentTarget.value)} /></label
				><${Button}
					data-worktree-create
					disabled=${working || !worktree || !worktreeBranch}
					onClick=${createTree}
					>Create worktree<//
				><label class="workspace-force"
					><input
						type="checkbox"
						checked=${force}
						disabled=${working}
						onChange=${(e) => setForce(e.currentTarget.checked)}
					/>
					Explicitly discard uncommitted work when removing</label
				>
			</div>`}
		</section>
	</div>`;
}
export function Files({ context }) {
	const [roots, setRoots] = useState([]),
		[root, setRoot] = useState(""),
		[path, setPath] = useState(""),
		[tree, setTree] = useState(null),
		[file, setFile] = useState(null),
		[draft, setDraft] = useState("");
	const [tab, setTab] = useState("tree"),
		[git, setGit] = useState(null),
		[diff, setDiff] = useState(null),
		[branch, setBranch] = useState(""),
		[worktree, setWorktree] = useState(""),
		[worktreeBranch, setWorktreeBranch] = useState(""),
		[force, setForce] = useState(false);
	const [working, setWorking] = useState(false),
		[status, setStatus] = useState(""),
		[error, setError] = useState(""),
		[operation, setOperation] = useState(null);
	const alive = useRef(true),
		currentRoot = roots.find((row) => row.id === root),
		writable = currentRoot?.writable,
		dirty = file?.text !== undefined && draft !== file.text;
	useEffect(() => {
		alive.current = true;
		void run(async () => {
			const result = await fileCall(context, "roots", {}),
				approved = result.value.roots;
			setRoots(approved);
			if (approved.length) {
				setRoot(approved[0].id);
				await listing(approved[0].id, "");
			}
		});
		return () => {
			alive.current = false;
		};
	}, []);
	async function run(effect) {
		if (context.signal.aborted || !alive.current) return;
		setWorking(true);
		setError("");
		try {
			await effect();
		} catch (failure) {
			if (!context.signal.aborted && alive.current) {
				setError(failure.message ?? "File operation unknown");
				if (failure.operationId) setOperation(failure.operationId);
			}
		} finally {
			if (!context.signal.aborted && alive.current) setWorking(false);
		}
	}
	async function listing(id, folder) {
		const result = await fileCall(context, "list", { root: id, path: folder });
		setTree(result.value);
		setPath(folder);
		setTab("tree");
	}
	function canLeave() {
		if (!dirty) return true;
		setError("Save or discard your edits before leaving this file.");
		return false;
	}
	function browse(id, folder) {
		if (!canLeave()) return;
		void run(async () => {
			setRoot(id);
			setFile(null);
			setDiff(null);
			await listing(id, folder);
		});
	}
	async function openFile(row) {
		if (!canLeave()) return;
		if (row.kind === "directory") {
			browse(root, row.path);
			return;
		}
		await run(async () => {
			const result = await fileCall(context, "read", { root, path: row.path });
			setFile(result.value);
			setDraft(result.value.text ?? "");
			setStatus("Read from approved root");
			setDiff(null);
		});
	}
	async function mutation(action, input) {
		const result = await fileCall(context, action, input);
		setOperation(result.id);
		const value = result.value;
		if (value.state === "conflict") {
			setStatus("Conflict — current files changed or work is still running. Your draft is retained.");
			return null;
		}
		if (value.state !== "done") {
			setStatus("Unknown — check the original operation. No automatic replay.");
			return null;
		}
		return value;
	}
	function save() {
		void run(async () => {
			const result = await mutation("write", {
				root,
				path: file.path,
				expectedSha256: file.sha256,
				text: draft,
			});
			if (result) {
				setFile({
					...file,
					text: draft,
					sha256: result.value.sha256,
					bytes: new TextEncoder().encode(draft).length,
				});
				setStatus("Saved");
			}
		});
	}
	async function refreshedGit() {
		const input = { root };
		const [changes, branches, worktrees] = await Promise.all([
			fileCall(context, "changes", input),
			fileCall(context, "branches", input),
			fileCall(context, "worktrees", input),
		]);
		setGit({
			changes: changes.value.files,
			branches: branches.value.branches,
			worktrees: worktrees.value.worktrees,
		});
	}
	function gitView() {
		if (!canLeave()) return;
		void run(async () => {
			await refreshedGit();
			setTab("git");
			setDiff(null);
		});
	}
	async function upload(event) {
		const chosen = event.currentTarget.files?.[0];
		event.currentTarget.value = "";
		if (!chosen) return;
		if (chosen.size > 65536) {
			setError("Upload is limited to 64 KiB.");
			return;
		}
		await run(async () => {
			const data = new Uint8Array(await chosen.arrayBuffer());
			let binary = "";
			for (const byte of data) binary += String.fromCharCode(byte);
			const result = await mutation("upload", {
				root,
				path: path ? `${path}/${chosen.name}` : chosen.name,
				base64: btoa(binary),
			});
			if (result) {
				setStatus("Uploaded without overwriting an existing file");
				await listing(root, path);
			}
		});
	}
	function download() {
		void run(async () => {
			const result = await fileCall(context, "export", { root, path: file.path }),
				bytes = Uint8Array.from(atob(result.value.base64), (char) => char.charCodeAt(0)),
				url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" })),
				anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = file.path.split("/").at(-1);
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			setStatus("Exported original bytes");
		});
	}
	function switchBranch(name, create) {
		void run(async () => {
			if (await mutation("switch-branch", { root, name, create })) {
				setBranch("");
				await refreshedGit();
				setStatus("Switched branch in the approved project");
			}
		});
	}
	function createTree() {
		void run(async () => {
			if (await mutation("add-worktree", { root, name: worktree, branch: worktreeBranch })) {
				setWorktree("");
				setWorktreeBranch("");
				await refreshedGit();
				setStatus("Created isolated worktree");
			}
		});
	}
	function removeTree(name) {
		void run(async () => {
			if (await mutation("remove-worktree", { root, name, force })) {
				await refreshedGit();
				setForce(false);
				setStatus("Worktree removed; its branch is retained");
			}
		});
	}
	const openDiff = (path) =>
		void run(async () => {
			const result = await fileCall(context, "diff", { root, path });
			setDiff(result.value);
		});
	const editDraft = (value) => {
			setDraft(value);
			setStatus("Unsaved edits");
		},
		discard = () => {
			setDraft(file.text);
			setStatus("Edits discarded");
		};
	return html`<section class="workspace-files" data-workspace-files>
		<link rel="stylesheet" href=${new URL("./files.css", import.meta.url).href} />
		<header class="workspace-files-heading">
			<div>
				<h2>Files & changes</h2>
				<p>Approved project files. Nothing is sent to the model automatically.</p>
			</div>
			<label
				>Project<select
					aria-label="Approved file root"
					value=${root}
					disabled=${working || !roots.length}
					onChange=${(e) => browse(e.currentTarget.value, "")}
				>
					${roots.map(
						(row) => html`<option value=${row.id}>${row.id}${row.writable ? "" : " · read only"}</option>`,
					)}
				</select></label
			>
		</header>
		${error && html`<${Notice} tone="error">${error}<//>`}${!roots.length &&
		!working &&
		html`<${Notice}>No file root is approved for this Conversation.<//>`}
		<div class="workspace-files-toolbar">
			<${Button} data-files-tree disabled=${working || !root} onClick=${() => browse(root, path)}>Files<//
			><${Button} data-files-git disabled=${working || !currentRoot?.git} onClick=${gitView}>Changes & Git<//
			>${tab === "tree" &&
			html`<${Button}
					disabled=${working || !path}
					onClick=${() => browse(root, path.split("/").slice(0, -1).join("/"))}
					>Parent folder<//
				><code>${path || "/"}</code>`}<span class="workspace-files-progress" aria-live="polite"
				>${working ? "Working…" : ""}</span
			>
		</div>
		${tab === "tree" &&
		html`<div class="workspace-files-grid">
			<${FileTree}
				tree=${tree}
				file=${file}
				writable=${writable}
				working=${working}
				upload=${upload}
				openFile=${openFile}
			/><${FileViewer}
				file=${file}
				writable=${writable}
				working=${working}
				draft=${draft}
				setDraft=${editDraft}
				status=${status}
				save=${save}
				download=${download}
				discard=${discard}
			/>
		</div>`}
		${tab === "git" &&
		git &&
		html`<${GitView}
			git=${git}
			diff=${diff}
			writable=${writable}
			working=${working}
			branch=${branch}
			setBranch=${setBranch}
			worktree=${worktree}
			setWorktree=${setWorktree}
			worktreeBranch=${worktreeBranch}
			setWorktreeBranch=${setWorktreeBranch}
			force=${force}
			setForce=${setForce}
			openDiff=${openDiff}
			switchBranch=${switchBranch}
			createTree=${createTree}
			removeTree=${removeTree}
		/>`}
		<footer class="workspace-files-footer">
			${tab !== "tree" && html`<output role="status">${status}</output>`}${operation &&
			html`<${Button}
				disabled=${working}
				onClick=${() =>
					void run(async () => {
						const saved = await context.operation(operation);
						setStatus(
							`Original operation: ${saved.state}${saved.value?.state ? ` / ${saved.value.state}` : ""}`,
						);
					})}
				>Check original operation<//
			>`}
		</footer>
	</section>`;
}
