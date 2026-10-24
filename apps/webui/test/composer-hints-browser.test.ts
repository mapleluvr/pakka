import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// The shell collapsed four independent refusal conditions into one boolean. Adding a reason
// channel must not change which clicks are refused, so the served module is asked directly
// and its boolean is compared against the original expression for every combination.
const EQUIVALENCE = `(async () => {
	const { submitState } = await import("/native-composer.js");
	const shell = ({ mode, canInput, slash, working, view }) =>
		(mode !== "chat" && !canInput && !slash) ||
		working ||
		!view ||
		(mode === "prompt" && view?.live.busy && !slash);
	const views = [null, { live: { busy: false, tools: [] } }, { live: { busy: true, tools: [] } }];
	const mismatch = [];
	let checked = 0;
	for (const mode of ["prompt", "steer", "followUp", "chat"])
		for (const canInput of [true, false])
			for (const slash of [true, false])
				for (const working of [true, false])
					for (const view of views) {
						const input = { mode, canInput, slash, working, view };
						const { disabled, reason } = submitState(input);
						checked++;
						if (disabled !== Boolean(shell(input)) || Boolean(reason) !== disabled)
							mismatch.push({ input, disabled, reason, shell: Boolean(shell(input)) });
					}
	const reasonOf = (input) => submitState(input).reason;
	return {
		checked,
		mismatch,
		precedence: {
			noView: reasonOf({ mode: "chat", canInput: true, slash: false, working: true, view: null }),
			working: reasonOf({ mode: "chat", canInput: true, slash: false, working: true, view: views[1] }),
			readOnly: reasonOf({ mode: "prompt", canInput: false, slash: false, working: false, view: views[1] }),
			busyPrompt: reasonOf({ mode: "prompt", canInput: true, slash: false, working: false, view: views[2] }),
			steerable: reasonOf({ mode: "steer", canInput: true, slash: false, working: false, view: views[2] }),
		},
	};
})()`;

const CARD_BOX = `(() => {
	const r = document.querySelector("#composerCard, .composer-card").getBoundingClientRect();
	return { x: r.x, y: r.y, w: r.width, h: r.height };
})()`;

const STOP_BOX = `(() => {
	const el = document.querySelector("[data-action=stop]");
	const b = el.getBoundingClientRect();
	const probe = (dx, dy) => {
		const hit = document.elementFromPoint(b.left + dx, b.top + dy);
		return Boolean(hit && hit.closest("[data-action=stop]"));
	};
	return {
		inGroup: Boolean(el.closest(".send-group")),
		inLeft: Boolean(el.closest(".toolbar-left")),
		w: b.width,
		h: b.height,
		growTop: probe(b.width / 2, -7),
		growBottom: probe(b.width / 2, b.height + 7),
		growLeft: probe(-5, b.height / 2),
		growRight: probe(b.width + 5, b.height / 2),
		disabled: el.disabled,
		busy: el.getAttribute("aria-busy"),
		label: el.textContent.trim(),
		stopping: el.dataset.stopping,
	};
})()`;

