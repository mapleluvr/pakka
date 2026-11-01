# Dynamite SQLite 持久化模式

用户在 JSONL 空间和持久工作调查之后确认 SQLite，并指定参考 Pi Durable 作架构决策。数据布局按内部开发阶段建立；原生持久化、领域提交、工作恢复和地址读取按依赖分阶段实施。

当前预期在 [state](../state/dynamite-persistence.md)。完整形成与任务入口：

- [change](../../openspec/changes/adopt-dynamite-sqlite-persistence/)
- [proposal](../../openspec/changes/adopt-dynamite-sqlite-persistence/proposal.md)
- [design](../../openspec/changes/adopt-dynamite-sqlite-persistence/design.md)
- [tasks](../../openspec/changes/adopt-dynamite-sqlite-persistence/tasks.md)
- [完整 dynamite-persistence delta](../../openspec/changes/adopt-dynamite-sqlite-persistence/specs/dynamite-persistence/spec.md)
- [完整 conversation-runtime delta](../../openspec/changes/adopt-dynamite-sqlite-persistence/specs/conversation-runtime/spec.md)
- 相关主边界：[conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)、[optional-dynamite-product](../../openspec/specs/optional-dynamite-product/spec.md)

宿主基线 ec173fd、SDK 1.4.0-pakka.1；本次两份归档、源码基线和实际检查固定在 [SQLite 配对](../../integrations/dynamite/sqlite-persistence-pairing.json)。[原 Compresser pairing](../../integrations/dynamite/compresser-conversation-pairing.json)保留原身份。workingTree 描述验证归档的构建时身份，产物按具体 hash 识别；随后保存的两仓实现见[源码关联](../../integrations/dynamite/sqlite-persistence-source-commits.json)，执行细节和接续由 tasks 承接。
