import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { TextArea } from "@astryxdesign/core/TextArea";
import { useMemberActions } from "./useMemberActions.ts";
import { conversationResource, type TeamProps } from "./service.ts";
import type { MemberRef, WorkbenchActivity, WorkbenchMember } from "./client.ts";
import type { PendingMemberAction } from "./pending.ts";

export const phaseLabel: Record<WorkbenchMember["phase"], string> = {
	preparing: "准备中",
	ready: "就绪",
	active: "可用",
	stopping: "停止中",
	retired: "已退休",
	failed: "失败",
	unknown: "待核对",
	ended: "已结束",
};
export const activityLabel: Record<WorkbenchActivity["state"], string> = {
	waiting: "等待中",
	thinking: "思考中",
	tool: "使用工具",
	reply: "回复",
	error: "请求错误",
	crashed: "执行中断",
	idle: "空闲",
};
const modes = [
	{ value: "prompt", label: "Prompt" },
	{ value: "steer", label: "Steer" },
	{ value: "followUp", label: "Follow up" },
] as const;
const sendIcon = (
	<svg
		width="24"
		height="24"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		aria-hidden="true"
	>
		<path d="M12 20V4m-7 7 7-7 7 7" />
	</svg>
);

export function MemberInspector(
	props: TeamProps & {
		member: WorkbenchMember;
		members?: readonly WorkbenchMember[];
		activity?: WorkbenchActivity;
		changed(): void;
		close(): void;
	},
) {
	const { member, activity, ui, changed, close } = props;
	const memberName = (ref: MemberRef) =>
		props.members?.find(
			(item) => item.ref.sessionId === ref.sessionId && item.ref.conversationId === ref.conversationId,
		)?.key ?? `Conversation ${ref.conversationId}`;
	const state = useMemberActions(props, member);
	const [text, setText] = useState(() => {
		try {
			return sessionStorage.getItem(state.draftKey) ?? "";
		} catch {
			return "";
		}
	});
	const [mode, setMode] = useState<"prompt" | "steer" | "followUp">("prompt");
	const [confirm, setConfirm] = useState<"abort" | "retire" | null>(null);
	const [draftError, setDraftError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const blocked = state.busy || !!state.pending,
		active = member.phase === "active";
	function draft(value: string) {
		setText(value);
		try {
			sessionStorage.setItem(state.draftKey, value);
			setDraftError(null);
		} catch {
			setDraftError("草稿无法保存在此浏览器；提交仍会要求保留原请求。");
		}
	}
	function completed(original: PendingMemberAction | null) {
		if (!original || ui.signal.aborted) return;
		if (["send", "steer", "reply"].includes(original.action)) {
			if (
				original.input &&
				typeof original.input === "object" &&
				!Array.isArray(original.input) &&
				"text" in original.input &&
				original.input.text === text
			)
				draft("");
			setNotice("输入已接纳；后续进度以原投递回执为准。");
		} else
			setNotice(original.action === "withdraw" ? "撤回请求已确认。" : "成员控制已确认；当前状态将重新读取。");
		setConfirm(null);
		changed();
	}
	async function submit() {
		if (blocked || !active || !text.trim() || text.length > 16384) return;
		completed(
			await state.run(mode === "prompt" ? "send" : "steer", mode === "prompt" ? { text } : { text, mode }),
		);
	}
	function openConversation() {
		void ui
			.navigate(conversationResource(member.ref))
			.then((result) => {
				if (ui.signal.aborted) return;
				if (result.status === "ready" || result.status === "unloaded") close();
				else setNotice(result.message ?? "原 Conversation 暂不可访问。");
			})
			.catch(() => {
				if (!ui.signal.aborted) setNotice("原 Conversation 暂不可访问。");
			});
	}
	return (
		<section className="mas-inspector mas-stack" aria-label={`成员 ${member.key}`}>
			<header className="mas-row mas-between">
				<h2>{member.key}</h2>
				<Button label="关闭成员详情" variant="ghost" onClick={close} />
			</header>
			<dl className="mas-properties">
				<dt>成员状态</dt>
				<dd>{phaseLabel[member.phase]}</dd>
				{activity && (
					<>
						<dt>活动摘要</dt>
						<dd>{activityLabel[activity.state]}</dd>
					</>
				)}
				<dt>所有者</dt>
				<dd>
					{member.owner === props.bindings.personId ? "你" : (member.parent ?? member.owner ?? "未记录")}
				</dd>
				<dt>创建来源</dt>
				<dd>{member.creationKnown ? (member.creator ?? "人类或服务") : "未记录"}</dd>
				<dt>分叉来源</dt>
				<dd>{member.forkSource ?? "未记录"}</dd>
				<dt>寿命</dt>
				<dd>{member.lifetime}</dd>
				<dt>Session</dt>
				<dd>
					<code>{member.ref.sessionId}</code>
				</dd>
				<dt>Conversation</dt>
				<dd>
					<code>{member.ref.conversationId}</code>
				</dd>
			</dl>
			{member.reason && <p className="mas-muted">{member.reason}</p>}
			{activity?.preview && <p className="mas-text">{activity.preview}</p>}
			{activity?.detail && (
				<p role="status">
					{activity.code ? `${activity.code} · ` : ""}
					{activity.detail}
				</p>
			)}
			<Button label="Open Conversation" onClick={openConversation} width="100%" />
			{(state.error || draftError) && (
				<p role="alert" className="mas-problem">
					{state.error || draftError}
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			{state.pending && (
				<div className="mas-pending mas-stack">
					{state.pending === "unreadable" ? (
						<p role="alert">本地原请求记录不可读，已停止新控制。请保留记录并核对服务。</p>
					) : (
						<>
							<p>原请求结果未确认，当前没有重新提交。</p>
							<code>{state.pending.requestId}</code>
							<Button
								label="核对成员原请求"
								isLoading={state.busy}
								isDisabled={state.busy}
								onClick={() => {
									void state.run().then(completed);
								}}
							/>
						</>
					)}
				</div>
			)}
			{member.permissions.includes("send") && (
				<form
					className="mas-composer mas-stack"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<TextArea
						label={`发送给 ${member.key}`}
						value={text}
						onChange={draft}
						rows={3}
						isReadOnly={blocked || !active}
						containerClassName="mas-field"
						maxLength={16384}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								void submit();
							}
						}}
					/>
					<div className="mas-row mas-between">
						<span className="mas-muted">{modes.find((item) => item.value === mode)?.label}</span>
						<div className="mas-row mas-send-group">
							<Button
								label="发送给成员"
								type="submit"
								variant="primary"
								isIconOnly
								icon={sendIcon}
								isDisabled={blocked || !active || !text.trim()}
							/>
							<DropdownMenu
								button={{ label: "选择发送方式", isDisabled: blocked || !active, variant: "ghost" }}
								items={modes.map((item) => ({
									label: item.label,
									isDisabled: item.value !== "prompt" && !member.permissions.includes("steer"),
									onClick: () => setMode(item.value),
								}))}
								placement="above"
								alignment="end"
							/>
						</div>
					</div>
				</form>
			)}
			{state.receipt && (
				<section className="mas-stack" aria-label="成员投递回执">
					<h3>原投递</h3>
					<p>
						<code>{state.receipt.id}</code> · {state.receipt.status}
					</p>
					{state.receipt.reason && <p>{state.receipt.reason}</p>}
					<div className="mas-row">
						<Button
							label="刷新投递回执"
							variant="ghost"
							isDisabled={state.busy}
							onClick={() => {
								void state.refreshReceipt();
							}}
						/>
						{member.permissions.includes("send") && ["queued", "unknown"].includes(state.receipt.status) && (
							<Button
								label="撤回该投递"
								isDisabled={blocked}
								onClick={() => {
									void state.run("withdraw", { id: state.receipt!.id }).then(completed);
								}}
							/>
						)}
					</div>
				</section>
			)}
			{state.inbox.some((item) => item.source) && (
				<section className="mas-stack" aria-label="成员收件箱">
					<h3>收到的消息</h3>
					{state.inbox
						.filter((item) => item.source)
						.slice(-8)
						.reverse()
						.map((item) => (
							<div className="mas-stack mas-inbox" key={item.id}>
								<p>
									{memberName(item.source!)} · {item.status}
								</p>
								<code>{item.id}</code>
								<Button
									label={`以此成员回复 ${memberName(item.source!)}`}
									isDisabled={blocked || !active || !text.trim()}
									onClick={() => {
										void state.run("reply", { id: item.id, text }).then(completed);
									}}
								/>
							</div>
						))}
				</section>
			)}
			{member.permissions.includes("manage") && (
				<DropdownMenu
					button={{ label: "Management", isDisabled: blocked }}
					items={[
						{ label: "停止当前工作", onClick: () => setConfirm("abort") },
						{
							label: "Retire 成员",
							isDisabled: member.phase === "retired",
							onClick: () => setConfirm("retire"),
						},
					]}
				/>
			)}
			{confirm && (
				<Dialog
					isOpen
					purpose="form"
					width={440}
					maxHeight="85dvh"
					aria-label={confirm === "retire" ? "确认退休成员" : "确认停止成员工作"}
					onOpenChange={(open) => {
						if (!open) setConfirm(null);
					}}
				>
					<div className="mas-view mas-stack">
						<h2>{confirm === "retire" ? "Retire 成员" : "停止当前工作"}</h2>
						<p>
							{confirm === "retire"
								? "将停止此成员接纳后续输入，并请求停止其当前工作。已有历史与效果继续保留。"
								: "向此成员的原 Conversation 请求停止当前工作。"}
						</p>
						{state.error && <p role="alert">{state.error}</p>}
						<div className="mas-row">
							<Button label="取消" onClick={() => setConfirm(null)} />
							<Button
								label="确认成员控制"
								variant="primary"
								isDisabled={blocked}
								isLoading={state.busy}
								onClick={() => {
									void state.run(confirm).then(completed);
								}}
							/>
						</div>
					</div>
				</Dialog>
			)}
		</section>
	);
}
