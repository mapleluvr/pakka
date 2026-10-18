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
		creator: { anyOf: [label, { type: "null" }] },
		creationKnown: { type: "boolean" },
		createdAt: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
		forkSource: { anyOf: [label, { type: "null" }] },
		lifetime: { enum: ["persistent", "temporary", "task-bound", "background"] },
		phase: { enum: memberPhases },
		reason: { type: "string", maxLength: 4096 },
		permissions: { type: "array", maxItems: 3, items: { enum: ["send", "steer", "manage"] } },
	},
	required: [
		"key",
		"ref",
		"owner",
		"parent",
		"creator",
		"creationKnown",
		"forkSource",
		"lifetime",
		"phase",
		"permissions",
	],
};
export const connectionSchema: Schema = {
	type: "object",
	properties: {
		id: label,
		kind: { enum: ["creation", "communication"] },
		from: label,
		to: label,
		count: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
		at: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
	},
	required: ["id", "kind", "from", "to", "count"],
};
export const viewSchema: Schema = {
	type: "object",
	properties: {
		sessionId: label,
		namespace: label,
		members: { type: "array", maxItems: 128, items: memberSchema },
		connections: { type: "array", maxItems: 512, items: connectionSchema },
		connectionsTruncated: { type: "boolean" },
	},
	required: ["sessionId", "namespace", "members", "connections", "connectionsTruncated"],
};
export const historyItemSchema: Schema = {
	type: "object",
	properties: {
		receipt: {
			type: "object",
			properties: { id: label, status: { enum: deliveryStatuses }, entryId: label },
			required: ["id", "status"],
		},
		from: { anyOf: [label, { type: "null" }] },
		to: label,
		text: { type: "string", maxLength: 16384 },
		mode: { enum: ["prompt", "steer", "followUp"] },
		at: { anyOf: [{ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, { type: "null" }] },
		initiator: { enum: ["agent", "human", "service", "unknown"] },
		replyTo: { anyOf: [label, { type: "null" }] },
	},
	required: ["receipt", "from", "to", "text", "mode", "at", "initiator", "replyTo"],
};
export const historyQuerySchema: Schema = {
	type: "object",
	properties: {
		limit: { type: "integer", minimum: 1, maximum: 64 },
		cursor: label,
		search: { type: "string", maxLength: 160 },
		from: label,
		to: label,
		member: label,
		mode: { enum: ["prompt", "steer", "followUp"] },
		initiator: { enum: ["agent", "human", "service", "unknown"] },
		status: { enum: deliveryStatuses },
	},
	required: [],
};
export const historyPageSchema: Schema = {
	type: "object",
	properties: {
		items: { type: "array", maxItems: 64, items: historyItemSchema },
		nextCursor: label,
	},
	required: ["items"],
};
export const activitySchema: Schema = {
	type: "object",
	properties: {
		ref: referenceSchema,
		state: { enum: ["waiting", "thinking", "tool", "reply", "error", "crashed", "idle"] },
		preview: { type: "string", maxLength: 244 },
		tool: label,
		code: { type: "integer", minimum: 100, maximum: 599 },
		detail: { type: "string", maxLength: 244 },
	},
	required: ["ref", "state", "preview"],
};
export const activitiesInput: Schema = {
	type: "object",
	properties: { refs: { type: "array", maxItems: 128, items: referenceSchema } },
	required: ["refs"],
};
export const activitiesSchema: Schema = { type: "array", maxItems: 128, items: activitySchema };
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
