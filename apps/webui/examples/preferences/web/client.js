export async function readPreference(context) {
	const result = await context.call("status", {});
	if (result.state !== "done") throw new Error("Setting is unconfirmed");
	return result.value;
}
