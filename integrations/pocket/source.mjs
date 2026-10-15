import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import lock from "./source-lock.json" with { type: "json" };

const cache = new Map();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function git(directory, ...args) {
	return execFileSync("git", ["-C", directory, ...args], {
		encoding: "utf8",
		windowsHide: true,
		maxBuffer: 32 * 1024 * 1024,
	}).trim();
}
function blob(directory, id) {
	return execFileSync("git", ["-C", directory, "cat-file", "blob", id], {
		windowsHide: true,
		maxBuffer: 16 * 1024 * 1024,
	});
}
function inspect(directory, kind) {
	assert.ok(kind === "upstream" || kind === "extensionReference", "Unknown source role");
	const expected = lock[kind];
	assert.equal(git(directory, "rev-parse", "HEAD"), expected.commit, "Unexpected source commit");
	assert.equal(git(directory, "rev-parse", "HEAD^{tree}"), expected.tree, "Unexpected source tree");
	assert.equal(
		git(directory, "status", "--porcelain", "--untracked-files=all"),
		"",
		"Pinned source checkout is dirty",
	);
	const key = resolve(directory) + ":" + expected.commit;
	if (cache.has(key)) return cache.get(key);
	const records = git(directory, "ls-tree", "-rz", "--full-tree", "HEAD")
		.split("\0")
		.filter(Boolean)
		.map((line) => {
			const match = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(line);
			assert.ok(match, "Invalid tree entry");
			const [, mode, type, oid, path] = match;
			assert.equal(type, "blob");
			assert.ok(
				!path.startsWith("/") && !path.split("/").includes("..") && !/[\x00-\x1f\\]/.test(path),
				"Unsafe source path",
			);
			assert.ok(
				mode === "100644" || mode === "100755",
				"Symlink/submodule source requires separate approval",
			);
			const bytes = blob(directory, oid);
			return { path, mode, blob: oid, sha256: sha256(bytes), bytes: bytes.length, content: bytes };
		});
	const packageFile = records.find((file) => file.path === "package.json");
	assert.ok(packageFile, "Missing source package");
	let pkg;
	try {
		pkg = JSON.parse(packageFile.content.toString("utf8"));
	} catch (error) {
		throw new Error("Invalid pinned source manifest", { cause: error });
	}
	assert.equal(
		pkg.dependencies["@earendil-works/pi-durable"],
		expected.durableVersion,
		"Source cohort mismatch",
	);
	for (const [path, license] of Object.entries(lock.licenses))
		assert.equal(
			records.find((file) => file.path === path)?.sha256,
			license.sha256,
			"License bytes mismatch: " + path,
		);
	const parents = git(directory, "show", "-s", "--format=%P", "HEAD").split(/\s+/).filter(Boolean);
	if (expected.phase1Parent) assert.equal(parents[0], expected.phase1Parent, "Phase 2 ancestry mismatch");
	const summary = {
		role: kind,
		repository: expected.repository,
		commit: expected.commit,
		tree: expected.tree,
		parents,
		durableVersion: expected.durableVersion,
		license: pkg.license,
		files: records.map(({ content: _content, ...file }) => file),
	};
	const result = { summary, records };
	cache.set(key, result);
	return result;
}
export function verifySource(directory, kind) {
	return inspect(directory, kind).summary;
}
export function inventorySource(directory, kind, parserDirectory = directory) {
	const { summary, records } = inspect(directory, kind);
	// The inspected upstream lock installs TS 6's public compiler API; TS 7 intentionally exports only version at root.
	const ts = createRequire(resolve(parserDirectory, "package.json"))("typescript");
	assert.equal(
		ts.version,
		"6.0.3",
		"Use the upstream lock-pinned stable parser, not a host/private compiler API",
	);
	assert.equal(
		typeof ts.createSourceFile,
		"function",
		"Install the isolated upstream baseline dependencies first",
	);
	const actions = [],
		routes = [],
		authorityEdges = [];
	for (const file of records) {
		if (!/^(web\/.*\.js|src\/server\/.*\.ts)$/.test(file.path)) continue;
		const source = ts.createSourceFile(
			file.path,
			file.content.toString("utf8"),
			ts.ScriptTarget.Latest,
			true,
			file.path.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
		);
		const edges = new Set();
		const location = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
		const addEdge = (node, kind, value) => {
			const line = location(node),
				key = line + ":" + kind + ":" + value;
			if (!edges.has(key)) {
				edges.add(key);
				authorityEdges.push({ path: file.path, line, kind, value });
			}
		};
		function visit(node) {
			if (ts.isImportDeclaration(node) && /pip|subagent|reporter|courier/i.test(node.moduleSpecifier.text))
				addEdge(node, "import", node.moduleSpecifier.text);
			else if (
				(ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
				/pip|subagent|reporter|courier/i.test(node.text)
			)
				addEdge(node, ts.isIdentifier(node) ? "identifier" : "string", node.text);
			if (ts.isCallExpression(node)) {
				const callee = node.expression.getText(source);
				if (
					/^(fetch|api|post|send|rpc)$|\b(actions|commands)\.|\.(submit|send|configure|abort|retire|reply|request)$/.test(
						callee,
					)
				)
					actions.push({
						path: file.path,
						line: location(node),
						callee,
						arguments: node.arguments.map((argument) => argument.getText(source).slice(0, 240)),
					});
			}
			if (ts.isIfStatement(node) && file.path.startsWith("src/server/http")) {
				const condition = node.expression.getText(source);
				if (/\b(first|second|third|fourth|method|parts)\b|\.pathname/.test(condition))
					routes.push({ path: file.path, line: location(node), condition });
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
	}
	return {
		source: summary,
		parser: { package: "typescript", version: ts.version },
		actions,
		routes,
		authorityEdges,
		note: "AST candidate edges, not a runtime proof. Manual action ledger assigns owners and acceptance; adopted production graphs must exclude old authority.",
	};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	assert.equal(
		args.length,
		3,
		"Usage: node integrations/pocket/source.mjs <upstream checkout> <Phase2 checkout> <output.json>",
	);
	const result = {
		schemaVersion: 1,
		commonAncestor: lock.commonAncestor,
		upstream: inventorySource(args[0], "upstream"),
		extensionReference: inventorySource(args[1], "extensionReference", args[0]),
	};
	assert.equal(
		git(args[0], "merge-base", lock.upstream.commit, lock.extensionReference.commit),
		lock.commonAncestor,
		"Source trees are not the recorded divergent branches",
	);
	mkdirSync(dirname(resolve(args[2])), { recursive: true });
	writeFileSync(args[2], JSON.stringify(result, null, 2) + "\n");
	console.log(
		JSON.stringify({
			upstreamFiles: result.upstream.source.files.length,
			referenceFiles: result.extensionReference.source.files.length,
			upstreamActions: result.upstream.actions.length,
			upstreamRoutes: result.upstream.routes.length,
			upstreamAuthorityEdges: result.upstream.authorityEdges.length,
		}),
	);
}
