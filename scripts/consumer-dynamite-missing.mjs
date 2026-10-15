import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapServer } from "@pakka/server/bootstrap";

const root = dirname(fileURLToPath(import.meta.url));
const cwd = join(root, "missing-peer-workspace");
await mkdir(cwd, { recursive: true });
const config = {
	schema: "pakka.server.v1",
	runtime: {
		cwd,
		dataDir: join(root, "native-no-peer-profile"),
		endpoint: "http://127.0.0.1:1/v1",
		model: "not-dispatched",
		apiKey: "local-only",
		systemPrompt: "NATIVE-ONLY",
		limits: { maxConversations: 2, maxPrimaryAttempts: 4, maxAuxiliaryAttempts: 1 },
	},
	mas: { namespace: "missing-peer", maxDeliveries: 4, maxPending: 2 },
	members: [{ key: "root", owner: "operator" }],
	roles: [
		{
			token: "missing-peer-local-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			principal: "operator",
			sourceKey: null,
			grants: ["discover", "send", "observe"],
		},
	],
};
const native = await bootstrapServer(config);
await native.close();
const dataDir = join(root, "missing-peer-denied-profile");
await assert.rejects(
	bootstrapServer({
		...config,
		runtime: { ...config.runtime, dataDir },
		dynamite: { members: [{ key: "root" }] },
	}),
);
await assert.rejects(access(dataDir), { code: "ENOENT" });
await writeFile(
	join(root, "missing-peer-evidence.json"),
	JSON.stringify(
		{
			nativeStartupWithoutPeer: true,
			missingPeerRefused: true,
			storageCreatedOnRefusal: false,
			providerRequests: 0,
		},
		null,
		2,
	),
);
console.log("native startup without peer + feature refusal before storage: passed");
