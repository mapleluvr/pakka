import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fixture } from "./fixture.ts";
import type { AgentRef } from "@pakka/protocol/pocket";

test(
	"Pocket HTTP workspace: human create/configure/fork preserve approved config and real inherited model history",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const made = await m.rpc({
				op: "create",
				requestId: "web-create",
				name: "New project",
				profile: "default",
			});
			assert.equal(made.response.status, 200);
			assert.ok("result" in made.decoded && made.decoded.result.kind === "reference");
			const ref = made.decoded.result.ref;
			const listed = await m.rpc({ op: "list" });
			assert.ok(
				"result" in listed.decoded &&
					listed.decoded.result.kind === "list" &&
					"titles" in listed.decoded.result,
			);
			assert.ok(listed.decoded.result.titles && typeof listed.decoded.result.titles === "object");
			assert.equal(Reflect.get(listed.decoded.result.titles, ref.conversationId), "New project");
			const changed = await m.rpc({ op: "configure", target: ref, profile: "default" });
			assert.equal(changed.response.status, 200);
			assert.ok("result" in changed.decoded && changed.decoded.result.kind === "reference");
			const current = changed.decoded.result.ref;
			const start = await m.rpc({
				op: "submit",
				target: current,
				input: { requestId: "history", text: "INHERITED-FROM-WEB", mode: "prompt" },
			});
			assert.ok("result" in start.decoded && start.decoded.result.kind === "receipt");
			await m.rpc({ op: "wait", id: start.decoded.result.receipt.id });
			const read = await m.rpc({ op: "read", target: current });
			assert.ok("result" in read.decoded && read.decoded.result.kind === "conversation");
			const anchor = read.decoded.result.snapshot.entries.at(-1)!.id;
			const fork = await m.rpc({
				op: "fork",
				target: current,
				requestId: "web-fork",
				name: "Alternative",
				profile: "default",
				entryId: anchor,
			});
			assert.equal(fork.response.status, 200);
			assert.ok("result" in fork.decoded && fork.decoded.result.kind === "reference");
			const child: AgentRef = fork.decoded.result.ref;
			assert.notEqual(child.conversationId, current.conversationId);
			const next = await m.rpc({
				op: "submit",
				target: child,
				input: { requestId: "continue", text: "CHILD-CONTINUES", mode: "prompt" },
			});
			assert.ok("result" in next.decoded && next.decoded.result.kind === "receipt");
			await m.rpc({ op: "wait", id: next.decoded.result.receipt.id });
			assert.equal(m.f.requests.length, 2);
			assert.match(JSON.stringify(m.f.requests[1]), /INHERITED-FROM-WEB/);
		} finally {
			await m.close();
		}
	},
);
