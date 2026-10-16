import { defineBackend } from "@pakka/webui/backend";
export const { actions } = defineBackend({
	actions: {
		list: async (context) => ({ schedules: await context.service("schedules").list() }),
		add: (context, input) => context.service("schedules").add({ ...input, requestId: context.requestId }),
		cancel: (context, input) => context.service("schedules").cancel(input.id),
	},
});
