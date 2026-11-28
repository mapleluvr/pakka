# Conversation 笔记、原文引用与聊天边界

独立笔记及置顶属于原 Conversation，不属于协作聊天或模型上下文。受权服务用原 Session 的 Store CAS 同时写入对象和原请求凭证；每个 Note 有独立版本，置顶使用对象版本与顺序版本。按 Person、requestId、原意图摘要查询自己的历史回执，查询不产生效果。

存量 schema 3 的聊天记录、聊天消息上的置顶及原操作凭证保留在原服务。首次带内容读取/修改时，从只读迁移口读取非空旧 note，映射为 `legacy-` 加 `sha256(JSON.stringify([sessionId, conversationId]))`。保留原文本、作者、修改时间和版本；不杜撰创建时间，旧条目以最后一次修改信息为唯一已知来源。CAS 保存迁移后再发布，删除后不会再次导入。空白旧文本不生成条目；Pocket v3 的旧 note 修改和 services 6 的旧调用均不能写入。升级须在旧 writer 正常关闭后重开原 Session。

固定候选见[应用配对](../../integrations/webui/README.md)。持续回归选择实际存储/授权风险，不固定 UI 私有 DOM。`apps/webui/test/conversation-notebook.test.ts` 使用真实 Pi/SQLite，覆盖迁移、并发版本隔离、删除关联 Pin 与丢失 CAS 回包后重开、同一 fork 内容的有/无父来源署名、原来源不可用时编辑既有摘录。HTTP 与旧聊天回归另外核对拒绝、actor、原回执和异步发布。
