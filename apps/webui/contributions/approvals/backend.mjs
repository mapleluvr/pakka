import { defineBackend } from "@pakka/webui/backend";
export const { actions } = defineBackend({
	actions: {
		list: async (context) => ({ approvals: await context.service("approvals").list() }),
		decide: (context, input) => context.service("approvals").decide(input),
	},
});
