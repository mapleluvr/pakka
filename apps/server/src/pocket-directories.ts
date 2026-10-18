import { realpath, stat, opendir } from "node:fs/promises";
import { isAbsolute, relative, dirname, join } from "node:path";

export interface PocketDirectories {
	readonly path: string;
	readonly parent: string | null;
	readonly roots: readonly string[];
	readonly directories: readonly string[];
	readonly places: readonly string[];
	readonly truncated: boolean;
}
const inside = (root: string, path: string) => {
	const part = relative(root, path);
	return part === "" || (!part.startsWith("..") && !isAbsolute(part));
};
export const directoryWithin = (path: string, roots: readonly string[]) =>
	roots.some((root) => inside(root, path));
const valid = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= 8192 &&
	isAbsolute(value) &&
	!/[\x00-\x1f\x7f]/.test(value);
export async function resolveDirectory(path: unknown, roots: readonly string[]): Promise<string> {
	if (!valid(path) || !roots.some((root) => inside(root, path)))
		throw new Error("Directory authority denied");
	try {
		const canonical = await realpath(path);
		if (!roots.some((root) => inside(root, canonical)) || !(await stat(canonical)).isDirectory())
			throw Error();
		return canonical;
	} catch {
		throw new Error("Directory authority denied");
	}
}
/** Read-only server navigation. Neither listing nor selecting grants file/tool access or creates folders. */
export async function listDirectories(
	roots: readonly string[],
	current: string,
	input: { readonly path?: string; readonly places?: readonly string[] },
	check: () => void,
): Promise<PocketDirectories> {
	check();
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		Object.keys(input).some((key) => !["path", "places"].includes(key)) ||
		(input.places !== undefined &&
			(!Array.isArray(input.places) || input.places.length > 32 || !input.places.every(valid)))
	)
		throw new Error("Invalid directory query");
	const path = await resolveDirectory(input.path ?? current, roots);
	check();
	const directories: string[] = [];
	let truncated = false,
		scanned = 0,
		bytes = path.length + roots.join("").length;
	const stream = await opendir(path);
	for await (const entry of stream) {
		check();
		if (++scanned > 4096) {
			truncated = true;
			break;
		}
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		try {
			const candidate = await resolveDirectory(join(path, entry.name), roots);
			check();
			if (bytes + candidate.length > 32768 || directories.length >= 128) {
				truncated = true;
				break;
			}
			if (!directories.includes(candidate)) {
				directories.push(candidate);
				bytes += candidate.length;
			}
		} catch {
			check();
		}
	}
	const places: string[] = [];
	for (const candidate of input.places ?? []) {
		check();
		try {
			const value = await resolveDirectory(candidate, roots);
			if (!places.includes(value)) places.push(value);
		} catch {
			check();
		}
	}
	const parent = dirname(path);
	check();
	return Object.freeze({
		path,
		parent: parent !== path && roots.some((root) => inside(root, parent)) ? parent : null,
		roots: Object.freeze([...roots]),
		directories: Object.freeze(directories.sort((a, b) => a.localeCompare(b))),
		places: Object.freeze(places),
		truncated,
	});
}
