## Why

M1 提供共享 Session 的隔离 Conversation；M2 需要让真实 MAS 通过受控端口管理成员、分配所有权与通信，并为后续 DevPack 提供可用服务。单纯循环创建并不能保证 membership 原子提交，通信也不能以 caller 字符串自证身份。

## What Changes

- 新增 `@pakka/mas`，bootstrap 返回受信任服务，调用方获得 principal/source/lease 绑定的冻结 client；通信 grant 与管理 grant 分开。
- 在 agent adapter 内新增窄 catalog/runtime 命令：原子 enroll Conversation/config/metadata、CAS state、native submission delivery/receipt、task ownership 与 abort/drain；不导出 Tx 或 Pi handles。
- MAS 定义 preparing/ready/active/stopping/retired/failed 与 unknown，中间态持久保留。配置只选择批准 profile，销毁采用 tombstone，保留历史。
- A2A 保留 native prompt/steer/followUp、精确来源与目标 incarnation、request/payload 冲突及真实生成终态；inspection 不调度。
- 真实 Durable/local HTTP 验证全部边界并独立只读复审。Dynamite 继续 deferred。

## Capabilities

### New Capabilities

- `same-session-mas`: 同 Session membership、principal policy、A2A、任务寿命与明确终态。

### Modified Capabilities

无；M1 legacy Host/runtime 的已验收行为保留。

## Impact

新增 `packages/mas`（生产 import 只从 `@pakka/agent` exports），扩展 agent 的受控 bootstrap port 与 frozen DTO，增加真实 acceptance consumer、workspace/check/build/test 配置。唯一 native mutable owner 仍为 `packages/agent/src/durable-adapter.ts`。跨 Session、worker、DevPack 与对外协议按后续阶段分别验收。