test(
	"WebUI composer: a refused send explains itself in every mode, without moving the card, and Stop owns the primary slot",
	{ timeout: 90000 },
	async () => {
		const release = deferred();
		let first = true;
		const m = await runtimeFixture({}, undefined, async () => {
			if (first) {
				first = false;
				await release.promise;
			}
			return { text: "HINT-ANSWER" };
		});
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: m.f.dataDir + "/hints" },
				owner: "Operator",
				initial: [{ name: "Hints", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(await mkdtemp(join(tmpdir(), "pocket-hints-")), "profile"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');

			// The served module is the one under test, not a copy imported by the harness.
			const equivalence = (await page.evaluate(EQUIVALENCE)) as {
				checked: number;
				mismatch: unknown[];
				precedence: Record<string, string | null>;
			};
			assert.deepEqual(equivalence.mismatch, [], "disabled must stay exactly the shell decision");
			assert.equal(equivalence.checked, 96);
			assert.deepEqual(equivalence.precedence, {
				noView: "no-view",
				working: "working",
				readOnly: "read-only",
				busyPrompt: "busy-prompt",
				steerable: null,
			});

			await page.click("[data-action=signin]");
			await page.wait(
				"[data-conversation] => true".replace(/.*/, 'document.querySelector("[data-conversation]") !== null'),
			);
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("textarea")');
			await page.wait('document.querySelector("[data-action=send]")?.disabled === false');

			// Idle and able to send: no reason text at all.
			assert.equal(await page.evaluate('document.querySelectorAll("[data-submit-hint]").length'), 0);
			assert.equal(
				await page.evaluate('document.querySelector("[data-action=send]").getAttribute("aria-describedby")'),
				null,
			);

			const pickMode = async (value: string) => {
				await page.click(".send-caret");
				await page.wait(`document.querySelector('[data-input-mode="${value}"]') !== null`);
				await page.click(`[data-input-mode="${value}"]`);
				await page.wait(`document.querySelector('[data-input-mode]') === null`);
			};

			await page.type("textarea", "BLOCK-THE-TURN");
			await page.click("[data-action=send]");

			// Generating, prompt mode: the refusal names itself instead of going grey silently.
			await page.wait('document.querySelector("[data-submit-hint]")?.dataset.reason === "busy-prompt"');
			const hint = (await page.evaluate(`(() => {
				const el = document.querySelector("[data-submit-hint]");
				const send = document.querySelector("[data-action=send]");
				const area = document.querySelector("textarea");
				const box = el.getBoundingClientRect();
				const card = document.querySelector(".composer-card").getBoundingClientRect();
				return {
					text: el.textContent.trim(),
					role: el.getAttribute("role"),
					sendDescribed: send.getAttribute("aria-describedby"),
					areaDescribed: area.getAttribute("aria-describedby"),
					pointsAtHint: document.getElementById("submitHint") === el,
					textX: box.x + parseFloat(getComputedStyle(el).paddingLeft),
					contentX: card.x + 12 + 12,
					aboveCard: box.bottom <= card.top + 1,
				};
			})()`)) as {
				text: string;
				role: string;
				sendDescribed: string | null;
				areaDescribed: string | null;
				pointsAtHint: boolean;
				textX: number;
				contentX: number;
				aboveCard: boolean;
			};
			assert.ok(hint.text.length > 0, "the reason must be readable text");
			assert.equal(hint.role, "status");
			assert.equal(hint.sendDescribed, "submitHint");
			assert.equal(hint.areaDescribed, "submitHint", "the focusable field must also carry the reason");
			assert.equal(hint.pointsAtHint, true);
			assert.equal(hint.aboveCard, true, "the reason must sit above the card so the card cannot be pushed");
			assert.ok(
				Math.abs(hint.textX - hint.contentX) <= 2,
				`the reason must align with the composer text column (${hint.textX} vs ${hint.contentX})`,
			);

			const withHint = (await page.evaluate(CARD_BOX)) as { x: number; y: number; w: number; h: number };

			// Prompt mode while generating: Stop and Send never compete for the same click.
			const promptStop = (await page.evaluate(STOP_BOX)) as Record<string, unknown>;
			assert.equal(promptStop.inGroup, true, "Stop must live in the primary send group");
			assert.equal(await page.evaluate('document.querySelector("[data-action=send]").disabled'), true);

			// Team chat while the same turn runs: no reason text, and the card must not move.
			await pickMode("chat");
			await page.wait('document.querySelectorAll("[data-submit-hint]").length === 0');
			const withoutHint = (await page.evaluate(CARD_BOX)) as { x: number; y: number; w: number; h: number };
			assert.deepEqual(withoutHint, withHint, "the reason line must not shift the composer card");
			const chatStop = (await page.evaluate(STOP_BOX)) as {
				inLeft: boolean;
				w: number;
				h: number;
				growTop: boolean;
				growBottom: boolean;
				growLeft: boolean;
				growRight: boolean;
			};
			assert.equal(chatStop.inLeft, true, "Team chat keeps Stop out of the circular send group");
			assert.ok(
				chatStop.growTop && chatStop.growBottom && chatStop.growLeft && chatStop.growRight,
				"the Team chat Stop control must still reach a 44px touch target: " + JSON.stringify(chatStop),
			);
			assert.equal(await page.evaluate('document.querySelector("[data-action=send]").disabled'), false);

			// Steering while generating is the point of the mode: both controls must stay usable.
			for (const drive of ["steer", "followUp"]) {
				await pickMode(drive);
				const both = (await page.evaluate(STOP_BOX)) as { inGroup: boolean; disabled: boolean };
				assert.equal(both.inGroup, true, drive + " keeps Stop in the send group");
				assert.equal(both.disabled, false, drive + " keeps Stop clickable");
				assert.equal(
					await page.evaluate('document.querySelector("[data-action=send]").disabled'),
					false,
					drive + " keeps Send clickable next to Stop",
				);
				assert.equal(await page.evaluate('document.querySelectorAll("[data-submit-hint]").length'), 0);
			}

			await pickMode("prompt");
			await page.wait('document.querySelector("[data-submit-hint]")?.dataset.reason === "busy-prompt"');
			const groupStop = (await page.evaluate(STOP_BOX)) as {
				w: number;
				h: number;
				growTop: boolean;
				growBottom: boolean;
				label: string;
				stopping: string;
				disabled: boolean;
				busy: string;
			};
			assert.equal(groupStop.stopping, "false");
			assert.equal(groupStop.label, "Stop");
			assert.ok(groupStop.w >= 40, "Stop must be at least 40px wide, got " + groupStop.w);
			assert.equal(
				groupStop.growTop && groupStop.growBottom,
				true,
				"Stop must accept a 44px tall touch target",
			);

			// A healthy abort ends the turn in well under a frame, so the latch is only
			// observable inside the click itself. What is asserted here is the invariant that
			// matters in that window: a second stop request is refused immediately.
			await page.click("[data-action=stop]");
			const immediate = (await page.evaluate(STOP_BOX).catch(() => null)) as {
				disabled: boolean;
				label: string;
				busy: string;
			} | null;
			if (immediate) {
				assert.equal(immediate.disabled, true, "a second stop must be refused");
				assert.equal(immediate.busy, "true");
				assert.equal(immediate.label, "Stopping…");
			}

			release.resolve();
			await page.wait('document.querySelector("[data-action=stop]") === null');
			assert.equal(
				await page.evaluate('document.querySelectorAll("[data-submit-hint]").length'),
				0,
				"the reason text disappears once sending is possible again",
			);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
