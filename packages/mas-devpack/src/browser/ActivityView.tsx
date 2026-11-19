import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
	readHistory,
	type WorkbenchHistoryPage,
	type WorkbenchHistoryQuery,
	type WorkbenchView,
} from "./client.ts";
import { failure, readService, type TeamProps } from "./service.ts";
import { deliveryStatuses } from "./dto.ts";
import type { ExtensionJson } from "@pakka/protocol/extensions";

const arrow = (
	<svg
		width="24"
		height="24"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.6"
		aria-hidden="true"
	>
		<path d="M4 12h16m-6-6 6 6-6 6" />
	</svg>
);
export function ActivityView({
	ui,
	bindings,
	team,
	initial = {},
	select,
}: TeamProps & { team: WorkbenchView; initial?: WorkbenchHistoryQuery; select(key: string): void }) {
	const [draft, setDraft] = useState<WorkbenchHistoryQuery>(initial),
		[query, setQuery] = useState<WorkbenchHistoryQuery>(initial);
	const [page, setPage] = useState<WorkbenchHistoryPage | null>(null),
		[loading, setLoading] = useState(false),
		[error, setError] = useState<string | null>(null);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		const controller = new AbortController(),
			signal = AbortSignal.any([ui.signal, bindings.signal, controller.signal]);
		setLoading(true);
		setPage(null);
		setError(null);
		const input: Record<string, ExtensionJson> = { limit: 32 };
		for (const [key, value] of Object.entries(query)) if (value !== undefined) input[key] = value;
		void readService(bindings, "history", input, readHistory, signal)
			.then((value) => {
				if (!signal.aborted) setPage(value);
			})
			.catch((reason) => {
				if (!signal.aborted) setError(failure(reason));
			})
			.finally(() => {
				if (!signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [ui, bindings, query, revision]);
	const memberOptions = [
		{ value: "", label: "全部" },
		...team.members.map((item) => ({ value: item.key, label: item.key })),
	];
	const update = (value: Partial<WorkbenchHistoryQuery>) => setDraft((current) => ({ ...current, ...value }));
	return (
		<section className="mas-stack" aria-label="Team Activity">
			<form
				className="mas-filters"
				onSubmit={(event) => {
					event.preventDefault();
					if ((draft.search?.length ?? 0) > 160) return;
					setQuery({ ...draft, cursor: undefined });
					setRevision((value) => value + 1);
				}}
			>
				<TextInput
					label="搜索交流正文"
					value={draft.search ?? ""}
					description="最多 160 字符"
					status={
						(draft.search?.length ?? 0) > 160
							? { type: "error", message: "搜索词超过 160 字符。" }
							: undefined
					}
					onChange={(search) => update({ search: search || undefined })}
					containerClassName="mas-field mas-search"
				/>
				<Selector
					label="发件成员"
					options={memberOptions}
					value={draft.from ?? ""}
					onChange={(from) => update({ from: from || undefined })}
				/>
				<Selector
					label="收件成员"
					options={memberOptions}
					value={draft.to ?? ""}
					onChange={(to) => update({ to: to || undefined })}
				/>
				<Selector
					label="参与成员"
					options={memberOptions}
					value={draft.member ?? ""}
					onChange={(member) => update({ member: member || undefined })}
				/>
				<Selector
					label="发送模式"
					options={["all", "prompt", "steer", "followUp"]}
					value={draft.mode ?? "all"}
					onChange={(value) =>
						update({
							mode: value === "prompt" || value === "steer" || value === "followUp" ? value : undefined,
						})
					}
				/>
				<Selector
					label="发起者"
					options={["all", "agent", "human", "service", "unknown"]}
					value={draft.initiator ?? "all"}
					onChange={(value) =>
						update({
							initiator:
								value === "agent" || value === "human" || value === "service" || value === "unknown"
									? value
									: undefined,
						})
					}
				/>
				<Selector
					label="投递状态"
					options={["all", ...deliveryStatuses]}
					value={draft.status ?? "all"}
					onChange={(value) => update({ status: deliveryStatuses.find((item) => item === value) })}
				/>
				<Button
					label="筛选 Activity"
					type="submit"
					isLoading={loading}
					isDisabled={loading || (draft.search?.length ?? 0) > 160}
				/>
			</form>
			{error && <p role="alert">{error}</p>}
			{loading && <p role="status">正在读取交流记录…</p>}
			{page?.items.length === 0 && <p className="mas-muted">当前范围没有可读取的交流记录。</p>}
			<ol className="mas-history">
				{page?.items.map((item) => (
					<li
						key={item.receipt.id}
						className="mas-stack mas-history-item"
						id={`mas-delivery-${item.receipt.id}`}
					>
						<div className="mas-row">
							{item.from ? (
								<Button variant="ghost" label={`查看成员 ${item.from}`} onClick={() => select(item.from!)}>
									{item.from}
								</Button>
							) : (
								<span>
									{item.initiator === "human" ? "人类" : item.initiator === "service" ? "服务" : "来源未记录"}
								</span>
							)}
							{arrow}
							<Button variant="ghost" label={`查看成员 ${item.to}`} onClick={() => select(item.to)}>
								{item.to}
							</Button>
						</div>
						<p className="mas-text">{item.text}</p>
						<p className="mas-muted">
							{item.mode} · {item.initiator} · {item.receipt.status} ·{" "}
							{item.at === null ? "时间未记录" : new Date(item.at).toLocaleString()}
						</p>
						<code>{item.receipt.id}</code>
						{item.replyTo && (
							<p>
								回复投递 <code>{item.replyTo}</code>
							</p>
						)}
					</li>
				))}
			</ol>
			<div className="mas-row">
				<Button
					label="Activity 首页"
					variant="ghost"
					isDisabled={loading}
					onClick={() => {
						setQuery((current) => ({ ...current, cursor: undefined }));
						setRevision((value) => value + 1);
					}}
				/>
				{page?.nextCursor && (
					<Button
						label="下一页 Activity"
						isDisabled={loading}
						onClick={() => setQuery((current) => ({ ...current, cursor: page.nextCursor }))}
					/>
				)}
			</div>
		</section>
	);
}
