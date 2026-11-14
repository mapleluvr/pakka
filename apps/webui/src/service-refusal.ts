import type { PocketErrorCode } from "@pakka/protocol/pocket";

/** Public diagnostics are categorical; native failures can contain paths, config and credentials. */
export class WebUiServiceRefusal extends Error {
	readonly code: PocketErrorCode;
	readonly confirmedNoEffect: boolean;
	constructor(code: "FORBIDDEN" | "INVALID_REQUEST" | "CONFLICT" | "CAPACITY" | "UNSUPPORTED" | "UNKNOWN") {
		super("WebUI service request refused");
		this.name = "WebUiServiceRefusal";
		this.code = code;
		this.confirmedNoEffect = code !== "UNKNOWN";
	}
}
