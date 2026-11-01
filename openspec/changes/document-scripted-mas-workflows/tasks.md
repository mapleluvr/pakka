# Tasks

## 指南与入口

- [x] 核对公开 Runtime、MAS、DevPack 接口、现有应用指南及可运行脚本。
- [x] 编写面向人和 Agent 的主指南，包含 Mermaid 与代码对应的协作关系。
- [x] 说明业务完成条件、产物／状态的保存、版本、确认与重开行为。
- [x] 采用普通测试 → 确定性推理 → 用户批准真实模型小任务的验证方法。
- [x] 接入产品／MAS state、使用导航与完整 OpenSpec 形成记录。

## 本次检查

- [x] 检查示例与用例语法，重跑两项隔离的本地确定性用例。
- [x] 检查 Markdown 格式和相对引用，校验本 change strict。
- [x] 人工核对 Mermaid 图、文字与实际示例的完成条件和持久化范围。

本次交付的证据范围为文档与本地示例；真实模型试跑按指南在具体 workflow 的用户批准范围内另行安排。

## 实际结果

- `node --check` 对示例与用例均通过。
- `node --test --test-concurrency=1 scripts/workflow-example.test.mjs`：2/2 通过，覆盖正常协作、缺少 A 完成标记与两种结果的重开零额外 HTTP。
- 本 change 的 OpenSpec strict 通过；12 份受影响 Markdown 的 138 个相对路径有效。
- 主指南、产品／MAS state、指南导航、变更摘要和 delta 共 6 个文档的 active LSP 检查无诊断。
- Mermaid 按图中的节点、消息、提交与完成条件对照源码人工检查；本次没有执行 Mermaid 渲染。
