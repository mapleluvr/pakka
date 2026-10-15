import { test } from "node:test";
import { strict as assert } from "node:assert";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { fixture } from "./fixture.ts";

test(
	"Pocket invitation: independently decoded actual QR opens the same one-use local invitation",
	{ timeout: 15000 },
	async () => {
		const m = await fixture();
		try {
			const result = await m.rpc({
				op: "invite",
				requestId: "qr-invite",
				role: "viewer",
				resources: [m.ref.conversationId],
				ttlMs: 60000,
			});
			assert.equal(result.response.status, 200);
			assert.ok("result" in result.decoded && result.decoded.result.kind === "invite");
			const invitation = result.decoded.result;
			assert.ok(invitation.token);
			assert.ok("qr" in invitation && typeof invitation.qr === "string");
			assert.match(invitation.qr, /^data:image\/png;base64,/);
			const png = PNG.sync.read(Buffer.from(invitation.qr.split(",")[1]!, "base64"));
			const qr = jsQR.default(new Uint8ClampedArray(png.data), png.width, png.height);
			assert.ok(qr);
			assert.equal(qr.data, m.http.origin + "/#invite=" + invitation.token);
			const joined = await m.exchange(new URL(qr.data).hash.slice("#invite=".length), "invite", "QR viewer");
			assert.equal(joined.response.status, 200);
			assert.equal((await m.exchange(invitation.token, "invite", "Second")).response.status, 401);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
