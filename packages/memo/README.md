# @pakka/memo

Memo 是独立的 Markdown Wiki 与来源知识服务。它在宿主指定的 SQLite 中保存页面、版本、书库授权、来源目录、变更与原请求回执，通过同一入口浏览、检索和按需读取。普通知识读取无需创建 Conversation、馆员或模型任务。

需要 Node.js 24+。数据库目录由可信宿主预先创建并设置访问权限；使用专用 Memo 文件，不要传入 Runtime/业务 SQLite。数据库、WAL 和 SHM 都属于同一私有存储域。正常关闭所有 Memo 实例后再做冷文件备份；运行中的一致备份需要 SQLite 一致快照，不能只复制主文件。

```js
import { openMemo } from "@pakka/memo";
const memo = openMemo({ file: "/private/knowledge/memo.sqlite" });
memo.createLibrary({ id: "work", title: "工作知识", ownerId: "alice" });
const client = memo.connect({
	id: "alice",
	check() {
		/* 校验当前宿主身份 */
	},
});
const saved = await client.write({
	libraryId: "work",
	requestId: "note-1",
	baseRevision: 0,
	path: "notes/isolation.md",
	title: "隔离",
	markdown: "使用独立工作目录。",
	summary: "首次记录",
	sources: [],
});
const page = await client.read({
	kind: "wiki",
	libraryId: "work",
	pageId: saved.pageId,
	revision: saved.revision,
});
memo.close();
```

运行安装包自带示例：`node node_modules/@pakka/memo/examples/headless.mjs <database-path>`。以同一路径重复运行会查回同一请求回执。

- 书库 reader 读取，editor 编辑，manager 授权、登记来源及删除。
- `list/search/history/changes/libraries` 返回 `{items,cursor}`；一直读取到 cursor 为 null。空页仍可能有继续游标。
- `read` 的 offset、limit、nextOffset 是 Unicode 码点，不是 UTF-16 或字节偏移。默认 4096、最多 16384 码点。
- `write` 修改时必须给原 pageId、baseRevision 和新的 requestId。重命名保留身份；`restore` 形成新修订。
- `exportMarkdown/importMarkdown` 保留页身份和基础版本；来源引用不完整时拒绝完整导出，防止往返丢失元数据。
- `lookup(requestId)` 查询当前 actor 的原回执。收到 unknown 后先核对原请求。
- 来源通过宿主 providers 注册；`check` 同步检查 read/share，`read` 返回同一 ref 的窗口，可选 `search` 返回该来源内的准确引用。Memo 校验返回身份、版本、范围并再次检查权限。解析后才确定的对象权限通过 provider 的可选 `publicationCheck(originalResult)` 传递，包装端不能丢弃它。
- 宿主异步加工 read/search 结果时，先取 `const verify = client.publicationCheck(result)`，最后一次 await 后、同步发布前调用 `verify()`。它只接受同一 Client 的原结果，不是可序列化的授权令牌。

Book 适配由 `@pakka/memo/dynamite` 的 `createDynamiteSourceProvider({book,check})` 提供：宿主传入 Dynamite 的公开 Book 服务和图书馆 read/share 策略，Memo 管理来源格式及导航。Dynamite 不提供反向的 Memo 专属接口。MAS 适配仍在 `@pakka/memo/patchouli/mas`；RSI/EI 保持独立 opt-in，当前没有自动装配。普通知识安装无需这些上游，也不会隐式运行模型。

原生 Agent 工具位于 `@pakka/memo/agent`，该子入口需要宿主已有的 `@pakka/agent` Runtime。使用 `bindMemoInvocation` 将当前 native scope、原 Conversation 和 actor 绑定到服务，再把 `createMemoTools` 的工具注入 Host。知识入口本身没有 Runtime 依赖。工具不暴露授权、来源登记或删除管理动作。

完整 API 和后续馆员切片见仓库 `docs/reference/MEMO-API.md` 与 `openspec/changes/add-memo-knowledge/tasks.md`。
