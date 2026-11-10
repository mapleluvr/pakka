# Memo API

`@pakka/memo` 的独立知识入口使用 Node.js 24+ 的 SQLite；`@pakka/memo/agent` 提供原生工具装配。字段类型见 [contracts](../../packages/memo/src/contracts.ts)，行为预期见 [Memo](../state/memo.md)。

## 宿主与身份

`openMemo({file,providers?})` 打开绝对路径下的专用 Memo 数据库。宿主先创建私有目录并保护主文件、WAL、SHM；该存储域独立于 Runtime。`createLibrary({id,title,ownerId})` 是可信宿主初始化端口，已有同身份同配置可重复调用。`close()` 结束本实例连接；同文件多个实例依赖 SQLite 事务和逐页版本防止覆盖。

`connect({id,check})` 将 actor 固定为身份；check 必须是同步且成功时返回 undefined 的当前权限检查。`withAuthority(check)` 追加检查，不替换原检查链。客户端参数不接受 actor/role 自报字段。

| 角色    | 操作                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| reader  | libraries/list/search/read/history/changes、当前 actor 回执查询、完整 Markdown 导出 |
| editor  | reader 操作及 write/restore/importMarkdown                                          |
| manager | editor 操作及 grant/registerSource/remove                                           |

书库 owner 保持 manager。来源 provider 的读权/分享权另行检查；知道引用不会产生读权。管理配置、来源接入和删除不在模型工具列表中。

## Wiki 与请求核对

`write({libraryId,requestId,pageId?,baseRevision,path,title,markdown,summary,sources})`：新页省略 pageId、基础版本为 0；编辑提供原页 ID 和当前基础版本。路径为相对 Markdown 路径，不能包含父目录、绝对路径或反斜杠。重命名保存同一 pageId。标题/正文/来源作为一个修订原子提交。

`restore({libraryId,pageId,requestId,baseRevision,revision,summary})` 将指定版本的正文、标题和引用形成新修订，保留当前路径。`remove(...)` 是管理删除，页面退出普通读取与检索，原历史仍保留。`history({libraryId,pageId,cursor?,limit?})` 返回作者、说明、时间和可见来源引用；正文按对应 WikiRef 读取。

每次变更与轻量 change、原回执在同一事务提交。回执由 actorId/requestId 唯一确定；相同请求及参数返回原结果，参数不同返回 conflict。查询 `lookup(requestId)` 只返回本 actor 的回执，仍需当前书库读权。查回旧回执不会执行新效果。

错误分为 invalid、denied、conflict、busy、unavailable、unknown。busy 表示当前 SQLite 锁竞争，可在锁释放后重试原 requestId，不使实例失效；数据库或 schema 故障返回 unavailable 并封闭当前实例。已有数据库先只读核验身份，无法确认时拒绝，保全主文件与回滚日志。非法输入在 SQLite 绑定前拒绝，不影响其他书库。unknown 表示提交/发布不能确定，应保留原 requestId 核对；不要自动换新 ID 重放。提交前确定拒绝与提交后发布失权分开处理。

## 浏览、检索和范围

- `libraries({cursor?,limit?})`：已授权书库。
- `list({libraryId,prefix?,cursor?,limit?})`：Wiki 路径和来源目录。
- `search({query,libraryId?,cursor?,limit?})`：Wiki 标题/路径/正文与来源目录关键词，随后逐来源读取其可选 search 端口。首版不提供语义向量排名保证。
- `changes({libraryId,cursor?,limit?})`：该库的实际变更，包括操作者、对象、前后版本和 requestId。
- `read(ref,{offset?,limit?})`：Wiki 修订或来源章节的内容窗口，附可继续展开的授权 refs。

分页返回 `{items,cursor}`。必须继续直到 cursor 为 null，空页不代表查询完毕。页条数默认 20、最多 50；来源读取/检索每次只处理有限窗口。游标使用数据库持有密钥认证加密，绑定原 actor、查询范围和扫描上界；过期权限始终重新核验。追加记录不进入已开始的目录/历史扫描，已有页面改动可以反映在后续页，游标不是全库一致性快照。

正文 offset、limit 和 nextOffset 按 Unicode 码点计数，默认 4096、最多 16384。不能拿 UTF-16 长度或编码后字节数推进。单页 Markdown 最多 256 KiB，引用最多 32 个且其 JSON 编码不超过 48 KiB；修订历史每次最多 192 KiB JSON（含游标余量）。累计页面、历史和回执数量不作为生命周期上限。

## 来源 provider

`providers` 是可信宿主注入的具名端口集合。管理 `registerSource` 提供 sourceId、provider、address、版本、标题/摘要和 baseVersion。首次 baseVersion=0，更新必须核对来源目录版本。固定版本的 provider/address 保留，来源目录指向新版本后旧引用仍可读取；无固定快照用 version=null 表示当前内容。

`check({actorId,action,libraryId,address,ref})` 同步确认原资料权限。share 必须包含向目标书库分享的授权；read 检查具体版本/章节。`read` 接收相同身份与 offset/limit，返回同一 ref、text、nextOffset 和可选 sources。可选 `search` 接收 query、limit 和 provider 私有 cursor，返回有界 Entry 页；每项引用仍须属于该 sourceId/书库/版本，可携带章节 locator。provider 内部字段不会发布到客户端。

异步返回后，服务检查当前书库/来源授权、目录版本、返回 ref 和范围。目录在等待期间更新会产生 conflict；来源无权限时列表与检索不显示其元数据。Wiki 正文及历史附带的 refs 也按当前权限过滤，过滤后重新核对整体身份和原页面的发布权限。provider 收到独立冻结的请求 DTO，不能改变服务保留的原引用校验基准。

注册本身不抓取 URL 或文件，不复制业务 Session 正文。provider 的网络、文件和一致性策略由实际宿主实现；原始资料指令只是资料内容，不能改变宿主授予的权限。

## Markdown 与原生工具

`exportMarkdown({libraryId,pageId})` 输出包含 ID/baseRevision 的编码头和原 Markdown。导入必须提供该头并经过正常冲突检查。若导出会缺失无权读取的引用，则拒绝完整导出，避免往返静默丢引用。

`createMemoTools({resolve,timeoutMs?})` 在 native invocation 内解析受控 client；推荐 `bindMemoInvocation({runtime,source,service,actor},scope)`。scope 的当前有效性由 Runtime catalog 核验，复制或过期 scope 被拒绝。工具贡献支持 revoke；超时/中断收窄后续发布与提交权限，已经提交的写入通过原请求核对。

可执行入口：[headless](../../packages/memo/examples/headless.mjs)、[安装消费](../../scripts/consumer-memo.mjs)。运行 `npm run smoke:memo` 只构建并验证 Memo 独立安装包；`npm run test:affected -- --scope memo` 运行核心集合与 Memo 影响域。后续馆员与 History Book 接入见 [tasks](../../openspec/changes/add-memo-knowledge/tasks.md)。
