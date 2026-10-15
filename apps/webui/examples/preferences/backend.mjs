import { defineBackend } from "@pakka/webui/backend";
export const { actions } = defineBackend({
	actions: {
		status: async (context) => (await context.settings.get("label")).value ?? { text: "" },
		save: async (context, input) => {
			const saved = await context.settings.get("label");
			await context.settings.compareAndSet("label", saved.version, input);
			return input;
		},
		card: async (context, input) => {
			await context.display("card", input.text);
			return { text: "Card saved" };
		},
	},
});
