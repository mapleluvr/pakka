import { fileURLToPath } from "node:url";
import type { WebUiArtifactSource } from "./assets.ts";

/** Product-selected static artifact; source and pairing are recorded in integrations/webui. */
export const DEFAULT_WEBUI_ARCHIVE = "pakka-webui-app-0.1.0-65f598476697a145.tgz";
export const DEFAULT_WEBUI_ARCHIVE_SHA256 =
	"65f598476697a1452cbdcd9518213908890ae6c52d143b69b7c97bcab9375079";
export const DEFAULT_WEBUI_MANIFEST_SHA256 =
	"b40dd56a35657806decd04208cb0fd4506ff84a3f06a126dcc71e24e1c64b898";

export function defaultWebUiArtifact(): WebUiArtifactSource {
	return {
		directory: fileURLToPath(new URL("./frontend/", import.meta.resolve("@pakka/webui"))),
		manifestSha256: DEFAULT_WEBUI_MANIFEST_SHA256,
	};
}
