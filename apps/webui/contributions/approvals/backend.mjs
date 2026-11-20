import { defineBackend } from "@pakka/webui/backend";
export const { actions } = defineBackend({
	actions: {
		list: async (context) => ({
			approvals: await context.service("approvals").list(),
			canDecide: context.person.role === "admin",
		}),
		decide: (context, input) => context.service("approvals").decide(input),
	},
});
