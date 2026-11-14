import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decodeWebUiAssetManifest, type WebUiAssetManifest } from "@pakka/protocol/webui-assets";
import { WEBUI_SERVICE_API } from "@pakka/protocol/webui";
import { POCKET_VERSION } from "@pakka/protocol/pocket";

export interface WebUiArtifactSource {
	readonly directory: string;
	/** Pin the exact manifest bytes, not an unversioned path or the renderer's descriptive name. */
	readonly manifestSha256: string;
}
export interface LoadedWebUiAssets {
	readonly manifest: WebUiAssetManifest;
	readonly assets: ReadonlyMap<string, { readonly type: string; readonly body: Uint8Array }>;
}
const media = new Set([
	"text/html; charset=utf-8",
	"text/javascript; charset=utf-8",
	"text/css; charset=utf-8",
	"text/plain; charset=utf-8",
	"application/json; charset=utf-8",
	"application/manifest+json",
	"image/svg+xml",
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/x-icon",
	"font/woff2",
]);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Verify before a Session opens. No downloads, compilation, npm resolution or fallback to another frontend. */
export async function loadWebUiAssets(input: WebUiArtifactSource): Promise<LoadedWebUiAssets> {
	if (
		!input ||
		typeof input.directory !== "string" ||
		!input.directory ||
		!/^[a-f0-9]{64}$/.test(input.manifestSha256)
	)
		throw new Error("A fixed frontend artifact and manifest digest are required");
	const directory = resolve(input.directory);
	const directoryStat = await lstat(directory);
	if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
		throw new Error("Frontend artifact directory must be a regular directory");
	const root = await realpath(directory);
	async function bytes(path: string, max: number): Promise<Buffer> {
		let current = root;
		for (const part of path.split("/")) {
			current = join(current, part);
			if ((await lstat(current)).isSymbolicLink()) throw new Error("Frontend asset links are refused");
		}
		const file = await open(current, "r");
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > max) throw new Error("Frontend asset exceeds its read bound");
			// The bounded read cannot expand if a producer is concurrently replacing a file.
			const value = Buffer.alloc(Number(stat.size));
			let offset = 0;
			while (offset < value.length) {
				const next = await file.read(value, offset, value.length - offset, offset);
				if (next.bytesRead === 0) throw new Error("Frontend asset changed during verification");
				offset += next.bytesRead;
			}
			if ((await file.stat()).size !== stat.size)
				throw new Error("Frontend asset changed during verification");
			return value;
		} finally {
			await file.close();
		}
	}
	const raw = await bytes("asset-manifest.json", 2 * 1024 * 1024);
	if (hash(raw) !== input.manifestSha256) throw new Error("Frontend manifest identity mismatch");
	let manifest: WebUiAssetManifest;
	try {
		manifest = decodeWebUiAssetManifest(JSON.parse(raw.toString("utf8")));
	} catch {
		throw new Error("Invalid frontend asset manifest");
	}
	if (
		manifest.requires.services !== WEBUI_SERVICE_API ||
		manifest.requires.workbench !== POCKET_VERSION ||
		manifest.requires.extensions !== 2
	)
		throw new Error("Frontend requires an unsupported service version");
	const assets = new Map<string, { type: string; body: Uint8Array }>();
	let size = 0;
	for (const file of manifest.files) {
		if (!media.has(file.type)) throw new Error("Unsupported frontend media type");
		const body = await bytes(file.path, 32 * 1024 * 1024);
		size += body.length;
		if (size > 128 * 1024 * 1024) throw new Error("Frontend artifact exceeds its total byte bound");
		if (hash(body) !== file.sha256) throw new Error("Frontend asset identity mismatch");
		assets.set(file.url, { type: file.type, body });
	}
	return { manifest, assets };
}
