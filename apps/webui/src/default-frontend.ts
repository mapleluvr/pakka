import { fileURLToPath } from "node:url";
import type { WebUiArtifactSource } from "./assets.ts";

/** Product-selected static artifact; source and pairing are recorded in integrations/webui. */
export const DEFAULT_WEBUI_ARCHIVE = "pakka-webui-app-0.1.0-2460c6b80f2f1126.tgz";
export const DEFAULT_WEBUI_ARCHIVE_SHA256 =
	"2460c6b80f2f112662efb596501af7293e2f03abc2311ff3662f1de4f305e7ab";
export const DEFAULT_WEBUI_MANIFEST_SHA256 =
	"4942093ef2ca0269cad2d1bc0a8bb31270d7d7c528bd16c40410459a071cc0eb";

export function defaultWebUiArtifact(): WebUiArtifactSource {
	return {
		directory: fileURLToPath(new URL("./frontend/", import.meta.resolve("@pakka/webui"))),
		manifestSha256: DEFAULT_WEBUI_MANIFEST_SHA256,
	};
}
