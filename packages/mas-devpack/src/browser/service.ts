import { useEffect, useState } from "react";
import type { UiViewProps } from "@pakka/webui-sdk";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { ExtensionJson } from "@pakka/protocol/extensions";
import {
	readActivities,
	readBoard,
	type MemberRef,
	type WorkbenchActivity,
	type WorkbenchView,
} from "./client.ts";

export type TeamProps = UiViewProps<ExtensionServiceBinding>;
export const resourceKey = (ref: Pick<MemberRef, "sessionId" | "conversationId">) =>
	JSON.stringify([ref.sessionId, ref.conversationId]);
export const conversationResource = (ref: MemberRef) => ({
	source: "pakka",
	type: "conversation",
	id: resourceKey(ref),
});
export const failure = (reason: unknown) => (reason instanceof Error ? reason.message : "读取未能确认。");

export async function readService<T>(
	service: ExtensionServiceBinding,
	action: string,
	input: ExtensionJson,
	decode: (value: unknown) => T,
	signal: AbortSignal,
): Promise<T> {
	const result = await service.call(action, input, { signal });
	signal.throwIfAborted();
	if (result.state !== "done") throw new Error("本次读取未能确认，请重新读取。");
	return decode(result.value);
}

/** One bounded observation loop per mounted surface; stopping it only cancels reads. */
export function useTeam({ ui, bindings }: TeamProps) {
	const [view, setView] = useState<WorkbenchView | null>(null);
	const [activities, setActivities] = useState<readonly WorkbenchActivity[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		const controller = new AbortController(),
			signal = AbortSignal.any([ui.signal, bindings.signal, controller.signal]);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let iteration = 0,
			latest: WorkbenchView | null = null;
		async function observe() {
			try {
				if (!latest || iteration % 3 === 0) {
					latest = await readService(bindings, "view", {}, readBoard, signal);
					setView(latest);
				}
				const values = await readService(
					bindings,
					"activities",
					{ refs: latest.members.map((member) => ({ ...member.ref })) },
					readActivities,
					signal,
				);
				if (!signal.aborted) {
					setActivities(values);
					setError(null);
				}
			} catch (reason) {
				if (!signal.aborted) {
					setError(failure(reason));
					setView(null);
					setActivities([]);
					latest = null;
				}
			} finally {
				iteration++;
				if (!signal.aborted)
					timer = setTimeout(() => {
						void observe();
					}, 1000);
			}
		}
		void observe();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [ui, bindings, revision]);
	return { view, activities, error, refresh: () => setRevision((value) => value + 1) };
}
