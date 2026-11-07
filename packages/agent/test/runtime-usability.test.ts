import assert from "node:assert/strict";
import test from "node:test";
import { runtimeFixture } from "./runtime-fixture.ts";
import { text } from "./fixture.ts";

for (const status of [401, 503]) {
	test(`a known HTTP ${status} leaves history readable and accepts a later explicit input`, async () => {
		const m = await runtimeFixture({}, undefined, (_payload, count) =>
			count === 1 ? { error: status } : { text: "EXPLICIT-RECOVERY" },
		);
		try {
			const host = m.runtime.root();
			const client = host.connect("user", ["input.submit"]);
			await client.submit({ key: "first", text: "FIRST-INPUT" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 1, "failed response does not silently replay input");
			assert.equal(host.view().phase, "ready");
			const originalId = host.view().entries.find((entry) => entry.role === "user")!.id;
			await client.submit({ key: "later", text: "EXPLICIT-NEW-INPUT" });
			await host.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			assert.equal(host.view().entries.filter((entry) => entry.id === originalId).length, 1);
			assert.ok(host.view().entries.some((entry) => entry.text?.includes("EXPLICIT-RECOVERY")));
			assert.equal(m.runtime.view().budget.primaryAttempts, 2);
		} finally {
			await m.close();
		}
	});
}

for (const boundary of ["host", "catalog"] as const) {
	test(`${boundary} accepts a literal POSIX path without treating it as an extension command`, async () => {
		const m = await runtimeFixture();
		try {
			const literal = "/tmp/project is a literal path, not a command.";
			if (boundary === "host") {
				await m.runtime.root().connect("user", ["input.submit"]).submit({ key: "path", text: literal });
			} else {
				const catalog = m.runtime.catalog({ namespace: "usability.text", maxDeliveries: 8, maxPending: 4 });
				const [member] = await catalog.enroll(
					[{ key: "chat", profile: "default", data: { phase: "active" } }],
					() => {},
				);
				await catalog.deliver(
					{
						requestId: "path",
						principal: "user",
						source: null,
						target: member!.ref,
						text: literal,
						mode: "prompt",
					},
					() => {},
				);
			}
			await m.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.ok(text(m.f.requests[0]!).includes(literal));
		} finally {
			await m.close();
		}
	});
}
