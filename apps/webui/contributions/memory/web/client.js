export async function memoryCall(context, action, input = {}, options) {
	const result = await context.call(action, input, options);
	if (result.state !== "done")
		throw Error("Memory result is unconfirmed. Read the original operation; do not repeat it.");
	return result.value;
}
