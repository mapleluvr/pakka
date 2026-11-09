import { h } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import {
	Virtualizer,
	defaultRangeExtractor,
	elementScroll,
	observeElementRect,
	observeElementOffset,
} from "@tanstack/virtual-core";

const html = htm.bind(h);
const estimateRow = () => 120;
const measureRow = (element) => Math.max(1, element.getBoundingClientRect().height);

/** One geometry owner. Only current virtual rows and one focused off-screen row have DOM. */
export function VirtualTranscript({ rows, rowKey, renderRow, scroll, follow }) {
	const node = useRef(null),
		core = useRef(null),
		mounted = useRef(false),
		prependAnchor = useRef(null),
		prior = useRef({ following: false, origin: -1, keys: "" });
	const [, update] = useState(0),
		[focused, setFocused] = useState(null);
	const keys = rows.map(rowKey),
		keysToken = JSON.stringify(keys);
	const origin =
		node.current && scroll.current
			? node.current.getBoundingClientRect().top -
				scroll.current.getBoundingClientRect().top +
				scroll.current.scrollTop
			: 0;
	const getItemKey = useMemo(() => (index) => keys[index], [keysToken]);
	const getScrollElement = useMemo(() => () => scroll.current, [scroll]);
	const onChange = useMemo(
		() => () => {
			if (mounted.current) update((value) => value + 1);
		},
		[],
	);
	const rangeExtractor = useMemo(
		() => (range) => {
			const indexes = defaultRangeExtractor(range),
				pinned = keys.indexOf(focused);
			if (pinned >= 0 && !indexes.includes(pinned)) indexes.push(pinned);
			return indexes.sort((left, right) => left - right);
		},
		[keysToken, focused],
	);
	const options = {
		count: rows.length,
		getScrollElement,
		getItemKey,
		estimateSize: estimateRow,
		scrollToFn: elementScroll,
		observeElementRect,
		observeElementOffset,
		onChange,
		measureElement: measureRow,
		rangeExtractor,
		overscan: 5,
		gap: 22,
		scrollMargin: origin,
		anchorTo: "end",
		followOnAppend: follow.current,
		scrollEndThreshold: 80,
		useAnimationFrameWithResizeObserver: true,
		initialRect: { width: scroll.current?.clientWidth ?? 660, height: scroll.current?.clientHeight ?? 700 },
		indexAttribute: "data-virtual-index",
	};
	if (!core.current) core.current = new Virtualizer(options);
	else {
		if (!follow.current && prior.current.keys !== keysToken) {
			const previous = core.current.getVirtualItemForOffset(core.current.scrollOffset ?? 0);
			prependAnchor.current = previous && keys.includes(previous.key) ? previous.key : null;
		}
		core.current.setOptions(options);
	}
	const virtual = core.current;
	// A prepended item can occupy the old controls gap inside the viewport. Its first measurement still belongs before the retained row.
	virtual.shouldAdjustScrollPositionOnItemSizeChange =
		prependAnchor.current === null ? undefined : (item) => item.index < keys.indexOf(prependAnchor.current);
	useLayoutEffect(() => {
		mounted.current = true;
		const dispose = virtual._didMount();
		return () => {
			mounted.current = false;
			dispose();
		};
	}, [virtual]);
	useLayoutEffect(() => {
		virtual._willUpdate();
		const root = scroll.current;
		if (!root || !node.current) return;
		const nextOrigin =
			node.current.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
		if (Math.abs(nextOrigin - origin) > 0.5) {
			update((value) => value + 1);
			return;
		}
		const movedOrigin = prior.current.origin >= 0 && Math.abs(prior.current.origin - origin) > 0.5;
		// Key changes and origin move enter setOptions atomically. Only a controls-only move needs a separate core command.
		if (!follow.current && movedOrigin && prior.current.keys === keysToken)
			virtual.scrollBy(origin - prior.current.origin, { behavior: "auto" });
		if (follow.current && rows.length && (!prior.current.following || movedOrigin))
			virtual.scrollToEnd({ behavior: "auto" });
		prior.current = { following: follow.current, origin, keys: keysToken };
		// Derived measurements follow the loaded byte window, not cumulative archive history.
		const keep = new Set(keys);
		for (const key of virtual.itemSizeCache.keys()) if (!keep.has(key)) virtual.itemSizeCache.delete(key);
	});
	useLayoutEffect(() => {
		const root = scroll.current;
		if (!root) return;
		const focus = () => {
			const row = document.activeElement?.closest?.("[data-virtual-key]");
			setFocused(row && node.current?.contains(row) ? row.dataset.virtualKey : null);
		};
		const blur = () => queueMicrotask(focus);
		const interact = () => {
			prependAnchor.current = null;
			virtual.shouldAdjustScrollPositionOnItemSizeChange = undefined;
		};
		for (const type of ["wheel", "touchstart", "pointerdown", "keydown"])
			root.addEventListener(type, interact, { passive: true });
		root.addEventListener("focusin", focus);
		root.addEventListener("focusout", blur);
		focus();
		return () => {
			root.removeEventListener("focusin", focus);
			root.removeEventListener("focusout", blur);
			for (const type of ["wheel", "touchstart", "pointerdown", "keydown"])
				root.removeEventListener(type, interact);
		};
	}, [scroll.current]);
	const items = virtual.getVirtualItems(),
		total = virtual.getTotalSize();
	return html`<div
		class="virtual-transcript"
		data-virtual-history
		data-window-scrolling=${virtual.isScrolling ? "true" : "false"}
		data-following=${follow.current ? "true" : "false"}
		data-window-start=${virtual.range?.startIndex ?? 0}
		data-window-end=${(virtual.range?.endIndex ?? -1) + 1}
		data-window-total=${total}
		style=${{ height: total + "px" }}
		ref=${node}
	>
		${items.map((item) =>
			h(
				"div",
				{
					key: item.key,
					class: "virtual-history-row",
					"data-virtual-key": item.key,
					"data-virtual-index": item.index,
					ref: virtual.measureElement,
					style: {
						position: "absolute",
						top: 0,
						left: 0,
						width: "100%",
						transform: `translateY(${item.start - origin}px)`,
					},
				},
				renderRow(rows[item.index]),
			),
		)}
	</div>`;
}
