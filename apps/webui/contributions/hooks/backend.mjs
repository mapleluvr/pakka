import { defineBackend } from "@pakka/webui/backend";
export const { actions } = defineBackend({
	actions: {
		read: async (context) => ({
			hooks: await context.service("hooks").list(),
			canManage: ["admin", "driver"].includes(context.person.role),
		}),
		create: (context, input) => context.service("hooks").create({ ...input, requestId: context.requestId }),
		rotate: (context, input) => context.service("hooks").rotate({ ...input, requestId: context.requestId }),
		remove: (context, input) => context.service("hooks").remove({ ...input, requestId: context.requestId }),
		credentials: (context, input) => context.service("hooks").credentials(input.id),
		operation: (context, input) => context.service("hooks").operation(input.requestId),
		deliveries: (context, input) => context.service("hooks").deliveries(input.id),
	},
});
