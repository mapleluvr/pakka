# ExecutionEnv 接入

## Why

用户于 2026-11-05 决定保留当前补丁范围，在 1.4.0 基线上接入 ExecutionEnv 并验证可用性，随后再考虑 MXC。调查确认 Durable 已提供公开 HarnessOptions.env，Pakka 尚未接出环境及原生文件/命令工具。

## What Changes

- 可信宿主按 Conversation/profile 提供有版本身份的执行环境；adapter 使用公开 env。
- 显式装配原生文件/命令工具，合作工具通过有效 invocation 取得冻结的中性能力。
- 明确指纹、失败关闭、取消、句柄与 owner cleanup，加入真实本地回归和使用指南。
- 现有 block/check/settlement 契约保留；仅在复现原生缺口时修订 Durable source patch。
- 后续采用用户指定的 `1.4.0-pakka.2` 交付身份：重建精确 SDK 归档、切换生产依赖并复验后提交；SDK 源码补丁语义保留。

## Scope

本次验证本地驱动和可替换驱动的接缝，不实现 MXC、不隔离恶意插件、不升级 1.5.x，不改造辅助 Compresser 或 WebUI 装配。

## Impact

@pakka/agent 的宿主 API、durable adapter、测试和文档。变更属于 conversation-runtime 的补充。
