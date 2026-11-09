import { strict as assert } from "node:assert";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { StoredDocument, StorageWrite, JsonObject } from "@earendil-works/pi-durable";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { blockSqliteWrites, readNativeDocument, readStorageText } from "./native-storage.ts";

const allow = () => {};

/** Produce the exact v1 data layout through public Storage after the owned runtime closes.
 * Native submissions/entries are unchanged; no invented receipts or replayed model calls. */
async function legacyCatalog(file: string, namespace: string, corrupt?: "fingerprint" | "provenance") {
	const { documents } = JSON.parse(await readStorageText(file)) as { documents: StoredDocument[] };
	const catalog = documents.find((d) => d.record.kind === "pakka.catalog" && d.record.key === namespace)!;
	assert.equal(catalog.version, 2);
	const deliveries: JsonObject = {};
	const retired: StorageWrite[] = [];
	for (const doc of documents.filter(
		(d) => d.record.kind === "pakka.catalog-delivery" && d.value.namespace === namespace,
	)) {
		const record = doc.value.record as JsonObject;
		deliveries[String(record.id)] = {
			...record,
			...(corrupt === "fingerprint" ? { fingerprint: "corrupt" } : {}),
			...(corrupt === "provenance" ? { submissionId: "nonexistent" } : {}),
		};
		retired.push({ type: "document.retire", id: doc.record.id });
	}
	const storage = await openNodeSqliteStorage(file);
	try {
		await storage.commit(
			[
				{
					type: "document.change",
					id: catalog.record.id,
					content: {
						kind: "base",
						version: 1,
						value: {
							version: catalog.value.version!,
							members: catalog.value.members!,
							options: { namespace, maxDeliveries: 2, maxPending: 2 },
							deliveries,
						},
					},
				},
				...retired,
			],
			BACKGROUND_CONTEXT,
		);
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
}

for (const fault of ["none", "write-lock", "fingerprint", "provenance"] as const) {
	test(
		`delivery migration: v1 ${fault} preserves original admissions and atomic layout`,
		{ timeout: 30000 },
		async () => {
			const m = await runtimeFixture();
			let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
			let release = () => {};
			const options = { namespace: "legacy-work", maxPending: 2 };
			try {
				const catalog = m.runtime.catalog(options);
				const [member] = await catalog.enroll([{ key: "worker", data: { phase: "active" } }], allow);
				const original = {
					requestId: "first",
					principal: "owner",
					source: null,
					target: member!.ref,
					text: "original",
					mode: "prompt" as const,
				};
				const first = await catalog.deliver(original, allow);
				await catalog.wait(first.id, allow);
				const second = await catalog.deliver({ ...original, requestId: "second" }, allow);
				await catalog.wait(second.id, allow);
				const file = m.runtime.view().sessionFile;
				await m.runtime.close();
				await legacyCatalog(
					file,
					options.namespace,
					fault === "fingerprint" || fault === "provenance" ? fault : undefined,
				);
				reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
				let restored = reopened.catalog(options);
				if (fault !== "fingerprint" && fault !== "provenance") {
					assert.equal((await restored.lookupReceipt(first.id, allow))?.status, "done");
					assert.deepEqual(
						(await restored.history({}, allow)).items.map((r) => r.receipt.id),
						[second.id, first.id],
					);
				}
				assert.equal(m.f.requests.length, 2);
				assert.equal(
					(await readNativeDocument(file, "pakka.catalog", options.namespace)).version,
					1,
					"passive lookup does not migrate storage",
				);
				if (fault === "write-lock") release = blockSqliteWrites(file);
				const next = { ...original, requestId: "third", text: "continue after v1 ceiling" };
				const result = await restored.deliver(next, allow);
				if (fault !== "none") {
					assert.equal(result.status, "unknown");
					assert.equal(reopened.view().phase, "failed");
					assert.equal(m.f.requests.length, 2);
					release();
					await reopened.close();
					const unchanged = await readNativeDocument(file, "pakka.catalog", options.namespace);
					assert.equal(unchanged.version, 1);
					assert.equal(unchanged.value.index, undefined);
					if (fault === "fingerprint" || fault === "provenance") return;
					reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
					restored = reopened.catalog(options);
					assert.equal((await restored.lookupReceipt(first.id, allow))?.status, "done");
					const retried = await restored.deliver(next, allow);
					await restored.wait(retried.id, allow);
				} else await restored.wait(result.id, allow);
				const migrated = await readNativeDocument(file, "pakka.catalog", options.namespace);
				assert.equal(migrated.version, 2);
				assert.equal(migrated.value.deliveries, undefined);
				assert.equal((await restored.deliver(original, allow)).id, first.id);
				assert.equal((await restored.receipt(second.id, allow)).status, "done");
				await assert.rejects(restored.deliver({ ...original, text: "changed" }, allow), /conflict/);
				assert.equal(m.f.requests.length, 3);
			} finally {
				release();
				await reopened?.close();
				await m.close();
			}
		},
	);
}
