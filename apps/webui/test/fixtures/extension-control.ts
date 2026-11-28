import type { PocketAuthority } from "@pakka/server/pocket";
import type { ExtensionFacet, ExtensionFacetControl } from "@pakka/protocol/extensions";
import type { ExtensionHost } from "../../src/backend.ts";

/** Tests exercise the public facet request, including its current generation and stable original identity. */
export function controlFacet(
	host: ExtensionHost,
	actor: PocketAuthority,
	extension: string,
	facet: ExtensionFacet,
	action: ExtensionFacetControl["action"],
	requestId: string = crypto.randomUUID(),
) {
	const registration = host.list(actor).find((row) => row.manifest.id === extension && row.facet === facet);
	if (!registration) throw Error("Missing test facet registration");
	return host.control(actor, {
		extension,
		facet,
		action,
		expectedGeneration: registration.generation,
		requestId,
	});
}
