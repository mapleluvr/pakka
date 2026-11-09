/** Pure geometry: no hidden full DOM, no scroll-triggered task/API work. */
export function virtualRange(heights, scrollTop, viewportHeight, overscan = 4) {
	let total = 0,
		first = heights.length,
		last = heights.length;
	for (let index = 0; index < heights.length; index++) {
		const height = Math.max(1, Number(heights[index]) || 1);
		if (first === heights.length && total + height >= scrollTop) first = index;
		if (last === heights.length && total >= scrollTop + viewportHeight) last = index;
		total += height;
	}
	const start = Math.max(0, first - overscan),
		end = Math.min(heights.length, last + overscan);
	const top = heights.slice(0, start).reduce((sum, height) => sum + height, 0);
	const shown = heights.slice(start, end).reduce((sum, height) => sum + height, 0);
	return { start, end, top, bottom: Math.max(0, total - top - shown), total };
}

/**
 * @template {{id:string}} T
 * @param {readonly T[]} entries
 * @param {{maxBytes:number,anchorId?:string}} options
 * @returns {{entries:T[],retainedBytes:number,unloadedOlder:boolean,unloadedNewer:boolean}}
 */
export function fitHistoryWindow(entries, options) {
	if (!entries.length) return { entries: [], retainedBytes: 0, unloadedOlder: false, unloadedNewer: false };
	let anchor =
		options.anchorId === undefined
			? entries.length - 1
			: entries.findIndex((entry) => entry.id === options.anchorId);
	if (anchor < 0) anchor = entries.length - 1;
	const size = (entry) => JSON.stringify(entry).length * 2 + 64;
	let first = anchor,
		last = anchor,
		bytes = size(entries[anchor]);
	if (bytes > options.maxBytes) throw new Error("One history preview exceeds the browser byte budget");
	while (first > 0 || last < entries.length - 1) {
		let changed = false;
		if (first > 0 && bytes + size(entries[first - 1]) <= options.maxBytes) {
			first--;
			bytes += size(entries[first]);
			changed = true;
		}
		if (last < entries.length - 1 && bytes + size(entries[last + 1]) <= options.maxBytes) {
			last++;
			bytes += size(entries[last]);
			changed = true;
		}
		if (!changed) break;
	}
	return {
		entries: entries.slice(first, last + 1),
		retainedBytes: bytes,
		unloadedOlder: first > 0,
		unloadedNewer: last < entries.length - 1,
	};
}
