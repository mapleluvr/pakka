import { fileURLToPath } from "node:url";
import type { WebUiArtifactSource } from "./assets.ts";

/** Product-selected static artifact; source and pairing are recorded in integrations/webui. */
export const DEFAULT_WEBUI_ARCHIVE = "pakka-webui-app-0.1.0-4c5779bdd179bf65.tgz";
export const DEFAULT_WEBUI_ARCHIVE_SHA256 =
	"4c5779bdd179bf653253f1024b053201ecbff48d956faf1c3c5fe46a25f55b78";
export const DEFAULT_WEBUI_MANIFEST_SHA256 =
	"eb6a70dafe3bda25a3bc75ffe76bd02de5ef8ab04d8d8143456b6f74554273e2";

export function defaultWebUiArtifact(): WebUiArtifactSource {
	return {
		directory: fileURLToPath(new URL("./frontend/", import.meta.resolve("@pakka/webui"))),
		manifestSha256: DEFAULT_WEBUI_MANIFEST_SHA256,
	};
}
