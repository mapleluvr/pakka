import { fileURLToPath } from "node:url";
import type { WebUiArtifactSource } from "./assets.ts";

/** Product-selected static artifact; source and pairing are recorded in integrations/webui. */
export const DEFAULT_WEBUI_ARCHIVE = "pakka-webui-app-0.1.0-97c5bcd821a91b3a.tgz";
export const DEFAULT_WEBUI_ARCHIVE_SHA256 =
	"97c5bcd821a91b3a4c7ab4f80a7fffdd3b2172b84c77572c874f6f0dd71ce1ad";
export const DEFAULT_WEBUI_MANIFEST_SHA256 =
	"a4ea8a221f173c4ac4c3e5d0f81c8019bb42d057fc7c91f2c7ef290c02631941";

export function defaultWebUiArtifact(): WebUiArtifactSource {
	return {
		directory: fileURLToPath(new URL("./frontend/", import.meta.resolve("@pakka/webui"))),
		manifestSha256: DEFAULT_WEBUI_MANIFEST_SHA256,
	};
}
