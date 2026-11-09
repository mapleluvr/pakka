import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { PocketNotifications } from "@pakka/server/pocket";
import { startPocket } from "../src/bootstrap.ts";
import { observeNotifications } from "../src/notification-monitor.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

// Failed/revoked child openings close their native Runtime before the workbench
// shuts down. Its passive observer must not keep polling that closed owner.
test(
	"notification observation stops polling a normally closed native Runtime",
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
			let scans = 0;
			let sawClosed: (() => void) | undefined;
			const closedObserved = new Promise<void>((resolve) => {
				sawClosed = resolve;
			});
			monitor = await observeNotifications(
				{
					...runtime,
					view: () => {
						scans++;
						const view = runtime.view();
						if (view.phase !== "ready") sawClosed?.();
						return view;
					},
				},
				notifications,
			);
			await runtime.close();
			await closedObserved;
			const settled = scans;
			// Two further nominal periods must cause no observation after closure.
			await delay(750);
			assert.equal(scans, settled, "closed native ownership must retire its passive timer");
			assert.equal(m.f.requests.length, 0);
		} finally {
			await monitor?.close();
			await app?.close();
			await m.close();
		}
	},
);
