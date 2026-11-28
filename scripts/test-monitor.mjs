import { writeFileSync } from "node:fs";
import { join } from "node:path";
// Includes the Node test-file worker. Descendant application processes are not
// summed into this high-water mark; available system memory is sampled separately.
if (process.env.PAKKA_TEST_METRICS)
	process.on("exit", () => {
		try {
			writeFileSync(
				join(process.env.PAKKA_TEST_METRICS, process.pid + ".json"),
				JSON.stringify({
					pid: process.pid,
					ppid: process.ppid,
					maxRssBytes: process.resourceUsage().maxRSS * 1024,
				}),
			);
		} catch {
			/* A killed worker has no final sample; the runner records null. */
		}
	});
