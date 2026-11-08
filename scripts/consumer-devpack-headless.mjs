import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { createMasDevPack } from "@pakka/mas-devpack";
import { createMasProfilePacks, validateRetainedMasRoots } from "@pakka/mas-devpack/agent";
import { createMasWorkbench } from "@pakka/mas-devpack/workbench";
import { createTicketTools } from "@pakka/rsi/agent";
import { createTicketService } from "@pakka/rsi";
import { createMasTicketDispatcher } from "@pakka/rsi/mas";
import "@pakka/memo";

const runtimeRequire = createRequire(import.meta.resolve("@pakka/agent"));
assert.throws(() => runtimeRequire.resolve("@earendil-works/pi-coding-agent"), { code: "MODULE_NOT_FOUND" });
for (const dependency of ["@pakka/webui", "preact", "@earendil-works/pi-coding-agent"]) {
	await assert.rejects(access(new URL("./node_modules/" + dependency, import.meta.url)), { code: "ENOENT" });
	assert.throws(() => import.meta.resolve(dependency), { code: "ERR_MODULE_NOT_FOUND" });
}
assert.equal(typeof createMasWorkbench, "function");
assert.equal(typeof validateRetainedMasRoots, "function");
const pack = createMasProfilePacks({ profiles: { limited: ["spawn"] } }, () => undefined).get("limited");
assert.ok(pack.tools.some((tool) => tool.name === "mas_spawn"));
assert.ok(
	createMasDevPack({
		resolve: () => {
			throw new Error("No native invocation was admitted");
		},
	}).tools.length > 0,
);
const ticketTools = createTicketTools({
	resolve: () => {
		throw new Error("No live invocation");
	},
});
const submit = ticketTools.tools.find((tool) => tool.name === "ticket_submit");
let deniedTicket;
try {
	deniedTicket = JSON.parse(
		await submit.execute({ requestId: "denied", title: "Idea", body: "Evidence", sources: [] }),
	);
} catch (error) {
	throw new Error("Invalid ticket tool response", { cause: error });
}
assert.equal(deniedTicket.status, "denied");
assert.equal(typeof createTicketService, "function");
assert.throws(() => createMasTicketDispatcher({ routes: [] }).plan("unapproved"));
ticketTools.revoke();
console.log(
	"Headless RSI/Memo and DevPack imports passed with no WebUI, Preact or Coding Agent installed or resolvable; no model dispatch.",
);
