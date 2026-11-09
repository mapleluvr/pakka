/**
 * @typedef {{offset:number,nextOffset:number,text:string}} Range
 * @typedef {{query:string,start:number,startIndex?:number,coordinates?:'utf8'|'archive',byteLength:number,read:(offset:number)=>Promise<Range>,signal?:AbortSignal,yield?:()=>Promise<void>}} SearchOptions
 * @typedef {{matchOffset?:number,rangeOffset?:number,rangeEnd?:number,nextOffset:number,nextIndex:number,excerpt?:string,complete:boolean}} SearchResult
 */
const encoder = new TextEncoder();
/** Literal, case-sensitive streaming search. Only one source range and a needle-sized overlap reside here.
 * Archive byte coordinates are not decoded string byte coordinates: escaped JSON strings preserve
 * source-range positions plus a separate decoded character cursor, rather than inventing byte offsets.
 * @param {SearchOptions} options
 * @returns {Promise<SearchResult>}
 */
export async function scanOriginal(options) {
	if (
		typeof options.query !== "string" ||
		!options.query.length ||
		options.query.length > 512 ||
		![options.start, options.byteLength, options.startIndex ?? 0].every(Number.isSafeInteger) ||
		options.start < 0 ||
		options.start > options.byteLength ||
		(options.startIndex ?? 0) < 0 ||
		(options.coordinates !== undefined && !["archive", "utf8"].includes(options.coordinates))
	)
		throw new Error("Invalid bounded original search");
	const archive = options.coordinates === "archive";
	let offset = options.start,
		carry = "",
		carryOffset = offset,
		first = true;
	while (offset < options.byteLength) {
		options.signal?.throwIfAborted();
		const range = await options.read(offset);
		options.signal?.throwIfAborted();
		if (
			range.offset !== offset ||
			!Number.isSafeInteger(range.nextOffset) ||
			range.nextOffset <= offset ||
			range.nextOffset > options.byteLength ||
			typeof range.text !== "string"
		)
			throw new Error("Original search range is unconfirmed");
		const decodedBytes = encoder.encode(range.text).byteLength;
		if (archive ? decodedBytes > range.nextOffset - offset : decodedBytes !== range.nextOffset - offset)
			throw new Error("Original search encoding is unconfirmed");
		const skip = first ? (options.startIndex ?? 0) : 0;
		first = false;
		if (skip > range.text.length) throw new Error("Original search character cursor is unconfirmed");
		const combined = carry + range.text.slice(skip),
			found = combined.indexOf(options.query);
		if (found >= 0) {
			const rangeOffset = found < carry.length ? carryOffset : offset;
			const excerpt = combined.slice(Math.max(0, found - 256), found + options.query.length + 512);
			if (archive)
				return {
					rangeOffset,
					rangeEnd: range.nextOffset,
					nextOffset: offset,
					nextIndex: skip + found - carry.length + options.query.length,
					excerpt,
					complete: false,
				};
			const matchOffset =
				offset -
				encoder.encode(carry).byteLength +
				encoder.encode(range.text.slice(0, skip)).byteLength +
				encoder.encode(combined.slice(0, found)).byteLength;
			return {
				matchOffset,
				rangeOffset,
				rangeEnd: range.nextOffset,
				nextOffset: matchOffset + encoder.encode(options.query).byteLength,
				nextIndex: 0,
				excerpt,
				complete: false,
			};
		}
		let from = Math.max(0, combined.length - options.query.length + 1);
		// Keep valid surrogate pairs in the overlap so UTF-8 sizing does not replace a lone surrogate.
		if (
			from > 0 &&
			combined.charCodeAt(from) >= 0xdc00 &&
			combined.charCodeAt(from) <= 0xdfff &&
			combined.charCodeAt(from - 1) >= 0xd800 &&
			combined.charCodeAt(from - 1) <= 0xdbff
		)
			from--;
		if (from >= carry.length) carryOffset = offset;
		carry = combined.slice(from);
		offset = range.nextOffset;
		await options.yield?.();
	}
	options.signal?.throwIfAborted();
	return { nextOffset: offset, nextIndex: 0, complete: true };
}
