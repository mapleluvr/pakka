# RSI 工单薄层与 Memo 初始化

操作者要求在 monorepo 初始化 `pakka-rsi`、`pakka-memo`，先实现 RSI 薄抽象层，并先抓取 remote dev。采用 `@pakka/rsi` 的持久工单、当前身份/简单角色、非阻塞建单、作者编辑、状态观察、MAS 显式派发和公开 WebUI 贡献；Memo 只保留可构建入口，功能语义留待单独讨论。

实现以成功 fetch 的 dev `e7c938ef3b7c2005ef9db319bd84598c25ab8b23` 为基线，在独立 `feat/rsi-ticket-layer` 工作树完成，保留原 checkout 的未提交工作。默认研究/构建/评估/应用流程仍是工单消费者，本次只交付能实际启动的装配示例，不固定业务阶段。

## 完整形成记录

- [change 目录](../../openspec/changes/add-rsi-ticket-layer/)
- [proposal](../../openspec/changes/add-rsi-ticket-layer/proposal.md)
- [design](../../openspec/changes/add-rsi-ticket-layer/design.md)
- [tasks](../../openspec/changes/add-rsi-ticket-layer/tasks.md)
- 全部 delta：[rsi-tickets](../../openspec/changes/add-rsi-ticket-layer/specs/rsi-tickets/spec.md)
- 新增 capability 暂无同名主 spec，尚未归档；相关既有主规格：[conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)、[same-session-mas](../../openspec/specs/same-session-mas/spec.md)。

## 当前声明与验证

预期入口为 [RSI state](../state/rsi.md)，细则为 [RSI API](../reference/RSI-API.md)，实际使用见 [package README](../../packages/rsi/README.md)。原 PR #5 的固定候选为 `cb6eea9dbe284b78c302476f435e4b4663d631da`；本轮重新交付和验证由 [长期持久化](rsi-persistence.md)承接，原始证据不重复提交。

选择真实 Runtime/SQLite、确定性 provider、native tools、MAS、实际浏览器、公开类型与仓库外安装检查。原 #5 交付当时遵循操作者不使用 subagent review 的要求，由主会话完成核对；未选择独立子代理 GUI/对抗复审或付费模型试跑。这些确定性检查证明服务边界，不证明模型研究或构建能力。
