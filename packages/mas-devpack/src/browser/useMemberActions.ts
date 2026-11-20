import { useEffect, useMemo, useRef, useState } from "react";
import { isRecord, type ExtensionJson, type ExtensionOperation } from "@pakka/protocol/extensions";
import {
	readInbox,
	readMember,
	readReceipt,
	type MemberRef,
	type WorkbenchMember,
	type WorkbenchReceipt,
} from "./client.ts";
import {
	clearMemberAction,
	memberPendingKey,
	readMemberPending,
	retainMemberAction,
	watchMemberAction,
	type MemberAction,
	type PendingMemberAction,
} from "./pending.ts";
import { failure, readService, resourceKey, type TeamProps } from "./service.ts";

const same = (left: MemberRef, right: MemberRef) =>
	["key", "sessionId", "conversationId", "incarnation", "profile"].every(
		(key) => left[key as keyof MemberRef] === right[key as keyof MemberRef],
	);
const textField = (input: ExtensionJson, name: string): string | undefined => {
	if (!isRecord(input)) return undefined;
	const value = input[name];
	return typeof value === "string" ? value : undefined;
};

export function useMemberActions({ ui, bindings }: TeamProps, member: WorkbenchMember) {
	const lifetime = useMemo(() => new AbortController(), []);
	const signal = useMemo(
		() => AbortSignal.any([ui.signal, bindings.signal, lifetime.signal]),
		[ui, bindings, lifetime],
	);
	useEffect(() => () => lifetime.abort(), [lifetime]);
	const key = memberPendingKey(bindings, member.ref),
		refIdentity = JSON.stringify(member.ref);
	const service = useMemo(
		() => bindings.forConversation(member.ref, { signal }),
		[bindings, signal, refIdentity],
	);
	const [pending, setPending] = useState(() => readMemberPending(key, member.ref));
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null);
	const [inbox, setInbox] = useState<readonly WorkbenchReceipt[]>([]);
	const [receipt, setReceipt] = useState<WorkbenchReceipt | null>(() => {
		try {
			const raw = sessionStorage.getItem(key + ":receipt");
			return raw ? readReceipt(JSON.parse(raw)) : null;
		} catch {
			return null;
		}
	});
	const admission = useRef(false);
	const alive = () => !signal.aborted;
	useEffect(() => {
		const update = () => {
			if (alive()) setPending(readMemberPending(key, member.ref));
		};
		update();
		return watchMemberAction(key, update);
	}, [ui, bindings, key]);
	const canReply = member.permissions.includes("send") && member.phase === "active";
	useEffect(() => {
		setInbox([]);
		if (!canReply) return;
		const controller = new AbortController(),
			signal = AbortSignal.any([ui.signal, service.signal, controller.signal]);
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function observe() {
			try {
				const rows = await readService(service, "inbox", {}, readInbox, signal);
				if (!signal.aborted) setInbox(rows);
			} catch (reason) {
				if (!signal.aborted) {
					setInbox([]);
					setError(failure(reason));
				}
			} finally {
				if (!signal.aborted)
					timer = setTimeout(() => {
						void observe();
					}, 1500);
			}
		}
		void observe();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [service, ui, canReply]);
	useEffect(() => {
		if (!receipt || !["queued", "placed"].includes(receipt.status)) return;
		const original = receipt,
			controller = new AbortController(),
			signal = AbortSignal.any([ui.signal, service.signal, controller.signal]);
		const timer = setTimeout(() => {
			void readService(service, "receipt", { id: original.id }, readReceipt, signal)
				.then((value) => {
					if (value.id !== original.id || value.requestId !== original.requestId)
						throw new Error("投递回执身份不符。");
					if (!signal.aborted) {
						sessionStorage.setItem(key + ":receipt", JSON.stringify(value));
						setReceipt(value);
					}
				})
				.catch((reason) => {
					if (!signal.aborted) setError(`回执观察中断；原工作可能仍在执行。${failure(reason)}`);
				});
		}, 600);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [receipt, service, ui, key]);

	async function finish(original: PendingMemberAction, operation: ExtensionOperation) {
		if (operation.action !== original.action || operation.requestId !== original.requestId)
			throw new Error("操作回执与原请求不符。");
		if (operation.state !== "done") throw new Error("原操作仍未确认；继续保留请求，不能重新提交。");
		if (original.action === "abort" || original.action === "retire") {
			const result = readMember(operation.value);
			if (!same(result.ref, original.target)) throw new Error("成员控制结果的身份不符。");
		} else {
			let value = readReceipt(operation.value);
			if (original.action === "withdraw") {
				if (value.id !== textField(original.input, "id")) throw new Error("撤回结果与原投递不符。");
			} else {
				if (value.requestId !== operation.id) throw new Error("MAS 投递未关联原扩展操作。");
				if (original.action === "reply") {
					if (!value.source || !same(value.source, original.target))
						throw new Error("回复来源与原成员不符。");
				} else if (
					value.source !== null ||
					value.principal !== bindings.personId ||
					!same(value.target, original.target)
				)
					throw new Error("投递身份与原成员不符。");
			}
			if (value.status === "unknown") {
				const current = await readService(
					bindings.forConversation(original.target),
					"receipt",
					{ id: value.id },
					readReceipt,
					signal,
				);
				if (current.id !== value.id || current.requestId !== value.requestId)
					throw new Error("MAS 投递回执身份不符。");
				value = current;
			}
			if (!alive()) return false;
			if (value.status === "unknown") throw new Error("原生投递仍未确认；请继续核对原请求。");
			sessionStorage.setItem(key + ":receipt", JSON.stringify(value));
			setReceipt(value);
		}
		if (!alive()) return false;
		clearMemberAction(key, original);
		return true;
	}
	async function run(action?: MemberAction, input: ExtensionJson = {}): Promise<PendingMemberAction | null> {
		if (admission.current || !alive()) return null;
		admission.current = true;
		setBusy(true);
		setError(null);
		let submitted: PendingMemberAction | undefined;
		try {
			if (action) {
				const next: PendingMemberAction = {
					version: 1,
					requestId: crypto.randomUUID(),
					action,
					target: { ...member.ref },
					input,
				};
				retainMemberAction(key, next);
				submitted = next;
			}
			const original = readMemberPending(key, member.ref);
			setPending(original);
			if (!original || original === "unreadable") throw new Error("原请求记录不可读，已停止新控制。");
			const bound = bindings.forConversation(original.target, { signal });
			let operation: ExtensionOperation;
			if (submitted) {
				try {
					operation = await bound.call(original.action, original.input, { requestId: original.requestId });
				} catch (reason) {
					// Only denial of this admission certifies no accepted effect. Later receipt reads cannot undo it.
					if (reason instanceof Error && "outcome" in reason && reason.outcome === "denied")
						clearMemberAction(key, submitted);
					throw reason;
				}
			} else operation = await bound.operationByRequest(original.requestId);
			return (await finish(original, operation)) ? original : null;
		} catch (reason) {
			if (alive()) setError(failure(reason));
			return null;
		} finally {
			admission.current = false;
			if (alive()) {
				setBusy(false);
				setPending(readMemberPending(key, member.ref));
			}
		}
	}
	async function refreshReceipt() {
		if (!receipt || busy || !alive()) return;
		try {
			const value = await readService(service, "receipt", { id: receipt.id }, readReceipt, signal);
			if (value.id !== receipt.id || value.requestId !== receipt.requestId)
				throw new Error("原投递回执身份不符。");
			if (alive()) {
				sessionStorage.setItem(key + ":receipt", JSON.stringify(value));
				setReceipt(value);
				setError(null);
			}
		} catch (reason) {
			if (alive()) setError(failure(reason));
		}
	}
	return {
		pending,
		receipt,
		inbox,
		busy,
		error,
		run,
		refreshReceipt,
		draftKey: key + ":draft",
		resource: resourceKey(member.ref),
	};
}
