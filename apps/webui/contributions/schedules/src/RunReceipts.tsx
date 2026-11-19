import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import { decodeValue, isRecord } from "@pakka/protocol/extensions";
import manifest from "../manifest.json" with { type: "json" };
import { decodeManifest } from "@pakka/protocol/extensions";

const action = decodeManifest(manifest).actions.find((item) => item.id === "deliveries")!;
const labels: Record<string, string> = {
	done: "已完成",
	placed: "已接纳",
	queued: "排队中",
	unanswered: "未作答",
	unknown: "尚未确认",
};

export function RunReceipts({
	binding,
	id,
	signal,
}: {
	binding: ExtensionServiceBinding;
	id: string;
	signal: AbortSignal;
}) {
	const [open, setOpen] = useState(false);
	const [report, setReport] = useState("");
	useEffect(() => {
		if (!open) return;
		const controller = new AbortController();
		const active = AbortSignal.any([controller.signal, signal]);
		async function read() {
			setReport("正在读取…");
			const operation = await binding.call("deliveries", { id }, { signal: active });
			if (operation.state !== "done") throw Error("原投递记录尚未确认。");
			const result = decodeValue(action.output, operation.value);
			if (!isRecord(result) || !Array.isArray(result.items)) throw Error("投递记录不可读。");
			const lines = result.items.map((item) => {
				if (!isRecord(item) || typeof item.status !== "string") throw Error("投递记录不可读。");
				return `第 ${item.run} 次 · ${labels[item.status]} · ${item.id}`;
			});
			if (!lines.length) lines.push("尚未查到已接纳的输入。");
			if (!result.originalBinding) lines.unshift("计划登记后运行配置已变更。");
			if (!active.aborted) setReport(lines.join("\n"));
		}
		void read().catch(() => {
			if (!active.aborted) setReport("原投递记录尚未确认。");
		});
		return () => controller.abort();
	}, [open, binding, signal, id]);
	return (
		<div>
			<Button variant="ghost" label={open ? "收起投递记录" : "查看逐次投递"} onClick={() => setOpen(!open)} />
			{open && (
				<p className="schedule-text" role="status">
					{report}
				</p>
			)}
		</div>
	);
}
