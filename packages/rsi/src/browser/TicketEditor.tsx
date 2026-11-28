import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from "@astryxdesign/core/Layout";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useUiContext } from "@pakka/webui-sdk/react";
import type { TicketContent, TicketView } from "../types.ts";
import type { PendingTicketState } from "./pending.ts";

export function TicketEditor({
	original,
	busy,
	pending,
	problem,
	save,
	reconcile,
	close,
}: {
	original: TicketView | null;
	busy: boolean;
	pending: PendingTicketState;
	problem: string;
	save(content: TicketContent, original: TicketView | null): Promise<boolean>;
	reconcile(): Promise<boolean>;
	close(): void;
}) {
	const ui = useUiContext();
	const formId = useId();
	const titleInput = useRef<HTMLInputElement>(null);
	const bodyInput = useRef<HTMLTextAreaElement>(null);
	const sourceInput = useRef<HTMLTextAreaElement>(null);
	const [title, setTitle] = useState(original?.ticket.title ?? "");
	const [body, setBody] = useState(original?.ticket.body ?? "");
	const [sources, setSources] = useState(original?.ticket.sources.join("\n") ?? "");
	const [errors, setErrors] = useState({ title: "", body: "", sources: "" });
	const dirty =
		title !== (original?.ticket.title ?? "") ||
		body !== (original?.ticket.body ?? "") ||
		sources !== (original?.ticket.sources.join("\n") ?? "");
	const blocked = busy || !!pending;
	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		const unregister = ui.onDispose(() => window.removeEventListener("beforeunload", warn));
		return () => {
			unregister();
			window.removeEventListener("beforeunload", warn);
		};
	}, [dirty, ui]);
	function dismiss() {
		if (dirty && !pending && !window.confirm("放弃尚未保存的工单草稿？")) return;
		close();
	}
	async function submit() {
		if (blocked) return;
		const links = sources
			.split("\n")
			.map((value) => value.trim())
			.filter(Boolean);
		const next = {
			title: !title.trim() || title.trim().length > 200 ? "请填写标题，最长 200 字符。" : "",
			body: !body.trim() || body.length > 12000 ? "请填写正文，最长 12000 字符。" : "",
			sources:
				links.length > 8 || links.some((value) => value.length > 2048)
					? "最多 8 条来源，每条最长 2048 字符。"
					: "",
		};
		setErrors(next);
		if (next.title) {
			titleInput.current?.focus();
			return;
		}
		if (next.body) {
			bodyInput.current?.focus();
			return;
		}
		if (next.sources) {
			sourceInput.current?.focus();
			return;
		}
		if (await save({ title: title.trim(), body, sources: links }, original)) close();
	}
	return (
		<Dialog
			isOpen
			purpose="form"
			width={680}
			maxHeight="90dvh"
			aria-label={original ? "编辑工单" : "新建工单"}
			onOpenChange={(open) => {
				if (!open) dismiss();
			}}
		>
			<Layout
				className="rsi-editor"
				header={
					<LayoutHeader>
						<h2>{original ? "编辑工单" : "新建工单"}</h2>
					</LayoutHeader>
				}
				footer={
					<LayoutFooter>
						<div className="rsi-actions">
							<Button label="关闭编辑器" variant="ghost" onClick={dismiss} />
							{pending && pending !== "unreadable" ? (
								<Button
									label="核对原请求"
									isLoading={busy}
									isDisabled={busy}
									onClick={() => {
										void reconcile().then((done) => {
											if (done) close();
										});
									}}
								/>
							) : (
								<Button
									label="保存工单"
									type="submit"
									form={formId}
									variant="primary"
									isLoading={busy}
									isDisabled={blocked}
								/>
							)}
						</div>
					</LayoutFooter>
				}
			>
				<LayoutContent>
					<form
						id={formId}
						className="rsi-stack"
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							void submit();
						}}
						onKeyDown={(event) => {
							if (
								(event.ctrlKey || event.metaKey) &&
								event.key === "Enter" &&
								!event.nativeEvent.isComposing
							) {
								event.preventDefault();
								void submit();
							}
						}}
					>
						<p className="rsi-muted">
							{original
								? `基于版本 ${original.ticket.version} 保存；已有更新会报告冲突。`
								: "创建工单只保存记录，不会派发模型工作。"}
						</p>
						{problem && (
							<p className="rsi-problem" role="alert">
								{problem}
							</p>
						)}
						{pending && (
							<p role="status">
								{pending === "unreadable"
									? "本地原请求记录不可读，已停止提交；请保留记录并核对服务。"
									: "原请求结果未确认。可关闭界面后继续核对；关闭不会取消已接纳的保存。"}
							</p>
						)}
						<TextInput
							ref={titleInput}
							label="工单标题"
							htmlName="ticket-title"
							value={title}
							onChange={setTitle}
							width="100%"
							autoComplete="off"
							isRequired
							isDisabled={blocked}
							controlClassName="rsi-control"
							status={errors.title ? { type: "error", message: errors.title } : undefined}
						/>
						<TextArea
							ref={bodyInput}
							label="工单正文"
							htmlName="ticket-body"
							value={body}
							onChange={setBody}
							width="100%"
							rows={7}
							autoComplete="off"
							isRequired
							isDisabled={blocked}
							controlClassName="rsi-control"
							status={errors.body ? { type: "error", message: errors.body } : undefined}
						/>
						<TextArea
							ref={sourceInput}
							label="来源引用"
							htmlName="ticket-sources"
							value={sources}
							onChange={setSources}
							width="100%"
							rows={3}
							autoComplete="off"
							isOptional
							description="每行一条；保存原引用，不抓取内容。"
							isDisabled={blocked}
							controlClassName="rsi-control"
							status={errors.sources ? { type: "error", message: errors.sources } : undefined}
						/>
					</form>
				</LayoutContent>
			</Layout>
		</Dialog>
	);
}
