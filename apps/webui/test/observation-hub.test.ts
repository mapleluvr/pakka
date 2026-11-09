import { test } from "node:test";
import assert from "node:assert/strict";
import { ObservationHub } from "../web/observation-hub.js";

const target = {
	key: "root",
	sessionId: "session",
	conversationId: "2",
	incarnation: "original",
	profile: "default",
};
const scope = { serverId: "server", personId: "person" };

test("shared observation hub: selected pages use one scoped connection, and retired generations cannot publish", () => {
	const opened: { query: URLSearchParams; event: (value: object) => void }[] = [];
	let closed = 0;
	const a: object[] = [],
		b: object[] = [];
	const hub = new ObservationHub({
		schedule: () => {},
		create: (query: URLSearchParams, handlers: { event: (value: object) => void }) => {
			opened.push({ query, event: handlers.event });
			return { close: () => closed++ };
		},
	});
	try {
		hub.subscribe("a", target, scope, (value: object) => a.push(value));
		hub.subscribe("b", { ...target, conversationId: "3" }, scope, (value: object) => b.push(value));
		hub.flush();
		assert.equal(opened.length, 1);
		assert.equal(JSON.parse(opened[0]!.query.get("targets")!).length, 2);
		assert.equal(opened[0]!.query.get("expectedPersonId"), scope.personId);
		opened[0]!.event({ kind: "conversation", snapshot: { ref: target } });
		assert.equal(a.filter((value) => "event" in value).length, 1);
		assert.equal(b.filter((value) => "event" in value).length, 0);
		hub.unsubscribe("b");
		hub.flush();
		assert.equal(closed, 1);
		opened[0]!.event({ kind: "conversation", snapshot: { ref: target } });
		assert.equal(a.filter((value) => "event" in value).length, 1);
		opened[1]!.event({
			kind: "collaboration",
			snapshot: { sessionId: target.sessionId, conversationId: "another" },
		});
		assert.equal(
			a.filter((value) => "event" in value).length,
			1,
			"foreign team snapshots cannot enter this page binding",
		);
		hub.unsubscribe("a");
		assert.equal(closed, 2);
	} finally {
		hub.dispose();
	}
});

test("shared observation hub: changed person scope retires old page bindings and expired pages release their resources", () => {
	let now = 0,
		closed = 0;
	const notices: object[] = [];
	const hub = new ObservationHub({
		schedule: () => {},
		now: () => now,
		create: () => ({ close: () => closed++ }),
	});
	try {
		hub.subscribe("old", target, scope, (value: object) => notices.push(value));
		hub.flush();
		hub.subscribe("new", target, { ...scope, personId: "new-person" }, () => {});
		hub.flush();
		assert.ok(notices.some((value) => "kind" in value && value.kind === "scope-changed"));
		assert.equal(hub.metrics().pages, 1);
		now = 121000;
		hub.sweep();
		hub.flush();
		assert.equal(hub.metrics().pages, 0);
		assert.equal(hub.metrics().connections, 0);
		assert.equal(closed, 2);
	} finally {
		hub.dispose();
	}
});
