import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { UiViewProps } from "@pakka/webui-sdk";
import type { TicketState, TicketView } from "../types.ts";
import { TicketEditor } from "./TicketEditor.tsx";
import { useTickets } from "./useTickets.ts";

const labels: Record<TicketState, string> = {
	open: "待处理",
	active: "进行中",
	waiting: "等待中",
	closed: "已关闭",
};
const date = (value: number) =>
	new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);

function Source({ value }: { value: string }) {
	return /^https?:\/\//i.test(value) ? (
		<a href={value} target="_blank" rel="noreferrer noopener">
			{value}
		</a>
	) : (
		<code>{value}</code>
	);
}

/** Ordinary app-scoped React view. Service bindings and UI instance capabilities stay separate. */
export function Tickets({ ui, bindings }: UiViewProps<ExtensionServiceBinding>) {
	const state = useTickets(ui, bindings);
	const [editor, setEditor] = useState<TicketView | "new" | null>(null);
	const ticket = state.view?.ticket;
	return (
		<section className="rsi-view rsi-stack" aria-label="RSI 工单">
			<header className="rsi-heading">
				<div className="rsi-stack rsi-tight">
					<p className="rsi-eyebrow">RSI</p>
					<h1>工单</h1>
					<p className="rsi-muted">记录问题、查看当前内容与证据。保存不派发工作。</p>
				</div>
				<div className="rsi-actions">
					<Button
						label="刷新工单"
						variant="ghost"
						isDisabled={state.busy || state.loading}
						isLoading={state.loading}
						onClick={() => {
							void state.refresh();
						}}
					/>
					{state.capabilities?.submit && (
						<Button
							label="新建工单"
							variant="primary"
							isDisabled={state.busy || !!state.pending}
							onClick={() => setEditor("new")}
						/>
					)}
				</div>
			</header>
			{state.error && !editor && (
				<p role="alert" className="rsi-problem">
					{state.error}
				</p>
			)}
			{state.notice && <p role="status">{state.notice}</p>}
			{state.pending && (
				<section className="rsi-pending rsi-stack" aria-label="工单原请求">
					{state.pending === "unreadable" ? (
						<p role="alert">
							本地原请求记录不可读，已停止新写入。请保留记录并核对服务，不能假定此前没有保存。
						</p>
					) : (
						<>
							<p role="status">保存结果未确认。只查询原请求，不会重复提交。</p>
							<code>{state.pending.requestId}</code>
							<div className="rsi-actions">
								<Button
									label="核对原请求"
									isDisabled={state.busy}
									isLoading={state.busy}
									onClick={() => {
										void state.reconcile();
									}}
								/>
							</div>
						</>
					)}
				</section>
			)}
			<div className="rsi-columns">
				<section className="rsi-list rsi-stack" aria-label="工单列表">
					<h2>可读取的工单</h2>
					{state.loading && <p role="status">正在读取工单…</p>}
					{!state.loading && !state.page && <p className="rsi-muted">工单列表未能读取，请检查权限或刷新。</p>}
					{state.page?.items.length === 0 && <p className="rsi-muted">当前页没有可读取的工单。</p>}
					{state.page?.items.map((row) => (
						<Button
							key={row.id}
							label={`查看工单：${row.title}`}
							variant="ghost"
							width="100%"
							className="rsi-row"
							aria-pressed={ticket?.id === row.id}
							isDisabled={state.busy}
							onClick={() => {
								void state.choose(row.id);
							}}
						>
							<span className="rsi-row-content">
								<strong>{row.title}</strong>
								<span className="rsi-muted">
									{labels[row.state]} · v{row.version}
								</span>
								<small>{date(row.updatedAt)}</small>
							</span>
						</Button>
					))}
					<div className="rsi-actions">
						{state.page?.cursor && (
							<Button
								label="下一页工单"
								isDisabled={state.loading || state.busy}
								onClick={() => {
									void state.loadList(state.page?.cursor ?? undefined);
								}}
							/>
						)}
						<Button
							label="返回列表首页"
							variant="ghost"
							isDisabled={state.loading || state.busy}
							onClick={() => {
								void state.loadList();
							}}
						/>
					</div>
				</section>
				<article className="rsi-detail rsi-stack" aria-label="工单详情">
					{state.reading ? (
						<p role="status">正在读取工单详情…</p>
					) : ticket ? (
						<>
							<header className="rsi-stack rsi-tight">
								<p className="rsi-muted">
									{labels[ticket.state]} · 版本 {ticket.version} · 内容修订 {ticket.contentRevision}
								</p>
								<h2>{ticket.title}</h2>
								<code>{ticket.id}</code>
							</header>
							<p className="rsi-body">{ticket.body}</p>
							{ticket.sources.length > 0 && (
								<section className="rsi-stack rsi-tight">
									<h3>来源</h3>
									<ul>
										{ticket.sources.map((value, index) => (
											<li key={index}>
												<Source value={value} />
											</li>
										))}
									</ul>
								</section>
							)}
							<div className="rsi-actions">
								{state.view?.permissions.edit && (
									<Button
										label="编辑工单"
										isDisabled={state.busy || !!state.pending}
										onClick={() => setEditor(state.view)}
									/>
								)}
							</div>
							<section className="rsi-stack rsi-tight">
								<h3>最近动态</h3>
								<p className="rsi-muted">当前详情中的有限窗口；已保存的完整记录由服务保留。</p>
								<ol className="rsi-events">
									{[...ticket.events].reverse().map((event) => (
										<li key={event.version}>
											<p className="rsi-body">{event.text}</p>
											<small>
												{date(event.at)} · {event.kind} · v{event.version}
											</small>
										</li>
									))}
								</ol>
							</section>
						</>
					) : (
						<p className="rsi-muted">选择一条工单，查看其原内容与来源。</p>
					)}
				</article>
			</div>
			{editor && (
				<TicketEditor
					original={editor === "new" ? null : editor}
					busy={state.busy}
					pending={state.pending}
					problem={state.error}
					save={state.save}
					reconcile={state.reconcile}
					close={() => setEditor(null)}
				/>
			)}
		</section>
	);
}
