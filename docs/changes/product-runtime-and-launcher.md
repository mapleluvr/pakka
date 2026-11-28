# 可演进 Runtime 与默认 WebUI 入口

2026-11-06，用户要求解除早期固定装配留下的产品限制，完成 pakka → WebUI。先采用原生模型/配置与默认入口，随后按依赖推进恢复、资源、上下文和生命周期；安全、一致性与原生身份继续约束实现。

完整记录：[change](../../openspec/changes/enable-product-runtime-and-launcher/)、[proposal](../../openspec/changes/enable-product-runtime-and-launcher/proposal.md)、[design](../../openspec/changes/enable-product-runtime-and-launcher/design.md)、[tasks](../../openspec/changes/enable-product-runtime-and-launcher/tasks.md)。Delta：[runtime](../../openspec/changes/enable-product-runtime-and-launcher/specs/conversation-runtime/spec.md)、[WebUI](../../openspec/changes/enable-product-runtime-and-launcher/specs/pakka-webui/spec.md)。相关声明：[Runtime](../state/runtime.md)、[WebUI](../state/webui.md)、[前端](../state/frontend.md)、[产品](../state/product.md)；相关主场景：[Conversation runtime](../../openspec/specs/conversation-runtime/spec.md) 与 [WebUI 当前场景](../../openspec/changes/pakka-webui/specs/pakka-webui/spec.md)。

原生模型/认证、预算与配置演进、Session 隔离、默认本地执行及 `pakka → WebUI` 的固定候选、实际安装和回归见[交付记录](../verification/PRODUCT-RUNTIME-LAUNCHER.md)。长上下文、受控重试、附件与长期容量治理保留在 tasks，不因入口切片交付而算作完成。
