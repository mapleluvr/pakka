// pakka-webui's notification worker. Behavioral reference: pi-pocket@de612d5622cd web/sw.js (MIT).
// It caches no application, credentials or resource content. Push carries only opaque lookup IDs.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const identity = (value) => typeof value === "string" && /^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value);
function wake(value) {
	return (
		record(value) &&
		Object.keys(value).sort().join(",") === "deviceId,eventId" &&
		typeof value.eventId === "string" &&
		/^[a-f0-9]{64}$/.test(value.eventId) &&
		identity(value.deviceId)
	);
}
async function entry(value) {
	if (!wake(value)) return null;
	const response = await fetch(
		"/pocket/notifications/event?eventId=" +
			encodeURIComponent(value.eventId) +
			"&deviceId=" +
			encodeURIComponent(value.deviceId),
		{ credentials: "same-origin", cache: "no-store", redirect: "error" },
	);
	if (!response.ok) return null;
	const data = await response.json();
	if (
		!record(data) ||
		data.id !== value.eventId ||
		!["done", "approval", "chat", "mention"].includes(data.kind) ||
		typeof data.preview !== "string" ||
		data.preview.length > 512 ||
		!record(data.target) ||
		typeof data.target.conversationId !== "string" ||
		!data.target.conversationId ||
		data.target.conversationId.length > 512
	)
		return null;
	return data;
}
async function clear() {
	for (const row of await self.registration.getNotifications()) row.close();
	await self.navigator.clearAppBadge?.();
}
async function receive(value) {
	if (!wake(value)) return;
	let displayed = false;
	try {
		const data = await entry(value);
		if (!data) return;
		const title =
			data.kind === "done"
				? "Agent finished"
				: data.kind === "approval"
					? "Approval needed"
					: data.kind === "mention"
						? "You were mentioned"
						: "Team update";
		await self.registration.showNotification(title, {
			body: data.preview,
			tag: "pakka-" + data.id,
			data: { eventId: data.id, deviceId: value.deviceId },
		});
		displayed = true;
		await self.navigator.setAppBadge?.();
	} catch {
		// No decrypted/private fallback is displayed if authority or transport cannot be confirmed.
	} finally {
		for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true }))
			client.postMessage({ type: "pakka.notification", eventId: value.eventId, displayed });
	}
}
self.addEventListener("push", (event) => {
	let value;
	try {
		value = event.data?.json();
	} catch {
		return;
	}
	event.waitUntil(receive(value));
});
self.addEventListener("message", (event) => {
	if (!event.source || !record(event.data)) return;
	let origin;
	try {
		origin = new URL(event.source.url).origin;
	} catch {
		return;
	}
	if (origin !== self.location.origin) return;
	if (event.data.type === "pakka.notifications.clear") event.waitUntil(clear());
	else if (event.data.type === "pakka.notifications.test")
		event.waitUntil(
			self.registration.showNotification("pakka-webui", {
				body: "System notifications work on this device.",
				tag: "pakka-device-test",
			}),
		);
});
self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	event.waitUntil(
		(async () => {
			try {
				const data = await entry(event.notification.data);
				if (!data) return;
				const url = self.location.origin + "/#conversation=" + encodeURIComponent(data.target.conversationId);
				const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
				const client = clients.find((row) => {
					try {
						return new URL(row.url).origin === self.location.origin;
					} catch {
						return false;
					}
				});
				if (client) {
					await client.focus();
					await client.navigate(url);
				} else await self.clients.openWindow(url);
			} catch {
				// A stale notification is not an authority or an alternate navigation destination.
			}
		})(),
	);
});
