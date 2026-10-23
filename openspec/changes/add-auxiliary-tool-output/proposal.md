## Why

用户要求调研并实现 pakka-dynamite P2/P3/P4 的 Tool Calling 生产。现有 SourceJob.infer 仅传递文本且将 toolUse 当作不完整结果，无法通过受控宿主提交结构化候选。

## What Changes

- SourceJob.infer 增加可选的声明式 outputTool；一次受预算控制的真实推理返回一个冻结的调用 DTO，由调用方校验、持久化和采用。
- Dynamite 显式选择 Tool Calling 模式，一次提交 P1 正文、P2 局部图/P3 注释和 P4 线索，并绑定已有来源、版本、job 和 adoption receipt。
- 为新开发配对建立独立版本、固定归档身份、真实 localhost/仓库外消费者证据；保留已有配对记录。

## Capabilities

### New Capabilities

- `auxiliary-tool-output`: 受控辅助推理的声明式单次工具输出、结果身份和失败语义。

### Modified Capabilities

现有 optional-dynamite-product 的自动装配与已接受范围由其原规格维护。

## Impact

涉及 @pakka/agent 的公开 inference DTO、StrategyControl 请求校验和 Durable adapter。Dynamite 在独立仓库维护 schema、生成/持久化/读取和 state-evo 文档。沿用 Pi 1.0.3 / Durable 1.0.3-pakka.1 的公开 SDK、有限预算、来源重验和不确定持久化闭锁。
