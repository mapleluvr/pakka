import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { UiViewProps } from "@pakka/webui-sdk";
import * as data from "./data.ts";
import { LessonCard, LessonEditor, type Draft, type Confirmation } from "./Lesson.tsx";

const names = {
	add: "添加记忆",
	activation: "记忆上下文设置",
	edit: "编辑记忆",
	remove: "忘记",
	approve: "批准",
	discard: "撤回建议",
};
const actionName = (value: data.Command) =>
	names[value.action === "change" ? value.input.action : value.action];
function restoredDraft(value: data.PendingState): Record<string, Draft> {
	return value &&
		value !== "unreadable" &&
		value.action === "change" &&
		value.input.action === "edit" &&
		value.input.text !== undefined
		? { [value.input.id]: { text: value.input.text, version: value.input.expectedVersion, conflict: false } }
		: {};
}
export function Memory({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
	const key = data.storageKey(bindings),
		target = bindings.target!;
	const lifetime = useMemo(() => new AbortController(), [ui, bindings]);
	const signal = useMemo(
		() => AbortSignal.any([ui.signal, bindings.signal, lifetime.signal]),
		[ui, bindings, lifetime],
	);
	const element = useRef<HTMLElement>(null),
		lock = useRef(false);
	const [visible, setVisible] = useState(false),
		[revision, setRevision] = useState(0);
	const [pending, setPending] = useState(() => data.pending(key, target));
	const [text, setText] = useState(() =>
		pending && pending !== "unreadable" && pending.action === "add" ? pending.input.text : "",
	);
	const [scope, setScope] = useState<"project" | "global">(() =>
		pending && pending !== "unreadable" && pending.action === "add" ? pending.input.scope : "project",
	);
	const [edits, setEdits] = useState(() => restoredDraft(pending));
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [view, setView] = useState<data.View | null>(null),
		[readProblem, setReadProblem] = useState("");
	const [busy, setBusy] = useState(false),
		[problem, setProblem] = useState(""),
		[notice, setNotice] = useState("");
	const [search, setSearch] = useState(""),
		[filter, setFilter] = useState("all"),
		[page, setPage] = useState(0);
	useEffect(() => () => lifetime.abort(), [lifetime]);
	useEffect(() => data.watch(key, () => setPending(data.pending(key, target))), [key, target]);
	useEffect(() => {
		const node = element.current;
		if (!node) return;
		const observer = new ResizeObserver(() => {
			const bounds = node.getBoundingClientRect();
			setVisible(bounds.width > 0 && bounds.height > 0);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (!visible || signal.aborted) return;
		const controller = new AbortController(),
			reading = AbortSignal.any([signal, controller.signal]);
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function refresh() {
			try {
				if (document.visibilityState === "visible") {
					const next = await data.read(bindings, reading);
					reading.throwIfAborted();
					setView(next);
					setReadProblem("");
				}
			} catch (reason) {
				if (!reading.aborted) {
					setReadProblem(data.failure(reason));
					if (reason instanceof Error && "outcome" in reason && reason.outcome === "denied") setView(null);
				}
			} finally {
				if (!reading.aborted)
					timer = setTimeout(() => {
						void refresh();
					}, 1500);
			}
		}
		void refresh();
		return () => {
			controller.abort();
			if (timer) clearTimeout(timer);
		};
	}, [bindings, signal, visible, revision]);
	async function perform(effect: () => Promise<void>) {
		if (signal.aborted || lock.current) return;
		lock.current = true;
		setBusy(true);
		setProblem("");
		setNotice("");
		try {
			await effect();
		} catch (reason) {
			if (!signal.aborted) setProblem(data.failure(reason));
		} finally {
			lock.current = false;
			if (!signal.aborted) setBusy(false);
		}
	}
	function settle(original: data.Pending, result: data.Mutation | null) {
		signal.throwIfAborted();
		if (!result) {
			setNotice("记忆操作结果未知，请核对原请求。");
			return;
		}
		data.clear(key, original);
		if (result.state === "conflict") {
			setNotice("原请求发生版本冲突，草稿已保留。");
			if (original.action === "change" && original.input.action === "edit") {
				const input = original.input;
				setEdits((previous) => ({
					...previous,
					[input.id]: {
						text: previous[input.id]?.text ?? input.text ?? "",
						version: previous[input.id]?.version ?? input.expectedVersion,
						conflict: true,
					},
				}));
			}
		} else {
			setNotice(`原请求「${actionName(original)}」已确认。`);
			if (original.action === "add")
				setText((current) => (current.trim() === original.input.text ? "" : current));
			if (original.action === "change") {
				const input = original.input;
				setEdits((previous) => {
					const draft = previous[input.id];
					if (
						!draft ||
						input.action !== "edit" ||
						draft.version !== input.expectedVersion ||
						draft.text.trim() !== input.text
					)
						return previous;
					const next = { ...previous };
					delete next[input.id];
					return next;
				});
			}
		}
		setConfirmation(null);
		setRevision((value) => value + 1);
	}
	function act(command: data.Command) {
		if (!view?.canWrite || pending || readProblem) return;
		void perform(async () => {
			const original: data.Pending = { ...command, version: 1, requestId: crypto.randomUUID(), target };
			data.retain(key, original);
			let operation;
			try {
				operation = await bindings.call(original.action, original.input, {
					signal,
					requestId: original.requestId,
				});
			} catch (reason) {
				if (!signal.aborted && reason instanceof Error && "outcome" in reason && reason.outcome === "denied")
					data.clear(key, original);
				throw reason;
			}
			settle(original, data.confirmed(bindings, original, operation));
		});
	}
	function reconcile(original: data.Pending) {
		void perform(async () => {
			const current = data.pending(key, target);
			if (!current || current === "unreadable" || current.requestId !== original.requestId)
				throw new Error("本地原请求已变化，请保留记录并核对。");
			settle(original, await data.reconcile(bindings, original, signal));
		});
	}
	const blocked = busy || !!pending || !!readProblem;
	const filtered = (view?.lessons ?? []).filter((row) => {
		const matches =
			filter === "all" || (filter === "waiting" ? row.pending || row.proposal : row.scope === filter);
		return (
			matches &&
			`${row.text}\n${row.proposal?.text ?? ""}\n${row.authorName}`
				.toLocaleLowerCase()
				.includes(search.toLocaleLowerCase())
		);
	});
	const pages = Math.max(1, Math.ceil(filtered.length / 20)),
		currentPage = Math.min(page, pages - 1);
	const rows = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
	const removeDraft = (id: string) =>
		setEdits((previous) => {
			const next = { ...previous };
			delete next[id];
			return next;
		});
	return (
		<section ref={element} className="memory-view memory-stack" aria-label="Memory">
			<header className="memory-heading">
				<div className="memory-stack memory-tight">
					<h1>Memory</h1>
					<p className="memory-muted">{view?.project ? `项目：${view.project.name}` : "当前 Session"}</p>
				</div>
				<div className="memory-actions">
					<Button label="刷新记忆" variant="ghost" onClick={() => setRevision((value) => value + 1)} />
					{view?.owner && (
						<Button
							label={view.enabled ? "暂停记忆上下文" : "启用记忆上下文"}
							aria-pressed={view.enabled}
							isDisabled={blocked}
							onClick={() => act({ action: "activation", input: { enabled: !view.enabled } })}
						/>
					)}
				</div>
			</header>
			{view && (
				<p className="memory-muted">
					{view.enabled ? "记忆上下文已启用" : "记忆上下文已暂停"}
					{!view.canWrite ? " · 只读" : ""}
				</p>
			)}
			{problem && (
				<p role="alert" className="memory-problem">
					{problem}
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			{pending && (
				<section className="memory-pending memory-stack" aria-label="记忆原请求">
					{pending === "unreadable" ? (
						<p role="alert">本地原请求不可读，已停止新操作。请保留记录并核对。</p>
					) : (
						<>
							<h2>待核对：{actionName(pending)}</h2>
							<code>{pending.requestId}</code>
							<details>
								<summary>原请求与草稿</summary>
								<pre>{JSON.stringify(pending.input, null, 2)}</pre>
							</details>
							<Button
								label="核对原请求"
								isDisabled={busy}
								isLoading={busy}
								onClick={() => reconcile(pending)}
							/>
						</>
					)}
				</section>
			)}
			{readProblem && (
				<p role="alert" className="memory-problem">
					{readProblem}
					{view ? " · 下方保留最近一次读取结果。" : ""}
				</p>
			)}
			{!view ? (
				<p role="status">{readProblem ? "当前记忆暂不可读取。" : "正在读取记忆…"}</p>
			) : (
				<>
					{view.canWrite && (
						<form
							className="memory-card memory-stack"
							onSubmit={(event) => {
								event.preventDefault();
								act({ action: "add", input: { text: text.trim(), scope: view.project ? scope : "global" } });
							}}
						>
							<label className="memory-stack memory-tight">
								<span>新记忆</span>
								<textarea
									name="memory-text"
									aria-label="新记忆"
									value={text}
									maxLength={view.limits.text}
									rows={3}
									disabled={blocked}
									onChange={(event) => setText(event.currentTarget.value)}
								/>
							</label>
							<div className="memory-actions">
								<label className="memory-stack memory-tight">
									<span>作用域</span>
									<select
										name="memory-scope"
										value={view.project ? scope : "global"}
										disabled={blocked || !view.project}
										onChange={(event) =>
											setScope(event.currentTarget.value === "project" ? "project" : "global")
										}
									>
										{view.project && <option value="project">本项目</option>}
										<option value="global">本 Session 的所有 Conversation</option>
									</select>
								</label>
								<Button
									label={view.owner ? "保存记忆" : "提交建议"}
									type="submit"
									variant="primary"
									isDisabled={blocked || !text.trim()}
								/>
								<small className="memory-muted">
									{text.length} / {view.limits.text}
								</small>
							</div>
						</form>
					)}
					{view.canWrite &&
						Object.entries(edits).map(([id, draft]) => (
							<LessonEditor
								key={id}
								id={id}
								draft={draft}
								current={view.lessons.find((row) => row.id === id)}
								maxLength={view.limits.text}
								blocked={blocked}
								act={act}
								update={(next) => setEdits((previous) => ({ ...previous, [id]: next }))}
								discard={() => removeDraft(id)}
							/>
						))}
					{view.canWrite && confirmation && (
						<section className="memory-pending memory-stack" aria-label="确认记忆操作">
							<h2>{confirmation.action === "remove" ? "忘记此条记忆？" : "撤回此建议？"}</h2>
							<p>{confirmation.text}</p>
							<div className="memory-actions">
								<Button
									label="取消"
									variant="ghost"
									isDisabled={busy}
									onClick={() => setConfirmation(null)}
								/>
								<Button
									label={confirmation.action === "remove" ? "确认忘记" : "确认撤回"}
									isDisabled={blocked}
									onClick={() =>
										act({
											action: "change",
											input: {
												id: confirmation.id,
												expectedVersion: confirmation.version,
												action: confirmation.action,
											},
										})
									}
								/>
							</div>
						</section>
					)}
					<section className="memory-stack" aria-label="记忆清单">
						<div className="memory-heading">
							<h2>记忆清单</h2>
							<small className="memory-muted">
								已批准容量：每项目 {view.limits.project} · 本 Session 全局 {view.limits.global}
							</small>
						</div>
						<div className="memory-filters">
							<TextInput
								label="搜索已读取记忆"
								value={search}
								onChange={(value) => {
									setSearch(value);
									setPage(0);
								}}
								width="100%"
								autoComplete="off"
								controlClassName="memory-control"
							/>
							<label className="memory-stack memory-tight">
								<span>范围</span>
								<select
									value={filter}
									onChange={(event) => {
										setFilter(event.currentTarget.value);
										setPage(0);
									}}
								>
									<option value="all">全部</option>
									{view.canWrite && <option value="waiting">待批准</option>}
									{view.project && <option value="project">本项目</option>}
									<option value="global">本 Session 全局</option>
								</select>
							</label>
						</div>
						{rows.length === 0 && <p>{search || filter !== "all" ? "没有匹配的记忆。" : "暂无记忆。"}</p>}
						{rows.map((row) => (
							<LessonCard
								key={row.id}
								row={row}
								view={view}
								blocked={blocked}
								editing={!!edits[row.id]}
								act={act}
								confirm={setConfirmation}
								edit={() =>
									setEdits((previous) => ({
										...previous,
										[row.id]: {
											text: row.proposal?.mine && row.proposal.text !== null ? row.proposal.text : row.text,
											version: row.version,
											conflict: false,
										},
									}))
								}
							/>
						))}
						<div className="memory-actions">
							<Button
								label="上一页"
								variant="ghost"
								isDisabled={currentPage === 0}
								onClick={() => setPage(currentPage - 1)}
							/>
							<span>
								{filtered.length} 条 · {currentPage + 1} / {pages}
							</span>
							<Button
								label="下一页"
								variant="ghost"
								isDisabled={currentPage + 1 >= pages}
								onClick={() => setPage(currentPage + 1)}
							/>
						</div>
					</section>
				</>
			)}
		</section>
	);
}
