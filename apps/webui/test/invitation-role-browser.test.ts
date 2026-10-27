import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import {
	openAppearance,
	openConversations,
	organizationAction,
	settleFrontend,
	type FrontendPage,
} from "./frontend-controls.ts";

const captures = join("docs", ".temp", "invite-role", "captures");
const trigger = '[aria-label="Invite Role"]';
async function inspect(
	name: string,
	work: (
		page: FrontendPage,
		app: Awaited<ReturnType<typeof startPocket>>,
		m: Awaited<ReturnType<typeof runtimeFixture>>,
	) => Promise<void>,
) {
	const m = await runtimeFixture();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined,
		browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, name) },
			owner: "Owner",
			initial: [{ name: "Invitation project", profile: "default" }],
		});
		assert.ok(app.initialOwner);
		browser = await ownedBrowser(join(m.f.root, name + "-browser"));
		const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
		await page.wait('document.querySelector("[data-action=signin]")');
		await page.click("[data-action=signin]");
		await page.wait('document.querySelector(".home-create-card")');
		await mkdir(captures, { recursive: true });
		// Observe actual commands, never replace responses. Do not retain generated invitation secrets.
		await page.evaluate(`(() => { const original=globalThis.fetch; globalThis.__invitationCommands=[];
			globalThis.fetch=(...args)=>{if(typeof args[1]?.body==='string'){const c=JSON.parse(args[1].body).command;
			if(c?.op==='invite')globalThis.__invitationCommands.push({role:c.role,resources:c.resources,ttlMs:c.ttlMs});}
			return original(...args);}; })()`);
		await work(page, app, m);
	} finally {
		await browser?.close();
		await app?.close();
		await m.close();
	}
}

