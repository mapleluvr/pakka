export async function scheduleCall(context, action, input = {}, options) {
	const result = await context.call(action, input, options);
	if (result.state !== "done")
		throw Error("Schedule outcome unknown. Check the original operation; do not replay it.");
	return result.value;
}
