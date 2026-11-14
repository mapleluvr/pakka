# 独立 WebUI 与通用插件规划

2026-11-14：用户采用独立 pakka-webui、React 19 / TypeScript/TSX / Astryx、`/pakka-webui` 服务命名空间、配置作用域、固定前端制品及分阶段推进；随后要求读取通用插件能力需求并继续修订规划。**初轮只调整预期和规划；随后执行阶段 0 盘点，仍未实现新前端/接口、创建远端仓库或发布产物。**

## 采用与调整

- “同一产品包内分层”调整为独立前端宿主与 Pakka 接入层；Node 产品装配和 Backend 能力留在 Pakka。默认 `pakka` 仍提供固定版本/hash 的前端。
- 当前模型/Thinking 归 Conversation，人类默认归 Person 并由后端跨设备保存，提供商/端点/模型定义归实例配置权限。模型命令和点击/触控共用业务操作；Provider `/login` 交互待用户敲定多端偏好后再设计。
- 用户明确旧 Preact 插件不迁移，旧 WebUI/SDK 按无用户处理；撤下兼容 facade、旧插件移植、必须保留旧默认入口的安排。仍需业务功能由新 SDK 消费，原 Session、权限、凭据、持久记录和已接纳工作不随 UI 清理删除。
- 吸纳 G1–G6 通用插件要求。RSI/MAS/Memo 的可视化、业务控制和管线属于插件；认为公开能力不足时先给通用缺口证据，不把领域模型放入核心。
- 明确按稳定引用跨 Session 浏览原 Conversation；已有多 Session/导航基础不误列为从零新增。通用资源视图、原身份与未加载状态需要进一步核对；全 Session 自动发现/总览/全局搜索没有被本次采用。

[产品](../state/product.md)与 [WebUI](../state/webui.md)维护当前预期，[架构说明](../development/WEBUI-ARCHITECTURE.md)区分现有源码和目标职责，前端指南、仓库规则和 AGENTS 同步消除旧“单一产品包/必须兼容”路线。旧研究结论仍作为其原时点记录，不倒写成曾经已经采用分仓。

## 来源与证据边界

