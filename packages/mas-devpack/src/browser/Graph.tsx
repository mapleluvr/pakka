import { useId, useRef, type PointerEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { WorkbenchActivity, WorkbenchConnection, WorkbenchMember } from "./client.ts";
import { phaseLabel, activityLabel } from "./MemberInspector.tsx";
import type { Position, TeamPresentation } from "./presentation.ts";
import { resourceKey } from "./service.ts";

const moveIcon = (
	<svg
		width="24"
		height="24"
		viewBox="0 0 24 24"
		stroke="currentColor"
		strokeWidth="1.5"
		fill="none"
		aria-hidden="true"
	>
		<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
	</svg>
);
const clamp = (value: number) => Math.max(24, Math.min(12000, value));
export function Graph({
	members,
	connections,
	activities,
	view,
	select,
	move,
	history,
}: {
	members: readonly WorkbenchMember[];
	connections: readonly WorkbenchConnection[];
	activities: readonly WorkbenchActivity[];
	view: TeamPresentation;
	select(member: WorkbenchMember, trigger: HTMLElement): void;
	move(key: string, point: Position): void;
	history(connection: WorkbenchConnection): void;
}) {
	const marker = useId().replaceAll(":", "");
	const drag = useRef<{ key: string; x: number; y: number; origin: Position } | null>(null);
	const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
	const area = useRef<HTMLDivElement>(null);
	const positions = new Map(
		members.map((member, index) => [
			member.key,
			view.positions[resourceKey(member.ref)] ?? {
				x: 36 + (index % 3) * 310,
				y: 36 + Math.floor(index / 3) * 220,
			},
		]),
	);
	const width = Math.max(760, ...[...positions.values()].map((point) => point.x + 310));
	const height = Math.max(460, ...[...positions.values()].map((point) => point.y + 220));
	const activityMap = new Map(activities.map((item) => [resourceKey(item.ref), item]));
	function startMove(event: PointerEvent<HTMLButtonElement>, member: WorkbenchMember, point: Position) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { key: resourceKey(member.ref), x: event.clientX, y: event.clientY, origin: point };
	}
	return (
		<div
			className="mas-graph-viewport"
			aria-label="成员关系图，可滚动"
			tabIndex={0}
			ref={area}
			onPointerDown={(event) => {
				if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				pan.current = {
					x: event.clientX,
					y: event.clientY,
					left: event.currentTarget.scrollLeft,
					top: event.currentTarget.scrollTop,
				};
			}}
			onPointerMove={(event) => {
				const value = pan.current;
				if (value) {
					event.currentTarget.scrollLeft = value.left - event.clientX + value.x;
					event.currentTarget.scrollTop = value.top - event.clientY + value.y;
				}
			}}
			onPointerUp={() => {
				pan.current = null;
			}}
			onPointerCancel={() => {
				pan.current = null;
			}}
		>
			<div style={{ width: width * view.zoom, height: height * view.zoom }}>
				<div className="mas-graph-canvas" style={{ width, height, transform: `scale(${view.zoom})` }}>
					<svg width={width} height={height} className="mas-graph-lines" aria-hidden="true">
						<defs>
							<marker
								id={marker}
								viewBox="0 0 10 10"
								refX="9"
								refY="5"
								markerWidth="7"
								markerHeight="7"
								orient="auto-start-reverse"
							>
								<path d="M1 1 9 5 1 9" fill="none" stroke="currentColor" />
							</marker>
						</defs>
						{connections.map((edge) => {
							const from = positions.get(edge.from),
								to = positions.get(edge.to);
							if (!from || !to) return null;
							const x1 = from.x + 260,
								y1 = from.y + 70,
								x2 = to.x,
								y2 = to.y + 70;
							return (
								<path
									key={edge.id}
									d={`M${x1},${y1} C${x1 + 65},${y1} ${x2 - 65},${y2} ${x2},${y2}`}
									fill="none"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeDasharray={edge.kind === "creation" ? "5 5" : undefined}
									markerEnd={`url(#${marker})`}
								/>
							);
						})}
					</svg>
					{connections.map((edge) => {
						const from = positions.get(edge.from),
							to = positions.get(edge.to);
						return from && to ? (
							<Button
								key={edge.id}
								label={`${edge.from} 至 ${edge.to} 的${edge.kind === "creation" ? "创建关系" : `${edge.count} 次通信`}`}
								className="mas-edge-count"
								style={{ left: (from.x + 260 + to.x) / 2 - 22, top: (from.y + to.y) / 2 + 48 }}
								onClick={() => history(edge)}
							>
								{edge.kind === "creation" ? "创建" : String(edge.count)}
							</Button>
						) : null;
					})}
					{members.map((member) => {
						const key = resourceKey(member.ref),
							point = positions.get(member.key)!,
							activity = activityMap.get(key);
						return (
							<div
								key={key}
								className="mas-node"
								data-selected={view.selected === key}
								style={{ left: point.x, top: point.y }}
							>
								<Button
									label={`查看成员 ${member.key}`}
									variant="ghost"
									className="mas-node-open"
									aria-pressed={view.selected === key}
									onClick={(event) => select(member, event.currentTarget)}
								>
									<span className="mas-stack">
										<strong>{member.key}</strong>
										<small>
											{phaseLabel[member.phase]} · {activity ? activityLabel[activity.state] : "读取中"}
										</small>
										<span className="mas-node-preview">
											{activity?.preview || member.reason || "暂无活动摘要"}
										</span>
									</span>
								</Button>
								<button
									type="button"
									className="mas-node-move"
									aria-label={`移动 ${member.key}，方向键可调整位置`}
									onPointerDown={(event) => startMove(event, member, point)}
									onPointerMove={(event) => {
										const value = drag.current;
										if (!value || value.key !== key) return;
										move(key, {
											x: clamp(value.origin.x + (event.clientX - value.x) / view.zoom),
											y: clamp(value.origin.y + (event.clientY - value.y) / view.zoom),
										});
									}}
									onPointerUp={(event) => {
										drag.current = null;
										event.currentTarget.releasePointerCapture(event.pointerId);
									}}
									onPointerCancel={() => {
										drag.current = null;
									}}
									onKeyDown={(event) => {
										const offsets: Record<string, Position> = {
												ArrowUp: { x: 0, y: -20 },
												ArrowDown: { x: 0, y: 20 },
												ArrowLeft: { x: -20, y: 0 },
												ArrowRight: { x: 20, y: 0 },
											},
											offset = offsets[event.key];
										if (offset) {
											event.preventDefault();
											move(key, { x: clamp(point.x + offset.x), y: clamp(point.y + offset.y) });
										}
									}}
								>
									{moveIcon}
								</button>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
