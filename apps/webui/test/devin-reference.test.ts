import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// This is the Git blob, not a Windows CRLF-expanded checkout. The upstream
// commit is ed20cec0aef82daa22aa50da19597b7ba1607e02, clean-room/current/styles.css.
test("Devin reference: exact pinned LF CSS, protected from checkout/formatting and no legacy stylesheet chain", async () => {
	const css = await readFile(new URL("../web/reference.css", import.meta.url));
	const sha256 = createHash("sha256").update(css).digest("hex");
	assert.equal(sha256, "084adce8bc6e1feab314b301f57ddac0bab5081cfa08d1c911addece9bdb9974");
	const [html, attributes, ignores, reference] = await Promise.all([
		readFile(new URL("../web/index.html", import.meta.url), "utf8"),
		readFile(new URL("../../../.gitattributes", import.meta.url), "utf8"),
		readFile(new URL("../../../.prettierignore", import.meta.url), "utf8"),
		readFile(new URL("./fixtures/devin-reference.json", import.meta.url), "utf8"),
	]);
	assert.match(html, /href=["'][^"']*reference\.css["']/);
	assert.doesNotMatch(html, /href=["'][^"']*\/(?:pocket|workbench|devin)\.css["']/);
	assert.match(attributes, /^apps\/webui\/web\/reference\.css text eol=lf\r?$/m);
	assert.match(ignores, /^apps\/webui\/web\/reference\.css\r?$/m);
	assert.equal(JSON.parse(reference).cssSha256, sha256);
});
