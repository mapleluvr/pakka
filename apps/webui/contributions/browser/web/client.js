export async function browserCall(context, action, input = {}, options) {
	const result = await context.call(action, input, options);
	if (result.state !== "done")
		throw new Error("Browser operation unknown. Inspect the original receipt; do not replay it.");
	return result.value;
}
