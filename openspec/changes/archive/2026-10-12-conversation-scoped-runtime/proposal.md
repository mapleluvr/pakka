## Why

Pakka 当前只公开单 Conversation host，host 级状态不足以安全承载同一 Durable Session 内的多个 agent。M1 必须先建立独立权限与上下文作用域，才可让后续 MAS/DevPack 使用公共受控端口。

## What Changes

- 保留 `@pakka/agent` 和现有 `createHost()`；增加显式 runtime bootstrap/control 入口，在一个 Harness/Session 中创建并访问多个 Conversation。
- 每个 Conversation 使用独立 Kernel、策略控制、admission/receipt、工具 invocation、projection 和 artifact namespace；Frame/View 添加明确的 Durable Session/Conversation 身份，保留旧 storage/provenance `sessionId` 兼容字段，并显式给出独立的 `providerSessionId`。
- 新 runtime 使用 bootstrap 允许的 profile 和显式有限的 Session 汇总配额，不把模型、路径、原始 Pi handles 或权限授予 agent。
- 普通 Conversation 失败/abort/导航/reload 不撤销其他 Conversation 的能力；未知 storage/commit/extension 错误影响整个 Session。
- 更正旧取消语义：`cancelQueued()` 签名保持同步，但取消请求的快照为 `unknown`，只有原生持久化 withdrawal 的精确确认才能转为 `released`；不再凭 abort 请求立即释放 admission。对应旧测试改为验证确认后的状态，而不是保留不安全的即时状态断言。
- 真实 HTTP 与物理 storage 验证并发、作用域、迟到结果、重开和汇总配额。Dynamite 保持 deferred，且不默认装配。

## Capabilities

### New Capabilities

- `conversation-runtime`: 单 Session 多 Conversation 的受控创建、身份、权限、预算、生命周期和持久化边界。

### Modified Capabilities

无现有 OpenSpec baseline；原有单 Conversation 行为仍由现存回归测试约束。

## Impact

修改 `packages/agent/src/durable-adapter.ts`、`host.ts`、`strategy-control.ts`、公开类型/入口和相关测试、消费者验证与文档。没有新增生产 package、私有 Pi import、原始 Session 导出或外部 Dynamite 修改；不宣称进程隔离、跨 Session 原子性或 A2A 业务语义已完成。
