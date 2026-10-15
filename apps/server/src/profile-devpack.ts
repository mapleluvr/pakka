// Preserve existing app wiring while sharing the public approved-profile/invocation contract.
export {
	createMasProfilePacks as profileDevPacks,
	validateRetainedMasRoots as retainedProductRoots,
	type MasProfilePacksOptions as ProfileDevPackConfig,
} from "@pakka/mas-devpack/agent";
