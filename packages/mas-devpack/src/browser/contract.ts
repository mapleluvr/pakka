import type { Schema } from "@pakka/webui/extension";
import { memberPhases, deliveryStatuses } from "./dto.ts";
export const label: Schema = { type: "string", minLength: 1, maxLength: 160 };
export const referenceSchema: Schema = {
	type: "object",
	properties: { key: label, sessionId: label, conversationId: label, incarnation: label, profile: label },
	required: ["key", "sessionId", "conversationId", "incarnation", "profile"],
};
export const memberSchema: Schema = {
	type: "object",
	properties: {
		key: label,
		ref: referenceSchema,
		owner: { anyOf: [label, { type: "null" }] },
		parent: { anyOf: [label, { type: "null" }] },
		lifetime: { enum: ["persistent", "temporary", "task-bound", "background"] },
		phase: { enum: memberPhases },
		reason: { type: "string", maxLength: 4096 },
		permissions: { type: "array", maxItems: 3, items: { enum: ["send", "steer", "manage"] } },
	},
	required: ["key", "ref", "owner", "parent", "lifetime", "phase", "permissions"],
};
export const viewSchema: Schema = {
	type: "object",
	properties: { namespace: label, members: { type: "array", maxItems: 128, items: memberSchema } },
	required: ["namespace", "members"],
};
export const receiptSchema: Schema = {
	type: "object",
	properties: {
		id: label,
		requestId: label,
		principal: label,
		source: { anyOf: [referenceSchema, { type: "null" }] },
		target: referenceSchema,
		status: { enum: deliveryStatuses },
		entryId: label,
		reason: { type: "string", maxLength: 4096 },
	},
	required: ["id", "requestId", "principal", "source", "target", "status"],
};
export const inboxSchema: Schema = { type: "array", maxItems: 128, items: receiptSchema };
export const replyInput: Schema = {
	type: "object",
	properties: { id: label, text: { type: "string", minLength: 1, maxLength: 16384 } },
	required: ["id", "text"],
};
export const empty: Schema = { type: "object", properties: {}, required: [] };
export const textInput: Schema = {
	type: "object",
	properties: { text: { type: "string", minLength: 1, maxLength: 16384 } },
	required: ["text"],
};
export const steerInput: Schema = {
	type: "object",
	properties: {
		text: { type: "string", minLength: 1, maxLength: 16384 },
		mode: { enum: ["steer", "followUp"] },
	},
	required: ["text", "mode"],
};
export const receiptInput: Schema = { type: "object", properties: { id: label }, required: ["id"] };
