import { useEffect, useState } from "react";
import { isRecord } from "@pakka/protocol/extensions";

export type TeamMode = "Graph" | "Activity" | "Agents";
export interface Position {
	readonly x: number;
	readonly y: number;
}
export interface TeamPresentation {
	readonly mode: TeamMode;
	readonly selected: string | null;
	readonly query: string;
	readonly phase: string;
	readonly zoom: number;
	readonly creation: boolean;
	readonly communication: boolean;
	readonly hidden: readonly string[];
	readonly positions: Readonly<Record<string, Position>>;
}
const initial: TeamPresentation = {
	mode: "Graph",
	selected: null,
	query: "",
	phase: "all",
	zoom: 1,
	creation: true,
	communication: true,
	hidden: [],
	positions: {},
};
function restore(key: string): TeamPresentation {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
		if (!isRecord(value)) return initial;
		const positions: Record<string, Position> = {};
		if (isRecord(value.positions))
			for (const [name, point] of Object.entries(value.positions).slice(0, 128)) {
				if (
					name.length <= 512 &&
					isRecord(point) &&
					typeof point.x === "number" &&
					Number.isFinite(point.x) &&
					point.x >= 0 &&
					point.x <= 12000 &&
					typeof point.y === "number" &&
					Number.isFinite(point.y) &&
					point.y >= 0 &&
					point.y <= 12000
				)
					positions[name] = { x: point.x, y: point.y };
			}
		return {
			mode: value.mode === "Activity" || value.mode === "Agents" ? value.mode : "Graph",
			selected: typeof value.selected === "string" && value.selected.length <= 512 ? value.selected : null,
			query: typeof value.query === "string" ? value.query.slice(0, 160) : "",
			phase: typeof value.phase === "string" ? value.phase : "all",
			zoom: typeof value.zoom === "number" && value.zoom >= 0.5 && value.zoom <= 1.5 ? value.zoom : 1,
			creation: value.creation !== false,
			communication: value.communication !== false,
			hidden: Array.isArray(value.hidden)
				? value.hidden
						.filter((item): item is string => typeof item === "string" && item.length <= 512)
						.slice(0, 128)
				: [],
			positions,
		};
	} catch {
		return initial;
	}
}
export function usePresentation(key: string) {
	const [view, setView] = useState(() => restore(key));
	const [warning, setWarning] = useState<string | null>(null);
	useEffect(() => {
		try {
			localStorage.setItem(key, JSON.stringify(view));
			setWarning(null);
		} catch {
			setWarning("个人视图暂时无法保存在此浏览器，当前页面仍可使用。");
		}
	}, [key, view]);
	return {
		view,
		warning,
		update: (change: Partial<TeamPresentation>) => setView((previous) => ({ ...previous, ...change })),
	};
}
export function useCompact() {
	const [compact, setCompact] = useState(() => matchMedia("(max-width: 800px)").matches);
	useEffect(() => {
		const query = matchMedia("(max-width: 800px)"),
			changed = () => setCompact(query.matches);
		query.addEventListener("change", changed);
		return () => query.removeEventListener("change", changed);
	}, []);
	return compact;
}
