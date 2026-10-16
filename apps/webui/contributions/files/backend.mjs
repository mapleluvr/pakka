import { defineBackend } from "@pakka/webui/backend";
import { PocketFileConflict } from "@pakka/server/pocket";
const service = (context) => context.service("files");
const mutation = async (context, method, input) => {
	try {
		return await service(context)[method]({ ...input, requestId: context.requestId });
	} catch (error) {
		if (error instanceof PocketFileConflict) return { requestId: context.requestId, state: "conflict" };
		throw error;
	}
};
export const { actions } = defineBackend({
	actions: {
		roots: async (context) => ({ roots: await service(context).roots() }),
		list: (context, input) => service(context).list(input),
		read: (context, input) => service(context).read(input),
		export: (context, input) => service(context).export(input),
		write: (context, input) => mutation(context, "write", input),
		upload: (context, input) => mutation(context, "upload", input),
		changes: (context, input) => service(context).changes(input),
		diff: (context, input) => service(context).diff(input),
		branches: async (context, input) => ({ branches: await service(context).branches(input) }),
		"switch-branch": (context, input) => mutation(context, "switchBranch", input),
		worktrees: async (context, input) => ({ worktrees: await service(context).worktrees(input) }),
		"add-worktree": (context, input) => mutation(context, "addWorktree", input),
		"remove-worktree": (context, input) => mutation(context, "removeWorktree", input),
		receipt: (context, input) => service(context).receipt(input),
	},
});
