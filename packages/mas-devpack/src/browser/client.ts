import { decodeValue } from "@pakka/webui/extension";
import {
	inboxSchema,
	memberSchema,
	receiptSchema,
	viewSchema,
	activitiesSchema,
	historyPageSchema,
} from "./contract.ts";
import type {
	WorkbenchMember,
	WorkbenchReceipt,
	WorkbenchView,
	WorkbenchActivity,
	WorkbenchHistoryPage,
} from "./dto.ts";
export type {
	MemberRef,
	WorkbenchMember,
	WorkbenchReceipt,
	WorkbenchView,
	WorkbenchActivity,
	WorkbenchHistoryPage,
	WorkbenchHistoryItem,
	WorkbenchHistoryQuery,
	WorkbenchConnection,
} from "./dto.ts";
export function readHistory(value: unknown): WorkbenchHistoryPage {
	return decodeValue(historyPageSchema, value) as unknown as WorkbenchHistoryPage;
}
export function readActivities(value: unknown): readonly WorkbenchActivity[] {
	return decodeValue(activitiesSchema, value) as unknown as readonly WorkbenchActivity[];
}
export function readBoard(value: unknown): WorkbenchView {
	// SAFETY: the closed schema checks every member/reference, enum and nullable owner field before publishing a DTO.
	return decodeValue(viewSchema, value) as unknown as WorkbenchView;
}
export function readMember(value: unknown): WorkbenchMember {
	// SAFETY: the same complete finite member schema is enforced by backend, transport and browser.
	return decodeValue(memberSchema, value) as unknown as WorkbenchMember;
}
export function readInbox(value: unknown): readonly WorkbenchReceipt[] {
	// SAFETY: the finite inbox schema validates every closed receipt and reference before it reaches component state.
	return decodeValue(inboxSchema, value) as unknown as readonly WorkbenchReceipt[];
}
export function readReceipt(value: unknown): WorkbenchReceipt {
	// SAFETY: this is a scoped same-Session native receipt DTO, not a broker/provenance proof; all closed fields are decoded.
	return decodeValue(receiptSchema, value) as unknown as WorkbenchReceipt;
}