// A system popup, unthemed/clipped rows, arrow-selection, Escape closing Settings, or a Tab trap must fail.
test(
	"Invitation role: shared menu preserves draft on browsing/cancel with keyboard, theme and phone text scaling",
	{ timeout: 60000 },
	async () => {
		await inspect("invite-role-menu", async (page, _app, m) => {
			for (const setting of [
				{ theme: "dark", size: 14, width: 1440, height: 900 },
				{ theme: "light", size: 20, width: 360, height: 600 },
			]) {
				await openAppearance(page);
				await page.type('[aria-label="Theme"]', "");
				await page.key(setting.theme === "light" ? "ArrowDown" : "ArrowUp");
				await page.type('[aria-label="Text size"]', "");
				for (let step = 0; step < (setting.size - 14) / 2; step++) await page.key("ArrowDown");
				await page.resize({ width: setting.width, height: setting.height });
				await settleFrontend(page);
				await openConversations(page);
				await page.click(".org-trigger");
				await page.wait('document.querySelector(".org-menu")');
				const sharedStyle = await page.evaluate(
					`(() => {const s=getComputedStyle(document.querySelector('.org-menu'));return [s.backgroundColor,s.borderRadius,s.boxShadow];})()`,
				);
				await page.click('[data-action="people"]');
				await page.wait('document.querySelector(".settings-page h1")?.textContent==="People & Invitations"');
				await settleFrontend(page);
				const field = await page.evaluate(
					`document.querySelector('[aria-label="Invite Role"],[aria-label="Invite role"]')?.tagName`,
				);
				if (field === "SELECT") await writeFile(join(captures, "native-before.png"), await page.screenshot());
				assert.equal(field, "BUTTON", "Invite Role must use a workbench popup, not a system select");
				assert.equal(await page.evaluate('document.querySelector(".settings-page select")===null'), true);
				await page.click(trigger);
				await page.wait(
					'document.querySelector(".invite-role-menu [aria-checked=true]") && getComputedStyle(document.querySelector(".invite-role-menu")).visibility==="visible"',
				);
				const sample = (await page.evaluate(`(() => {
				const menu=document.querySelector('.invite-role-menu'), t=document.querySelector('[aria-label="Invite Role"]'),
				style=getComputedStyle(menu), r=menu.getBoundingClientRect(), tr=t.getBoundingClientRect();
				return { background:style.backgroundColor, border:style.borderRadius, shadow:style.boxShadow,
					box:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}, triggerHeight:tr.height,
					rows:[...menu.querySelectorAll('[role=menuitemradio]')].map(n=>({role:n.dataset.inviteRoleChoice,height:n.getBoundingClientRect().height,font:getComputedStyle(n).fontSize})),
					labelFont:getComputedStyle(document.querySelector('label[for="invite-role-trigger"]')).fontSize,triggerFont:getComputedStyle(t).fontSize,focused:document.activeElement?.dataset.inviteRoleChoice,
					hasCheck:Boolean(menu.querySelector('[aria-checked=true] svg')),theme:document.documentElement.dataset.theme };
			})()`)) as {
					background: string;
					border: string;
					shadow: string;
					box: { left: number; top: number; right: number; bottom: number };
					triggerHeight: number;
					rows: { role: string; height: number; font: string }[];
					labelFont: string;
					triggerFont: string;
					focused: string;
					hasCheck: boolean;
				};
				await writeFile(
					join(captures, `menu-${setting.theme}-${setting.width}.json`),
					JSON.stringify(sample, null, 2) + "\n",
				);
				await writeFile(
					join(captures, `menu-${setting.theme}-${setting.width}.png`),
					await page.screenshot(),
				);
				assert.deepEqual(
					[sample.background, sample.border, sample.shadow],
					sharedStyle,
					"invite popup uses the actual workbench menu theme",
				);
				assert.equal(sample.focused, "viewer");
				assert.equal(sample.hasCheck, true);
				assert.deepEqual(
					sample.rows.map((row) => row.role),
					["viewer", "sender", "driver", "admin"],
				);
				assert.ok(sample.triggerHeight >= 44 && sample.rows.every((row) => row.height >= 44));
				assert.ok(
					sample.box.left >= 0 &&
						sample.box.top >= 0 &&
						sample.box.right <= setting.width &&
						sample.box.bottom <= setting.height,
					"menu is fully on screen",
				);
				assert.notEqual(sample.background, "rgba(0, 0, 0, 0)");
				assert.notEqual(sample.shadow, "none");
				assert.equal(
					sample.triggerFont,
					sample.labelFont,
					"trigger follows the field UI text role, not the native button caption",
				);
				assert.ok(
					sample.rows.every((row) => row.font === sample.triggerFont),
					"menu and trigger follow UI typography",
				);
				if (setting.size === 20) assert.ok(parseFloat(sample.rows[0]!.font) > 14);
				await page.key("ArrowUp");
				assert.equal(await page.evaluate("document.activeElement?.dataset.inviteRoleChoice"), "admin");
				assert.equal(
					await page.evaluate(
						'document.querySelector(".invite-role-menu [aria-checked=true]").dataset.inviteRoleChoice',
					),
					"viewer",
				);
				await page.key("Home");
				await page.key("ArrowDown");
				assert.equal(await page.evaluate("document.activeElement?.dataset.inviteRoleChoice"), "sender");
				await page.key("Escape");
				await page.wait('!document.querySelector(".invite-role-menu")');
				assert.equal(
					await page.evaluate(
						'document.activeElement===document.querySelector(\'[aria-label="Invite Role"]\') && Boolean(document.querySelector(".settings-view"))',
					),
					true,
				);
				assert.equal(
					await page.evaluate("document.querySelector('[aria-label=\"Invite Role\"]').value"),
					"viewer",
				);
				await page.key("Enter");
				await page.wait('document.querySelector(".invite-role-menu")');
				await page.key("End");
				assert.equal(await page.evaluate("document.activeElement?.dataset.inviteRoleChoice"), "admin");
				await page.key("Tab");
				await page.wait('!document.querySelector(".invite-role-menu")');
				assert.equal(
					await page.evaluate("document.activeElement?.dataset.action"),
					"invite",
					"Tab continues to the next field action",
				);
				await page.click(trigger);
				await page.wait('document.querySelector(".invite-role-menu")');
				await page.click(".settings-page h1");
				await page.wait('!document.querySelector(".invite-role-menu")');
				assert.equal(
					await page.evaluate("document.querySelector('[aria-label=\"Invite Role\"]').value"),
					"viewer",
				);
				assert.equal(
					await page.evaluate("globalThis.__invitationCommands.length"),
					0,
					"no browse/cancel gesture creates an invitation",
				);
				await page.click(".back-to-app");
				await settleFrontend(page);
			}
			assert.equal(m.f.requests.length, 0);
			assert.equal(m.f.errors.length, 0);
		});
	},
);

