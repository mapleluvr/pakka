export async function hooksCall(context, action, input = {}, options) {
	const operation = await context.call(action, input, options);
	if (operation.state !== "done")
		throw Error("Webhook result is unconfirmed. Check the original operation before another change.");
	return operation.value;
}
