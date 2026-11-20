import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { UiViewProps } from "@pakka/webui-sdk";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import * as data from "./data.ts";

const actionNames: Record<data.Action, string> = {
	navigate: "打开页面",
	click: "点击控件",
	fill: "填入文本",
};
function PageFrame({ frame }: { frame: string }) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		const bytes = Uint8Array.from(atob(frame), (character) => character.charCodeAt(0));
		const next = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [frame]);
	return url ? (
		<img src={url} alt="受控浏览器当前页面截图" className="browser-frame" />
	) : (
		<p role="status">正在显示截图…</p>
	);
}
export function Browser({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
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
	const input = pending && pending !== "unreadable" && isRecord(pending.input) ? pending.input : null;
	const [url, setUrl] = useState(() => (typeof input?.url === "string" ? input.url : ""));
	const [selector, setSelector] = useState(() => (typeof input?.selector === "string" ? input.selector : ""));
	const [text, setText] = useState(() => (typeof input?.text === "string" ? input.text : ""));
	const [view, setView] = useState<data.View | null>(null),
		[observedAt, setObservedAt] = useState<number | null>(null);
	const [busy, setBusy] = useState(false),
		[paused, setPaused] = useState(false);
	const [notice, setNotice] = useState(""),
		[problem, setProblem] = useState(""),
		[readProblem, setReadProblem] = useState("");
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
					const next = await data.view(bindings, reading);
					reading.throwIfAborted();
					setView(next);
					setReadProblem("");
					setObservedAt(Date.now());
				}
			} catch (reason) {
				if (!reading.aborted) {
					setReadProblem(data.failure(reason));
					if (reason instanceof Error && "outcome" in reason && reason.outcome === "denied") setView(null);
				}
			} finally {
				if (!reading.aborted && !paused)
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
	}, [bindings, signal, visible, paused, revision]);
	async function perform(effect: () => Promise<void>) {
		if (signal.aborted || lock.current) return;
		lock.current = true;
		setBusy(true);
		setNotice("");
		setProblem("");
		try {
			await effect();
		} catch (reason) {
			if (!signal.aborted) setProblem(data.failure(reason));
		} finally {
			lock.current = false;
			if (!signal.aborted) setBusy(false);
		}
	}
	function settle(original: data.Pending, receipt: data.Receipt | null) {
		signal.throwIfAborted();
		if (receipt?.state === "done") {
			data.clear(key, original);
			setNotice(`原请求「${actionNames[original.action]}」的浏览器动作已确认。`);
		} else setNotice("浏览器动作结果未知，请核对原请求。");
		setRevision((value) => value + 1);
	}
	function act(action: data.Action, input: ExtensionJson) {
		if (!view?.canAct || readProblem || pending) return;
		void perform(async () => {
			if (action === "navigate") {
				let parsed: URL;
				try {
					parsed = new URL(url);
				} catch {
					throw new Error("请输入完整的 HTTP 或 HTTPS 地址。");
				}
				if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
					throw new Error("请输入不含账户信息的 HTTP 或 HTTPS 地址。");
			}
			const original: data.Pending = {
				version: 1,
				requestId: crypto.randomUUID(),
				target,
				action,
				input: data.inputFor(action, input),
			};
			data.retain(key, original);
			let operation;
			try {
				operation = await bindings.call(action, original.input, { signal, requestId: original.requestId });
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
	return (
		<section ref={element} className="browser-view browser-stack" aria-label="项目浏览器">
			<header className="browser-heading">
				<div>
					<h1>项目浏览器</h1>
					<p className="browser-muted">服务器浏览器</p>
				</div>
				<div className="browser-actions">
					<Button label="刷新当前页面" variant="ghost" onClick={() => setRevision((value) => value + 1)} />
					<Button
						label={paused ? "继续自动观察" : "暂停自动观察"}
						variant="ghost"
						aria-pressed={paused}
						onClick={() => setPaused((value) => !value)}
					/>
				</div>
			</header>
			{problem && (
				<p role="alert" className="browser-problem">
					{problem}
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			{pending && (
				<section className="browser-pending browser-stack" aria-label="浏览器原请求">
					{pending === "unreadable" ? (
						<p role="alert">本地原请求不可读，已停止新操作。请保留记录并核对。</p>
					) : (
						<>
							<h2>待核对：{actionNames[pending.action]}</h2>
							<code>{pending.requestId}</code>
							<details>
								<summary>原操作参数</summary>
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
			{view?.canAct && (
				<section className="browser-card browser-stack" aria-label="浏览器操作">
					<form
						className="browser-navigation"
						onSubmit={(event) => {
							event.preventDefault();
							act("navigate", { url });
						}}
					>
						<TextInput
							label="获准页面地址"
							htmlName="browser-url"
							value={url}
							onChange={setUrl}
							autoComplete="off"
							width="100%"
							controlClassName="browser-control"
							isDisabled={blocked}
							placeholder="https://project.example"
						/>
						<Button label="打开页面" type="submit" variant="primary" isDisabled={blocked || !url.trim()} />
					</form>
					<div className="browser-operation">
						<div className="browser-stack">
							<TextInput
								label="页面控件选择器"
								htmlName="browser-selector"
								value={selector}
								onChange={setSelector}
								autoComplete="off"
								width="100%"
								controlClassName="browser-control"
								isDisabled={blocked}
								placeholder="#submit 或 input[name=message]"
							/>
							<Button
								label="点击控件"
								isDisabled={blocked || !view.open || !selector.trim()}
								onClick={() => act("click", { selector })}
							/>
						</div>
						<div className="browser-stack">
							<label className="browser-stack browser-tight">
								<span>填入文本（最多 4096 个字符）</span>
								<textarea
									aria-label="填入文本"
									name="browser-text"
									value={text}
									maxLength={4096}
									disabled={blocked}
									onChange={(event) => setText(event.currentTarget.value)}
									rows={3}
								/>
							</label>
							<Button
								label="填入控件"
								isDisabled={blocked || !view.open || !selector.trim()}
								onClick={() => act("fill", { selector, text })}
							/>
						</div>
					</div>
				</section>
			)}
			{view && !view.canAct && <p className="browser-muted">只读</p>}
			<section className="browser-card browser-stack" aria-label="当前页面">
				<header className="browser-heading">
					<h2>{view?.title || "当前页面"}</h2>
					{observedAt && (
						<small className="browser-muted">
							{paused ? "自动观察已暂停 · " : ""}最近读取 {new Date(observedAt).toLocaleTimeString()}
						</small>
					)}
				</header>
				{readProblem && (
					<p role="alert" className="browser-problem">
						{readProblem}
						{view ? " · 下方保留最近一次读取结果。" : ""}
					</p>
				)}
				{!view ? (
					<p role="status">{readProblem ? "当前页面暂不可读取。" : "正在读取页面…"}</p>
				) : !view.open ? (
					<p>此 Conversation 尚未打开页面。</p>
				) : (
					<>
						<code>{view.url}</code>
						{view.frame && visible && <PageFrame frame={view.frame} />}
						<details open>
							<summary>页面文字（最多 16000 个字符）</summary>
							<pre tabIndex={0}>{view.text || "当前页面没有可读取的文字。"}</pre>
						</details>
					</>
				)}
			</section>
		</section>
	);
}
