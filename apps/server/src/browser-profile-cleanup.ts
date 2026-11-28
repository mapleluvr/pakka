import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Called only after the owned browser process has stopped. OS caches are not Session state. */
export async function cleanupBrowserProfile(profile: string): Promise<"removed" | "retained"> {
	try {
		// Retries at every recursive directory can multiply into minutes on Windows-held AppData.
		await rm(profile, { recursive: true, force: true, maxRetries: 0 });
		return "removed";
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (!code || !["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(code)) throw error;
		// Keep the private directory and an explicit cleanup receipt; never kill its external holder.
		await writeFile(
			join(profile, ".pakka-cleanup.json"),
			JSON.stringify({
				schema: 1,
				state: "retained",
				browserProcess: "stopped",
				reason: code,
			}) + "\n",
			{ mode: 0o600 },
		);
		return "retained";
	}
}
