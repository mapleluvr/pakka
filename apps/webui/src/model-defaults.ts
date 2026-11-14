import { createHash } from "node:crypto";
import type { Runtime, RuntimeRecord, JsonObject } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "@pakka/server/pocket";
import {
	decodeModelDefaults,
	decodeModelDefaultsChange,
	decodeModelDefaultsReceipt,
	type ModelDefaults,
	type ModelDefaultsChange,
	type ModelDefaultsReceipt,
} from "@pakka/protocol/webui";
import { WebUiServiceRefusal } from "./service-refusal.ts";

export interface PersonModelDefaults {
	read(actor: PocketAuthority): Promise<ModelDefaults>;
	write(actor: PocketAuthority, change: ModelDefaultsChange): Promise<ModelDefaultsReceipt>;
	lookup(actor: PocketAuthority, original: ModelDefaultsChange): Promise<ModelDefaultsReceipt | null>;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function view(record: RuntimeRecord, actorId: string): ModelDefaults {
	if (record.version === 0 && record.data === null)
		return Object.freeze({ version: 0, model: null, thinkingLevel: null });
	const data = record.data;
	if (
		!data ||
		data.schema !== 1 ||
		data.actorId !== actorId ||
		Object.keys(data).sort().join(",") !== "actorId,model,schema,thinkingLevel"
	)
		throw new Error("Invalid person model defaults record");
	return decodeModelDefaults({
		version: record.version,
		model: data.model,
		thinkingLevel: data.thinkingLevel,
	});
}
function receipt(
	record: RuntimeRecord,
	actorId: string,
	requestId: string,
	fingerprint: string,
): ModelDefaultsReceipt | null {
	if (record.version === 0 && record.data === null) return null;
	const data = record.data;
	if (
		!data ||
		data.schema !== 1 ||
		data.actorId !== actorId ||
		Object.keys(data).sort().join(",") !== "actorId,fingerprint,receipt,schema"
	)
		throw new Error("Invalid defaults operation record");
	if (data.fingerprint !== fingerprint) throw new WebUiServiceRefusal("CONFLICT");
	const result = decodeModelDefaultsReceipt(data.receipt);
	if (result.actorId !== actorId || result.requestId !== requestId)
		throw new Error("Defaults operation identity mismatch");
	return result;
}

/** Person-owned preferences in the control Session; not CLI/global SettingsManager defaults. */
export function createPersonModelDefaults({
	runtime,
	people,
}: {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
}): PersonModelDefaults {
	const records = runtime.records({ namespace: "pakka-webui.model-defaults" });
	function binding(actor: PocketAuthority) {
		const person = people.current(actor);
		const check = () => {
			people.current(actor);
		};
		return { id: person.id, key: "person." + hash(person.id), check };
	}
	function original(actorId: string, raw: ModelDefaultsChange) {
		const input = decodeModelDefaultsChange(raw);
		return {
			input,
			key: "request." + hash([actorId, input.requestId]),
			fingerprint: hash([
				input.expectedVersion,
				input.model?.provider ?? null,
				input.model?.id ?? null,
				input.thinkingLevel,
			]),
		};
	}
	return Object.freeze({
		read: async (actor: PocketAuthority) => {
			const owner = binding(actor);
			return view(await records.get(owner.key, owner.check), owner.id);
		},
		lookup: async (actor: PocketAuthority, raw: ModelDefaultsChange) => {
			const owner = binding(actor),
				request = original(owner.id, raw);
			return receipt(
				await records.get(request.key, owner.check),
				owner.id,
				request.input.requestId,
				request.fingerprint,
			);
		},
		write: async (actor: PocketAuthority, raw: ModelDefaultsChange): Promise<ModelDefaultsReceipt> => {
			const owner = binding(actor),
				request = original(owner.id, raw),
				input = request.input;
			const prior = await records.get(request.key, owner.check);
			const previous = receipt(prior, owner.id, input.requestId, request.fingerprint);
			if (previous) return previous;
			const current = await records.get(owner.key, owner.check);
			view(current, owner.id);
			if (current.version !== input.expectedVersion) throw new WebUiServiceRefusal("CONFLICT");
			if (input.model) {
				const key = `${encodeURIComponent(input.model.provider)}/${input.model.id}`;
				const choices = await runtime.modelChoices();
				owner.check();
				const choice = choices.find((model) => model.key === key);
				if (
					!choice ||
					!choice.available ||
					(input.thinkingLevel !== null && !choice.thinkingLevels?.includes(input.thinkingLevel))
				)
					throw new WebUiServiceRefusal("INVALID_REQUEST");
			}
			const next = decodeModelDefaultsReceipt({
				requestId: input.requestId,
				actorId: owner.id,
				defaults: { version: current.version + 1, model: input.model, thinkingLevel: input.thinkingLevel },
			});
			const model = input.model ? { provider: input.model.provider, id: input.model.id } : null;
			const data: JsonObject = { schema: 1, actorId: owner.id, model, thinkingLevel: input.thinkingLevel };
			const operation: JsonObject = {
				schema: 1,
				actorId: owner.id,
				fingerprint: request.fingerprint,
				receipt: {
					requestId: input.requestId,
					actorId: owner.id,
					defaults: { version: next.defaults.version, model, thinkingLevel: input.thinkingLevel },
				},
			};
			try {
				await records.commit(
					{
						requestId: "save." + hash([owner.id, input.requestId]),
						reads: [
							{ key: owner.key, version: current.version },
							{ key: request.key, version: prior.version },
						],
						writes: [
							{ key: owner.key, data },
							{ key: request.key, data: operation },
						],
						append: [],
					},
					owner.check,
				);
			} catch (error) {
				// Resolve a failed acknowledgement only through the same atomic operation record, never by retrying.
				const confirmed = receipt(
					await records.get(request.key, owner.check),
					owner.id,
					input.requestId,
					request.fingerprint,
				);
				if (confirmed) return confirmed;
				if ((await records.get(owner.key, owner.check)).version !== current.version)
					throw new WebUiServiceRefusal("CONFLICT");
				throw error;
			}
			owner.check();
			return next;
		},
	});
}
