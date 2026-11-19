import { Button } from "@astryxdesign/core/Button";
import type { Command, Lesson, View } from "./data.ts";

export type Draft = { text: string; version: number; conflict: boolean };
export type Confirmation = { id: string; version: number; text: string; action: "remove" | "discard" };
const author = (value: { mine: boolean; byAgent: boolean; authorName: string }) =>
	value.byAgent ? "Agent" : value.mine ? "你" : value.authorName;

export function LessonCard({
	row,
	view,
	blocked,
	editing,
	act,
	edit,
	confirm,
}: {
	row: Lesson;
	view: View;
	blocked: boolean;
	editing: boolean;
	act(command: Command): void;
	edit(): void;
	confirm(value: Confirmation): void;
}) {
	return (
		<article className="memory-card memory-stack" aria-label={`记忆 ${row.id}`}>
			<header className="memory-heading">
				<small className="memory-muted">
					{row.scope === "project" ? "本项目" : "本 Session 全局"} · {author(row)} · 版本 {row.version}
				</small>
				{(row.pending || row.proposal) && <span className="memory-badge">待批准</span>}
			</header>
			<p className="memory-text">{row.text}</p>
			{row.proposal && (
				<blockquote className="memory-stack memory-tight">
					<small>
						{author(row.proposal)} · {row.proposal.text === null ? "建议忘记" : "修改建议"}
					</small>
					{row.proposal.text !== null && <p className="memory-text">{row.proposal.text}</p>}
				</blockquote>
			)}
			{view.canWrite && (
				<div className="memory-actions">
					{view.owner && (row.pending || row.proposal) && (
						<Button
							label="批准"
							variant="primary"
							isDisabled={blocked}
							onClick={() =>
								act({
									action: "change",
									input: { id: row.id, expectedVersion: row.version, action: "approve" },
								})
							}
						/>
					)}
					{((view.owner && (row.pending || row.proposal)) ||
						(row.pending && row.mine) ||
						row.proposal?.mine) && (
						<Button
							label="撤回建议…"
							isDisabled={blocked}
							onClick={() =>
								confirm({
									id: row.id,
									version: row.version,
									text: row.proposal?.text ?? row.text,
									action: "discard",
								})
							}
						/>
					)}
					{(!row.pending || row.mine || view.owner) && (
						<Button label="编辑…" isDisabled={blocked || editing} onClick={edit} />
					)}
					{!row.pending && (
						<Button
							label="忘记…"
							isDisabled={blocked}
							onClick={() => confirm({ id: row.id, version: row.version, text: row.text, action: "remove" })}
						/>
					)}
				</div>
			)}
		</article>
	);
}

export function LessonEditor({
	id,
	draft,
	current,
	maxLength,
	blocked,
	update,
	discard,
	act,
}: {
	id: string;
	draft: Draft;
	current: Lesson | undefined;
	maxLength: number;
	blocked: boolean;
	update(draft: Draft): void;
	discard(): void;
	act(command: Command): void;
}) {
	return (
		<form
			className="memory-card memory-stack"
			aria-label="编辑记忆"
			onSubmit={(event) => {
				event.preventDefault();
				act({
					action: "change",
					input: { id, expectedVersion: draft.version, action: "edit", text: draft.text.trim() },
				});
			}}
		>
			<h2>编辑记忆 · 版本 {draft.version}</h2>
			<label className="memory-stack memory-tight">
				<span>记忆草稿</span>
				<textarea
					name={`memory-draft-${id}`}
					aria-label="记忆草稿"
					value={draft.text}
					maxLength={maxLength}
					rows={3}
					disabled={blocked}
					onChange={(event) => update({ ...draft, text: event.currentTarget.value })}
				/>
			</label>
			{draft.conflict && <p role="alert">版本冲突，请先核对当前内容。</p>}
			{current ? (
				<div className="memory-stack memory-tight">
					<small className="memory-muted">当前版本 {current.version}</small>
					<p>{current.text}</p>
					{current.proposal && (
						<blockquote>
							<small>待批准建议</small>
							<p>{current.proposal.text ?? "建议忘记此条记忆"}</p>
						</blockquote>
					)}
				</div>
			) : (
				<p role="alert">此条记忆当前不可得，草稿仍保留。</p>
			)}
			<div className="memory-actions">
				{draft.conflict && current && (
					<Button
						label="按当前版本继续编辑"
						isDisabled={blocked}
						onClick={() => update({ ...draft, version: current.version, conflict: false })}
					/>
				)}
				<Button
					label="保存修改"
					type="submit"
					variant="primary"
					isDisabled={blocked || draft.conflict || !current || !draft.text.trim()}
				/>
				<Button label="放弃草稿" variant="ghost" isDisabled={blocked} onClick={discard} />
			</div>
		</form>
	);
}
