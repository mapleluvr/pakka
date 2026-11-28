import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { UiViewProps } from "@pakka/webui-sdk";
import { GitPanel, WindowedRows } from "./GitPanel.tsx";
import { useFiles, type FilesState } from "./useFiles.ts";
import type { FileView } from "./service.ts";

function FileIcon({ directory }: { directory: boolean }) {
	return (
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			aria-hidden="true"
		>
			{directory ? (
				<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
			) : (
				<>
					<path d="M5 3h9l5 5v13H5V3Z" />
					<path d="M14 3v6h5M8 13h8M8 17h8" />
				</>
			)}
		</svg>
	);
}
function FileImage({ file }: { file: FileView }) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!file.base64 || !["image/png", "image/jpeg", "image/gif"].includes(file.type)) return;
		const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
		const next = URL.createObjectURL(new Blob([bytes], { type: file.type }));
		setUrl(next);
		return () => {
			URL.revokeObjectURL(next);
		};
	}, [file]);
	return url ? <img src={url} alt={file.path} className="files-image" /> : <p>图片未能展开。</p>;
}
function FileEditor({ state }: { state: FilesState }) {
	const file = state.file;
	if (!file)
		return (
			<section className="files-card">
				<h2>文件内容</h2>
				<p className="files-muted">选择文件以阅读、编辑或导出其原始字节。</p>
			</section>
		);
	const draft =
		state.draft &&
		state.draft !== "unreadable" &&
		state.draft.root === file.root &&
		state.draft.path === file.path
			? state.draft
			: null;
	return (
		<section className="files-card files-stack" aria-label="文件内容">
			<header className="files-stack files-tight">
				<h2>{file.path}</h2>
				<p className="files-muted">
					{file.bytes.toLocaleString()} 字节 · SHA-256 <code>{file.sha256}</code>
				</p>
			</header>
			<div className="files-actions">
				<Button label="导出原文件" isDisabled={state.busy} onClick={state.download} />
				{file.text !== undefined && state.currentRoot?.writable && (
					<>
						<Button
							label="保存文件"
							variant="primary"
							isDisabled={state.blocked}
							isLoading={state.busy}
							onClick={() => {
								void state.save();
							}}
						/>
						<Button
							label="放弃草稿"
							variant="ghost"
							isDisabled={state.blocked || !state.dirty}
							onClick={state.discard}
						/>
					</>
				)}
			</div>
			{draft && draft.sha256 !== file.sha256 && (
				<p role="alert" className="files-problem">
					当前文件已变化。编辑区保留基于旧版本的草稿，保存仍会按原 hash 核对；请先复制草稿并处理差异。
				</p>
			)}
			{file.text !== undefined ? (
				<label className="files-stack files-tight">
					<span>{state.currentRoot?.writable ? "文本编辑" : "文本内容（只读）"}</span>
					<textarea
						aria-label="文件文本"
						name="file-content"
						className="files-editor"
						value={state.text}
						readOnly={!state.currentRoot?.writable}
						disabled={state.blocked}
						spellCheck={false}
						onChange={(event) => state.edit(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (
								(event.ctrlKey || event.metaKey) &&
								event.key === "Enter" &&
								!event.nativeEvent.isComposing
							) {
								event.preventDefault();
								void state.save();
							}
						}}
					/>
				</label>
			) : file.base64 && file.type.startsWith("image/") ? (
				<FileImage file={file} />
			) : (
				<p>二进制文件，可导出原始字节。</p>
			)}
			{state.dirty && (
				<p role="status" className="files-muted">
					草稿尚未保存到文件；本页刷新后可继续编辑。
				</p>
			)}
		</section>
	);
}
export function Files(props: UiViewProps<ExtensionServiceBinding>) {
	const state = useFiles(props),
		[filter, setFilter] = useState("");
	const rows =
		state.tree?.entries.filter((row) => row.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ??
		[];
	const pending = state.pending;
	return (
		<section className="files-view files-stack" aria-label="文件与 Git">
			<header className="files-heading">
				<div className="files-stack files-tight">
					<h1>文件与 Git</h1>
					<p className="files-muted">浏览获准根目录、编辑文件与管理工作树。</p>
				</div>
				<label className="files-stack files-tight">
					<span>获准根目录</span>
					<select
						aria-label="获准根目录"
						value={state.root}
						disabled={state.busy || !state.roots.length}
						onChange={(event) => {
							setFilter("");
							state.browse(event.currentTarget.value, "");
						}}
					>
						{!state.roots.length && <option value="">暂无根目录</option>}
						{state.roots.map((root) => (
							<option key={root.id} value={root.id}>
								{root.id}
								{root.writable ? "" : " · 只读"}
							</option>
						))}
					</select>
				</label>
			</header>
			{state.error && (
				<p role="alert" className="files-problem">
					{state.error}
				</p>
			)}
			{state.notice && <p role="status">{state.notice}</p>}
			{state.draft === "unreadable" && (
				<p role="alert" className="files-problem">
					本地草稿记录不可读，已停止写入。请保留记录并核对。
				</p>
			)}
			{pending && (
				<section className="files-pending files-stack" aria-label="文件原请求">
					{pending === "unreadable" ? (
						<p role="alert">本地原请求不可读，已停止新写入。请保留记录并核对服务。</p>
					) : (
						<>
							<p>原文件操作待核对。查询只读取原回执。</p>
							<code>{pending.requestId}</code>
							<Button
								label="核对原请求"
								isDisabled={state.busy}
								isLoading={state.busy}
								onClick={() => {
									void state.reconcile();
								}}
							/>
						</>
					)}
				</section>
			)}
			<div className="files-actions">
				<Button
					label="文件"
					aria-pressed={state.tab === "files"}
					isDisabled={state.busy || !state.root}
					onClick={state.showFiles}
				/>
				<Button
					label="变更与 Git"
					aria-pressed={state.tab === "git"}
					isDisabled={state.busy || !state.currentRoot?.git}
					onClick={state.showGit}
				/>
				<Button
					label="刷新当前状态"
					variant="ghost"
					isDisabled={state.busy || !state.root}
					onClick={state.refresh}
				/>
				<span role="status">{state.busy ? "正在读取或核对…" : ""}</span>
			</div>
			{!state.busy && !state.roots.length && <p>此 Conversation 没有可读取的获准文件根目录。</p>}
			{!!state.roots.length &&
				(state.tab === "git" ? (
					<GitPanel state={state} />
				) : (
					<div className="files-columns">
						<section className="files-card files-stack" aria-label="目录文件">
							<div className="files-actions">
								<Button
									label="上级目录"
									isDisabled={state.busy || !state.tree?.path}
									onClick={() => {
										setFilter("");
										state.browse(state.root, state.tree?.path.split("/").slice(0, -1).join("/") ?? "");
									}}
								/>
								<code>{state.tree?.path || "/"}</code>
							</div>
							<TextInput
								label="筛选当前目录"
								value={filter}
								onChange={setFilter}
								htmlName="file-filter"
								autoComplete="off"
								width="100%"
								controlClassName="files-control"
							/>
							{state.currentRoot?.writable && (
								<label className="files-upload files-stack files-tight">
									<span>上传到当前目录（最多 64 KiB）</span>
									<input
										type="file"
										aria-label="上传文件"
										disabled={state.blocked}
										onChange={(event) => {
											const file = event.currentTarget.files?.[0];
											event.currentTarget.value = "";
											if (file) void state.upload(file);
										}}
									/>
								</label>
							)}
							{state.tree?.truncated && (
								<p className="files-muted">服务只返回此目录前 500 项；筛选仅覆盖已返回条目。</p>
							)}
							{!rows.length && <p className="files-muted">当前目录没有匹配的可读条目。</p>}
							<WindowedRows key={`${state.root}/${state.tree?.path}/${filter}`} rows={rows} label="目录分页">
								{(row) => (
									<Button
										key={row.path}
										label={`${row.kind === "directory" ? "打开目录" : "打开文件"}：${row.name}`}
										width="100%"
										variant="ghost"
										className="files-row"
										aria-pressed={state.file?.path === row.path}
										isDisabled={state.busy}
										onClick={() => {
											if (row.kind === "directory") {
												setFilter("");
												state.browse(state.root, row.path);
											} else state.open(row.path);
										}}
									>
										<span className="files-row-body">
											<FileIcon directory={row.kind === "directory"} />
											<span>
												{row.name}
												{row.kind === "file" && <small>{row.bytes.toLocaleString()} B</small>}
											</span>
										</span>
									</Button>
								)}
							</WindowedRows>
						</section>
						<FileEditor state={state} />
					</div>
				))}
		</section>
	);
}
