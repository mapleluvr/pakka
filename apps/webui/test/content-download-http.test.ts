import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture } from "./fixture.ts";

test(
	"WebUI original download: authorized streaming delivers exact original bytes and a foreign target does not deliver an attachment",
	{ timeout: 10000 },
	async () => {
		const m = await fixture();
		try {
			const body = "Original Unicode 例子 👋\n".repeat(300);
			await m.client.display(m.ref, { requestId: "original-download", kind: "card", text: body });
			const preview = await m.client.preview(m.ref, { limit: 32 });
			const reference = preview.entries.find((entry) => entry.display?.requestId === "original-download")
				?.display?.contentReference;
			assert.ok(reference);
			const url =
				m.http.origin +
				"/pocket/content/download?" +
				new URLSearchParams({ target: JSON.stringify(m.ref), reference: JSON.stringify(reference) });
			const response = await fetch(url, { headers: { Origin: m.http.origin, Cookie: m.admin.cookies } });
			assert.equal(response.status, 200);
			assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
			const bytes = Buffer.from(await response.arrayBuffer());
			assert.equal(
				createHash("sha256").update(bytes).digest("hex"),
				createHash("sha256").update(body, "utf8").digest("hex"),
			);
			const other = await m.client.create({ requestId: "other", name: "Other", profile: "default" });
			const denied = await fetch(
				m.http.origin +
					"/pocket/content/download?" +
					new URLSearchParams({ target: JSON.stringify(other), reference: JSON.stringify(reference) }),
				{ headers: { Origin: m.http.origin, Cookie: m.admin.cookies } },
			);
			assert.notEqual(denied.status, 200);
			assert.equal(denied.headers.get("content-disposition"), null);
			assert.equal((await denied.text()).includes("Original Unicode"), false);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
