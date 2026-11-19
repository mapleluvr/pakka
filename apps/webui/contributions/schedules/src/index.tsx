import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { UiViewProps } from "@pakka/webui-sdk";
import * as data from "./data.ts";
import { RunReceipts } from "./RunReceipts.tsx";
import { ScheduleForm, restored } from "./ScheduleForm.tsx";

const time = (value: number) => new Date(value).toLocaleString();
export function Schedules({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
	const key = data.storageKey(bindings),
		target = bindings.target!;
	const lifetime = useMemo(() => new AbortController(), [ui, bindings]);
	const signal = useMemo(
		() => AbortSignal.any([ui.signal, bindings.signal, lifetime.signal]),
		[ui, bindings, lifetime],
	);
	const element = useRef<HTMLElement>(null),
		locks = useRef(new Set<string>());
	const [pending, setPending] = useState(() => data.pending(key, target));
	const [draft, setDraft] = useState(() =>
		restored(pending === "unreadable" ? undefined : pending.find((row) => row.action === "add")),
	);
	const [view, setView] = useState<data.View | null>(null),
		[readProblem, setReadProblem] = useState("");
	const [visible, setVisible] = useState(false),
		[revision, setRevision] = useState(0);
	const [busy, setBusy] = useState<readonly string[]>([]),
		[problem, setProblem] = useState("");
	const [notices, setNotices] = useState<Record<string, { requestId: string; text: string }>>({});
	const [search, setSearch] = useState(""),
		[filter, setFilter] = useState("all"),
		[page, setPage] = useState(0);
	const [confirmation, setConfirmation] = useState<data.Schedule | null>(null);
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
		if (!visible) setConfirmation(null);
	}, [visible]);
	useEffect(() => {
		if (!visible || signal.aborted) return;
		const controller = new AbortController(),
			reading = AbortSignal.any([signal, controller.signal]);
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function refresh() {
			try {
				if (document.visibilityState === "visible") {
					const next = await data.list(bindings, reading);
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
	const pendingFor = (slot: string) =>
		pending !== "unreadable" && pending.some((row) => data.slot(row) === slot);
	const blocked = (slot: string) =>
		pending === "unreadable" || pendingFor(slot) || busy.includes(slot) || !!readProblem;
	function notice(original: data.Pending, text: string) {
		setNotices((previous) => ({
			...previous,
			[data.slot(original)]: { requestId: original.requestId, text },
		}));
	}
	function settle(original: data.Pending, result: data.Schedule | null) {
		signal.throwIfAborted();
		if (!result) {
			notice(original, "操作结果未知，请核对原请求。");
			return;
		}
		data.clear(key, original);
		notice(
			original,
			original.action === "add"
				? "原请求：定时输入已登记。"
				: result.state === "done"
					? "原请求已确认：计划投递已结束，已提交的输入继续。"
					: "取消请求已确认；任务终态单独显示，已提交的输入继续。",
		);
		if (original.action === "add")
			setDraft((current) => (current.text === original.input.text ? { ...current, text: "" } : current));
		setRevision((value) => value + 1);
	}
	async function perform(slot: string, effect: () => Promise<void>) {
		if (signal.aborted || locks.current.has(slot)) return;
		locks.current.add(slot);
		setBusy([...locks.current]);
		setProblem("");
		setNotices((previous) => {
			const next = { ...previous };
			delete next[slot];
			return next;
		});
		try {
			await effect();
		} catch (reason) {
			if (!signal.aborted) setProblem(data.failure(reason));
		} finally {
			locks.current.delete(slot);
			if (!signal.aborted) setBusy([...locks.current]);
		}
	}
	function act(command: data.Command) {
		const slot = data.slot(command);
		if (!view?.canWrite || blocked(slot)) return;
		void perform(slot, async () => {
			const original: data.Pending = { ...command, version: 1, requestId: crypto.randomUUID(), target };
			data.retain(key, original);
			setConfirmation(null);
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
		void perform(data.slot(original), async () => {
			const current = data.pending(key, target);
			if (current === "unreadable" || !current.some((row) => row.requestId === original.requestId))
				throw new Error("原请求记录已变化，请保留记录并核对。");
			settle(original, await data.reconcile(bindings, original, signal));
		});
	}
	const filtered = (view?.schedules ?? []).filter((row) => {
		const match =
			filter === "all" ||
			(filter === "active" ? ["waiting", "running", "unknown"].includes(row.state) : row.state === filter);
		return (
			match &&
			`${row.text}\n${row.actorName}\n${row.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
		);
	});
	const pages = Math.max(1, Math.ceil(filtered.length / 20)),
		currentPage = Math.min(page, pages - 1);
	const rows = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
	return (
		<section ref={element} className="schedule-view schedule-stack" aria-label="定时输入">
			<header className="schedule-heading">
				<div className="schedule-stack schedule-tight">
					<h1>定时输入</h1>
					<p className="schedule-muted">当前 Conversation 的有限计划</p>
				</div>
				<Button label="刷新计划" variant="ghost" onClick={() => setRevision((value) => value + 1)} />
			</header>
			{problem && (
				<p role="alert" className="schedule-problem">
					{problem}
				</p>
			)}
			{Object.entries(notices).map(([slot, value]) => (
				<p key={slot} role="status">
					{value.text}
				</p>
			))}
			{pending === "unreadable" ? (
				<p role="alert">本地原请求不可读，已停止新操作。请保留记录并核对。</p>
			) : (
				pending.map((original) => (
					<section
						key={original.requestId}
						className="schedule-pending schedule-stack"
						aria-label={`原请求 ${original.requestId}`}
					>
						<h2>待核对：{original.action === "add" ? "安排输入" : "取消计划"}</h2>
						<code>{original.requestId}</code>
						<details>
							<summary>原请求与草稿</summary>
							<pre>{JSON.stringify(original.input, null, 2)}</pre>
						</details>
						<Button
							label="核对原请求"
							isDisabled={busy.includes(data.slot(original))}
							isLoading={busy.includes(data.slot(original))}
							onClick={() => reconcile(original)}
						/>
					</section>
				))
			)}
			{readProblem && (
				<p role="alert" className="schedule-problem">
					{readProblem}
					{view ? " · 下方保留最近一次读取结果。" : ""}
				</p>
			)}
			{!view ? (
				<p role="status">{readProblem ? "当前计划暂不可读取。" : "正在读取计划…"}</p>
			) : (
				<>
					{!view.canWrite && <p className="schedule-muted">只读</p>}
					{view.canWrite && (
						<ScheduleForm draft={draft} update={setDraft} blocked={blocked("add")} submit={act} />
					)}
					{visible && view.canWrite && confirmation && (
						<section className="schedule-pending schedule-stack" aria-label="确认取消计划">
							<h2>取消后续投递？</h2>
							<p className="schedule-text">{confirmation.text}</p>
							<p className="schedule-muted">已提交的输入继续执行。</p>
							<div className="schedule-actions">
								<Button label="返回" variant="ghost" onClick={() => setConfirmation(null)} />
								<Button
									label="确认取消计划"
									isDisabled={blocked("cancel:" + confirmation.id)}
									onClick={() => act({ action: "cancel", input: { id: confirmation.id } })}
								/>
							</div>
						</section>
					)}
					<section className="schedule-stack" aria-label="计划清单">
						<div className="schedule-heading">
							<h2>计划清单</h2>
							<small className="schedule-muted">投递次数不表示模型已答完。</small>
						</div>
						<div className="schedule-fields">
							<TextInput
								label="搜索已读取计划"
								value={search}
								width="100%"
								autoComplete="off"
								controlClassName="schedule-control"
								onChange={(value) => {
									setSearch(value);
									setPage(0);
								}}
							/>
							<label className="schedule-stack schedule-tight">
								<span>状态</span>
								<select
									value={filter}
									onChange={(event) => {
										setFilter(event.currentTarget.value);
										setPage(0);
									}}
								>
									<option value="all">全部</option>
									<option value="active">未结束</option>
									<option value="done">输入已投递</option>
									<option value="cancelled">已取消</option>
									<option value="unknown">执行结果未知</option>
								</select>
							</label>
						</div>
						{rows.length === 0 && <p>{search || filter !== "all" ? "没有匹配的计划。" : "暂无计划。"}</p>}
						{rows.map((row) => (
							<article key={row.id} className="schedule-card schedule-stack" aria-label={`计划 ${row.id}`}>
								<header className="schedule-heading">
									<strong>{row.actorName}</strong>
									<span className="schedule-state">{data.states[row.state]}</span>
								</header>
								<p className="schedule-text">{row.text}</p>
								<p className="schedule-muted">
									<time dateTime={new Date(row.dueAt).toISOString()}>{time(row.dueAt)}</time>
									{" · "}
									{row.completed} / {row.maxRuns} 次已投递
									{row.intervalMs === null ? "" : ` · 间隔 ${row.intervalMs / 1000} 秒`}
								</p>
								{row.cancellationRequested && ["waiting", "running", "unknown"].includes(row.state) && (
									<p role="status">已请求取消，任务停止仍待确认。</p>
								)}
								{row.state === "unknown" && <p role="status">执行结果未知；读取不恢复或重放计划。</p>}
								{row.actorId === bindings.personId && visible && (
									<RunReceipts binding={bindings} id={row.id} signal={signal} />
								)}
								{row.deliveryId && (
									<p className="schedule-muted">
										输入回执：<code>{row.deliveryId}</code>
									</p>
								)}
								<details>
									<summary>计划身份</summary>
									<p>
										计划：<code>{row.id}</code>
									</p>
									<p>
										原生任务：<code>{row.jobId ?? "未确认"}</code>
									</p>
									{row.nativeTerminal && (
										<p>原生终态：{row.nativeTerminal === "aborted" ? "已停止" : "已结束"}</p>
									)}
								</details>
								{view.canWrite &&
									!row.cancellationRequested &&
									["waiting", "running", "unknown"].includes(row.state) && (
										<Button
											label="取消计划…"
											variant="ghost"
											isDisabled={blocked("cancel:" + row.id)}
											onClick={() => setConfirmation(row)}
										/>
									)}
							</article>
						))}
						<div className="schedule-actions">
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
