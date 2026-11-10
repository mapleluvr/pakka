# Memo 知识服务形成记录

用户要求处理 [Issue #9](https://github.com/mapleluvr/pakka/issues/9)，并说明知识服务勾选是误操作。实际基线 dev 55d097c 中 Memo 为空骨架。以提案的知识服务切片作为首先实施的独立消费路径，随后完成可选持久 Patchouli：研究请求和原 Runtime/MAS 绑定持久化，显式推进、无发表完成与取消恢复复用知识权限。History Book、辅助成员和后续界面仍留在任务中，不由这两个切片的完成替代。

采用独立 Memo SQLite 存储域，复用宿主公开身份/来源端口，以逐记录原子提交、原请求回执与有界分页落实长期知识库。包、数据库和运行时 Conversation 分别承担职责。OpenViking/WikiSkill 仍为研究资料，不是运行依赖。

独立双审在知识权限和持久馆员取消边界提出六项阻断：引用过滤后遗漏整体授权、来源 ref 别名、取消意图恢复遗漏、原生取消提交前的跨 run 窗口、业务结束后无法停止原生成、异属数据库预检过晚。真实 SQLite 与 MAS 回归复现对应缺陷；取消提交后仅延迟返回的对照通过。另由协作复核发现非字符串角色能毒化实例。修正采用最终发布核验、独立冻结 provider 输入、只读身份预检及独立持久执行槽位，取消按原身份核对。修正后的独立双 reviewer 复审均为 OK with notes，没有剩余阻断或分歧；实际验证及三项取消覆盖限制见[验证摘要](../verification/MEMO-KNOWLEDGE.md)和所属任务。

当前预期见 [Memo](../state/memo.md)。完整形成材料：[proposal](../../openspec/changes/add-memo-knowledge/proposal.md)、[design](../../openspec/changes/add-memo-knowledge/design.md)、[tasks](../../openspec/changes/add-memo-knowledge/tasks.md)、[delta spec](../../openspec/changes/add-memo-knowledge/specs/memo-knowledge/spec.md)。这是新增领域，尚无归档后的 main spec。
