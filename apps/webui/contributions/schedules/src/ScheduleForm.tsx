import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { Command, Pending } from "./data.ts";

export interface Draft {
	text: string;
	delay: string;
	runs: string;
	interval: string;
}
export function restored(original: Pending | undefined): Draft {
	return original?.action === "add"
		? {
				text: original.input.text,
				delay: String(original.delaySeconds),
				runs: String(original.input.maxRuns ?? 1),
				interval: String((original.input.intervalMs ?? 60000) / 1000),
			}
		: { text: "", delay: "30", runs: "1", interval: "60" };
}
export function ScheduleForm({
	draft,
	update,
	blocked,
	submit,
}: {
	draft: Draft;
	update(next: Draft): void;
	blocked: boolean;
	submit(command: Command): void;
}) {
	const [problem, setProblem] = useState("");
	const field = (key: keyof Draft, value: string) => {
		setProblem("");
		update({ ...draft, [key]: value });
	};
	return (
		<form
			className="schedule-card schedule-stack"
			aria-label="新建定时输入"
			onSubmit={(event) => {
				event.preventDefault();
				const seconds = Number(draft.delay),
					count = Number(draft.runs),
					interval = Number(draft.interval);
				if (
					!draft.text.trim() ||
					draft.text.length > 8192 ||
					/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(draft.text) ||
					!Number.isSafeInteger(seconds) ||
					seconds < 1 ||
					seconds > 31622400 ||
					!Number.isSafeInteger(count) ||
					count < 1 ||
					count > 32 ||
					(count > 1 && (!Number.isSafeInteger(interval) || interval < 1 || interval > 31622400))
				) {
					setProblem("请输入正文、1–31622400 秒的整数时间和 1–32 次投递次数。");
					return;
				}
				submit({
					action: "add",
					delaySeconds: seconds,
					input: {
						text: draft.text,
						dueAt: Date.now() + seconds * 1000,
						...(count > 1 ? { intervalMs: interval * 1000, maxRuns: count } : {}),
					},
				});
			}}
		>
			<h2>新建定时输入</h2>
			<label className="schedule-stack schedule-tight">
				<span>输入内容</span>
				<textarea
					aria-label="输入内容"
					name="scheduled-text"
					rows={4}
					maxLength={8192}
					value={draft.text}
					disabled={blocked}
					onChange={(event) => field("text", event.currentTarget.value)}
				/>
			</label>
			<div className="schedule-fields">
				<label className="schedule-stack schedule-tight">
					<span>延迟（秒）</span>
					<input
						name="scheduled-delay"
						type="number"
						min={1}
						max={31622400}
						step={1}
						required
						value={draft.delay}
						disabled={blocked}
						onChange={(event) => field("delay", event.currentTarget.value)}
					/>
				</label>
				<label className="schedule-stack schedule-tight">
					<span>投递次数</span>
					<input
						name="scheduled-runs"
						type="number"
						min={1}
						max={32}
						step={1}
						required
						value={draft.runs}
						disabled={blocked}
						onChange={(event) => field("runs", event.currentTarget.value)}
					/>
				</label>
				{Number(draft.runs) > 1 && (
					<label className="schedule-stack schedule-tight">
						<span>间隔（秒）</span>
						<input
							name="scheduled-interval"
							type="number"
							min={1}
							max={31622400}
							step={1}
							required
							value={draft.interval}
							disabled={blocked}
							onChange={(event) => field("interval", event.currentTarget.value)}
						/>
					</label>
				)}
			</div>
			{problem && <p role="alert">{problem}</p>}
			<div className="schedule-actions">
				<Button label="安排输入" variant="primary" type="submit" isDisabled={blocked || !draft.text.trim()} />
				<small className="schedule-muted">{draft.text.length} / 8192</small>
			</div>
		</form>
	);
}
