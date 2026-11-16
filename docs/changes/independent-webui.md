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
- 全部 delta：[independent-webui](../../openspec/changes/plan-independent-webui/specs/independent-webui/spec.md)、[durable-storage-reader](../../openspec/changes/plan-independent-webui/specs/durable-storage-reader/spec.md)、[extension-facet-control](../../openspec/changes/plan-independent-webui/specs/extension-facet-control/spec.md)。尚未完成的整体前端目标继续在该 change 中推进，不提前归档。
- 阶段 1 后续：[原历史只读接缝](../../openspec/changes/plan-independent-webui/readonly-history.md)。用户在核对 .3 opener 的写权限需求后授权独立 reader 生命周期；采用的是原生只读能力及 Pakka 原资源接入，不是删除写方迁移/恢复或提前实现独立 facet 控制。
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

## 只读 SDK 与原资源接入

用户随后批准只读 SDK 扩展。基于固定 Pi 1.4.0 构建 `1.4.0-pakka.4`，由 Chord 提供只读连接/事务/关闭，Durable 提供原生记录、分叉和 document 物化；writer 的迁移与恢复保留。实际探针发现完整 Chord 双副本会丢失 Context 取消信号，因此最终只交付 SQLite companion，主运行时与原公共 Context 保持同一接入关系。

Pakka 将历史 read 授权与“执行资源已加载”分开，再核对确认登记、原身份及当前权限。未加载来源返回保存状态和稳定引用；已加载仍走现有 owner。新公开形状显式采用 services API 2，配对更新客户端与前端 manifest，不修改 workbench/extension/UI SDK 版本。

原生 SDK、真实 HTTP、安装产品与固定资产核对见[只读历史验证](../verification/READONLY-SQLITE-HISTORY.md)，SDK 身份与失效条件追加在[兼容性账本](../PI-DURABLE-COMPATIBILITY.md)。原始扩大回归失败、Windows 长路径控制和上游声明限制保持各自结果。独立 facet 控制与阶段 2 的历史界面/业务插件仍未完成；此次没有把后端可读当作完整 UI 验收。

## 独立 facet 控制

用户继续授权阶段 1 的独立生命周期，随后要求阶段 1 验收后进入阶段 2。逐 facet 发现、控制和资产身份替换整包状态；可信 Agent 定义按批准 profiles 通过公开 Registry 发布，WebUI publication 管理其实例集合。原请求控制回执独立于 Backend operation，清理失败与未确认初始化保持可核对状态。采用过程及取舍见 [facets](../../openspec/changes/plan-independent-webui/facets.md)。

版本核对发现 services API 2 将 extension 版本闭合为 2；因此两者显式配对升级为 3，workbench 保持 2，Node 加载器读取协议常量，前端制品独立声明所需版本，并通过真实装配核对两者。旧默认消费者同步使用正确 facet 身份；停用 Backend 保留已授权命令声明，避免 slash 输入落入模型消息。没有为兼容恢复整包控制 facade。

[独立 facet 验证](../verification/INDEPENDENT-FACET-CONTROL.md)记录真实原生/HTTP/安装/浏览器、回归和保留失败。已批准的后续工作为[阶段 2 最小真实应用](../../openspec/changes/plan-independent-webui/phase-2.md)；本轮不把临时浏览器宿主计为完整 UI，不改变 Provider 登录、默认切换、发包和合并边界。

## 阶段 2 独立应用与 RSI 切片

独立前端形成应用入口、同源开发、registry、GUI-only、原历史和模型/Thinking 设置。Pakka 侧公开现有 `openProductModels` 装配入口，客户端提供独立 Backend binding；RSI 包拥有 React/Astryx 工单界面，读取/编辑复用领域协议。丢响应后按浏览器原请求找外层 operation，再确认 operation.id 对应的工单回执，实例替换不取消已接纳工作。

实际模型分页暴露 Astryx Layer 的固定样式注入，资产格式显式升至 schema 2 并声明有限精确 hash；服务 wire 仍为 services 3 / extensions 3 / workbench 2。安装版生产入口验证许可样式生效、其他 inline style 被拒绝。输入跨重开定位与多设置实例并发记录缺陷经真实响应顺序复现并修正；公共输入回执查询保留在阶段 4。

[阶段 2 核对](../verification/INDEPENDENT-WEBUI-PHASE-2.md)记录干净安装、模型真实请求、双 Session 原历史、RSI 两层回执、publication/撤权清理、移动交互与受影响回归。新增持久测试只覆盖资产 closed decoder，RSI 现有浏览器场景下沉到真实 HTTP 并保留实际 React 界面检查；没有将试用 DOM 固定为长期契约。阶段 3–5、默认切换、发布与合并各自保留未完成状态。

## 阶段 3 固定交付

用户在阶段 2 收口后批准推进。独立前端补齐本地应用 pack 命令，SDK 与应用分开交付；Pakka 的 [integrations/webui](../../integrations/webui/README.md)固定完整归档和对应服务/后端包身份。打包采用 npm 标准格式，核对资产与许可；已有目录、篡改资产和元数据同名覆盖均明确拒绝。

[phase-3](../../openspec/changes/plan-independent-webui/phase-3.md)落实剩余条件；[阶段 3 核对](../verification/INDEPENDENT-WEBUI-PHASE-3.md)记录两个真实前端候选、同一安装版后端 A → B → A、原 Session/Conversation 身份和启动前不兼容拒绝。B 为隔离 GUI-only 变体，不是另一公开发行。阶段 3 已验收；阶段 4–5、默认切换、Provider /login、发布和合并保持各自后续边界。
