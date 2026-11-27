import { fileURLToPath } from "node:url";
import type { WebUiArtifactSource } from "./assets.ts";

/** Product-selected static artifact; source and pairing are recorded in integrations/webui. */
export const DEFAULT_WEBUI_ARCHIVE = "pakka-webui-app-0.1.0-6076b13bc181c9f6.tgz";
export const DEFAULT_WEBUI_ARCHIVE_SHA256 =
	"6076b13bc181c9f6dc8648a21a207f55e1ece1652ab86bc1321994e56d1bb69e";
export const DEFAULT_WEBUI_MANIFEST_SHA256 =
	"28242cb569f25b227ec40e3bb93e192cb70f00868c192d2e2067cdf62ec0b360";

export function defaultWebUiArtifact(): WebUiArtifactSource {
	return {
		directory: fileURLToPath(new URL("./frontend/", import.meta.resolve("@pakka/webui"))),
		manifestSha256: DEFAULT_WEBUI_MANIFEST_SHA256,
	};
}
