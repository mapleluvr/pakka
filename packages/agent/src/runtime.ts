import { DurableAdapter, type ManagedAdapterPort } from "./durable-adapter.ts";
import { createHostWithAdapter } from "./host.ts";
import type {
	CatalogOptions,
	CatalogEnroll,
	RuntimeCatalog,
	ConversationRef,
	ConversationSpec,
	Host,
	Runtime,
	RuntimeOptions,
} from "./types.ts";

/** Composition only: all Pi/storage mutable objects remain in DurableAdapter. */
export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
	if (options.backend !== undefined && options.backend !== "durable")
		throw new Error("Unsupported production backend");
	let port!: ManagedAdapterPort;
	const hosts = new Map<string, { incarnation: string; host: Host }>();
	const pending = new Map<string, Promise<Host>>();
	const root = await createHostWithAdapter(
		options,
		async (opts, notify, control) => {
			const opened = await DurableAdapter.createManaged({ ...options, ...opts }, notify, control);
			port = opened.port;
			return opened.adapter;
		},
		2,
	);
	const rootRef = port.view().conversations.find((ref) => ref.key === "root")!;
	hosts.set(rootRef.key, { incarnation: rootRef.incarnation, host: root });
	async function attach(ref: ConversationRef): Promise<Host> {
		port.validateReference(ref);
		const existing = hosts.get(ref.key);
		if (existing && existing.host.view().conversationId === ref.conversationId) {
			hosts.set(ref.key, { incarnation: ref.incarnation, host: existing.host });
			return existing.host;
		}
		const attaching = pending.get(ref.key);
		if (attaching) return attaching;
		const operation = createHostWithAdapter(
			port.profileOptions(ref.profile),
			(_opts, notify, control) => port.attach(ref, notify, control),
			2,
		)
			.then((host) => {
				hosts.set(ref.key, { incarnation: ref.incarnation, host });
				return host;
			})
			.finally(() => {
				pending.delete(ref.key);
			});
		pending.set(ref.key, operation);
		return operation;
	}
	// Restore every approved authority before any progress-enabling command.
	try {
		for (const ref of port.view().conversations) if (ref.key !== "root") await attach(ref);
	} catch (error) {
		await root.dispose();
		await port.close();
		throw error;
	}
	let closing: Promise<void> | undefined;
	return Object.freeze({
		root: () => root,
		view: () => port.view(),
		conversation: attach,
		createConversation: async (spec: ConversationSpec) => {
			const ref = await port.createConversation(spec);
			await attach(ref);
			return ref;
		},
		catalog: (options: CatalogOptions): RuntimeCatalog => {
			const catalog = port.catalog(options);
			return Object.freeze({
				...catalog,
				configure: async (ref: ConversationRef, profile: string, check: () => void) => {
					const member = await catalog.configure(ref, profile, check);
					await attach(member.ref);
					return member;
				},
				enroll: async (specs: readonly CatalogEnroll[], check: () => void) => {
					const members = await catalog.enroll(specs, check);
					for (const member of members) await attach(member.ref);
					check();
					return members;
				},
			});
		},
		waitForIdle: () => port.waitForIdle(),
		close: () =>
			(closing ??= (async () => {
				const results = await Promise.allSettled([...hosts.values()].map(({ host }) => host.dispose()));
				await port.close();
				const failure = results.find((result) => result.status === "rejected");
				if (failure?.status === "rejected") throw failure.reason;
			})()),
	});
}
