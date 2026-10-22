import type { ownedBrowser } from "./browser.ts";

type Browser = Awaited<ReturnType<typeof ownedBrowser>>;
export type FrontendPage = Awaited<ReturnType<Browser["page"]>>;

/** Actual reference UI entry points. No synthetic DOM clicks or backend shortcuts. */
export async function settleFrontend(page: FrontendPage) {
	await page.wait(
		`document.fonts.status === 'loaded' && document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).every(a => a.playState !== 'running')`,
	);
}
export async function toggleConversations(page: FrontendPage) {
	await settleFrontend(page);
	await page.click('[aria-label="Toggle conversations"]');
	await settleFrontend(page);
}
async function backFromSettings(page: FrontendPage) {
	if (await page.evaluate('Boolean(document.querySelector(".settings-view"))')) {
		await page.click(".back-to-app");
		await settleFrontend(page);
	}
}
async function sidebarReady(page: FrontendPage) {
	await settleFrontend(page);
	if (await page.evaluate('document.querySelector(".sidebar")?.getBoundingClientRect().right <= 0')) {
		await toggleConversations(page);
	}
}
export async function openConversations(page: FrontendPage) {
	await backFromSettings(page);
	await sidebarReady(page);
}
export async function openExtensionManager(page: FrontendPage) {
	await backFromSettings(page);
	await sidebarReady(page);
	await page.click('[data-action="commands"]');
	await page.wait('document.querySelector("[data-action=manage-extensions]")');
	await page.click("[data-action=manage-extensions]");
	await page.wait('document.querySelector(".settings-view")');
}
export async function openAppearance(page: FrontendPage) {
	await backFromSettings(page);
	await sidebarReady(page);
	await page.click('[data-action="appearance"]');
	await settleFrontend(page);
	await page.click('[data-action="open-appearance"]');
}
export async function openConversationMenu(page: FrontendPage) {
	await backFromSettings(page);
	await page.wait("document.querySelector('[aria-label=\"Conversation options\"]')");
	if (!(await page.evaluate('Boolean(document.querySelector(".conversation-menu"))'))) {
		await page.click('[aria-label="Conversation options"]');
		await settleFrontend(page);
	}
}
export async function conversationAction(
	page: FrontendPage,
	action: "conversation" | "settings" | "notifications" | "collaboration",
	options?: Parameters<FrontendPage["click"]>[1],
) {
	await openConversationMenu(page);
	await page.click('[data-action="' + action + '"]', options);
}
export async function organizationAction(page: FrontendPage, action: "people" | "logout") {
	await backFromSettings(page);
	await sidebarReady(page);
	await page.click(".org-trigger");
	await settleFrontend(page);
	await page.click('[data-action="' + action + '"]');
}
export async function findInConversation(page: FrontendPage, query: string) {
	await settleFrontend(page);
	await page.click('[aria-label="Find in conversation"]');
	await page.wait("document.querySelector('[aria-label=\"Find loaded history\"]')");
	await page.type('[aria-label="Find loaded history"]', query, { replace: true });
	await page.key("Escape");
}
export async function inputMode(page: FrontendPage, mode: "prompt" | "steer" | "followUp" | "chat") {
	await page.click('[aria-label="Input mode"]');
	await page.click('[data-input-mode="' + mode + '"]');
}
export async function masInputMode(page: FrontendPage, mode: "prompt" | "steer" | "followUp") {
	await page.click('[aria-label="Member input mode"]');
	await page.click('[data-mas-mode="' + mode + '"]');
}
export async function newConversation(page: FrontendPage, name: string) {
	await backFromSettings(page);
	await sidebarReady(page);
	await page.click('[data-action="home"]');
	await page.wait('document.querySelector("#composerInput")');
	await settleFrontend(page);
	await page.type("#composerInput", name, { replace: true });
	await page.click("[data-home-create]");
	await page.wait('document.querySelector(".conversation-view")');
}
