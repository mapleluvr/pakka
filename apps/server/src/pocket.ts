/** Host composition APIs for the Pocket product. Imports allocate no identities, writers or listeners. */
export { createPocketPeople } from "./pocket-people.js";
export type {
	PocketPeople,
	PocketPeopleOptions,
	PocketPerson,
	PocketSession,
	PocketAuthority,
	PocketPermission,
	PocketInvite,
	PocketRole,
} from "./pocket-people.js";
export { createPocketWorkspace } from "./pocket-workspace.js";
export type {
	PocketWorkspace,
	PocketWorkspaceOptions,
	PocketWorkspaceClient,
	PocketCreate,
	PocketFork,
	PocketInput,
	PocketInputReceipt,
} from "./pocket-workspace.js";
