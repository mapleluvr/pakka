import { Fragment, h, type TargetedKeyboardEvent, type TargetedPointerEvent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "@pakka/webui/components";
import type { WebInterfaceProps } from "@pakka/webui/ui";
import {
	readActivities,
	readBoard,
	readHistory,
	type WorkbenchActivity,
	type WorkbenchHistoryItem,
	type WorkbenchHistoryQuery,
	type WorkbenchMember,
	type WorkbenchView,
} from "./client.ts";

type Position = { x: number; y: number };
type Edge = WorkbenchView["connections"][number];
const moveOffsets: Readonly<Record<string, readonly [number, number]>> = {
	ArrowLeft: [-20, 0],
	ArrowRight: [20, 0],
	ArrowUp: [0, -20],
	ArrowDown: [0, 20],
};
const viewPrefix = "pakka.mas-board.view.v2";
const resourceKey = (ref: WorkbenchMember["ref"]) => JSON.stringify([ref.sessionId, ref.conversationId]);
const stylesheet = (handlers: { onLoad: () => void; onError: () => void }) =>
	h("link", { rel: "stylesheet", href: new URL("board.css", import.meta.url).href, ...handlers });
const storedString = (key: string, fallback: string) => {
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
};
const storedZoom = (viewKey: string) => {
	const value = Number(storedString(`${viewKey}.zoom`, "1"));
	return Number.isFinite(value) ? Math.max(0.55, Math.min(1.5, value)) : 1;
};
const membershipLabel = (phase: WorkbenchMember["phase"] | "all") =>
	({
		all: "All",
		preparing: "Preparing",
		ready: "Ready to activate",
		active: "Available",
		stopping: "Stopping",
		retired: "Retired",
		failed: "Unavailable",
		unknown: "Unknown",
		ended: "Ended",
	})[phase];
const tone = (phase: WorkbenchMember["phase"]) =>
	phase === "active"
		? "available"
		: phase === "failed"
			? "failed"
			: ["ready", "preparing", "stopping", "unknown"].includes(phase)
				? "waiting"
				: "stopped";
const activityText = (activity: WorkbenchActivity | undefined, phase: WorkbenchMember["phase"]) => {
	if (!activity) return "Loading activity…";
	if (activity.state === "waiting") return "Waiting for Model Response";
	if (activity.state === "thinking") return `Thinking... ${activity.preview}`;
	if (activity.state === "tool")
		return `Tool using ${activity.tool ?? "tool"}${activity.preview ? ` · ${activity.preview}` : ""}`;
	if (activity.state === "reply") return activity.preview;
	if (activity.state === "error")
		return activity.code
			? `HTTP ${activity.code}${activity.detail ? ` · ${activity.detail}` : ""}`
			: `Error${activity.detail ? ` · ${activity.detail}` : " · Request failed"}`;
	if (activity.state === "crashed") return "Conversation crashed";
	if (activity.state === "idle") return activity.preview || "No activity yet";
	return membershipLabel(phase);
};
function EdgeShape({
	edge,
	from,
	to,
	selected,
	label,
	onActivate,
}: {
	edge: Edge;
	from: Position;
	to: Position;
	selected: boolean;
	label: string;
	onActivate: () => void;
}) {
	const x1 = from.x + 224,
		y1 = from.y + 64,
		x2 = to.x,
		y2 = to.y + 64;
	const labelX = (x1 + x2) / 2,
		labelY = (y1 + y2) / 2 - 42;
	const d =
		edge.kind === "creation"
			? `M${x1} ${y1} H${labelX} V${y2} H${x2}`
			: `M${x1} ${y1} C${x1 + 60} ${y1 - 56},${x2 - 60} ${y2 - 56},${x2} ${y2}`;
	return h(
		"g",
		{ class: `graph-edge ${edge.kind} ${selected ? "selected" : ""}`, "data-connection": edge.id },
		h("path", { d, class: "edge-line", "aria-hidden": true }),
		h("path", {
			d,
			class: "edge-hit",
			role: "button",
			tabindex: 0,
			"aria-label": label,
			onClick: onActivate,
			onKeyDown: (event: TargetedKeyboardEvent<SVGPathElement>) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onActivate();
				}
			},
		}),
		edge.kind === "communication" &&
			h(
				"foreignObject",
				{ x: labelX - 22, y: labelY - 22, width: 44, height: 44 },
				h(
					"button",
					{ class: "edge-count-button", "aria-label": label, onClick: onActivate },
					String(edge.count),
				),
			),
	);
}
type NodeMotion = {
	onPointerDown(event: TargetedPointerEvent<HTMLButtonElement>): void;
	onPointerMove(event: TargetedPointerEvent<HTMLButtonElement>): void;
	onPointerUp(event: TargetedPointerEvent<HTMLButtonElement>): void;
	onKeyDown(event: TargetedKeyboardEvent<HTMLButtonElement>): void;
};
function AgentCard({
	member,
	activity,
	selected,
	onSelect,
	motion,
}: {
	member: WorkbenchMember & { readonly position: Position };
	activity?: WorkbenchActivity;
	selected: boolean;
	onSelect: () => void;
	motion?: NodeMotion;
}) {
	const text = activityText(activity, member.phase);
	return h(
		"article",
		{
			class: `graph-agent ${tone(member.phase)} ${selected ? "selected" : ""}`,
			style: { left: `${member.position.x}px`, top: `${member.position.y}px` },
			"data-agent": member.key,
		},
		h(
			"button",
			{
				class: "graph-agent-open",
				"data-member": member.key,
				"aria-label": `${member.key}, ${membershipLabel(member.phase)}, ${text}`,
				"aria-pressed": selected,
				onClick: onSelect,
			},
			h(
				"span",
				{ class: "graph-agent-title" },
				h(Icon, { name: "conversation" }),
				h("strong", null, member.key),
			),
			h(
				"span",
				{ class: "graph-agent-meta" },
				h("span", { class: "membership-dot", "aria-hidden": true }),
				membershipLabel(member.phase),
			),
			h(
				"span",
				{
					class: `graph-agent-activity ${activity?.state ?? "loading"}`,
					"data-activity-state": activity?.state ?? "loading",
					title: activity?.detail ?? text,
				},
				text,
			),
		),
		motion &&
			h(
				"button",
				{
					class: "graph-node-move",
					"data-agent-move": member.key,
					"aria-label": `Move ${member.key}; use arrow keys to adjust position`,
					...motion,
					onPointerCancel: motion.onPointerUp,
				},
				h(Icon, { name: "move" }),
			),
	);
}

