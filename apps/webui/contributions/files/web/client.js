export async function fileCall(context, action, input) {
	const operation = await context.call(action, input);
	if (operation.state !== "done")
		throw Object.assign(
			new Error("Operation unknown. Check its original receipt; do not repeat it automatically."),
			{ operationId: operation.id },
		);
	return operation;
}
