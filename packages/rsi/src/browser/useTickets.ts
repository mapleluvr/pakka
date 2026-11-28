import { useEffect, useMemo, useRef, useState } from "react";
import { decodeValue } from "@pakka/protocol/extensions";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import type { UiContext } from "@pakka/webui-sdk";
import type { TicketContent } from "../types.ts";
import { inputs } from "./contract.ts";
import {
	ticketCall,
	readTicketResult,
	TicketCallError,
	type ActionValues,
	type TicketPage,
	type TicketView,
} from "./client.ts";
import {
	checkTicketReceipt,
	clearTicketWrite,
	pendingTicketKey,
	readPendingTicket,
	reconcileTicketWrite,
	retainTicketWrite,
	ticketWriteDenied,
	watchTicketWrite,
	type PendingTicketWrite,
} from "./pending.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : "工单服务未能确认结果。");

/** One interface's bounded reads and explicit mutation attempts; durable identity stays in the service. */
export function useTickets(ui: UiContext, service: ExtensionServiceBinding) {
	const signal = useMemo(() => AbortSignal.any([ui.signal, service.signal]), [ui, service]);
	const key = pendingTicketKey(service);
	const [pending, setPending] = useState(() => readPendingTicket(key));
	const [page, setPage] = useState<TicketPage | null>(null);
	const [view, setView] = useState<TicketView | null>(null);
	const [capabilities, setCapabilities] = useState<ActionValues["capabilities"] | null>(null);
	const [loading, setLoading] = useState(true);
	const [reading, setReading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const selected = useRef<string | null>(null);
	const listRead = useRef<AbortController | null>(null);
	const detailRead = useRef<AbortController | null>(null);
	const locked = useRef(false);

	async function loadList(cursor?: string) {
		if (signal.aborted) return;
		listRead.current?.abort();
		const read = new AbortController();
		listRead.current = read;
		const querySignal = AbortSignal.any([signal, read.signal]);
		setLoading(true);
		try {
			const [next, caps] = await Promise.all([
				ticketCall(service, "list", { limit: 20, ...(cursor ? { cursor } : {}) }, { signal: querySignal }),
				ticketCall(service, "capabilities", {}, { signal: querySignal }),
			]);
			if (querySignal.aborted) return;
			setPage(next);
			setCapabilities(caps);
		} catch (reason) {
			if (querySignal.aborted) return;
			detailRead.current?.abort();
			setReading(false);
			setPage(null);
			setView(null);
			setCapabilities(null);
			setError(message(reason));
		} finally {
			if (!querySignal.aborted) setLoading(false);
		}
	}
	async function choose(id: string) {
		if (signal.aborted) return;
		detailRead.current?.abort();
		const read = new AbortController();
		detailRead.current = read;
		selected.current = id;
		const querySignal = AbortSignal.any([signal, read.signal]);
		setView(null);
		setReading(true);
		setError("");
		try {
			const next = await ticketCall(service, "get", { id }, { signal: querySignal });
			if (!querySignal.aborted && selected.current === id) setView(next);
		} catch (reason) {
			if (!querySignal.aborted) setError(message(reason));
		} finally {
			if (!querySignal.aborted) setReading(false);
		}
	}
	async function refresh() {
		setError("");
		await loadList();
		if (!signal.aborted && selected.current) await choose(selected.current);
	}
	useEffect(() => {
		void loadList();
		const stop = watchTicketWrite(key, () => {
			if (!signal.aborted) setPending(readPendingTicket(key));
		});
		return () => {
			stop();
			listRead.current?.abort();
			detailRead.current?.abort();
		};
	}, [signal, key]);

	async function save(content: TicketContent, existing: TicketView | null): Promise<boolean> {
		if (locked.current || signal.aborted) return false;
		const held = readPendingTicket(key);
		if (held) {
			setPending(held);
			setError("先核对尚未确认的工单请求。");
			return false;
		}
		locked.current = true;
		setBusy(true);
		setError("");
		setNotice("");
		const original: PendingTicketWrite = {
			version: 1,
			requestId: crypto.randomUUID(),
			action: existing ? "edit" : "submit",
			ticketId: existing?.ticket.id ?? null,
		};
		let retained = false;
		try {
			const input = decodeValue(inputs[original.action], {
				...content,
				...(existing ? { id: existing.ticket.id, expectedVersion: existing.ticket.version } : {}),
			});
			retainTicketWrite(key, original);
			retained = true;
			const operation = await service.call(original.action, input, { requestId: original.requestId, signal });
			if (signal.aborted) return false;
			if (operation.state !== "done") throw new TicketCallError("unknown", "保存结果未确认，请核对原请求。");
			const receipt = checkTicketReceipt(
				original,
				operation,
				readTicketResult(original.action, operation.value),
			);
			clearTicketWrite(key, original);
			setNotice(`工单已保存 · 内容修订 ${receipt.contentRevision}`);
			await loadList();
			await choose(receipt.id);
			return !signal.aborted;
		} catch (reason) {
			if (signal.aborted) return false;
			if (retained && ticketWriteDenied(reason)) {
				try {
					clearTicketWrite(key, original);
				} catch {
					setError("拒绝结果已返回，但本地原请求记录未能清理，请保留记录核对。");
					return false;
				}
			}
			setError(message(reason));
			return false;
		} finally {
			locked.current = false;
			if (!signal.aborted) setBusy(false);
		}
	}
	async function reconcile(): Promise<boolean> {
		const original = readPendingTicket(key);
		if (!original || original === "unreadable" || locked.current || signal.aborted) return false;
		locked.current = true;
		setBusy(true);
		setError("");
		try {
			const result = await reconcileTicketWrite(service, original, signal);
			if (signal.aborted) return false;
			clearTicketWrite(key, original);
			if (result.status === "rejected") {
				setError(result.message);
				return false;
			}
			setNotice(`原请求已确认 · 内容修订 ${result.receipt.contentRevision} · 未重复提交`);
			await loadList();
			await choose(result.receipt.id);
			return !signal.aborted;
		} catch (reason) {
			// A refused/unavailable lookup says nothing about the original write's effects.
			if (!signal.aborted) setError(message(reason));
			return false;
		} finally {
			locked.current = false;
			if (!signal.aborted) setBusy(false);
		}
	}
	return {
		page,
		view,
		capabilities,
		loading,
		reading,
		busy,
		pending,
		error,
		notice,
		choose,
		refresh,
		loadList,
		save,
		reconcile,
	};
}
