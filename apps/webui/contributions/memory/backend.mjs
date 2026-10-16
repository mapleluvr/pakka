import { defineBackend } from "@pakka/webui/backend";
export const { actions } = defineBackend({
	actions: {
		read: (context) => context.service("memory").read(),
		add: (context, input) => context.service("memory").add({ ...input, requestId: context.requestId }),
		change: (context, input) => context.service("memory").change({ ...input, requestId: context.requestId }),
		activation: (context, input) =>
			context.service("memory").setEnabled({ ...input, requestId: context.requestId }),
		operation: (context, input) => context.service("memory").operation(input.requestId),
	},
});