/** Relationship and exchange projections are read-only; member controls remain in MemberPanel. */
export function GraphBoard({ context }: WebInterfaceProps) {
	const [snapshot, setSnapshot] = useState<WorkbenchView | null>(null);
	const [styleState, setStyleState] = useState<"loading" | "ready" | "failed">("loading");
	useEffect(
		() => context.subscribe("view", {}, (value) => setSnapshot(readBoard(value)), { intervalMs: 700 }),
		[context],
	);
	// Keep the same link mounted across snapshot/loading transitions. Mounting
	// controls first can move them between pointer measurement and native press.
	const styleLink = stylesheet({
		onLoad: () => setStyleState("ready"),
		onError: () => setStyleState("failed"),
	});
	if (styleState === "failed")
		return h(
			Fragment,
			null,
			styleLink,
			h("p", { role: "alert" }, "Team appearance could not load. Refresh to try again."),
		);
	if (styleState !== "ready")
		return h(Fragment, null, styleLink, h("p", { role: "status" }, "Loading team appearance…"));
	if (!snapshot) return h(Fragment, null, styleLink, h("p", { role: "status" }, "Loading team…"));
	const viewKey = `${viewPrefix}:${JSON.stringify([context.extension, context.person.id, snapshot.sessionId])}`;
	return h(Fragment, null, styleLink, h(GraphView, { key: viewKey, viewKey, context, snapshot }));
}

