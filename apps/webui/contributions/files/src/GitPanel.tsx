import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Layout, LayoutHeader, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { FilesState } from "./useFiles.ts";

export function WindowedRows<T>({
	rows,
	children,
	label,
}: {
	rows: readonly T[];
	children: (row: T) => ReactNode;
	label: string;
}) {
	const [page, setPage] = useState(0),
		start = Math.min(page * 50, Math.max(0, Math.ceil(rows.length / 50) - 1) * 50);
	return (
		<div className="files-stack">
			<div className="files-stack files-tight">{rows.slice(start, start + 50).map(children)}</div>
			{rows.length > 50 && (
				<nav className="files-actions" aria-label={label}>
					<Button
						label="上一页"
						isDisabled={start === 0}
						onClick={() => setPage(Math.max(0, start / 50 - 1))}
					/>
					<span>
						{start + 1}–{Math.min(rows.length, start + 50)} / {rows.length}
					</span>
					<Button
						label="下一页"
						isDisabled={start + 50 >= rows.length}
						onClick={() => setPage(start / 50 + 1)}
					/>
				</nav>
			)}
		</div>
	);
}

export function GitPanel({ state }: { state: FilesState }) {
	const [branch, setBranch] = useState(""),
		[tree, setTree] = useState(""),
		[treeBranch, setTreeBranch] = useState("");
	const [removing, setRemoving] = useState<string | null>(null),
		[force, setForce] = useState(false);
	const container = useRef<HTMLDivElement>(null),
		[visible, setVisible] = useState(false);
	const trigger = useRef<HTMLElement | null>(null),
		returnFocus = useRef(false);
	function closeRemoval() {
		returnFocus.current = true;
		setRemoving(null);
	}
	useEffect(() => {
		if (removing || !visible || !returnFocus.current) return;
		const frame = requestAnimationFrame(() => {
			returnFocus.current = false;
			(trigger.current?.isConnected ? trigger.current : container.current)?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [removing, visible]);
	const git = state.git,
		writable = state.currentRoot?.writable;
	useEffect(() => {
		const element = container.current;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			const bounds = element.getBoundingClientRect();
			setVisible(bounds.width > 0 && bounds.height > 0);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [!!git]);
	if (!git) return <p>尚未读取 Git 状态，请刷新。</p>;
	return (
		<div ref={container} tabIndex={-1} className="files-git">
			<section className="files-card files-stack">
				<h2>文件变更</h2>
				<p className="files-muted">相对 HEAD 的当前工作区；读取 diff 不执行仓库脚本。</p>
				{!git.changes.length && <p>工作区没有变更。</p>}
				<WindowedRows rows={git.changes} label="变更分页">
					{(row) => (
						<Button
							key={row.path}
							label={`查看差异：${row.path}`}
							variant="ghost"
							width="100%"
							className="files-row"
							isDisabled={state.busy}
							onClick={() => state.showDiff(row.path)}
						>
							<span className="files-row-body">
								<code>{row.status}</code>
								<span>
									{row.path}
									{row.previousPath && <small>原路径：{row.previousPath}</small>}
								</span>
							</span>
						</Button>
					)}
				</WindowedRows>
				{state.diff && (
					<div className="files-stack">
						<h3>{state.diff.path}</h3>
						<pre tabIndex={0} aria-label="文件差异">
							{state.diff.text || "没有可显示的文本差异。新文件尚未进入 HEAD。"}
						</pre>
					</div>
				)}
			</section>
			<section className="files-card files-stack">
				<h2>分支</h2>
				<p>
					当前：<code>{git.branches.find((row) => row.current)?.name ?? "分离 HEAD"}</code>
				</p>
				<WindowedRows rows={git.branches} label="分支分页">
					{(row) => (
						<div key={row.name} className="files-line">
							<code>{row.name}</code>
							{row.current ? (
								<span>当前</span>
							) : (
								writable && (
									<Button
										label={`切换到 ${row.name}`}
										isDisabled={state.blocked}
										onClick={() => {
											void state.changeBranch(row.name, false);
										}}
									>
										切换
									</Button>
								)
							)}
						</div>
					)}
				</WindowedRows>
				{writable && (
					<form
						className="files-stack"
						onSubmit={(event) => {
							event.preventDefault();
							if (!state.blocked)
								void state.changeBranch(branch, true).then((done) => {
									if (done) setBranch("");
								});
						}}
					>
						<TextInput
							label="新分支名"
							htmlName="branch"
							value={branch}
							onChange={setBranch}
							isDisabled={state.blocked}
							autoComplete="off"
							width="100%"
							controlClassName="files-control"
						/>
						<Button label="创建并切换分支" type="submit" isDisabled={state.blocked} />
						<p className="files-muted">
							切换前服务会检查工作区和相关 Conversation 是否空闲；未保存文件或正在执行的工作会阻止切换。
						</p>
					</form>
				)}
			</section>
			<section className="files-card files-stack">
				<h2>独立工作树</h2>
				<p className="files-muted">在获准位置创建与移除；当前 Conversation 目录由配置入口管理。</p>
				{!git.worktrees.length && <p>没有获准位置内的工作树。</p>}
				<WindowedRows rows={git.worktrees} label="工作树分页">
					{(row) => (
						<div key={row.name} className="files-line">
							<span>
								<strong>{row.name}</strong>
								<small>{row.branch}</small>
							</span>
							{writable && (
								<Button
									label={`移除工作树 ${row.name}`}
									variant="ghost"
									isDisabled={state.blocked}
									onClick={(event) => {
										trigger.current = event.currentTarget;
										state.resetFeedback();
										setForce(false);
										setRemoving(row.name);
									}}
								>
									移除…
								</Button>
							)}
						</div>
					)}
				</WindowedRows>
				{writable && (
					<form
						className="files-stack"
						onSubmit={(event) => {
							event.preventDefault();
							if (!state.blocked)
								void state.addWorktree(tree, treeBranch).then((done) => {
									if (done) {
										setTree("");
										setTreeBranch("");
									}
								});
						}}
					>
						<TextInput
							label="工作树目录名"
							htmlName="worktree"
							value={tree}
							onChange={setTree}
							isDisabled={state.blocked}
							autoComplete="off"
							width="100%"
							controlClassName="files-control"
						/>
						<TextInput
							label="工作树新分支"
							htmlName="worktree-branch"
							value={treeBranch}
							onChange={setTreeBranch}
							isDisabled={state.blocked}
							autoComplete="off"
							width="100%"
							controlClassName="files-control"
						/>
						<Button label="创建工作树" type="submit" isDisabled={state.blocked} />
					</form>
				)}
			</section>
			{removing && visible && (
				<Dialog
					isOpen
					purpose="form"
					width={520}
					maxHeight="90dvh"
					aria-label="移除工作树"
					onOpenChange={(open) => {
						if (!open) closeRemoval();
					}}
				>
					<Layout
						className="files-view"
						header={
							<LayoutHeader>
								<h2>移除工作树</h2>
							</LayoutHeader>
						}
						footer={
							<LayoutFooter>
								<div className="files-actions">
									<Button label="取消移除" onClick={closeRemoval} />
									<Button
										label="确认移除"
										variant="primary"
										isDisabled={state.blocked}
										isLoading={state.busy}
										onClick={() => {
											void state.removeWorktree(removing, force).then((done) => {
												if (done) closeRemoval();
											});
										}}
									/>
								</div>
							</LayoutFooter>
						}
					>
						<LayoutContent>
							<div className="files-stack">
								<p>
									移除 <strong>{removing}</strong> 的工作目录；其 Git 分支保留。
								</p>
								<label className="files-checkbox">
									<input
										type="checkbox"
										checked={force}
										disabled={state.blocked}
										onChange={(event) => setForce(event.currentTarget.checked)}
									/>
									<span>同时丢弃此工作树尚未提交的内容</span>
								</label>
								<p className="files-muted">未勾选时，有未提交内容的工作树会被服务拒绝移除。</p>
								{state.error && (
									<p role="alert" className="files-problem">
										{state.error}
									</p>
								)}
								{state.pending && (
									<div className="files-stack">
										<p role="status">原请求待核对，关闭弹窗后也可继续查询。</p>
										{state.pending !== "unreadable" && (
											<Button
												label="核对原请求"
												isDisabled={state.busy}
												onClick={() => {
													void state.reconcile().then((done) => {
														if (done) closeRemoval();
													});
												}}
											/>
										)}
									</div>
								)}
								{state.notice && <p role="status">{state.notice}</p>}
							</div>
						</LayoutContent>
					</Layout>
				</Dialog>
			)}
		</div>
	);
}
