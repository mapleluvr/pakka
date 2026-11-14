# WebUI 设计系统与开发原则

用户要求对比 Astryx 的同类开源设计系统，建立高可维护性、高开放性、低固化的 WebUI 原则，以及人类可直接定位的目录、抽象与接口说明；并明确允许更换技术栈，重构初期尽量少写测试，只有极必要时才补测，该指令优先于 Ockle TDD。

本次交付是[选型调研](../development/WEBUI-DESIGN-SYSTEMS.md)、[前端原则](../development/FRONTEND-GUIDELINES.md)和[架构／接口说明](../development/WEBUI-ARCHITECTURE.md)。现有入口与推荐目录分开说明；React 19 / TSX / Astryx 是首要评估路径，没有在本次变更里改动产品代码、依赖、资产或测试。授权、持久化、原请求／unknown、默认扩展与第三方同槽等既有契约继续有效。

原则通过 [frontend state](../state/frontend.md)、AGENTS 和开发／验证入口接入。完整比较条件、实际查阅范围与未执行试用见调研；生产 runtime／SDK／视觉切换由后续明确切片接续，不用本次文档校验代替实际消费证据。

## 完整 OpenSpec

- [文档归档目录](../../openspec/changes/archive/2026-11-13-establish-webui-design-principles/)
- [Proposal](../../openspec/changes/archive/2026-11-13-establish-webui-design-principles/proposal.md)
- [Design](../../openspec/changes/archive/2026-11-13-establish-webui-design-principles/design.md)
- [Tasks](../../openspec/changes/archive/2026-11-13-establish-webui-design-principles/tasks.md)
- Delta specs：无；本次为开发方法／文档，`skip_specs: true`。未修改或建立产品主 spec。
- 相关现行契约：[pakka-webui](../../openspec/changes/pakka-webui/specs/pakka-webui/spec.md)、[webui-extensions](../../openspec/changes/pakka-webui/specs/webui-extensions/spec.md)。两者尚无主 spec，仍由原活动变更维护；完整原变更引用见[WebUI 与 MAS](webui-and-mas.md)，本次未重写这些契约。

验证结果与本地证据包整体身份见[验证摘要](../verification/WEBUI-DESIGN-PRINCIPLES.md)。工作分支交付、dev 集成、发布与 OpenSpec 归档分别记录；本次不合并或发布。
