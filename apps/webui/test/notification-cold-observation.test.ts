import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { PocketNotifications } from "@pakka/server/pocket";
import { startPocket } from "../src/bootstrap.ts";
import { observeNotifications } from "../src/notification-monitor.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

test(
	"notification observation: cold preview is read once while unchanged, then follows an actual native commit",
	{ timeout: 10000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let monitor: Awaited<ReturnType<typeof observeNotifications>> | undefined;
		try {
			await m.runtime.close();
			let notifications: PocketNotifications | undefined;
			app = await startPocket({
				runtime: m.config,
				owner: "Owner",
				extensionServices: (context) => {
					notifications = context.notifications;
					return {};
				},
			});
			assert.ok(notifications);
			const runtime = app.runtime;
			let whole = 0,
				previews = 0;
			monitor = await observeNotifications(
				{
					...runtime,
					readConversation: (...args: Parameters<typeof runtime.readConversation>) => {
						whole++;
						return runtime.readConversation(...args);
					},
					previewConversation: (...args: Parameters<typeof runtime.previewConversation>) => {
						previews++;
						return runtime.previewConversation(...args);
					},
				},
				notifications,
			);
			assert.equal(whole, 0, "a notification observer must not open an entire native transcript view");
			const seeded = previews;
			await delay(1050);
			assert.equal(previews, seeded, "unchanged idle data does not need another body projection");
			const ref = runtime.view().conversations[0]!;
			await runtime.writeDisplay(
				ref,
				{
					namespace: "cold-probe",
					actorId: "host",
					requestId: "actual-commit",
					kind: "card",
					text: "changed native storage",
				},
				() => {},
			);
			const deadline = Date.now() + 1500;
			while (previews === seeded && Date.now() < deadline) await delay(20);
			assert.ok(previews > seeded, "a real committed change is observed without starting execution");
			assert.equal(whole, 0);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await monitor?.close();
			await app?.close();
			await m.close();
		}
	},
);
