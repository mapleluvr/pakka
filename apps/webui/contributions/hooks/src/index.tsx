import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { UiViewProps } from "@pakka/webui-sdk";
import * as data from "./data.ts";
import * as requests from "./requests.ts";
import { Setup } from "./Setup.tsx";

const admissionLabels = {
	accepted: "输入已接纳",
	ignored: "已忽略",
	unknown: "接纳结果未知",
	denied: "接收被拒绝",
	conflict: "投递身份冲突",
	capacity: "达到接收上限",
} as const;
const inputLabels = {
	queued: "排队",
	placed: "已接纳",
	done: "已完成",
	unanswered: "未回答",
	unknown: "结果未知",
} as const;
const time = (value: number) => new Date(value).toLocaleString();

function Admissions({
	bindings,
	hook,
	signal,
	close,
}: {
	bindings: ExtensionServiceBinding;
	hook: data.Hook;
	signal: AbortSignal;
	close(): void;
}) {
	const [rows, setRows] = useState<readonly data.Admission[] | null>(null),
		[problem, setProblem] = useState("");
	const [revision, setRevision] = useState(0),
		[page, setPage] = useState(0);
	useEffect(() => {
		const controller = new AbortController(),
			reading = AbortSignal.any([signal, controller.signal]);
		void data
			.deliveries(bindings, hook, reading)
			.then((value) => {
				reading.throwIfAborted();
				setRows([...value].sort((first, second) => second.receivedAt - first.receivedAt));
				setProblem("");
			})
			.catch((reason) => {
				if (!reading.aborted) setProblem(data.problem(reason));
			});
		return () => controller.abort();
	}, [bindings, hook.id, signal, revision]);
	const pages = Math.max(1, Math.ceil((rows?.length ?? 0) / 20)),
		current = Math.min(page, pages - 1);
	return (
		<section className="hook-panel hook-stack" aria-label={"接纳记录 " + hook.id}>
			<div className="hook-heading">
				<h3>接纳记录</h3>
				<div className="hook-actions">
					<Button label="刷新接纳记录" variant="ghost" onClick={() => setRevision((value) => value + 1)} />
					<Button label="关闭接纳记录" variant="ghost" onClick={close} />
				</div>
			</div>
			<p className="hook-muted">显示接纳时的原回执；当前模型工作请在 Conversation 中查看。</p>
			{problem && (
				<p role="alert" className="hook-problem">
					{problem}
					{rows ? " · 保留最近一次读取。" : ""}
				</p>
			)}
			{!rows ? (
				!problem && <p role="status">正在读取接纳记录…</p>
			) : rows.length === 0 ? (
				<p>暂无接纳记录。</p>
			) : (
				rows.slice(current * 20, (current + 1) * 20).map((row) => (
					<article key={row.id} className="hook-record hook-stack hook-tight">
						<div className="hook-heading">
							<strong>{admissionLabels[row.result.state]}</strong>
							<time dateTime={new Date(row.receivedAt).toISOString()}>{time(row.receivedAt)}</time>
						</div>
						<code>{row.id}</code>
						{row.result.receipt && (
							<>
								<p>接纳时输入状态：{inputLabels[row.result.receipt.status]}</p>
								<p className="hook-muted">
									输入回执：<code>{row.result.receipt.id}</code>
								</p>
							</>
						)}
					</article>
				))
			)}
			{rows && (
				<div className="hook-actions">
					<Button
						label="记录上一页"
						variant="ghost"
						isDisabled={current === 0}
						onClick={() => setPage(current - 1)}
					/>
					<span>
						{rows.length} 条 · {current + 1} / {pages}
					</span>
					<Button
						label="记录下一页"
						variant="ghost"
						isDisabled={current + 1 >= pages}
						onClick={() => setPage(current + 1)}
					/>
				</div>
			)}
		</section>
	);
}

