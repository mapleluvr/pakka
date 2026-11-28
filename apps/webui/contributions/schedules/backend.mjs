import { defineBackend } from "@pakka/webui/backend";
export const { actions } = defineBackend({
	actions: {
		list: async (context) => ({
			schedules: await context.service("schedules").list(),
			canWrite: ["admin", "driver"].includes(context.person.role),
		}),
		deliveries: (context, input) => context.service("schedules").deliveries(input.id),
		add: (context, input) => context.service("schedules").add({ ...input, requestId: context.requestId }),
		cancel: (context, input) => context.service("schedules").cancel(input.id),
	},
});
