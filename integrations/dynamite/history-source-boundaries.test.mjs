import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "@pakka/agent";
import { createHistoryBookService } from "@pakka/dynamite";
import { createDynamiteSourceProvider } from "@pakka/memo/dynamite";

import { deferred, fixture } from "./history-source-fixture.mjs";

test("Memo source navigation bounds every level and resolves long child references from the original Book and source window", async () => {
	const f = await fixture("history-source-boundaries");
	let runtime;
	try {
		runtime = await createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "main-local",
			apiKey: "local-only",
			limits: {
				maxConversations: 2,
				maxPrimaryAttempts: 4,
				maxAuxiliaryAttempts: 4,
			},
		});
		const source = runtime.view().conversations[0],
			longLocator = "汉".repeat(512),
			body = "root material 🔬 ".repeat(40);
		let changed = false,
			allowed = true;
		const book = createHistoryBookService({
				records: runtime.records({ namespace: "books" }),
				source: {
					sessionId: source.sessionId,
					conversationId: source.conversationId,
					namespace: "source",
				},
				check() {},
				checkEvidence() {
					if (!allowed) throw Error("source revoked");
				},
				async readEvidencePage(_actor, ref, offset, limit) {
					const text = ref.artifactId === "material" ? body : ref.artifactId;
					const children =
						ref.artifactId === "material" || ref.artifactId === "child-0"
							? Array.from({ length: 33 }, (_, i) => ({
									artifactId: (ref.artifactId === "material" ? "child-" : "nested-") + i,
									version: 1,
									locator: longLocator,
								}))
							: [];
					// A source provider may return different navigation for different content windows.
					// Following a returned reference must replay that exact window, not assume offset zero.
					if (offset !== 7 || limit !== 11) children.reverse();
					if (changed && children.length) children[0] = { ...children[0], artifactId: "changed" };
					const points = Array.from(text),
						part = points.slice(offset, offset + limit);
					return {
						ref,
						offset,
						text: part.join(""),
						nextOffset: offset + part.length < points.length ? offset + part.length : null,
						sources: children,
					};
				},
			}),
			client = book.connect({ id: "reader", check() {} }),
			provider = createDynamiteSourceProvider({ book, check() {} });
		const entity = {
			id: "书".repeat(160),
			kind: "chapter",
			title: "Event",
			text: "Observed",
			sources: [
				{ artifactId: "material", version: 1 },
				...Array.from({ length: 63 }, (_, i) => ({
					artifactId: "root-" + i,
					version: 1,
				})),
			],
			links: [],
		};
		await client.edit({
			requestId: "create",
			baseRevision: 0,
			title: "Book",
			changes: [{ kind: "put", value: entity }],
		});
		const input = {
			actorId: "reader",
			action: "read",
			libraryId: "library",
			address: book.bookId,
			ref: {
				kind: "source",
				libraryId: "library",
				sourceId: "history",
				version: "1",
			},
		};
		const entry = (await provider.search({ ...input, query: "Observed", limit: 1 })).items[0].ref;
		const artifacts = [],
			entries = [entry];
		while (entries.length) {
			const page = await provider.read({
				...input,
				ref: entries.shift(),
				offset: 0,
				limit: 16384,
			});
			assert.ok(page.sources.length <= 32);
			for (const next of page.sources) {
				if (next.locator.startsWith("references:")) entries.push(next);
				else artifacts.push(next);
			}
		}
		assert.equal(artifacts.length, 64, "All evidence roots remain navigable after entry reference paging");
		for (let i = 1; i < 64; i++)
			assert.equal(
				(
					await provider.read({
						...input,
						ref: artifacts[i],
						offset: 0,
						limit: 16384,
					})
				).text,
				"root-" + (i - 1),
			);
		const artifact = artifacts[0];
		async function expand(ref) {
			const first = await provider.read({
					...input,
					ref,
					offset: 7,
					limit: 11,
				}),
				children = [],
				queue = [first];
			while (queue.length) {
				const page = queue.shift();
				assert.ok(page.sources.length <= 32, "Every response respects Memo's reference count");
				assert.ok(
					page.sources.every((r) => r.locator.length <= 1024),
					"Long source metadata is not embedded in locators",
				);
				for (const next of page.sources) {
					if (next.locator.startsWith("source-refs:"))
						queue.push(
							await provider.read({
								...input,
								ref: next,
								offset: 0,
								limit: 16384,
							}),
						);
					else children.push(next);
				}
			}
			return { first, children };
		}
		const root = await expand(artifact);
		assert.equal(root.first.text, Array.from(body).slice(7, 18).join(""));
		assert.equal(root.children.length, 33);
		const texts = [];
		for (const ref of root.children)
			texts.push((await provider.read({ ...input, ref, offset: 0, limit: 16384 })).text);
		assert.deepEqual(
			texts,
			Array.from({ length: 33 }, (_, i) => "child-" + i),
			"Original source-window positions remain exact across pages",
		);
		const nested = await expand(root.children[0]);
		assert.equal(nested.children.length, 33);
		for (let i = 0; i < 33; i++)
			assert.equal(
				(
					await provider.read({
						...input,
						ref: nested.children[i],
						offset: 0,
						limit: 16384,
					})
				).text,
				"nested-" + i,
			);
		await client.edit({
			requestId: "edit-later",
			baseRevision: 1,
			title: "New Book",
			changes: [
				{
					kind: "put",
					value: {
						...entity,
						sources: [{ artifactId: "other-material", version: 1 }],
					},
				},
			],
		});
		assert.equal(
			(
				await provider.read({
					...input,
					ref: root.children[0],
					offset: 0,
					limit: 16384,
				})
			).text,
			"child-0",
		);
		await assert.rejects(
			provider.read({
				...input,
				ref: { ...root.children[0], version: "2" },
				offset: 0,
				limit: 16384,
			}),
			/identity|reference|unavailable/i,
		);
		changed = true;
		await assert.rejects(
			provider.read({
				...input,
				ref: root.children[0],
				offset: 0,
				limit: 16384,
			}),
			/identity|reference|unavailable/i,
		);
		changed = false;
		allowed = false;
		await assert.rejects(
			provider.read({
				...input,
				ref: nested.children[0],
				offset: 0,
				limit: 16384,
			}),
			/authority|denied|revoked/i,
		);
		assert.equal(f.requests.length, 0);
	} finally {
		await runtime?.close();
		await f.close();
	}
});