用户指定的 [WEBUI-PLUGIN-CAPABILITIES.md](https://github.com/mapleluvr/pakka/blob/170aa153e7dad0cda8f6172665d709407dfa703a/docs/requirements/WEBUI-PLUGIN-CAPABILITIES.md) 固定于 `pakka/history-book@170aa153e7dad0cda8f6172665d709407dfa703a`；[参考分支交接](https://github.com/mapleluvr/pakka/blob/170aa153e7dad0cda8f6172665d709407dfa703a/docs/changes/history-reference-branches.md)限定其为开发候选，不是必须合并或照搬的产品基线。

规划修订时成功 fetch 的 dev 为 `cc1cdd8aead42cd0afe018c75973f09fd369184d`。实际阅读了 WebUI package exports、extension/ui/client/backend 声明、HostInterface、App 导航，以及 AgentRef 和公开 PocketConversationSource；逐 G1–G6 初步路径见设计。那次只做关键抽查，未把源码、参考分支已有局部验证或文档检查算作新 SDK 的独立安装/GUI 通过；随后完成的阶段 0 见下文。

## 完整 OpenSpec 与后续

- [Change](../../openspec/changes/plan-independent-webui/)
- [Proposal](../../openspec/changes/plan-independent-webui/proposal.md)
- [Design：能力映射、最小接口分工、风险与阶段 0–5](../../openspec/changes/plan-independent-webui/design.md)
- [Tasks：规划、已实施接缝与未完成产品工作](../../openspec/changes/plan-independent-webui/tasks.md)
- [Phase 1：新 SDK/服务/模型/资产消费边界](../../openspec/changes/plan-independent-webui/phase-1.md)
- [Inventory：阶段 0 功能/入口/消费者归属、缺口及真实切片](../../openspec/changes/plan-independent-webui/inventory.md)
- 全部 delta：[independent-webui](../../openspec/changes/plan-independent-webui/specs/independent-webui/spec.md)。这是新增目标能力，尚无对应主 spec，未归档为已实现。
- 相关原活动声明：[pakka-webui](../../openspec/changes/pakka-webui/specs/pakka-webui/spec.md)、[webui-extensions](../../openspec/changes/pakka-webui/specs/webui-extensions/spec.md)，完整来路见[WebUI 与 MAS](webui-and-mas.md)。其中后端服务、权限与效果要求继续有效；本次明确替代的是独立前端的包/renderer/插件边界。
- 相关未改主 spec：[recoverable-multi-session](../../openspec/specs/recoverable-multi-session/spec.md)、[authenticated-mas-apps](../../openspec/specs/authenticated-mas-apps/spec.md)。
- 设计系统比较与原始文档交付：[WebUI 设计原则](webui-design-principles.md)。

阶段 0 之后从阶段 1 的独立消费与通用接缝开始，不直接大规模重写页面。最小真实切片覆盖 GUI-only、新 SDK 业务插件、模型访问和跨 Session 原历史；实际建仓、发布、集成与产品验收各有自己的条件。

## 规划修订时的检查

完成文档 diff/产物范围、来源/措辞对应、内部链接/锚点、格式、主动 LSP 和 OpenSpec strict 检查，见[核对记录](../verification/WEBUI-DESIGN-PRINCIPLES.md#独立前端规划修订)。未选择产品构建、运行、模型、GUI 或安装验收，未新增永久测试；它们不因规划完成而记为通过。该次本地提交 `bb3f7c7`，未推送或更新/合并 PR。

## 阶段 0 执行

用户随后授权执行阶段 0，仅在必要节点确认。本次重新 fetch 后基线未变，完整盘点 587 个源码文件、37 个 package exports、浏览器网络/资产、manifest/构建和已知跨仓引用；关键路径逐项阅读，JS 与声明图分别投影。结果按功能/服务/插件所有者归入 [inventory](../../openspec/changes/plan-independent-webui/inventory.md)，并与旧 backlog 分开。

重点发现：混合安装依赖仍未解开；现有可信资源来源不提供未加载原 Session 的历史读取；插件资产 query 丢失 Session 身份；public reconnect 仍按单 Session 校验；浏览器控制是整个 extension 而非独立 facet；默认 Node 装配仍自己读取前端文件。它们是阶段 1 的具体接缝，不是要求新建领域核心 API，也不是本轮已经运行复现/修复的故障。

固定后续 UI Playground、RSI 读取/编辑、同号 Conversation 的双 Session 原历史及模型/Thinking/参数编辑切片；固定的是对象和数据生成/验收路径，不是假定新 UI 或数据库已建好。配置作用域、旧 Preact 不迁移、Provider `/login` 延期和少测试政策没有改变。

[阶段 0 核对](../verification/INDEPENDENT-WEBUI-PHASE-0.md)保存实际方法、结果/限制和完整本地证据包身份。阶段 0 tasks 完成，阶段 1–5 保持未完成；产品、依赖和测试不变，未创建新仓或发布包。文档按工作分支流程提交/推送并更新已有 PR #13，不合并。

## 阶段 1 接缝执行

按用户授权在新前端仓库形成全新 UI SDK 与共享 runtime，后端提取 protocol/client 并接通新命名空间、受权原生配置、Person 默认与固定资产装配。原始和新实例能力分别验证；未加载原历史及独立 facet 控制仍缺实现，阶段 1 不标全完成。

边界与实际出口见 [phase-1](../../openspec/changes/plan-independent-webui/phase-1.md)、[服务手册](../reference/WEBUI-SERVICES.md)；源/安装/真实 HTTP/浏览器和丢响应结果见[阶段 1 验证](../verification/INDEPENDENT-WEBUI-PHASE-1.md)。选择 68 回归文件且只新增一个必要实服务测试文件，保留 UI 低固化政策；模型私有子树先脱敏后公开校验，不复制配置 registry 或削弱 wire 校验。完整产品任务、Provider 登录、默认切换、发行与合并各自未完成。
