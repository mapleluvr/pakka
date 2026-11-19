import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { UiViewProps } from "@pakka/webui-sdk";
import * as data from "./data.ts";

const states: Record<data.ApprovalState, string> = {
	pending: "等待决定",
	allowed: "已允许，等待执行",
	denied: "已拒绝",
	running: "正在执行",
	done: "执行完成",
	unknown: "执行结果未知",
};
const failure = (reason: unknown) => (reason instanceof Error ? reason.message : "审批操作未能确认。");
export function Approvals({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
	const target = bindings.target!,
		key = data.storageKey(bindings);
	const lifetime = useMemo(() => new AbortController(), [ui, bindings]);
	const signal = useMemo(
		() => AbortSignal.any([ui.signal, bindings.signal, lifetime.signal]),
		[ui, bindings, lifetime],
	);
	const element = useRef<HTMLElement>(null),
		lock = useRef(false);
	const [visible, setVisible] = useState(false),
		[revision, setRevision] = useState(0);
	const [view, setView] = useState<Awaited<ReturnType<typeof data.list>> | null>(null);
	const [pending, setPending] = useState(() => data.pending(key, target));
	const [problem, setProblem] = useState(""),
		[notice, setNotice] = useState("");
	const [readProblem, setReadProblem] = useState(""),
		[busy, setBusy] = useState<string | null>(null);
	const [onlyPending, setOnlyPending] = useState(false),
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
					const next = await data.list(bindings, reading);
					reading.throwIfAborted();
					setView(next);
					setReadProblem("");
				}
			} catch (reason) {
				if (!reading.aborted) {
					setReadProblem(failure(reason));
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
	async function perform(effect: () => Promise<void>, id: string) {
		if (signal.aborted || lock.current) return;
		lock.current = true;
		setBusy(id);
		setProblem("");
		setNotice("");
		try {
			await effect();
		} catch (reason) {
			if (!signal.aborted) {
				if (reason instanceof Error && "outcome" in reason && reason.outcome === "denied") setView(null);
				setProblem(failure(reason));
			}
		} finally {
			lock.current = false;
			if (!signal.aborted) setBusy(null);
		}
	}
	function settle(original: data.PendingDecision, operation: Parameters<typeof data.confirmed>[2]) {
		signal.throwIfAborted();
		const result = data.confirmed(bindings, original, operation);
		if (!result) {
			setNotice("原请求回执仍未确认；保留原请求，继续观察工具状态。");
			return;
		}
		data.clear(key, original);
		setNotice(
			`${original.input.allow ? "允许" : "拒绝"}的原请求已确认。回执中的工具状态：${states[result.state]}。下方列表独立读取当前状态。`,
		);
		setRevision((value) => value + 1);
	}
	function decide(row: data.Approval, allow: boolean) {
		if (
			!view?.canDecide ||
			pending === "unreadable" ||
			row.state !== "pending" ||
			Date.now() >= row.expiresAt
		)
			return;
		void perform(async () => {
			const original: data.PendingDecision = {
				version: 1,
				requestId: crypto.randomUUID(),
				target,
				input: { id: row.id, allow },
			};
			data.retain(key, original);
			let operation;
			try {
				operation = await bindings.call(
					"decide",
					{ id: original.input.id, allow: original.input.allow },
					{ signal, requestId: original.requestId },
				);
			} catch (reason) {
				if (!signal.aborted && reason instanceof Error && "outcome" in reason && reason.outcome === "denied")
					data.clear(key, original);
				throw reason;
			}
			settle(original, operation);
		}, row.id);
	}
	function reconcile(original: data.PendingDecision) {
		void perform(async () => {
			const current = data.pending(key, target);
			if (
				current === "unreadable" ||
				!current.some((row) => row.requestId === original.requestId && row.input.id === original.input.id)
			)
				throw new Error("本地原请求已变化，请保留记录并核对。");
			const bound = bindings.forConversation(original.target, { signal });
			settle(original, await bound.operationByRequest(original.requestId, { signal }));
		}, original.input.id);
	}
	function originalRequest(original: data.PendingDecision) {
		return (
			<section className="approvals-request approvals-stack" aria-label="审批原请求">
				<p>原决定待核对：{original.input.allow ? "允许这一次" : "拒绝这一次"}。查询只读取该请求的回执。</p>
				<code>{original.requestId}</code>
				<Button
					label="核对原请求"
					isDisabled={!!busy}
					isLoading={busy === original.input.id}
					onClick={() => reconcile(original)}
				/>
			</section>
		);
	}
	const rows = view?.approvals ?? [],
		originals = pending === "unreadable" ? [] : pending;
	const filtered = rows.filter(
		(row) =>
			!onlyPending || row.state === "pending" || originals.some((original) => original.input.id === row.id),
	);
	const start = Math.min(page * 20, Math.max(0, Math.ceil(filtered.length / 20) - 1) * 20);
	const known = new Set(rows.map((row) => row.id));
	return (
		<section ref={element} className="approvals-view approvals-stack" aria-label="工具审批">
			<header className="approvals-heading">
				<div>
					<h1>工具审批</h1>
					<p className="approvals-muted">查看原工具调用的参数，决定是否允许这一次执行。</p>
				</div>
				<Button label="刷新审批" variant="ghost" onClick={() => setRevision((value) => value + 1)} />
			</header>
			<p>决定只适用于仍在等待且未到期的调用。页面关闭只停止观察；调用期限和执行状态由服务管理。</p>
			{problem && (
				<p role="alert" className="approvals-problem">
					{problem}
				</p>
			)}
			{readProblem && (
				<p role="alert" className="approvals-problem">
					{readProblem} · 下方为最近一次读取结果。
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			{pending === "unreadable" && (
				<p role="alert" className="approvals-problem">
					本地原请求不可读，已停止新的决定。请保留记录并核对。
				</p>
			)}
			{originals
				.filter((original) => !known.has(original.input.id))
				.map((original) => (
					<article key={original.requestId} className="approvals-card approvals-stack">
						<h2>待核对的原审批</h2>
						<code>{original.input.id}</code>
						{originalRequest(original)}
					</article>
				))}
			{!view && <p role="status">{readProblem ? "审批列表暂不可用。" : "正在读取审批…"}</p>}
			{view && (
				<>
					<div className="approvals-actions">
						<label className="approvals-actions">
							<input
								type="checkbox"
								checked={onlyPending}
								onChange={(event) => {
									setOnlyPending(event.currentTarget.checked);
									setPage(0);
								}}
							/>
							仅显示等待决定或待核对的调用
						</label>
						<span>{rows.filter((row) => row.state === "pending").length} 项等待决定</span>
					</div>
					{!view.canDecide && (
						<p className="approvals-muted">当前身份可读取审批；决定需要此 Conversation 的管理权限。</p>
					)}
					{!filtered.length && <p>没有符合条件的审批记录。</p>}
					{filtered.slice(start, start + 20).map((row) => {
						const original = originals.find((original) => original.input.id === row.id),
							expired = Date.now() >= row.expiresAt;
						return (
							<article
								key={row.id}
								className="approvals-card approvals-stack"
								aria-label={`工具调用 ${row.tool}`}
							>
								<header className="approvals-heading">
									<h2>{row.tool}</h2>
									<span role="status">
										{states[row.state]}
										{row.state === "pending" && expired ? " · 已到期" : ""}
									</span>
								</header>
								<dl>
									<dt>请求时间</dt>
									<dd>{new Date(row.createdAt).toLocaleString()}</dd>
									<dt>等待截止</dt>
									<dd>{new Date(row.expiresAt).toLocaleString()}</dd>
								</dl>
								<details open={row.state === "pending"}>
									<summary>原工具参数</summary>
									<pre tabIndex={0}>{row.argumentsText}</pre>
								</details>
								<small className="approvals-muted">
									调用 {row.id}
									{row.decidedBy ? ` · 决定人 ${row.decidedBy}` : ""}
								</small>
								{row.state === "unknown" && (
									<p className="approvals-problem">工具是否完成尚未确认；保存的决定不授权重新执行。</p>
								)}
								{original
									? originalRequest(original)
									: row.state === "pending" &&
										view.canDecide && (
											<div className="approvals-actions">
												<Button
													label={`允许 ${row.tool} 这一次`}
													variant="primary"
													isDisabled={!!busy || expired || pending === "unreadable" || !!readProblem}
													onClick={() => decide(row, true)}
												>
													允许这一次
												</Button>
												<Button
													label={`拒绝 ${row.tool} 这一次`}
													isDisabled={!!busy || expired || pending === "unreadable" || !!readProblem}
													onClick={() => decide(row, false)}
												>
													拒绝
												</Button>
											</div>
										)}
							</article>
						);
					})}
					{filtered.length > 20 && (
						<nav className="approvals-actions" aria-label="审批分页">
							<Button
								label="上一页"
								isDisabled={start === 0}
								onClick={() => setPage(Math.max(0, start / 20 - 1))}
							/>
							<span>
								{start + 1}–{Math.min(start + 20, filtered.length)} / {filtered.length}
							</span>
							<Button
								label="下一页"
								isDisabled={start + 20 >= filtered.length}
								onClick={() => setPage(start / 20 + 1)}
							/>
						</nav>
					)}
				</>
			)}
		</section>
	);
}