export function Hooks({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
	const key = requests.key(bindings),
		target = data.requireTarget(bindings);
	const lifetime = useMemo(() => new AbortController(), [ui, bindings]);
	const signal = useMemo(
		() => AbortSignal.any([ui.signal, bindings.signal, lifetime.signal]),
		[ui, bindings, lifetime],
	);
	const root = useRef<HTMLElement>(null),
		form = useRef<HTMLFormElement>(null);
	const setupFocus = useRef<HTMLButtonElement | null>(null),
		confirmationFocus = useRef<HTMLButtonElement | null>(null);
	const confirmationRoot = useRef<HTMLElement>(null),
		locks = useRef(new Set<string>());
	const [pending, setPending] = useState(() => requests.read(key, target));
	const [draft, setDraft] = useState<data.Create>(() => {
		const saved = pending !== "unreadable" ? pending.find((row) => row.action === "create") : undefined;
		return saved?.action === "create"
			? { ...saved.input }
			: { name: "", instructions: "", signed: true, allowOutside: false };
	});
	const [view, setView] = useState<data.View | null>(null),
		[readProblem, setReadProblem] = useState("");
	const [visible, setVisible] = useState(false),
		[revision, setRevision] = useState(0);
	const [busy, setBusy] = useState<readonly string[]>([]),
		[problem, setProblem] = useState("");
	const [formProblem, setFormProblem] = useState("");
	const [notices, setNotices] = useState<Record<string, { requestId: string; text: string }>>({});
	const [setup, setSetup] = useState<{ id: string; version: number } | null>(null),
		[admissions, setAdmissions] = useState<string | null>(null);
	const [confirmation, setConfirmation] = useState<{ action: "rotate" | "remove"; hook: data.Hook } | null>(
		null,
	);
	const [search, setSearch] = useState(""),
		[page, setPage] = useState(0);

	useEffect(() => () => lifetime.abort(), [lifetime]);
	useEffect(() => requests.watch(key, () => setPending(requests.read(key, target))), [key, target]);
	useEffect(() => {
		const node = root.current;
		if (!node) return;
		const observer = new ResizeObserver(() => {
			const bounds = node.getBoundingClientRect();
			setVisible(bounds.width > 0 && bounds.height > 0);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (!visible) {
			setSetup(null);
			setAdmissions(null);
			setConfirmation(null);
		}
	}, [visible]);
	useEffect(() => {
		if (!setup) return;
		if (
			!view?.canManage ||
			readProblem ||
			!view.hooks.some(
				(row) =>
					row.id === setup.id &&
					row.version === setup.version &&
					row.active &&
					data.sameTarget(row.target, target),
			)
		)
			setSetup(null);
	}, [view, readProblem, setup, target]);
	useEffect(() => {
		if (confirmation && visible) confirmationRoot.current?.focus();
	}, [confirmation, visible]);
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
					setReadProblem(data.problem(reason));
					setSetup(null);
					if (reason instanceof Error && "outcome" in reason && reason.outcome === "denied") {
						setView(null);
						setAdmissions(null);
						setConfirmation(null);
					}
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
	}, [bindings, visible, signal, revision]);

	const pendingFor = (slot: string) =>
		pending !== "unreadable" && pending.some((row) => requests.slot(row) === slot);
	const blocked = (slot: string) =>
		pending === "unreadable" || pendingFor(slot) || busy.includes(slot) || Boolean(readProblem);
	function hideSetup() {
		setSetup(null);
		if (setupFocus.current?.isConnected) setupFocus.current.focus({ preventScroll: true });
	}
	function hideConfirmation() {
		setConfirmation(null);
		if (confirmationFocus.current?.isConnected) confirmationFocus.current.focus({ preventScroll: true });
	}
	function notice(original: requests.Pending, text: string) {
		setNotices((previous) => ({
			...previous,
			[requests.slot(original)]: { requestId: original.requestId, text },
		}));
	}
	function settle(original: requests.Pending, result: data.Mutation | null) {
		signal.throwIfAborted();
		if (!result) {
			notice(original, "操作结果未知，请核对原请求。");
			return;
		}
		requests.clear(key, original);
		if (result.state === "conflict") notice(original, "原请求发生版本冲突，没有采用新变更；草稿已保留。");
		else {
			notice(
				original,
				original.action === "create"
					? "原请求：Webhook 已登记。"
					: original.action === "rotate"
						? "原请求：密钥轮换已确认；当前连接设置以清单为准。"
						: "原请求：移除已确认，已接纳输入和接纳记录保留。",
			);
			if (original.action === "create")
				setDraft((current) =>
					current.name === original.input.name &&
					current.instructions === original.input.instructions &&
					current.signed === original.input.signed &&
					current.allowOutside === original.input.allowOutside
						? { ...current, name: "", instructions: "", allowOutside: false }
						: current,
				);
		}
		setRevision((value) => value + 1);
	}
	async function perform(slot: string, action: () => Promise<void>) {
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
			await action();
		} catch (reason) {
			if (!signal.aborted) setProblem(data.problem(reason));
		} finally {
			locks.current.delete(slot);
			if (!signal.aborted) setBusy([...locks.current]);
		}
	}
	function act(command: data.Command) {
		const slot = requests.slot(command);
		if (!view?.canManage || blocked(slot)) return;
		void perform(slot, async () => {
			const original: requests.Pending = { ...command, version: 1, requestId: crypto.randomUUID(), target };
			requests.retain(key, original);
			setSetup(null);
			setConfirmation(null);
			let result;
			try {
				result = await data.change(bindings, original, original.requestId, signal);
			} catch (reason) {
				if (!signal.aborted && reason instanceof Error && "outcome" in reason && reason.outcome === "denied")
					requests.clear(key, original);
				throw reason;
			}
			settle(original, result);
		});
	}
	function reconcile(original: requests.Pending) {
		void perform(requests.slot(original), async () => {
			const current = requests.read(key, target);
			if (current === "unreadable" || !current.some((row) => requests.same(row, original)))
				throw new Error("原请求记录已变化，请保留当前记录并核对。");
			settle(original, await data.reconcile(bindings, original, original.requestId, signal, original.target));
		});
	}
	const filtered = (view?.hooks ?? []).filter((row) =>
		(row.name + "\n" + row.instructions + "\n" + row.id)
			.toLocaleLowerCase()
			.includes(search.toLocaleLowerCase()),
	);
	const pages = Math.max(1, Math.ceil(filtered.length / 20)),
		currentPage = Math.min(page, pages - 1);
	const shown = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
	const selectedSetup = setup
		? view?.hooks.find(
				(row) => row.id === setup.id && row.version === setup.version && data.sameTarget(row.target, target),
			)
		: undefined;
	const selectedAdmissions = admissions ? view?.hooks.find((row) => row.id === admissions) : undefined;

	return (
		<section ref={root} className="hook-view hook-stack" aria-label="Webhook">
			<header className="hook-heading">
				<div className="hook-stack hook-tight">
					<h1>Webhook</h1>
					<p className="hook-muted">把受权外部事件送入当前 Conversation</p>
				</div>
				<div className="hook-actions">
					<Button label="刷新 Webhook" variant="ghost" onClick={() => setRevision((value) => value + 1)} />
					<Button
						label="打开 Conversation"
						variant="ghost"
						onClick={() => {
							void ui
								.navigate({
									source: "pakka",
									type: "conversation",
									id: JSON.stringify([target.sessionId, target.conversationId]),
								})
								.catch((reason) => {
									if (!signal.aborted) setProblem(data.problem(reason));
								});
						}}
					/>
				</div>
			</header>
			{problem && (
				<p role="alert" className="hook-problem">
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
						className="hook-pending hook-stack"
						aria-label={"原请求 " + original.requestId}
					>
						<h2>
							待核对：
							{original.action === "create"
								? "登记 Webhook"
								: original.action === "rotate"
									? "轮换密钥"
									: "移除 Webhook"}
						</h2>
						<code>{original.requestId}</code>
						<details>
							<summary>原请求与草稿</summary>
							<pre>{JSON.stringify(original.input, null, 2)}</pre>
						</details>
						<Button
							label="核对原请求"
							isDisabled={busy.includes(requests.slot(original))}
							isLoading={busy.includes(requests.slot(original))}
							onClick={() => reconcile(original)}
						/>
					</section>
				))
			)}
			{readProblem && (
				<p role="alert" className="hook-problem">
					{readProblem}
					{view ? " · 下方保留最近一次读取。" : ""}
				</p>
			)}
			{!view ? (
				<p role="status">{readProblem ? "Webhook 暂不可读取。" : "正在读取 Webhook…"}</p>
			) : (
				<>
					{!view.canManage && (
						<p className="hook-muted">只读。连接设置和变更需要当前控制权限及创建者归属。</p>
					)}
					{view.canManage && (
						<form
							ref={form}
							className="hook-card hook-stack"
							aria-label="新建 Webhook"
							onSubmit={(event) => {
								event.preventDefault();
								setFormProblem("");
								try {
									act(
										data.command({
											action: "create",
											input: { ...draft, allowOutside: draft.signed && draft.allowOutside },
										}),
									);
								} catch (reason) {
									setFormProblem(data.problem(reason));
									form.current?.querySelector<HTMLInputElement>('[name="hook-name"]')?.focus();
								}
							}}
						>
							<h2>新建 Webhook</h2>
							<fieldset disabled={blocked("create")} className="hook-stack">
								<label className="hook-stack hook-tight">
									名称
									<input
										name="hook-name"
										required
										maxLength={60}
										autoComplete="off"
										value={draft.name}
										onChange={(event) => {
											setFormProblem("");
											setDraft({ ...draft, name: event.currentTarget.value });
										}}
									/>
								</label>
								<label className="hook-stack hook-tight">
									每次事件的处理指令
									<textarea
										name="hook-instructions"
										rows={3}
										maxLength={2000}
										value={draft.instructions}
										onChange={(event) => {
											setFormProblem("");
											setDraft({ ...draft, instructions: event.currentTarget.value });
										}}
										onKeyDown={(event) => {
											if (
												(event.ctrlKey || event.metaKey) &&
												event.key === "Enter" &&
												!event.nativeEvent.isComposing
											) {
												event.preventDefault();
												form.current?.requestSubmit();
											}
										}}
									/>
								</label>
								<fieldset className="hook-stack hook-tight">
									<legend>发送方式</legend>
									<label className="hook-choice">
										<input
											type="radio"
											name="hook-source"
											checked={draft.signed}
											value="github"
											onChange={() => setDraft({ ...draft, signed: true })}
										/>
										GitHub 签名请求
									</label>
									<label className="hook-choice">
										<input
											type="radio"
											name="hook-source"
											checked={!draft.signed}
											value="generic"
											onChange={() => setDraft({ ...draft, signed: false, allowOutside: false })}
										/>
										其他服务的密钥地址
									</label>
								</fieldset>
								<p className="hook-muted">
									{draft.signed
										? "GitHub 使用独立签名密钥校验原始正文；地址本身不能提交输入。"
										: "完整地址携带授权密钥。持有该地址的服务可作为创建者提交输入。"}
								</p>
								{draft.signed && (
									<>
										<label className="hook-choice">
											<input
												type="checkbox"
												name="hook-outside"
												checked={draft.allowOutside}
												onChange={(event) =>
													setDraft({ ...draft, allowOutside: event.currentTarget.checked })
												}
											/>
											接受外部作者的内容
										</label>
										<p className="hook-muted">
											{draft.allowOutside
												? "签名通过的外部作者内容可进入此 Conversation。"
												: "依据签名正文筛选作者与仓库来源；通过的外部正文仍视为不可信数据。"}
										</p>
									</>
								)}
							</fieldset>
							{formProblem && (
								<p role="alert" className="hook-problem">
									{formProblem}
								</p>
							)}
							<Button
								label="登记 Webhook"
								variant="primary"
								type="submit"
								isDisabled={blocked("create")}
								isLoading={busy.includes("create")}
							/>
						</form>
					)}
					{visible && view.canManage && confirmation && (
						<section
							ref={confirmationRoot}
							tabIndex={-1}
							className="hook-pending hook-stack"
							aria-label={confirmation.action === "rotate" ? "确认轮换密钥" : "确认移除 Webhook"}
						>
							<h2>{confirmation.action === "rotate" ? "轮换密钥？" : "移除 Webhook？"}</h2>
							<p>
								{confirmation.hook.name} · 原版本 {confirmation.hook.version}
							</p>
							<p className="hook-muted">
								{confirmation.action === "rotate"
									? "旧密钥停止接收，请随后更新发送方的连接设置。"
									: "停止后续接收，已接纳输入和记录保留。"}
							</p>
							<div className="hook-actions">
								<Button label="返回" variant="ghost" onClick={hideConfirmation} />
								<Button
									label={confirmation.action === "rotate" ? "确认轮换密钥" : "确认移除 Webhook"}
									isDisabled={
										blocked("hook:" + confirmation.hook.id) ||
										(confirmation.action === "rotate" && !data.sameTarget(confirmation.hook.target, target))
									}
									onClick={() =>
										act({
											action: confirmation.action,
											input: { id: confirmation.hook.id, expectedVersion: confirmation.hook.version },
										})
									}
								/>
							</div>
						</section>
					)}
					<section className="hook-stack" aria-label="Webhook 清单">
						<div className="hook-heading">
							<h2>Webhook 清单</h2>
							<label className="hook-stack hook-tight">
								搜索已读取 Webhook
								<input
									name="hook-search"
									type="search"
									value={search}
									autoComplete="off"
									onChange={(event) => {
										setSearch(event.currentTarget.value);
										setPage(0);
									}}
								/>
							</label>
						</div>
						{shown.length === 0 && (
							<p>{search ? "没有匹配的 Webhook。" : "当前 Conversation 暂无可见 Webhook。"}</p>
						)}
						{shown.map((row) => (
							<article key={row.id} className="hook-card hook-stack" aria-label={"Webhook " + row.id}>
								<div className="hook-heading">
									<h3>{row.name}</h3>
									<span className="hook-state">{row.signed ? "GitHub · 签名" : "密钥地址"}</span>
								</div>
								{row.instructions && <p className="hook-text">{row.instructions}</p>}
								{!data.sameTarget(row.target, target) && (
									<p role="status" className="hook-muted">
										原运行配置已变更，旧地址不能接收。可移除后在当前配置新建。
									</p>
								)}
								<p className="hook-muted">
									记录：{row.received} 次 · 版本 {row.version}
									{row.allowOutside ? " · 接受外部作者" : ""}
								</p>
								{row.lastReceivedAt !== null && (
									<p className="hook-muted">最近记录：{time(row.lastReceivedAt)}</p>
								)}
								<div className="hook-actions">
									{view.canManage && (
										<>
											<Button
												label="连接设置…"
												variant="ghost"
												isDisabled={blocked("hook:" + row.id) || !data.sameTarget(row.target, target)}
												onClick={(event) => {
													setupFocus.current = event.currentTarget;
													setSetup({ id: row.id, version: row.version });
												}}
											/>
											<Button
												label="轮换密钥…"
												variant="ghost"
												isDisabled={blocked("hook:" + row.id) || !data.sameTarget(row.target, target)}
												onClick={(event) => {
													setSetup(null);
													confirmationFocus.current = event.currentTarget;
													setConfirmation({ action: "rotate", hook: row });
												}}
											/>
											<Button
												label="移除 Webhook…"
												variant="ghost"
												isDisabled={blocked("hook:" + row.id)}
												onClick={(event) => {
													setSetup(null);
													confirmationFocus.current = event.currentTarget;
													setConfirmation({ action: "remove", hook: row });
												}}
											/>
										</>
									)}
									<Button label="接纳记录" variant="ghost" onClick={() => setAdmissions(row.id)} />
								</div>
								<details>
									<summary>Webhook 身份</summary>
									<code>{row.id}</code>
								</details>
								{visible && view.canManage && !readProblem && selectedSetup?.id === row.id && (
									<Setup
										key={row.id + ":" + row.version}
										bindings={bindings}
										hook={selectedSetup}
										signal={signal}
										close={hideSetup}
									/>
								)}
								{visible && selectedAdmissions?.id === row.id && (
									<Admissions
										key={row.id}
										bindings={bindings}
										hook={selectedAdmissions}
										signal={signal}
										close={() => setAdmissions(null)}
									/>
								)}
							</article>
						))}
						<div className="hook-actions">
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
			<details className="hook-limits">
				<summary>接收范围与上限</summary>
				<div className="hook-stack hook-tight">
					<p>每人最多 20 个活动 Webhook；每个 Webhook 每小时最多 30 条新记录；每次正文最多 5 MiB。</p>
					<p>外部正文按 Conversation 输入上限截取。发送方需要能访问当前服务器地址。</p>
					<p>轮换密钥与移除约束后续接收；页面关闭或替换只结束观察，已接纳的输入继续执行。</p>
				</div>
			</details>
		</section>
	);
}
