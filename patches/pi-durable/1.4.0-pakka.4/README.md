# Pi Durable 1.4.0-pakka.4：现存 SQLite 原历史 Reader

固定上游为 Pi `1.4.0` / `4a080252f06caf63a525d7873c5d94d3c23887e0`。本版本保留 [.3](../1.4.0-pakka.3/README.md) 的 generation block/check/settlement 与 EntryArchive，新增不接管执行的只读生命周期。没有新存储格式或 schema 迁移。

- [输入](baseline.json)、[源差异](source.patch)、[构建锁](build-lock.json)共同固定重建来源。
- [归档身份](artifact.json)固定 vendor tgz、源差异、构建锁与 Chord SQLite companion 的 SHA-256。
- [安装归档](../../../packages/agent/vendor/earendil-works-pi-durable-1.4.0-pakka.4.tgz)是当前工作分支所选下游依赖，不表示已经发布到 npm 或合入上游。

## 公开入口

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteReader } from "@earendil-works/pi-durable/storage/sqlite/node";

// 定位及授权由可信调用者负责；这不是接收浏览器任意路径的 API。
export async function readOriginal(file: string, id: ConversationId) {
	const reader = await openNodeSqliteReader(file);
	try {
		return await reader.snapshot(async (read) => {
			const conversation = await read.conversation(id, BACKGROUND_CONTEXT);
			if (!conversation) return undefined;
			const entries = await read.entryArchive.scan(
				{ conversationId: id, order: "descending" },
				64,
				undefined,
				BACKGROUND_CONTEXT,
			);
			return { sequence: read.sequence, conversation, entries };
		}, BACKGROUND_CONTEXT);
	} finally {
		await reader.close(BACKGROUND_CONTEXT);
	}
}
```

`SqliteReader`、`SqliteReaderView`、`SqliteReaderVersionError` 和 `openSqliteReader` 由 `/storage/sqlite` 导出；Node opener 与只读连接设置由 `/storage/sqlite/node` 导出。通用 `openSqliteReader` 的调用者必须提供真正只读的 `SqliteReadDatabase`；Node opener 已落实这个前提，不只在 TypeScript 上隐藏 writer 方法。

| 能力                                    | 语义                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `snapshot(callback, context)`           | 一个短期一致读事务。sequence 是本次快照可见的最后提交，不是历史版本租约。               |
| `conversation` / `scanConversations`    | 复用原生记录和查询；Reader 的 Conversation 分页为 1–256 条。                            |
| `entryArchive.header` / `scan` / `read` | 复用原 Entry、commitSeq、分叉可见范围和连续 JSON 编码字节；每段最多 64 KiB。            |
| `findDocument` / `document`             | 在同一快照中物化保存的 record/base/delta，不调用定义的 initial/migrate 或创建 Session。 |
| `close(context)`                        | 拒绝新快照，等待已接纳回调结束后释放连接；读已取消也必须完成清理。                      |

返回 Reader 及借出的视图在运行时都没有 commit、mintId、submit、configure 或 resume。callback 内只使用该次 view，并 await 其读取；结束后 view 失效。不要在 callback 中等待用户、网络、下一页，或重新进入同一 Reader 的 snapshot/close。

## 打开、读取与关闭

- Node 使用 `DatabaseSync(..., { readOnly: true })`，只打开现存普通文件；不创建父目录、空库或迁移版本表。
- 当前支持 schema 2；核对版本、commit metadata 及所需列。旧/新版本以 `SqliteReaderVersionError` 拒绝；格式、损坏、缺文件和文件锁失败保留失败结果，不修复源。每次 snapshot 再核对版本。
- 使用 `BEGIN` 的读事务，不沿用 writer 的 `BEGIN IMMEDIATE`。不改变 journal mode，不在 close 做 checkpoint/truncate。
- 不调用 `Harness.open()`，不恢复 running Task、不增加 restarts、不派发模型或接管 writer。已保存 activity 只描述保存时的状态。
- WAL reader 读取已提交 WAL；一次快照不混合并发提交。它可能参与 SQLite 协调文件操作，不能把“零业务/恢复修改”说成“文件系统绝对零 I/O”，也不能给活跃数据库设置 immutable。
- Entry 范围延续 .3 的有界返回、编码缓存与后端单条记录临时工作边界。document 读取需要其保存版本/修订；不承诺任意旧 sequence 的所有 mutable 状态，也不承诺整个进程只占 64 KiB。

## Chord 与制品所有权

只读连接/事务/关闭来自同一固定 Chord 源码，原生记录及 schema 兼容由 Durable 负责。构建只把 Context 无关的 `database`、`node` SQLite 模块、声明、映射及许可证随 Durable 交付；Node writer 仍使用原公共 Chord 入口。

没有把第二份完整 Chord 嵌入 Durable。公开探针曾确认两份完整 Context runtime 混用会丢失取消信号，因此主 Chord 依赖仍为 `1.4.0`。源码条件解析到该固定 Chord 源模块，安装制品解析到随包 SQLite companion；Context 与错误类型沿原公开依赖解析。companion 的文件身份也记录在 artifact 中。

## 重建与验证

```powershell
npm run build:durable-patch -- <固定上游-checkout> 1.4.0-pakka.4
node scripts/verify-durable-patch.mjs
npm run build
npm run check
```

构建从精确 commit 导出源码、检查并应用补丁、按锁安装和编译，再运行 baseline 所列原生回归及仓库外安装消费者；不改原 checkout 或已安装依赖。Node opener 的示例同样以安装后的声明检查，不以 workspace alias 代替消费。

新增持久测试只保护只读性、schema 拒绝、真实 WAL 一致性、原分叉字节、保存状态、取消/失效视图与关闭。已有 generation、队列、恢复、工具和字节档案回归继续使用。删除条件是上游公开 API 提供等价原生读取、同样的 generation/EntryArchive 契约和这些实际消费检查通过；不把源码补丁模糊套到另一个 cohort。

Pakka 的可信来源登记、权限、原 Session 身份和公共 DTO 属于 [WebUI 服务](../../../docs/reference/WEBUI-SERVICES.md)；Reader 本身不授予访问权限。实际结果、制品及尚未完成的界面/facet 范围见[核对记录](../../../docs/verification/READONLY-SQLITE-HISTORY.md)，版本变化追加到[兼容性账本](../../../docs/PI-DURABLE-COMPATIBILITY.md)，不重写旧版本记录。
