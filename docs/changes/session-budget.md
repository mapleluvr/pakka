# Session 预算默认不限制

2026-11-27，操作者要求 Session 预算页与真实配置同时以 0 表示不限制。原生接纳、JSON/管理接口及工作台配置读取共同采用，不迁移或重置旧 Session 的有限预算或累计尝试。旧协议不能解码零上限，升级需成对部署。

验证范围与本地证据包见[验证摘要](../verification/SESSION-BUDGET-UNLIMITED.md)。

完整记录：[change](../../openspec/changes/allow-unlimited-session-budgets/)、[proposal](../../openspec/changes/allow-unlimited-session-budgets/proposal.md)、[design](../../openspec/changes/allow-unlimited-session-budgets/design.md)、[tasks](../../openspec/changes/allow-unlimited-session-budgets/tasks.md)、[delta](../../openspec/changes/allow-unlimited-session-budgets/specs/conversation-runtime/spec.md)；相关主规范为 [conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)。当前使用契约见 [Runtime API](../reference/RUNTIME-API.md)、[WebUI 服务](../reference/WEBUI-SERVICES.md)及[安装配对](../../integrations/webui/README.md)。
