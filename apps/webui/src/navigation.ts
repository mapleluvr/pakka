import { createHash, randomUUID } from "node:crypto";
import type { Runtime, JsonObject } from "@pakka/agent";
import type { PocketAuthority, PocketPeople, PocketWorkspace } from "@pakka/server/pocket";
import { decodePocketRequest, decodePocketResponse } from "@pakka/protocol/pocket";
import type {
	PocketNavigationReceipt,
	PocketNavigationUpdate,
	PocketPersonalNavigation,
} from "@pakka/protocol/pocket";

export interface PersonalNavigation {
	read(actor: PocketAuthority): Promise<PocketPersonalNavigation>;
	update(actor: PocketAuthority, input: PocketNavigationUpdate): Promise<PocketNavigationReceipt>;
	lookup(actor: PocketAuthority, original: PocketNavigationUpdate): Promise<PocketNavigationReceipt | null>;
}
export class NavigationRefusal extends Error {
	readonly code: "FORBIDDEN" | "INVALID_REQUEST" | "CONFLICT";
	constructor(code: "FORBIDDEN" | "INVALID_REQUEST" | "CONFLICT") {
		super("Personal navigation refused");
		this.code = code;
	}
}
interface Operation {
	readonly fingerprint: string;
	readonly receipt: PocketNavigationReceipt;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fingerprint = (input: PocketNavigationUpdate) => {
	const action = input.action;
	return hash(
		JSON.stringify([
			input.expectedVersion,
			action.kind,
			"mode" in action ? action.mode : null,
			"name" in action ? action.name.trim() : null,
			"resourceId" in action ? action.resourceId : null,
			"folderId" in action ? action.folderId : null,
		]),
	);
};
function envelope(result: unknown) {
	const response = decodePocketResponse(
		{ version: 2, serverId: "navigation-store", requestId: "navigation-store", result },
		"navigation-store",
	);
	if (!("result" in response)) throw Error("Invalid navigation result");
	return response.result;
}
function validated(input: PocketNavigationUpdate) {
	try {
		decodePocketRequest({
			version: 2,
			requestId: "navigation-input",
			command: { op: "navigation.update", input },
		});
	} catch {
		throw new NavigationRefusal("INVALID_REQUEST");
	}
}
function decode(
	data: JsonObject,
	version: number,
	actorId: string,
): { view: PocketPersonalNavigation; operations: readonly Operation[] } {
	if (version === 0 && Object.keys(data).length === 0)
		return { view: { version: 0, mode: "default", folders: [], assignments: {} }, operations: [] };
	if (
		Object.keys(data).sort().join(",") !== "actorId,assignments,folders,mode,operations,schema" ||
		data.schema !== 1 ||
		data.actorId !== actorId ||
		!Array.isArray(data.operations) ||
		data.operations.length > 16
	)
		throw Error("Invalid personal navigation store");
	const result = envelope({
		kind: "navigation",
		view: { version, mode: data.mode, folders: data.folders, assignments: data.assignments },
	});
	if (result.kind !== "navigation") throw Error("Invalid navigation view");
	const operations: Operation[] = [];
	for (const row of data.operations) {
		if (
			!row ||
			typeof row !== "object" ||
			Array.isArray(row) ||
			Object.keys(row).sort().join(",") !== "fingerprint,receipt" ||
			typeof row.fingerprint !== "string" ||
			!/^[a-f0-9]{64}$/.test(row.fingerprint)
		)
			throw Error("Invalid navigation operation");
		const receipt = envelope({ kind: "navigation.updated", receipt: row.receipt });
		if (receipt.kind !== "navigation.updated" || receipt.receipt.version > version)
			throw Error("Invalid navigation receipt");
		operations.push({ fingerprint: row.fingerprint, receipt: receipt.receipt });
	}
	if (new Set(operations.map((row) => row.receipt.requestId)).size !== operations.length)
		throw Error("Duplicate navigation operation");
	return { view: result.view, operations };
}

/** Private presentation metadata in the control Session; never moves or configures native resources. */
export function createPersonalNavigation({
	runtime,
	people,
	workspace,
}: {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly workspace: PocketWorkspace;
}): PersonalNavigation {
	function storage(actor: PocketAuthority) {
		const person = people.current(actor);
		return {
			person,
			store: runtime.store({
				namespace: "pocket.navigation." + hash(person.id).slice(0, 32),
				maxBytes: 65536,
			}),
		};
	}
	async function authorize(actor: PocketAuthority, input: PocketNavigationUpdate) {
		validated(input);
		people.current(actor);
		if (input.action.kind === "assign") {
			const resourceId = input.action.resourceId;
			try {
				people.check(actor, "read", resourceId);
			} catch {
				throw new NavigationRefusal("FORBIDDEN");
			}
			const rows = await workspace.bind(actor).navigation();
			if (!rows.some((row) => people.resourceId(row.ref) === resourceId))
				throw new NavigationRefusal("FORBIDDEN");
			try {
				people.check(actor, "read", resourceId);
			} catch {
				throw new NavigationRefusal("FORBIDDEN");
			}
		}
	}
	return Object.freeze({
		read: async (actor: PocketAuthority): Promise<PocketPersonalNavigation> => {
			const { person, store } = storage(actor),
				saved = await store.snapshot(),
				{ view } = decode(saved.data, saved.version, person.id);
			const allowed = new Set(
				(await workspace.bind(actor).navigation()).map((row) => people.resourceId(row.ref)),
			);
			people.current(actor);
			const result = envelope({
				kind: "navigation",
				view: {
					...view,
					assignments: Object.fromEntries(Object.entries(view.assignments).filter(([id]) => allowed.has(id))),
				},
			});
			if (result.kind !== "navigation") throw Error("Invalid filtered navigation");
			return result.view;
		},
		lookup: async (
			actor: PocketAuthority,
			input: PocketNavigationUpdate,
		): Promise<PocketNavigationReceipt | null> => {
			await authorize(actor, input);
			const { person, store } = storage(actor),
				saved = await store.snapshot(),
				decoded = decode(saved.data, saved.version, person.id);
			const prior = decoded.operations.find((row) => row.receipt.requestId === input.requestId);
			people.current(actor);
			if (prior && prior.fingerprint !== fingerprint(input)) throw new NavigationRefusal("CONFLICT");
			return prior?.receipt ?? null;
		},
		update: async (
			actor: PocketAuthority,
			input: PocketNavigationUpdate,
		): Promise<PocketNavigationReceipt> => {
			await authorize(actor, input);
			const { person, store } = storage(actor),
				saved = await store.snapshot(),
				{ view, operations } = decode(saved.data, saved.version, person.id);
			const intent = fingerprint(input),
				prior = operations.find((row) => row.receipt.requestId === input.requestId);
			if (prior) {
				if (prior.fingerprint !== intent) throw new NavigationRefusal("CONFLICT");
				people.current(actor);
				return prior.receipt;
			}
			if (saved.version !== input.expectedVersion) throw new NavigationRefusal("CONFLICT");
			const folders = view.folders.map((row) => ({ ...row })),
				assignments = { ...view.assignments },
				action = input.action;
			let mode = view.mode,
				created: string | undefined;
			switch (action.kind) {
				case "mode":
					mode = action.mode;
					break;
				case "folder.create":
					if (folders.length >= 32) throw new NavigationRefusal("INVALID_REQUEST");
					created = randomUUID();
					folders.push({ id: created, name: action.name.trim() });
					break;
				case "folder.rename": {
					const row = folders.find((row) => row.id === action.folderId);
					if (!row) throw new NavigationRefusal("FORBIDDEN");
					row.name = action.name.trim();
					break;
				}
				case "folder.delete": {
					const index = folders.findIndex((row) => row.id === action.folderId);
					if (index < 0) throw new NavigationRefusal("FORBIDDEN");
					folders.splice(index, 1);
					for (const [resource, folder] of Object.entries(assignments))
						if (folder === action.folderId) delete assignments[resource];
					break;
				}
				case "assign":
					if (action.folderId !== null && !folders.some((row) => row.id === action.folderId))
						throw new NavigationRefusal("FORBIDDEN");
					if (action.folderId === null) delete assignments[action.resourceId];
					else assignments[action.resourceId] = action.folderId;
					if (Object.keys(assignments).length > 256) throw new NavigationRefusal("INVALID_REQUEST");
					break;
			}
			const receipt = Object.freeze({
				requestId: input.requestId,
				version: saved.version + 1,
				...(created === undefined ? {} : { folderId: created }),
			});
			const data: JsonObject = {
				schema: 1,
				actorId: person.id,
				mode,
				folders,
				assignments,
				operations: [...operations, { fingerprint: intent, receipt }].slice(-16).map((row) => ({
					fingerprint: row.fingerprint,
					receipt: {
						requestId: row.receipt.requestId,
						version: row.receipt.version,
						...(row.receipt.folderId === undefined ? {} : { folderId: row.receipt.folderId }),
					},
				})),
			};
			try {
				await store.compareAndSet(saved.version, data, () => {
					people.current(actor);
					if (action.kind === "assign") people.check(actor, "read", action.resourceId);
				});
			} catch (error) {
				if (error instanceof Error && /version conflict/i.test(error.message))
					throw new NavigationRefusal("CONFLICT");
				throw error;
			}
			people.current(actor);
			return receipt;
		},
	});
}
