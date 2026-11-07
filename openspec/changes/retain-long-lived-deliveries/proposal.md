# 长任务的投递持久化

## Why

用户明确要求持久化服务漫长任务，并移除累计投递次数这个接纳指标。用户使用 Magic Context 时，完整历史可增长到接近半 GB，模型请求只携带尾部和压缩文本；这是完整持久历史与当前上下文分工的使用依据，并非 Pakka 的性能验收。

现有 WebUI 为同一 Session 的 workspace Catalog 设置 512 笔终身投递额度，跨 Conversation 共享。早期 MAS 用这个上限约束单文档增长，并保留全生命周期去重；没有发现 512 对应产品使用规模的依据。提升常数仍将历史保留转化为工作区寿命。

## What Changes

- 同 Session Catalog 按请求 ID 独立持久保存投递，接纳只核对当前收件人的未完成集合。
- 移除累计投递拒绝；旧 maxDeliveries 只作为已弃用兼容输入。保留 maxPending、权限、预算、单次载荷和 unknown 语义。
- 通过原生原子提交将 v1 历史迁移为 v2 索引与独立记录，保留原身份和回执。
- WebUI、server、worker 和公开示例使用无累计额度的配置。

## Scope and Evidence

本变更覆盖同 Session Catalog，含 WebUI workspace 与 MAS/worker 的目标接纳账本。跨 Session broker 的独立 outbox、展示回执容量及上下文治理各有所属生命周期工作。本次没有把这些不同数据集混成同一额度，也没有据此宣布全部长期容量问题已完成。

默认 Dynamite 的产品决定由 PR #3 的独立 change 承接；本变更基于 dev，保持该 PR 的内容与交付范围独立。

验证使用合成数据、本地确定性 provider 与真实 SQLite，不复制用户会话。方法和实际结果见 tasks 与验证记录。
