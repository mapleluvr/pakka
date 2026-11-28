import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { readMember, type WorkbenchMember } from "./client.ts";
import { MemberInspector } from "./MemberInspector.tsx";
import { failure, readService, resourceKey, type TeamProps } from "./service.ts";

/** Standalone Conversation contribution reads only its explicitly bound member. */
export function MemberPanel(props: TeamProps) {
	const { ui, bindings } = props;
	const [member, setMember] = useState<WorkbenchMember | null>(null),
		[error, setError] = useState<string | null>(null),
		[revision, setRevision] = useState(0);
	useEffect(() => {
		const controller = new AbortController(),
			signal = AbortSignal.any([ui.signal, bindings.signal, controller.signal]);
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function observe() {
			try {
				if (!bindings.target) throw new Error("需要明确的成员 Conversation。");
				const value = await readService(bindings, "inspect", {}, readMember, signal);
				if (resourceKey(value.ref) !== resourceKey(bindings.target)) throw new Error("成员读取身份不符。");
				if (!signal.aborted) {
					setMember(value);
					setError(null);
				}
			} catch (reason) {
				if (!signal.aborted) {
					setMember(null);
					setError(failure(reason));
				}
			} finally {
				if (!signal.aborted)
					timer = setTimeout(() => {
						void observe();
					}, 1500);
			}
		}
		void observe();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [ui, bindings, revision]);
	return (
		<div className="mas-view mas-stack">
			{error ? (
				<>
					<p role="alert">{error}</p>
					<Button label="重新读取成员" onClick={() => setRevision((value) => value + 1)} />
				</>
			) : member ? (
				<MemberInspector
					key={resourceKey(member.ref)}
					{...props}
					member={member}
					changed={() => setRevision((value) => value + 1)}
					close={() => ui.close()}
				/>
			) : (
				<p role="status">正在读取成员…</p>
			)}
		</div>
	);
}
