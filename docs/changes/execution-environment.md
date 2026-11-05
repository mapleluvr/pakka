# ExecutionEnv 接入

用户选择保留现有补丁范围，在 1.4.0 基线上形成可调用的执行环境接口，验证后再考虑 MXC。Pakka 使用公开 HarnessOptions.env 和原生文件/命令工具；执行配置、合作工具能力、资源寿命及失败关闭由 adapter 承接。

初次接入沿用 `1.4.0-pakka.1` 的源码 patch、构建锁和 vendor 归档，未增加上游 scheduler 修改。初轮缺失接缝、profile/cwd/重开身份和未 await 操作的 RED/GREEN，以及安装消费范围见[固定检查记录](../verification/EXECUTION-ENVIRONMENT.md)。MXC、插件运行器、Compresser 与 WebUI 装配不在这次采用范围。

## 1.4.0-pakka.2 交付身份

用户随后要求先将接入按 `1.4.0-pakka.2` 命名并提交，再设计独立 pakka-ei 的 MXC 驱动。生产选择切换到 `.2` 的实际 SDK 归档；上游仍为 1.4.0，source.patch 与 `.1` 逐字节相同，构建锁仅改变 Durable workspace 版本。执行环境适配代码保留在 Pakka，不把环境实现加入 scheduler。旧目录、归档与初轮检查记录保留。版本化复建与消费结果见[.2 交付检查](../verification/EXECUTION-ENVIRONMENT-PAKKA-2.md)。

## 完整形成记录

- [Change](../../openspec/changes/add-execution-environment/)
- [Proposal](../../openspec/changes/add-execution-environment/proposal.md)
- [Design](../../openspec/changes/add-execution-environment/design.md)
- [Tasks](../../openspec/changes/add-execution-environment/tasks.md)
- 全部 delta：[conversation-runtime](../../openspec/changes/add-execution-environment/specs/conversation-runtime/spec.md)
- 相关主 spec：[conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)

## 当前产物与证据

- [执行环境声明](../state/execution-environment.md)、[Runtime 声明](../state/runtime.md)、[Durable 补丁声明](../state/durable-patch.md)
- [使用指南](../guides/EXECUTION-ENVIRONMENT.md)、[Runtime API](../reference/RUNTIME-API.md)
- [兼容性账本](../PI-DURABLE-COMPATIBILITY.md)、[实际检查](../verification/EXECUTION-ENVIRONMENT.md)
