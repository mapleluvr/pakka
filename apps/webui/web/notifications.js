// Device UI adapted from pi-pocket@de612d5622cd web/notify.js (MIT); identity and RPC are Pakka-owned.
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import { SettingsPage } from "./settings-page.js";
const html = htm.bind(h);
let registering;
const capable = () => isSecureContext && "Notification" in globalThis && "serviceWorker" in navigator;
export function notificationWorker() {
	if (!capable())
		return Promise.reject(Error("This browser needs a secure origin and system notification support."));
	return (registering ??= navigator.serviceWorker
		.register("/sw.js")
		.then(async () => navigator.serviceWorker.ready)
		.catch((error) => {
			registering = null;
			throw error;
		}));
}
export async function clearNotifications() {
	if (!capable()) return;
	const registration = await navigator.serviceWorker.getRegistration("/");
	registration?.active?.postMessage({ type: "pakka.notifications.clear" });
}
const publicBytes = (value) =>
	Uint8Array.from(
		atob(
			value
				.replace(/-/g, "+")
				.replace(/_/g, "/")
				.padEnd(Math.ceil(value.length / 4) * 4, "="),
		),
		(character) => character.charCodeAt(0),
	);
const labels = { done: "Agent finished", approval: "Approvals", chat: "Team messages", mention: "Mentions" };
async function subscriptionKey(subscription) {
	if (!subscription) return null;
	const value = subscription.toJSON();
	const normalized = { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized)));
	return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
export function Notifications({ target, person, client, close, error }) {
	const [status, setStatus] = useState(null),
		[current, setCurrent] = useState(null),
		[currentKey, setCurrentKey] = useState(null),
		[pending, setPending] = useState(false),
		[uncertain, setUncertain] = useState(false),
		[message, setMessage] = useState("");
	const instance = useRef(null);
	useEffect(() => {
		const binding = {};
		instance.current = binding;
		void load(binding);
		return () => {
			instance.current = null;
		};
	}, [target.key, target.incarnation, person.id]);
	async function load(binding = instance.current) {
		try {
			const result = await client.request({ op: "notification.status", target });
			const registration = capable() ? await notificationWorker() : null;
			const subscription = await registration?.pushManager?.getSubscription();
			const key = await subscriptionKey(subscription);
			if (instance.current !== binding) return;
			setStatus(result.status);
			setCurrent(subscription ?? null);
			setCurrentKey(key);
			setUncertain(false);
			setMessage("");
		} catch (failure) {
			if (instance.current === binding) error(failure);
		}
	}
	async function perform(action) {
		if (pending || uncertain) return;
		const binding = instance.current;
		setPending(true);
		setMessage("");
		try {
			await action(binding);
		} catch (failure) {
			if (instance.current !== binding) return;
			if (failure.outcome === "unknown") {
				setUncertain(true);
				setMessage("Result unconfirmed. Read the current device state before another change.");
			} else if (failure.code) error(failure);
			else
				setMessage(
					"This browser could not enable notifications. Check the site's notification permission and push-service connection.",
				);
		} finally {
			if (instance.current === binding) setPending(false);
		}
	}
	async function enable(binding) {
		if (!capable() || !("PushManager" in globalThis)) throw Error("Push is unavailable");
		if ((await Notification.requestPermission()) !== "granted") throw Error("Permission not granted");
		const registration = await notificationWorker();
		let subscription = await registration.pushManager.getSubscription();
		const wanted = publicBytes(status.publicKey),
			prior = subscription?.options.applicationServerKey;
		if (
			subscription &&
			prior &&
			(prior.byteLength !== wanted.byteLength ||
				new Uint8Array(prior).some((value, index) => value !== wanted[index]))
		) {
			await subscription.unsubscribe();
			subscription = null;
		}
		subscription ??= await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: wanted,
		});
		if (instance.current !== binding) return;
		const json = subscription.toJSON();
		const result = await client.request({
			op: "notification.subscribe",
			target,
			input: {
				requestId: crypto.randomUUID(),
				subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
			},
		});
		if (instance.current !== binding) return;
		const key = await subscriptionKey(subscription);
		if (instance.current !== binding) return;
		if (!result.status.devices.some((row) => row.subscriptionKey === key))
			throw Error("Unconfirmed device registration");
		setStatus(result.status);
		setCurrent(subscription);
		setCurrentKey(key);
		setMessage("Background notifications are enabled for this conversation on this device.");
	}
	async function disable(binding) {
		const selected = status.devices.find((row) => row.subscriptionKey === currentKey);
		if (!selected) throw Error("This device's registration is unconfirmed");
		const result = await client.request({
			op: "notification.unsubscribe",
			target,
			input: { requestId: crypto.randomUUID(), deviceId: selected.id },
		});
		await current?.unsubscribe();
		await clearNotifications();
		if (instance.current === binding) {
			setStatus(result.status);
			setCurrent(null);
			setCurrentKey(null);
			setMessage("Notifications are off on this device.");
		}
	}
	async function test(binding) {
		if (!capable() || (await Notification.requestPermission()) !== "granted")
			throw Error("Permission not granted");
		const registration = await notificationWorker();
		if (instance.current !== binding) return;
		registration.active.postMessage({ type: "pakka.notifications.test" });
		setMessage("System notification check requested. This does not test background push delivery.");
	}
	const on = !!current && status?.devices.some((row) => row.subscriptionKey === currentKey);

	return html`<${SettingsPage} title="Notifications" closeLabel="Close notifications" icon="bell" close=${close}>
			<div class="settings-card settings-native-fields">
				<p>Enable this device for the current conversation. Only updates you can still read are displayed.</p>
				${
					!capable() &&
					html`<p role="status">
						System notifications require HTTPS (or localhost) and browser permission. On iPhone or iPad, open
						the installed home-screen app.
					</p>`
				}
				${
					!status
						? html`<p role="status">Loading notification settings…</p>`
						: html`<p data-notification-devices>
									${status.devices.length} registered device${status.devices.length === 1 ? "" : "s"} for this
									conversation.
								</p>
								<button
									class="button"
									data-notification-enable
									disabled=${pending || uncertain || !capable() || !("PushManager" in globalThis)}
									onClick=${() => perform(on ? disable : enable)}
								>
									${on ? "Disable on this device" : "Enable background notifications"}
								</button>
								<fieldset disabled=${pending || uncertain}>
									<legend>Notify me about</legend>
									${Object.entries(labels).map(
										([kind, label]) =>
											html`<label class="pocket-notification-kind"
												><input
													type="checkbox"
													data-notification-kind=${kind}
													checked=${status.preferences[kind]}
													onChange=${(event) => {
														const value = event.currentTarget.checked;
														void perform(async (binding) => {
															const result = await client.request({
																op: "notification.preferences",
																target,
																input: { requestId: crypto.randomUUID(), preferences: { [kind]: value } },
															});
															if (instance.current === binding) setStatus(result.status);
														});
													}}
												/>${label}</label
											>`,
									)}
								</fieldset>`
				}
				<button
					class="button"
					data-notification-test
					disabled=${!status || pending || !capable()}
					onClick=${() => perform(test)}
				>
					Check system notification
				</button>
				${
					uncertain &&
					html`<button class="button" data-notification-reload onClick=${() => load()}>
						Read current state
					</button>`
				}
				${message && html`<p role="status">${message}</p>`}
				<p class="pocket-secondary">
					Notifications open the conversation. Tool approvals still require your decision in the approval
					panel.
				</p>
			</div>
	</${SettingsPage}>`;
}
