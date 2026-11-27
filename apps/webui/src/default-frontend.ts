import { fileURLToPath } from "node:url";
import type { WebUiArtifactSource } from "./assets.ts";

/** Product-selected static artifact; source and pairing are recorded in integrations/webui. */
export const DEFAULT_WEBUI_ARCHIVE = "pakka-webui-app-0.1.0-17e7382fb3a2e441.tgz";
export const DEFAULT_WEBUI_ARCHIVE_SHA256 =
	"17e7382fb3a2e4418920e2ebb76594223f93ed2bc4d184a9c95621dc9c3d9279";
export const DEFAULT_WEBUI_MANIFEST_SHA256 =
	"289bf27ec8f04c69485685f7bfe973ee98aec95478e188d6125abbfec4e099f1";

export function defaultWebUiArtifact(): WebUiArtifactSource {
	return {
		directory: fileURLToPath(new URL("./frontend/", import.meta.resolve("@pakka/webui"))),
		manifestSha256: DEFAULT_WEBUI_MANIFEST_SHA256,
	};
}
