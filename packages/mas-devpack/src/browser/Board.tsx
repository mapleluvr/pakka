import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ActivityView } from "./ActivityView.tsx";
import { Graph } from "./Graph.tsx";
import { MemberInspector, phaseLabel, activityLabel } from "./MemberInspector.tsx";
import { useCompact, usePresentation } from "./presentation.ts";
import { resourceKey, useTeam, type TeamProps } from "./service.ts";
import type { WorkbenchActivity, WorkbenchHistoryQuery, WorkbenchMember, WorkbenchView } from "./client.ts";
import { memberPhases } from "./dto.ts";

/** The MAS package owns the workspace and member composition; the host only supplies instance and service bindings. */
export function Board(props: TeamProps) {
	const team = useTeam(props);
	return (
		<section className="mas-view mas-stack" aria-label="MAS Team">
			{team.error ? (
				<div className="mas-stack">
					<p role="alert">{team.error}</p>
					<Button label="重新读取 Team" onClick={team.refresh} />
				</div>
			) : !team.view ? (
				<p role="status">正在读取 Team…</p>
			) : (
				<TeamWorkspace
					key={JSON.stringify([
						props.bindings.personId,
						props.bindings.extensionId,
						team.view.sessionId,
						team.view.namespace,
					])}
					{...props}
					team={team.view}
					activities={team.activities}
					refresh={team.refresh}
				/>
			)}
		</section>
	);
}
function TeamWorkspace(
	props: TeamProps & { team: WorkbenchView; activities: readonly WorkbenchActivity[]; refresh(): void },
) {
	const { team, activities, refresh } = props;
	const key = JSON.stringify([
		"pakka-mas-view-v3",
		props.bindings.personId,
		props.bindings.extensionId,
		team.sessionId,
		team.namespace,
	]);
	const { view, warning, update } = usePresentation(key),
		compact = useCompact();
	const trigger = useRef<HTMLElement | null>(null),
		views = useRef<HTMLDivElement>(null);
	const [showInspector, setShowInspector] = useState(true),
		[history, setHistory] = useState<WorkbenchHistoryQuery>({});
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const element = views.current;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			const bounds = element.getBoundingClientRect();
			setVisible(bounds.width > 0 && bounds.height > 0);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const selected = team.members.find((member) => resourceKey(member.ref) === view.selected);
	useEffect(() => {
		if (!trigger.current?.isConnected) trigger.current = views.current;
	}, [selected?.key, compact]);
	useEffect(() => {
		if (!view.selected || selected) return;
		setShowInspector(false);
		update({ selected: null });
	}, [view.selected, !!selected]);
	function choose(member: WorkbenchMember, target?: HTMLElement) {
		trigger.current = target ?? views.current;
		update({ selected: resourceKey(member.ref) });
		setShowInspector(true);
	}
	function closeInspector() {
		if (!trigger.current?.isConnected) trigger.current = views.current;
		setShowInspector(false);
		trigger.current?.focus();
	}
	const members = team.members.filter(
		(member) =>
			!view.hidden.includes(resourceKey(member.ref)) &&
			(!view.query || member.key.toLocaleLowerCase().includes(view.query.toLocaleLowerCase())) &&
			(view.phase === "all" || member.phase === view.phase),
	);
	const connections = team.connections.filter((edge) =>
		edge.kind === "creation" ? view.creation : view.communication,
	);
	const activityMap = new Map(activities.map((item) => [resourceKey(item.ref), item]));
	const inspector =
		selected && showInspector ? (
			<MemberInspector
				key={resourceKey(selected.ref)}
				{...props}
				member={selected}
				members={team.members}
				activity={activityMap.get(resourceKey(selected.ref))}
				changed={refresh}
				close={closeInspector}
			/>
		) : null;
	return (
		<>
			<header className="mas-row mas-between mas-heading">
				<div>
					<h1>Team</h1>
					<p className="mas-muted">
						{team.namespace} · {team.members.length} 个获准成员
					</p>
				</div>
				<div className="mas-row">
					<Button label="刷新 Team" variant="ghost" onClick={refresh} />
					<DropdownMenu
						button={{ label: "View options" }}
						items={[
							{
								label: `${view.creation ? "隐藏" : "显示"}创建关系`,
								onClick: () => update({ creation: !view.creation }),
							},
							{
								label: `${view.communication ? "隐藏" : "显示"}通信关系`,
								onClick: () => update({ communication: !view.communication }),
							},
							{
								label: "隐藏所选成员",
								isDisabled: !selected,
								onClick: () => {
									if (selected) {
										update({ hidden: [...new Set([...view.hidden, resourceKey(selected.ref)])] });
										closeInspector();
									}
								},
							},
							{
								label: "显示所有隐藏成员",
								isDisabled: !view.hidden.length,
								onClick: () => update({ hidden: [] }),
							},
							{ label: "重置个人位置与缩放", onClick: () => update({ positions: {}, zoom: 1 }) },
						]}
					/>
				</div>
			</header>
			<div className="mas-row mas-between">
				<div className="mas-row mas-tabs" ref={views} tabIndex={-1} role="group" aria-label="Team 视图">
					{(["Graph", "Activity", "Agents"] as const).map((mode) => (
						<Button
							key={mode}
							label={mode}
							variant={view.mode === mode ? "secondary" : "ghost"}
							aria-pressed={view.mode === mode}
							onClick={() => update({ mode })}
						/>
					))}
				</div>
				{selected && !showInspector && (
					<Button
						label={`继续查看 ${selected.key}`}
						onClick={(event) => choose(selected, event.currentTarget)}
					/>
				)}
			</div>
			{warning && <p role="status">{warning}</p>}
			{team.members.length === 0 && <p>当前没有可读取的 Team 成员。</p>}
			<div className={`mas-workspace ${!compact && inspector ? "mas-with-inspector" : ""}`}>
				<div className="mas-main mas-stack">
					{view.mode !== "Activity" && (
						<div className="mas-row mas-filterbar">
							<TextInput
								label="查找成员"
								value={view.query}
								onChange={(query) => update({ query })}
								containerClassName="mas-field mas-search"
							/>
							<Selector
								label="成员状态"
								options={[
									{ value: "all", label: "全部状态" },
									...memberPhases.map((phase) => ({ value: phase, label: phaseLabel[phase] })),
								]}
								value={view.phase}
								onChange={(phase) => update({ phase })}
							/>
							{view.mode === "Graph" && (
								<div className="mas-row">
									<Button
										label="缩小关系图"
										isDisabled={view.zoom <= 0.5}
										onClick={() => update({ zoom: Math.max(0.5, view.zoom - 0.1) })}
									/>
									<span>{Math.round(view.zoom * 100)}%</span>
									<Button
										label="放大关系图"
										isDisabled={view.zoom >= 1.5}
										onClick={() => update({ zoom: Math.min(1.5, view.zoom + 0.1) })}
									/>
								</div>
							)}
						</div>
					)}
					{view.mode === "Graph" ? (
						<>
							<p className="mas-muted">
								虚线表示创建，实线表示通信。点击关系计数查看 Activity；移动把手支持拖动和方向键。
							</p>
							<Graph
								members={members}
								connections={connections}
								activities={activities}
								view={view}
								select={choose}
								move={(name, point) => update({ positions: { ...view.positions, [name]: point } })}
								history={(edge) => {
									setHistory(
										edge.kind === "communication" ? { from: edge.from, to: edge.to } : { member: edge.to },
									);
									update({ mode: "Activity" });
								}}
							/>
							{team.connectionsTruncated && (
								<p role="status">关系摘要达到当前窗口上限；可在 Activity 中继续分页读取。</p>
							)}
						</>
					) : view.mode === "Activity" ? (
						<ActivityView
							key={JSON.stringify(history)}
							{...props}
							team={team}
							initial={history}
							select={(name) => {
								const member = team.members.find((item) => item.key === name);
								if (member) choose(member);
							}}
						/>
					) : (
						<div className="mas-agents" aria-label="Team Agents">
							{members.map((member) => {
								const activity = activityMap.get(resourceKey(member.ref));
								return (
									<Button
										key={resourceKey(member.ref)}
										label={`查看成员 ${member.key}`}
										variant="ghost"
										className="mas-agent-row"
										aria-pressed={selected?.key === member.key}
										onClick={(event) => choose(member, event.currentTarget)}
									>
										<span className="mas-stack">
											<strong>{member.key}</strong>
											<small>
												{phaseLabel[member.phase]} · {activity ? activityLabel[activity.state] : "读取中"} ·{" "}
												{member.lifetime}
											</small>
											<span className="mas-node-preview">
												{activity?.preview || member.reason || "暂无活动摘要"}
											</span>
										</span>
									</Button>
								);
							})}
							{members.length === 0 && <p>没有符合当前筛选的成员。</p>}
						</div>
					)}
				</div>
				{!compact && inspector && <aside className="mas-inspector-column">{inspector}</aside>}
			</div>
			{compact && visible && inspector && (
				<BottomSheet
					isOpen
					label={`成员 ${selected!.key}`}
					purpose="form"
					height="tall"
					finalFocusRef={trigger}
					onOpenChange={(open) => {
						if (!open) closeInspector();
					}}
				>
					<div className="mas-view">{inspector}</div>
				</BottomSheet>
			)}
		</>
	);
}
