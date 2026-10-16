export async function approvalCall(context, action, input = {}) {
	const result = await context.call(action, input);
	if (result.state !== "done")
		throw new Error("Approval outcome unknown. Inspect the original call; do not replay it.");
	return result.value;
}