// UI enum wiring must reach a real one-use invite/redeem and unchanged server permissions, not only a checkmark.
test(
	"Invitation role: explicit selection is only a draft; created one-use invitations redeem to each original role",
	{ timeout: 60000 },
	async () => {
		await inspect("invite-role-redeem", async (page, app, m) => {
			await organizationAction(page, "people");
			await page.wait('document.querySelector(".settings-page h1")?.textContent==="People & Invitations"');
			assert.equal(
				await page.evaluate(
					`document.querySelector('[aria-label="Invite Role"],[aria-label="Invite role"]')?.tagName`,
				),
				"BUTTON",
			);
			const proof: { role: string; send: boolean; steer: boolean; manage: boolean }[] = [];
			for (const [role, send, steer, manage] of [
				["viewer", false, false, false],
				["sender", true, false, false],
				["driver", true, true, false],
				["admin", true, true, true],
			] as const) {
				const before = await page.evaluate("globalThis.__invitationCommands.length");
				const previous = await page.evaluate('document.querySelector("input[name=inviteLink]")?.value ?? ""');
				await page.click(trigger);
				await page.wait('document.querySelector(".invite-role-menu")');
				if (role === "driver" || role === "admin") {
					const keys =
						role === "driver"
							? (["Home", "ArrowDown", "ArrowDown", "Enter"] as const)
							: (["End", "Enter"] as const);
					for (const key of keys) await page.key(key);
				} else await page.click("[data-invite-role-choice=" + JSON.stringify(role) + "]");
				await page.wait('!document.querySelector(".invite-role-menu")');
				assert.equal(
					await page.evaluate("document.querySelector('[aria-label=\"Invite Role\"]').value"),
					role,
				);
				assert.equal(
					await page.evaluate("globalThis.__invitationCommands.length"),
					before,
					"selection cannot create a token",
				);
				await page.click('[data-action="invite"]');
				await page.wait(
					'document.querySelector("input[name=inviteLink]")?.value && document.querySelector("input[name=inviteLink]").value!==' +
						JSON.stringify(previous),
				);
				const link = (await page.evaluate(
					'document.querySelector("input[name=inviteLink]").value',
				)) as string;
				const token = new URLSearchParams(new URL(link).hash.slice(1)).get("invite")!;
				const joined = await app.people.redeem(token, "Test " + role);
				const actor = await app.people.authenticate(joined.token);
				const target = app.runtime.view().conversations.find((ref) => ref.key !== "root")!;
				const resource = app.people.resourceId(target);
				assert.equal(actor.person.role, role);
				assert.doesNotThrow(() => actor.check("read", resource));
				for (const [permission, allowed] of [
					["send", send],
					["steer", steer],
					["manage", manage],
				] as const) {
					if (allowed) assert.doesNotThrow(() => actor.check(permission, resource));
					else assert.throws(() => actor.check(permission, resource));
				}
				assert.equal(actor.person.resources, "*");
				await assert.rejects(
					app.people.redeem(token, "Second use"),
					"the original invite remains single use",
				);
				if (!manage)
					await assert.rejects(
						app.people.invite(actor, {
							requestId: "denied-" + role,
							role: "admin",
							resources: "*",
							ttlMs: 3600000,
						}),
						"non-admin redemption cannot grant roles",
					);
				proof.push({ role, send, steer, manage });
			}
			assert.deepEqual(await page.evaluate("globalThis.__invitationCommands"), [
				{ role: "viewer", resources: "*", ttlMs: 3600000 },
				{ role: "sender", resources: "*", ttlMs: 3600000 },
				{ role: "driver", resources: "*", ttlMs: 3600000 },
				{ role: "admin", resources: "*", ttlMs: 3600000 },
			]);
			await writeFile(join(captures, "redeemed-roles.json"), JSON.stringify(proof, null, 2) + "\n");
			assert.equal(m.f.requests.length, 0);
			assert.equal(m.f.errors.length, 0);
		});
	},
);