test("Source navigation publication boundaries", { timeout: 20000 }, async (t) => {
	const f = await fixture("history-source-publication-boundaries");
	let runtime;
	try {
		runtime = await createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "main-local",
			apiKey: "local-only",
			limits: {
				maxConversations: 2,
				maxPrimaryAttempts: 4,
				maxAuxiliaryAttempts: 4,
			},
		});
		const source = runtime.view().conversations[0],
			denied = new Set();
		let swap = false,
			leafGate,
			bookAllowed = true;
		const book = createHistoryBookService({
			records: runtime.records({ namespace: "books" }),
			source: {
				sessionId: source.sessionId,
				conversationId: source.conversationId,
				namespace: "source",
			},
			check() {
				if (!bookAllowed) throw new Error("Book own read revoked");
			},
			checkEvidence(_actor, ref) {
				if (denied.has(ref.artifactId)) throw new Error("source revoked");
			},
			async readEvidencePage(_actor, ref, offset, limit) {
				if (ref.artifactId === "leaf" && leafGate) {
					leafGate.entered.resolve();
					await leafGate.release.promise;
				}
				const children =
					ref.artifactId === "root"
						? Array.from({ length: 33 }, (_, i) => ({
								artifactId: "child-" + i,
								version: 1,
							}))
						: ref.artifactId === "child-0"
							? [{ artifactId: "leaf", version: 1 }]
							: [];
				if (swap && ref.artifactId === "root") [children[0], children[24]] = [children[24], children[0]];
				const value =
					ref.artifactId === "root"
						? "root source material for the fixed window"
						: ref.artifactId === "leaf"
							? "leaf-private"
							: ref.artifactId;
				const points = Array.from(value),
					part = points.slice(offset, offset + limit);
				return {
					ref,
					offset,
					text: part.join(""),
					nextOffset: offset + part.length < points.length ? offset + part.length : null,
					sources: children,
				};
			},
		});
		await book.connect({ id: "reader", check() {} }).edit({
			requestId: "create",
			baseRevision: 0,
			title: "Book",
			changes: [
				{
					kind: "put",
					value: {
						id: "chapter",
						kind: "chapter",
						title: "Event",
						text: "Observed",
						sources: [{ artifactId: "root", version: 1 }],
						links: [],
					},
				},
			],
		});
		const provider = createDynamiteSourceProvider({ book, check() {} }),
			input = {
				actorId: "reader",
				action: "read",
				libraryId: "library",
				address: book.bookId,
				ref: {
					kind: "source",
					libraryId: "library",
					sourceId: "history",
					version: "1",
				},
			};
		const entry = (await provider.search({ ...input, query: "Observed", limit: 1 })).items[0].ref;
		const artifact = (await provider.read({ ...input, ref: entry, offset: 0, limit: 16384 })).sources[0];
		const first = await provider.read({
			...input,
			ref: artifact,
			offset: 7,
			limit: 11,
		});
		const leaf = (
			await provider.read({
				...input,
				ref: first.sources[0],
				offset: 0,
				limit: 16384,
			})
		).sources[0];
		assert.equal(
			(await provider.read({ ...input, ref: leaf, offset: 0, limit: 16384 })).text,
			"leaf-private",
		);

		await t.test(
			"Reauthorizes both root and intermediate ancestors after the leaf read barrier",
			async () => {
				const outcomes = [];
				try {
					for (const revoked of ["root", "child-0"]) {
						const gate = { entered: deferred(), release: deferred() };
						leafGate = gate;
						const pending = provider.read({
							...input,
							ref: leaf,
							offset: 0,
							limit: 16384,
						});
						await Promise.race([
							gate.entered.promise,
							pending.then(() => {
								throw new Error("Leaf read bypassed the barrier");
							}),
						]);
						denied.add(revoked);
						gate.release.resolve();
						outcomes.push(
							await pending.then(
								() => "published",
								(error) => error.code,
							),
						);
						denied.clear();
						leafGate = undefined;
					}
					assert.deepEqual(
						outcomes,
						["denied", "denied"],
						"No descendant content is published after either ancestor is revoked during the leaf read",
					);
				} finally {
					denied.clear();
					leafGate?.release.resolve();
					leafGate = undefined;
				}
			},
		);
		await t.test("Rejects continuation when the original window swaps c0 with c24", async () => {
			const continuation = first.sources.find((ref) => ref.locator.startsWith("source-refs:"));
			assert.ok(continuation);
			const before = await provider.read({
				...input,
				ref: continuation,
				offset: 0,
				limit: 16384,
			});
			const contents = [];
			for (const ref of before.sources)
				contents.push((await provider.read({ ...input, ref, offset: 0, limit: 16384 })).text);
			assert.deepEqual(contents, [
				"child-24",
				"child-25",
				"child-26",
				"child-27",
				"child-28",
				"child-29",
				"child-30",
				"child-31",
				"child-32",
			]);
			try {
				swap = true;
				await assert.rejects(
					provider.read({
						...input,
						ref: continuation,
						offset: 0,
						limit: 16384,
					}),
					(error) => error.code === "unavailable",
				);
			} finally {
				swap = false;
			}
		});
		await t.test("Outermost publication rechecks ancestry after the source helper settles", async () => {
			let leafChecks = 0;
			const late = createDynamiteSourceProvider({
				book: {
					...book,
					connect(actor) {
						const client = book.connect(actor);
						return Object.freeze({
							...client,
							checkEvidence(refs) {
								client.checkEvidence(refs);
								if (refs.some((ref) => ref.artifactId === "leaf") && ++leafChecks === 2)
									// After the helper's post-leaf check, but before the outer await resumes.
									queueMicrotask(() => denied.add("root"));
							},
						});
					},
				},
				check() {},
			});
			try {
				await assert.rejects(
					late.read({ ...input, ref: leaf, offset: 0, limit: 16384 }),
					(error) => error.code === "denied",
				);
				assert.equal(leafChecks, 2, "The revocation happened after the helper's final check");
			} finally {
				denied.clear();
			}
		});
		await t.test(
			"Returned navigation is parent metadata; reading the child still requires its own authority",
			async () => {
				let rootChecks = 0;
				const late = createDynamiteSourceProvider({
					book: {
						...book,
						connect(actor) {
							const client = book.connect(actor);
							return Object.freeze({
								...client,
								checkEvidence(refs) {
									client.checkEvidence(refs);
									if (refs.some((ref) => ref.artifactId === "root") && ++rootChecks === 3)
										queueMicrotask(() => denied.add("child-0"));
								},
							});
						},
					},
					check() {},
				});
				try {
					const output = await late.read({ ...input, ref: artifact, offset: 7, limit: 11 }).then(
						() => "published",
						(error) => error.code,
					);
					assert.ok(denied.has("child-0"));
					assert.equal(denied.has("root"), false, "The root remains authorized");
					assert.equal(output, "published", "Parent metadata does not grant child-body read authority");
					await assert.rejects(provider.read({ ...input, ref: first.sources[0], offset: 0, limit: 16384 }), {
						code: "denied",
					});
				} finally {
					denied.clear();
				}
			},
		);
		await t.test("Unselected intermediate siblings do not block an authorized leaf publication", async () => {
			const late = createDynamiteSourceProvider({
				book: {
					...book,
					connect(actor) {
						const client = book.connect(actor);
						return Object.freeze({
							...client,
							async source(query) {
								const page = await client.source(query);
								if (query.ref.artifactId === "root") queueMicrotask(() => denied.add("child-1"));
								return page;
							},
						});
					},
				},
				check() {},
			});
			try {
				assert.equal(
					(
						await late.read({
							...input,
							ref: leaf,
							offset: 0,
							limit: 16384,
						})
					).text,
					"leaf-private",
				);
				assert.ok(denied.has("child-1"));
				assert.equal(denied.has("root") || denied.has("child-0") || denied.has("leaf"), false);
			} finally {
				denied.clear();
			}
		});
		await t.test(
			"Entry, directory and search metadata recheck Book own authority at source publication",
			async () => {
				const results = [];
				for (const mode of ["entry", "directory", "search"]) {
					const method = {
						entry: "read",
						directory: "list",
						search: "search",
					}[mode];
					const late = createDynamiteSourceProvider({
						book: {
							...book,
							connect(actor) {
								const client = book.connect(actor);
								return Object.freeze({
									...client,
									async [method](query) {
										const value = await client[method](query);
										queueMicrotask(() => {
											bookAllowed = false;
										});
										return value;
									},
								});
							},
						},
						check() {},
					});
					try {
						const pending =
							mode === "search"
								? late.search({ ...input, query: "Observed", limit: 1 })
								: late.read({
										...input,
										ref: mode === "entry" ? entry : input.ref,
										offset: 0,
										limit: 16384,
									});
						results.push(
							await pending.then(
								() => "published",
								(error) => error.code,
							),
						);
					} finally {
						bookAllowed = true;
						denied.clear();
					}
				}
				assert.deepEqual(results, ["denied", "denied", "denied"]);
			},
		);
		await t.test(
			"Evidence publication checks reject invalid read sets without poisoning the Book",
			async () => {
				const client = book.connect({ id: "reader", check() {} });
				for (const refs of [
					null,
					{},
					[{ artifactId: "root", version: [] }],
					Array.from({ length: 65 }, () => ({
						artifactId: "root",
						version: 1,
					})),
				])
					assert.throws(
						() => client.checkEvidence(refs),
						(error) => error.code === "invalid",
					);
				client.checkEvidence(
					Array.from({ length: 64 }, () => ({
						artifactId: "root",
						version: 1,
					})),
				);
				assert.equal((await client.open()).revision, 1);
			},
		);
		await t.test("Metadata pages consume bounded Book pages with many stored references", async () => {
			const client = book.connect({ id: "reader", check() {} }),
				sources = Array.from({ length: 64 }, (_, index) => ({
					artifactId: "dense-source-" + index,
					version: 1,
				}));
			for (const [index, id] of ["dense-a", "dense-b"].entries())
				await client.edit({
					requestId: id,
					baseRevision: index + 1,
					title: "Dense Book",
					changes: [
						{
							kind: "put",
							value: {
								id,
								kind: "chapter",
								title: id,
								text: "Dense evidence",
								sources,
								links: [],
							},
						},
					],
				});
			const ref = { ...input.ref, version: "3" };
			assert.equal((await provider.search({ ...input, ref, query: "Dense", limit: 2 })).items.length, 2);
			assert.ok((await provider.read({ ...input, ref, offset: 0, limit: 16384 })).text.includes("dense-a"));
		});
		assert.equal(f.requests.length, 0);
	} finally {
		await runtime?.close();
		await f.close();
	}
});
