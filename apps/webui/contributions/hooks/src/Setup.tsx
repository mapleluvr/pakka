import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { ExtensionServiceBinding } from "@pakka/client/extensions";
import * as data from "./data.ts";

export function Setup({
	bindings,
	hook,
	signal: parentSignal,
	close,
}: {
	readonly bindings: ExtensionServiceBinding;
	readonly hook: data.Hook;
	readonly signal: AbortSignal;
	readonly close: () => void;
}) {
	const lifetime = useMemo(() => new AbortController(), [bindings, hook.id, hook.version, hook.signed]);
	const signal = useMemo(() => AbortSignal.any([parentSignal, lifetime.signal]), [parentSignal, lifetime]);
	const [loaded, setLoaded] = useState<{
			binding: ExtensionServiceBinding;
			hookId: string;
			version: number;
			value: data.Credentials;
		} | null>(null),
		[problem, setProblem] = useState("");
	const value =
		loaded?.binding === bindings && loaded.hookId === hook.id && loaded.version === hook.version
			? loaded.value
			: null;
	const [copied, setCopied] = useState("");
	useEffect(() => {
		setLoaded(null);
		setProblem("");
		setCopied("");
		void data
			.credentials(bindings, hook, signal)
			.then((result) => {
				signal.throwIfAborted();
				setLoaded({ binding: bindings, hookId: hook.id, version: hook.version, value: result });
			})
			.catch((reason) => {
				if (!signal.aborted) setProblem(data.problem(reason));
			});
		return () => lifetime.abort();
	}, [bindings, hook.id, hook.version, hook.signed, signal, lifetime]);
	async function copy(text: string, label: string) {
		if (signal.aborted) return;
		try {
			await navigator.clipboard.writeText(text);
			if (!signal.aborted) setCopied(label + "已复制。");
		} catch {
			if (!signal.aborted) setProblem("复制未完成，请在设置字段中手动选择并复制。");
		}
	}
	return (
		<section className="hook-private hook-stack" aria-label={"连接设置 " + hook.id}>
			<div className="hook-heading">
				<h3>连接设置</h3>
				<Button label="关闭连接设置" variant="ghost" onClick={close} />
			</div>
			{problem && (
				<p role="alert" className="hook-problem">
					{problem}
				</p>
			)}
			{!value ? (
				!problem && <p role="status">正在读取连接设置…</p>
			) : (
				<>
					<label className="hook-stack hook-tight">
						Payload URL
						<input
							type="password"
							name="webhook-address"
							readOnly
							autoComplete="off"
							spellCheck={false}
							value={data.address(bindings, value)}
						/>
					</label>
					{value.signed && (
						<label className="hook-stack hook-tight">
							签名密钥
							<input
								type="password"
								name="webhook-secret"
								readOnly
								autoComplete="off"
								spellCheck={false}
								value={value.secret}
							/>
						</label>
					)}
					<p className="hook-muted">
						{value.signed
							? "在 GitHub 填入 Payload URL 与 Secret，内容类型选 application/json，再选择事件。"
							: "完整地址包含授权密钥。持有该地址的服务可作为创建者向此 Conversation 提交输入。"}
					</p>
					<div className="hook-actions">
						<Button
							label="复制地址"
							variant="ghost"
							onClick={() => {
								void copy(data.address(bindings, value), "地址");
							}}
						/>
						{value.signed && (
							<Button
								label="复制密钥"
								variant="ghost"
								onClick={() => {
									void copy(value.secret, "密钥");
								}}
							/>
						)}
					</div>
					<p className="hook-muted">
						设置只保留在当前打开的界面，轮换密钥后请更新发送方。浏览器或剪贴板中的已复制内容由你自行管理。
					</p>
				</>
			)}
			{copied && <p role="status">{copied}</p>}
		</section>
	);
}
