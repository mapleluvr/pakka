# Dynamite SQLite 持久化模式

## Why

Dynamite 的计划、推理结果与 P1–P4 产物需要稳定的身份、版本和提交边界，持续运行依赖可重开的工作 checkpoint。宿主当前已有 Pi 1.4.0 的 task/document 基础设施、长期 Compresser Session 与 Conversation 独立封存；SQLite 支持按身份读取历史、原子提交领域关系和控制工作集。

用户已确认采用 SQLite，按内部开发阶段的当前数据布局实施。初步计划先保存在本地执行材料；本 change 承接架构决策、采用的预期、实施任务与实际检查。

## What Changes

- Session 与 Compresser 新建存储采用 SQLite，公开 Storage/Harness API 负责原生记录和事务。
- 宿主提供可等待的领域写入端口，提交产物、采纳回执和对应工作 checkpoint。
- 持久化固定来源的计划、attempt、结果与阶段，按已存事实恢复本地工作。
- 使用固定身份衔接业务 Session 与 Compresser Session，各 Conversation 保持独立计数与 seal。
- SQLite 文件、存储身份、writer、耐久配置和关闭确认形成一致的生命周期。
- 历史与产物读取使用地址、版本、分页和当前已提交投影。

## Impact

- 主要实现：`packages/agent/src/durable-adapter.ts`、`strategy-control.ts`、`artifact-journal.ts` 及公开 Strategy API。
- 策略端：Dynamite 的原文窗口计划、产物提交和工作恢复消费宿主契约。
- 当前声明：[Dynamite persistence](../../../../docs/state/dynamite-persistence.md)。
- 细则：[dynamite-persistence delta](specs/dynamite-persistence/spec.md)、[conversation-runtime delta](specs/conversation-runtime/spec.md)；相关主边界为 [conversation-runtime](../../../specs/conversation-runtime/spec.md)、[optional-dynamite-product](../../../specs/optional-dynamite-product/spec.md)。
- 执行顺序和源码前置条件见 [tasks](tasks.md)；选型、事务域与恢复决策见 [design](design.md)。
