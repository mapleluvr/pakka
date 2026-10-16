import { defineBackend } from "@pakka/webui/backend";
const service = (context) => context.service("browser");
export const { actions } = defineBackend({
	actions: {
		view: async (context) => {
			const view = await service(context).snapshot();
			return { view, ...(view.open ? { frame: await service(context).frame() } : {}) };
		},
		navigate: (context, input) => service(context).navigate({ ...input, requestId: context.requestId }),
		click: (context, input) => service(context).click({ ...input, requestId: context.requestId }),
		fill: (context, input) => service(context).fill({ ...input, requestId: context.requestId }),
		receipt: (context, input) => service(context).receipt(input.requestId),
	},
});