function GraphView({
	context,
	snapshot,
	viewKey,
}: WebInterfaceProps & { snapshot: WorkbenchView; viewKey: string }) {
	const [mode, setMode] = useState(() =>
		storedString(`${viewKey}.mode`, "canvas") === "list" ? "list" : "canvas",
	);
	const [savedPositions, setSavedPositions] = useState<Record<string, Position>>(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(`${viewKey}.positions`) ?? "{}");
			return Object.fromEntries(
				Object.entries(saved).filter((entry): entry is [string, Position] => {
					const point = entry[1] as Position;
					return (
						!!point &&
						Number.isFinite(point.x) &&
						Number.isFinite(point.y) &&
						point.x >= 0 &&
						point.y >= 0 &&
						point.x <= 10000 &&
						point.y <= 10000
					);
				}),
			);
		} catch {
			return {};
		}
	});
	const moving = useRef<{ key: string; x: number; y: number; point: Position } | null>(null);
	const historyEpoch = useRef(0);
	const [historyBusy, setHistoryBusy] = useState(false);
	const [historyProblem, setHistoryProblem] = useState("");
	const [hiddenMembers, setHiddenMembers] = useState<ReadonlySet<string>>(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(`${viewKey}.hiddenMembers`) ?? "[]");
			return new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === "string") : []);
		} catch {
			return new Set();
		}
	});
	const [hiddenAgents, setHiddenAgents] = useState<ReadonlySet<string>>(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(`${viewKey}.hiddenAgents`) ?? "[]");
			return new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === "string") : []);
		} catch {
			return new Set();
		}
	});
	const [activities, setActivities] = useState<ReadonlyMap<string, WorkbenchActivity>>(new Map());
	const [screen, setScreen] = useState<"relationships" | "history">(() =>
		storedString(`${viewKey}.screen`, "relationships") === "history" ? "history" : "relationships",
	);
	const [query, setQuery] = useState(() => storedString(`${viewKey}.query`, ""));
	const [phase, setPhase] = useState(() => storedString(`${viewKey}.phase`, "all"));
	const [zoom, setZoom] = useState(() => storedZoom(viewKey));
	const scrollArea = useRef<HTMLDivElement>(null);
	const optionsRoot = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		const outside = (event: PointerEvent) => {
			const menu = optionsRoot.current;
			if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
		};
		window.addEventListener("pointerdown", outside, true);
		return () => window.removeEventListener("pointerdown", outside, true);
	}, []);
	const pan = useRef<{
		readonly pointerId: number;
		readonly x: number;
		readonly y: number;
		readonly left: number;
		readonly top: number;
	} | null>(null);
	const [panning, setPanning] = useState(false);
	const [visibleRelations, setVisibleRelations] = useState<ReadonlySet<Edge["kind"]>>(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(`${viewKey}.layers`) ?? '["creation","communication"]');
			return new Set<Edge["kind"]>(
				Array.isArray(saved)
					? saved.filter((x): x is Edge["kind"] => x === "creation" || x === "communication")
					: ["creation", "communication"],
			);
		} catch {
			return new Set<Edge["kind"]>(["creation", "communication"]);
		}
	});
	const [selected, setSelected] = useState<string | null>(() => {
		try {
			return localStorage.getItem(`${viewKey}.selected`);
		} catch {
			return null;
		}
	});
	const [selectedEdge, setSelectedEdge] = useState<string | null>(() => {
		try {
			return localStorage.getItem(`${viewKey}.edge`);
		} catch {
			return null;
		}
	});
	const [history, setHistory] = useState<readonly WorkbenchHistoryItem[]>([]);
	const [cursor, setCursor] = useState<string | undefined>();
	const [historyQuery, setHistoryQuery] = useState<WorkbenchHistoryQuery>({ limit: 32 });
	const [hidden, setHidden] = useState<ReadonlySet<string>>(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(viewKey) ?? "[]");
			return new Set(Array.isArray(saved) ? saved.filter((x) => typeof x === "string") : []);
		} catch {
			return new Set();
		}
	});
	const members = snapshot.members;
	const refSignature = JSON.stringify(members.map((member) => member.ref));
	useEffect(() => {
		if (!members.length) {
			setActivities(new Map());
			return;
		}
		return context.subscribe(
			"activities",
			{
				refs: members.map(({ ref }) => ({
					key: ref.key,
					sessionId: ref.sessionId,
					conversationId: ref.conversationId,
					incarnation: ref.incarnation,
					profile: ref.profile,
				})),
			},
			(value) => setActivities(new Map(readActivities(value).map((row) => [resourceKey(row.ref), row]))),
			{ intervalMs: 700 },
		);
	}, [context, refSignature]);
	useEffect(() => {
		try {
			localStorage.setItem(`${viewKey}.positions`, JSON.stringify(savedPositions));
			localStorage.setItem(`${viewKey}.hiddenMembers`, JSON.stringify([...hiddenMembers]));
			localStorage.setItem(`${viewKey}.hiddenAgents`, JSON.stringify([...hiddenAgents]));
			localStorage.setItem(`${viewKey}.mode`, mode);
		} catch {
			/* Personal presentation is independent of runtime work. */
		}
	}, [savedPositions, hiddenMembers, hiddenAgents, mode]);
	useEffect(() => {
		try {
			localStorage.setItem(viewKey, JSON.stringify([...hidden]));
		} catch {
			/* View preference storage is optional. */
		}
	}, [hidden]);
	useEffect(() => {
		try {
			if (selected) localStorage.setItem(`${viewKey}.selected`, selected);
			else localStorage.removeItem(`${viewKey}.selected`);
			if (selectedEdge) localStorage.setItem(`${viewKey}.edge`, selectedEdge);
			else localStorage.removeItem(`${viewKey}.edge`);
		} catch {
			/* View preference storage is optional. */
		}
	}, [selected, selectedEdge]);
	useEffect(() => {
		try {
			localStorage.setItem(`${viewKey}.screen`, screen);
			localStorage.setItem(`${viewKey}.phase`, phase);
			localStorage.setItem(`${viewKey}.query`, query);
			localStorage.setItem(`${viewKey}.zoom`, String(zoom));
			localStorage.setItem(`${viewKey}.layers`, JSON.stringify([...visibleRelations]));
		} catch {
			/* View preference storage is optional. */
		}
	}, [screen, phase, query, zoom, visibleRelations]);
	useEffect(() => {
		if (screen !== "relationships" || !snapshot || !scrollArea.current) return;
		try {
			const saved = JSON.parse(localStorage.getItem(`${viewKey}.scroll`) ?? "[0,0]");
			if (Array.isArray(saved) && saved.length === 2) {
				scrollArea.current.scrollLeft = Number(saved[0]) || 0;
				scrollArea.current.scrollTop = Number(saved[1]) || 0;
			}
		} catch {
			/* Invalid local view state starts at the origin. */
		}
	}, [screen, members.length]);
	const byKey = useMemo(() => new Map(members.map((member) => [member.key, member])), [snapshot]);
	const visibleMembers = members.filter(
		(member) =>
			!hiddenAgents.has(resourceKey(member.ref)) &&
			(phase === "all" || member.phase === phase) &&
			[member.key, member.parent, member.phase, member.lifetime]
				.join(" ")
				.toLocaleLowerCase()
				.includes(query.toLocaleLowerCase()),
	);
	const depth = (member: WorkbenchMember, path = new Set<string>()): number => {
		if (!member.creator || !byKey.has(member.creator) || path.has(member.key) || path.size >= 16) return 0;
		path.add(member.key);
		return 1 + depth(byKey.get(member.creator)!, path);
	};
	const membersByDepth = new Map<number, WorkbenchMember[]>();
	for (const member of visibleMembers) {
		const level = depth(member),
			rows = membersByDepth.get(level) ?? [];
		rows.push(member);
		membersByDepth.set(level, rows);
	}
	for (const rows of membersByDepth.values())
		rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.key.localeCompare(b.key));
	const positions = new Map<string, Position>();
	for (const [column, rows] of membersByDepth)
		rows.forEach((member, row) =>
			positions.set(
				member.key,
				savedPositions[resourceKey(member.ref)] ?? { x: 28 + column * 300, y: 28 + row * 210 },
			),
		);
	const moveAgent = (member: WorkbenchMember, point: Position) =>
		setSavedPositions((current) => ({
			...current,
			[resourceKey(member.ref)]: {
				x: Math.max(8, Math.min(10000, Math.round(point.x))),
				y: Math.max(8, Math.min(10000, Math.round(point.y))),
			},
		}));
	const nodeMotion = (member: WorkbenchMember): NodeMotion => ({
		onPointerDown(event) {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			moving.current = {
				key: member.key,
				x: event.clientX,
				y: event.clientY,
				point: positions.get(member.key)!,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		onPointerMove(event) {
			const drag = moving.current;
			if (drag?.key === member.key)
				moveAgent(member, {
					x: drag.point.x + (event.clientX - drag.x) / zoom,
					y: drag.point.y + (event.clientY - drag.y) / zoom,
				});
		},
		onPointerUp(event) {
			moving.current = null;
			if (event.currentTarget.hasPointerCapture(event.pointerId))
				event.currentTarget.releasePointerCapture(event.pointerId);
		},
		onKeyDown(event) {
			const point = positions.get(member.key)!;
			const offset = moveOffsets[event.key];
			if (!offset) return;
			event.preventDefault();
			moveAgent(member, { x: point.x + offset[0]!, y: point.y + offset[1]! });
		},
	});
	const positioned = visibleMembers.map((member) => ({ ...member, position: positions.get(member.key)! }));
	const width = Math.max(620, ...[...positions.values()].map((point) => point.x + 290));
	const height = Math.max(260, ...[...positions.values()].map((point) => point.y + 220));
	const edges = (snapshot?.connections ?? []).filter(
		(edge) => positions.has(edge.from) && positions.has(edge.to),
	);
	const edgeId = (edge: Edge) => edge.id;
	const isHidden = (edge: Edge) =>
		hidden.has(edge.id) ||
		(edge.kind === "communication" &&
			[edge.from, edge.to].some((key) => {
				const member = byKey.get(key);
				return member && hiddenMembers.has(resourceKey(member.ref));
			}));
	const hiddenCount = (snapshot?.connections ?? []).filter(isHidden).length;
	const shownEdges = edges.filter((edge) => !isHidden(edge) && visibleRelations.has(edge.kind));
	const hiddenAgentCount = members.filter((member) => hiddenAgents.has(resourceKey(member.ref))).length;
	const selectedMember = selected ? visibleMembers.find((member) => member.key === selected) : undefined;
	const selectedConnection = selectedEdge ? edges.find((edge) => edge.id === selectedEdge) : undefined;
	const loadHistory = async (filter: WorkbenchHistoryQuery, next?: string, append = false) => {
		const epoch = ++historyEpoch.current;
		setHistoryBusy(true);
		setHistoryProblem("");
		if (!append) {
			setHistory([]);
			setCursor(undefined);
		}
		try {
			const result = await context.call("history", { ...filter, ...(next ? { cursor: next } : {}) });
			if (context.signal.aborted || historyEpoch.current !== epoch) return;
			if (result.state !== "done") throw Error("Exchange observation is unavailable.");
			const page = readHistory(result.value);
			setHistory((prior) => (append ? [...prior, ...page.items] : page.items));
			setCursor(page.nextCursor);
		} catch {
			if (!context.signal.aborted && historyEpoch.current === epoch) {
				setCursor(undefined);
				setHistory([]);
				setHistoryProblem("Exchange records are unavailable. Refresh to check current access.");
			}
		} finally {
			if (!context.signal.aborted && historyEpoch.current === epoch) setHistoryBusy(false);
		}
	};
	useEffect(() => {
		if (screen === "history") void loadHistory(historyQuery);
		return () => {
			historyEpoch.current++;
		};
	}, [context, screen, JSON.stringify(historyQuery)]);
	const openConversation = (member: WorkbenchMember) => context.navigate(member.ref);
	const filterPair = (edge: Edge) => {
		setHistoryQuery({ limit: 32, from: edge.from, to: edge.to });
		setSelectedEdge(edge.id);
		setScreen("history");
	};
	const hideMember = (key: string) => {
		const member = byKey.get(key);
		if (member) setHiddenMembers(new Set([...hiddenMembers, resourceKey(member.ref)]));
	};
	const beginPan = (event: TargetedPointerEvent<HTMLDivElement>) => {
		if (
			event.pointerType !== "mouse" ||
			event.button !== 0 ||
			(event.target as Element).closest(
				"button,a,input,select,textarea,.graph-agent,.graph-edge,[role=button]",
			)
		)
			return;
		const target = event.currentTarget;
		pan.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			left: target.scrollLeft,
			top: target.scrollTop,
		};
		target.setPointerCapture(event.pointerId);
		setPanning(true);
	};
	const movePan = (event: TargetedPointerEvent<HTMLDivElement>) => {
		if (pan.current?.pointerId !== event.pointerId) return;
		event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
		event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y);
	};
	const endPan = (event: TargetedPointerEvent<HTMLDivElement>) => {
		if (pan.current?.pointerId !== event.pointerId) return;
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
		pan.current = null;
		setPanning(false);
	};
	const searchControl = h(
		"label",
		{ class: "board-search" },
		h("input", {
			"aria-label": "Find an Agent",
			value: query,
			placeholder: "Find an Agent",
			onInput: (event: InputEvent) => setQuery((event.currentTarget as HTMLInputElement).value),
		}),
	);
	const heading = h(
		"div",
		{ class: "board-title" },
		h("h1", null, "Team"),
		h("span", { class: "board-sub", title: snapshot.namespace }, snapshot.namespace),
	);
	const tabs = h(
		"nav",
		{ class: "board-tabs segmented", "aria-label": "MAS views" },
		h(
			"button",
			{
				"data-board-tab": "relationships",
				"data-board-mode": "canvas",
				"aria-pressed": screen === "relationships" && mode === "canvas",
				onClick: () => {
					setScreen("relationships");
					setMode("canvas");
				},
			},
			"Graph",
		),
		h(
			"button",
			{
				"data-board-tab": "history",
				"aria-pressed": screen === "history",
				onClick: () => setScreen("history"),
			},
			"Activity",
		),
		h(
			"button",
			{
				"data-board-mode": "list",
				"aria-pressed": screen === "relationships" && mode === "list",
				onClick: () => {
					setScreen("relationships");
					setMode("list");
				},
			},
			"Agents",
		),
	);
	const graphToolbar = h(
		"div",
		{ class: "graph-toolbar" },
		searchControl,
		h(
			"div",
			{ class: "graph-filters", role: "group", "aria-label": "Membership filter" },
			(["all", ...new Set(members.map((member) => member.phase))] as string[]).map((value) =>
				h(
					"button",
					{
						class: phase === value ? "on" : "",
						"aria-pressed": phase === value,
						onClick: () => setPhase(value),
					},
					`${membershipLabel(value as WorkbenchMember["phase"] | "all")} ${value === "all" ? members.length : members.filter((member) => member.phase === value).length}`,
				),
			),
		),
		snapshot?.connectionsTruncated &&
			h(
				"p",
				{ class: "graph-scope", role: "status" },
				"The canvas shows a bounded set of relationships. The exchange log can load older records.",
			),
		h(
			"div",
			{ class: "graph-relations", role: "group", "aria-label": "Relationship layers" },
			(["creation", "communication"] as const).map((kind) =>
				h(
					"button",
					{
						"data-board-layer": kind,
						class: visibleRelations.has(kind) ? "on" : "",
						"aria-pressed": visibleRelations.has(kind),
						onClick: () =>
							setVisibleRelations((current) => {
								const next = new Set(current);
								if (next.has(kind)) next.delete(kind);
								else next.add(kind);
								return next;
							}),
					},
					kind === "creation" ? "Creation links" : "Communication links",
				),
			),
		),
		h(
			"div",
			{ class: "graph-zoom", role: "group", "aria-label": "Canvas zoom" },
			h(
				"button",
				{
					"data-canvas-zoom": "out",
					"aria-label": "Zoom out",
					title: "Zoom out",
					disabled: zoom <= 0.55,
					onClick: () => setZoom((value) => Math.max(0.55, Math.round((value - 0.1) * 100) / 100)),
				},
				h(Icon, { name: "minus" }),
			),
			h("output", { "aria-live": "polite" }, `${Math.round(zoom * 100)}%`),
			h(
				"button",
				{
					"data-canvas-zoom": "in",
					"aria-label": "Zoom in",
					title: "Zoom in",
					disabled: zoom >= 1.5,
					onClick: () => setZoom((value) => Math.min(1.5, Math.round((value + 0.1) * 100) / 100)),
				},
				h(Icon, { name: "plus" }),
			),
			h("button", { onClick: () => setZoom(1) }, "Reset zoom"),
		),
		h(
			"button",
			{
				"data-show-hidden-links": true,
				disabled: !hiddenCount,
				onClick: () => {
					setHidden(new Set());
					setHiddenMembers(new Set());
				},
			},
			`Show hidden links (${hiddenCount})`,
		),
		h(
			"button",
			{
				"data-show-hidden-agents": true,
				disabled: !hiddenAgentCount,
				onClick: () => setHiddenAgents(new Set()),
			},
			`Show hidden Agents (${hiddenAgentCount})`,
		),
	);
	const canvas = !snapshot
		? h("p", { class: "board-empty" }, "Loading team…")
		: visibleMembers.length === 0
			? h("p", { class: "board-empty" }, "No visible Agents match this filter.")
			: h(
					"div",
					{
						class: `graph-scroll ${panning ? "panning" : ""}`,
						ref: scrollArea,
						"aria-label": "Agent relationship canvas",
						onPointerDown: beginPan,
						onPointerMove: movePan,
						onPointerUp: endPan,
						onPointerCancel: endPan,
						onScroll: (event: Event) => {
							try {
								const target = event.currentTarget as HTMLDivElement;
								localStorage.setItem(
									`${viewKey}.scroll`,
									JSON.stringify([target.scrollLeft, target.scrollTop]),
								);
							} catch {
								/* View preference storage is optional. */
							}
						},
					},
					h(
						"div",
						{
							class: "graph-canvas-frame",
							style: { width: `${width * zoom}px`, height: `${height * zoom}px` },
						},
						h(
							"div",
							{
								class: "graph-canvas",
								style: { width: `${width}px`, height: `${height}px`, transform: `scale(${zoom})` },
							},
							h(
								"svg",
								{ class: "graph-edges", width, height, "aria-label": "Agent relationships" },
								h(
									"defs",
									null,
									h(
										"marker",
										{
											id: "mas-board-arrow",
											markerWidth: 7,
											markerHeight: 7,
											refX: 6,
											refY: 3.5,
											orient: "auto",
										},
										h("path", {
											d: "M0 0L7 3.5L0 7",
											fill: "none",
											stroke: "context-stroke",
											"stroke-width": 1.5,
										}),
									),
								),
								shownEdges.map((edge) =>
									h(EdgeShape, {
										key: edgeId(edge),
										edge,
										from: positions.get(edge.from)!,
										to: positions.get(edge.to)!,
										selected: selectedEdge === edgeId(edge),
										label: `${byKey.get(edge.from)?.key ?? edge.from} ${edge.kind === "creation" ? "created" : "communicated with"} ${byKey.get(edge.to)?.key ?? edge.to}; ${edge.count} ${edge.kind === "creation" ? "relationships" : "messages"}`,
										onActivate: () =>
											edge.kind === "communication" ? filterPair(edge) : setSelectedEdge(edgeId(edge)),
									}),
								),
							),
							positioned.map((member) =>
								h(AgentCard, {
									key: member.key,
									member,
									activity: activities.get(resourceKey(member.ref)),
									motion: nodeMotion(member),
									selected: selected === member.key,
									onSelect: () => {
										setSelected(member.key);
										setSelectedEdge(null);
									},
								}),
							),
						),
					),
				);
	const clearSelection = () => {
		setSelected(null);
		setSelectedEdge(null);
	};
	const selection = selectedMember
		? h(
				"aside",
				{
					class: "graph-selection",
					"aria-label": `${selectedMember.key} selected`,
					onKeyDown: (event: TargetedKeyboardEvent<HTMLElement>) => {
						if (event.key === "Escape") {
							event.stopPropagation();
							clearSelection();
							document
								.querySelector<HTMLButtonElement>(`[data-member="${CSS.escape(selectedMember.key)}"]`)
								?.focus();
						}
					},
				},
				h(
					"div",
					{ class: "graph-selection-title" },
					h("strong", null, selectedMember.key),
					h(
						"button",
						{ class: "icon-btn", onClick: clearSelection, "aria-label": "Close selection" },
						h(Icon, { name: "close" }),
					),
				),
				h("span", { class: "member-phase" }, membershipLabel(selectedMember.phase)),
				h(
					"button",
					{
						class: "member-open pill-btn",
						"data-open-conversation": selectedMember.key,
						onClick: () => openConversation(selectedMember),
					},
					"Open Conversation",
				),
				h("h3", null, "Latest activity"),
				h(
					"p",
					{ class: "member-latest" },
					activityText(activities.get(resourceKey(selectedMember.ref)), selectedMember.phase),
				),
				h(
					"dl",
					{ class: "graph-provenance" },
					h("dt", null, "Created by"),
					h("dd", null, selectedMember.creator ?? (selectedMember.creationKnown ? "Host" : "Not recorded")),
					h("dt", null, "Managed by"),
					h(
						"dd",
						null,
						selectedMember.parent ?? (selectedMember.owner === context.person.id ? "You" : "Not visible"),
					),
					selectedMember.forkSource && [
						h("dt", null, "History from"),
						h("dd", null, selectedMember.forkSource),
					],
				),
				h(
					"details",
					{ class: "member-options" },
					h("summary", { "data-agent-details": true }, "More"),
					h(
						"div",
						{ class: "member-option-items" },
						h(
							"button",
							{
								"data-agent-controls": selectedMember.key,
								onClick: () => context.open("member", { target: selectedMember.ref }),
							},
							"Member controls…",
						),
						h(
							"button",
							{ "data-hide-member-links": selectedMember.key, onClick: () => hideMember(selectedMember.key) },
							"Hide communication links",
						),
						selectedMember.phase === "retired" &&
							h(
								"button",
								{
									"data-hide-agent": selectedMember.key,
									onClick: () => {
										setHiddenAgents(new Set([...hiddenAgents, resourceKey(selectedMember.ref)]));
										clearSelection();
									},
								},
								"Hide from Board",
							),
					),
				),
			)
		: selectedConnection && screen === "relationships"
			? h(
					"aside",
					{ class: "graph-selection", "aria-label": "Connection selected" },
					h(
						"div",
						{ class: "graph-selection-title" },
						h(
							"strong",
							null,
							selectedConnection.kind === "creation" ? "Creation link" : "Communication link",
						),
						h(
							"button",
							{ class: "icon-btn", onClick: clearSelection, "aria-label": "Close selection" },
							h(Icon, { name: "close" }),
						),
					),
					h("p", null, `${selectedConnection.from} → ${selectedConnection.to}`),
					h(
						"button",
						{
							"data-hide-connection": selectedConnection.id,
							onClick: () => setHidden(new Set([...hidden, selectedConnection.id])),
						},
						"Hide this link",
					),
					selectedConnection.kind === "communication" &&
						h("button", { onClick: () => filterPair(selectedConnection) }, "View activity"),
				)
			: null;
	const memberList = h(
		"ul",
		{ class: "graph-agent-list", "aria-label": "Agent list" },
		positioned.map((member) =>
			h(
				"li",
				{ key: resourceKey(member.ref) },
				h(AgentCard, {
					member,
					activity: activities.get(resourceKey(member.ref)),
					selected: selected === member.key,
					onSelect: () => {
						setSelected(member.key);
						setSelectedEdge(null);
					},
				}),
			),
		),
	);
	const viewOptions = h(
		"details",
		{
			class: "graph-view-options",
			ref: optionsRoot,
			onKeyDown: (event: KeyboardEvent) => {
				if (event.key !== "Escape" || !optionsRoot.current?.open) return;
				event.preventDefault();
				event.stopPropagation();
				optionsRoot.current.open = false;
				optionsRoot.current.querySelector<HTMLElement>("summary")?.focus();
			},
		},
		h(
			"summary",
			{ class: "icon-btn", "data-board-options": true, "aria-label": "View options", title: "View options" },
			h(Icon, { name: "menu" }),
		),
		h(
			"div",
			{ class: "board-options-menu" },
			graphToolbar,
			h(
				"button",
				{
					class: "layout-reset",
					"data-reset-layout": true,
					onClick: () => {
						setSavedPositions({});
						setZoom(1);
					},
				},
				"Reset layout",
			),
		),
	);
	const relationshipScreen = h(
		"div",
		{ class: "graph-layout" },
		h("div", { class: "graph-stage" }, mode === "list" ? memberList : canvas),
		selection,
	);
	const historyFilter = (
		key: "from" | "to" | "mode" | "initiator" | "status",
		label: string,
		values: readonly (readonly [string, string])[],
	) =>
		h(
			"label",
			null,
			label,
			h(
				"select",
				{
					"aria-label": `Exchange ${label.toLowerCase()}`,
					value: historyQuery[key] ?? "",
					onChange: (event: Event) => {
						const value = (event.currentTarget as HTMLSelectElement).value;
						setHistoryQuery((current) => {
							const next = { ...current, limit: 32 };
							delete next[key];
							return value ? { ...next, [key]: value } : next;
						});
					},
				},
				h("option", { value: "" }, "All"),
				values.map(([value, text]) => h("option", { value, key: value }, text)),
			),
		);
	const memberChoices = members.map((member) => [member.key, member.key] as const);
	const historyFilters = h(
		"details",
		{ class: "graph-log-filters" },
		h("summary", null, "Exchange filters"),
		h(
			"div",
			{ class: "graph-log-filter-fields" },
			historyFilter("from", "From", memberChoices),
			historyFilter("to", "To", memberChoices),
			historyFilter("mode", "Mode", [
				["prompt", "Prompt"],
				["steer", "Steer"],
				["followUp", "Follow-up"],
			]),
			historyFilter("initiator", "Initiated by", [
				["human", "Human"],
				["agent", "Agent"],
				["service", "Service"],
				["unknown", "Not recorded"],
			]),
			historyFilter(
				"status",
				"Status",
				["queued", "placed", "done", "unanswered", "unknown"].map((value) => [value, value] as const),
			),
		),
	);
	const historyHeader = h(
		"header",
		{ class: "graph-history-head" },
		h(
			"label",
			null,
			"Agent",
			h(
				"select",
				{
					value: historyQuery.member ?? "",
					onChange: (event: Event) => {
						const value = (event.currentTarget as HTMLSelectElement).value;
						setHistoryQuery({ limit: 32, ...(value ? { member: value } : {}) });
						setSelectedEdge(null);
					},
				},
				h("option", { value: "" }, "All Agents"),
				members.map((member) => h("option", { key: member.key, value: member.key }, member.key)),
			),
		),
		h(
			"label",
			null,
			"Search",
			h("input", {
				"aria-label": "Search exchange messages",
				value: historyQuery.search ?? "",
				placeholder: "Search messages",
				onInput: (event: InputEvent) =>
					setHistoryQuery((current) => {
						const search = (event.currentTarget as HTMLInputElement).value.trim();
						const { search: _previous, ...rest } = current;
						return { ...rest, limit: 32, ...(search ? { search } : {}) };
					}),
			}),
		),
		h("button", { onClick: () => void loadHistory(historyQuery) }, "Refresh"),
		selectedConnection &&
			h(
				"button",
				{
					"data-hide-connection": selectedConnection.id,
					onClick: () => setHidden(new Set([...hidden, selectedConnection.id])),
				},
				"Hide this link",
			),
		selectedEdge &&
			h(
				"button",
				{
					onClick: () => {
						setSelectedEdge(null);
						setHistoryQuery({ limit: 32 });
					},
				},
				"All exchanges",
			),
	);
	const historyItems = history
		.filter((item) => byKey.has(item.to) && (!item.from || byKey.has(item.from)))
		.map((item, index) =>
			h(
				"li",
				{ key: `${item.receipt.id}-${index}` },
				h(
					"div",
					{ class: "graph-history-meta" },
					h("strong", null, item.from ?? "Unknown sender"),
					" → ",
					h("strong", null, byKey.get(item.to)?.key ?? "Unknown recipient"),
					h("time", null, item.at === null ? "Time unavailable" : new Date(item.at).toLocaleString()),
					h("span", null, `${item.mode} · ${item.receipt.status} · ${item.initiator}`),
					item.replyTo && h("span", null, `Reply to ${item.replyTo}`),
				),
				h("p", null, item.text),
				h(
					"div",
					{ class: "graph-history-actions" },
					item.from &&
						byKey.has(item.from) &&
						h("button", { onClick: () => openConversation(byKey.get(item.from!)!) }, "Open sender"),
					byKey.has(item.to) &&
						h("button", { onClick: () => openConversation(byKey.get(item.to)!) }, "Open recipient"),
				),
			),
		);
	const historyScreen = h(
		"section",
		{ class: "graph-history", "aria-label": "Agent exchange log" },
		historyHeader,
		historyFilters,
		h("ol", null, historyItems),
		historyProblem && h("p", { role: "status" }, historyProblem),
		historyBusy && h("p", { role: "status" }, "Loading exchange records…"),
		history.length === 0 &&
			!historyBusy &&
			!historyProblem &&
			h("p", { class: "board-empty" }, "No exchange records in this view."),
		cursor &&
			h(
				"button",
				{
					class: "history-more",
					disabled: historyBusy,
					onClick: () => void loadHistory(historyQuery, cursor, true),
				},
				"Load more exchanges",
			),
	);
	return h(
		"section",
		{ class: "board mas-board graph-board", "aria-label": "MAS team" },
		h("header", { class: "board-head" }, heading, tabs, viewOptions),
		screen === "relationships" ? relationshipScreen : historyScreen,
	);
}
