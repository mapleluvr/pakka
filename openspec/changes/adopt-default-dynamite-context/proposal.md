# 默认 Dynamite 上下文策略

## Why

用户在 2026-11-07 的可用性评估讨论中明确选择：Pakka 的配置默认启用 pakka-dynamite。普通产品需要持续处理长任务；先前 native context 默认、Dynamite 全局 opt-in 的声明不再表达产品方向。

## What Changes

- 无参数 `pakka` 的产品装配采用 `@pakka/dynamite` 为默认业务上下文策略。
- 明确产品 bootstrap 的策略生命周期、辅助预算和来源授权责任，以及单一上下文改写所有者。
- 独立 SDK/headless 消费者仍由宿主选择策略；固定旧配对保持原支持范围和证据。
- 同步 state、开发入口、README 与任务。该阶段交付为预期调整；产品默认装配、配置与安装消费尚待实现。

## Capabilities

### New Capabilities

- `default-product-context`: 普通 Pakka 产品默认 Dynamite 上下文管理与可见运行状态。

## Impact

本阶段仅修改文档。后续实现涉及 WebUI bootstrap、策略生命周期、模型/预算配置和跨仓归档消费；不使 `@pakka/agent` 反向依赖 Dynamite，不修改已固定的配对记录。累计投递保留和 HTTP 连接容量属于另行讨论的生命周期与服务要求，不随本选择自动采用候选实现。
