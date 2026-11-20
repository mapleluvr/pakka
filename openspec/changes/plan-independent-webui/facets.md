# 阶段 1：独立 facet 控制

## 授权与已核对事实

本轮用户授权补齐阶段 1 的独立 facet 控制。继续 8207aa8 / 70e3865 的配对工作分支；完整应用、Provider 登录、默认切换、发包和合并不属于本轮。

采用的 G1/G6 要求各 facet 按需组合、分别启停，UI 卸载不取消所属服务工作。当前源码把 Backend 调用和 WebUI/Client 资产绑在一个 generation/phase；整包 reload 会轮换所有调用身份。Agent 工具则在 approved-profile 启动装配中进入 pi-durable Registry，不由旧 extension host 安装。

核对的公开 pi-durable 1.4.0-pakka.4 / 1.4.0 API 已有 Registry.install/uninstall、不可变 snapshot、按已选 extension 名称重新解析工具/sections。原生 Registry 留在 Pakka durable-adapter 内。该能力足以先实现已批准 Agent 贡献的启停；不为此增加第二套工具 registry 或改装已安装 SDK。

## 选择与职责

比较的两条路线：在旧整包状态上增加四个布尔值，或以 facet 为实际接纳/版本/状态边界。前者仍会让 UI 更新使 Backend generation 失效，也不能表达部分未知初始化；采用后者。旧 WebUI/SDK 无兼容承诺，公开协议按真实变化升级，不保留含混的整包控制 facade。

### 公开发现与身份

- 一个安装来源有稳定 extension id/title；实际批准的 Backend、WebUI、Client、Agent 各自返回类型明确的 registration、version、generation、phase。
- 发现声明、受信任安装选择、当前 enabled/unknown、资源权限是不同关系。未批准的 Agent 声明不是已启用工具，浏览器不能提供代码路径、原生对象或更强 profile。
- Backend actions/commands、WebUI interfaces/commands 和 Client entry 按各自当前 registration 发表。公开面不再以一个整体 phase/generation 表达所有 facet。
- Backend call 使用 Backend generation；WebUI/Client 资产 URL 明确 facet 和 generation。改动一个 facet 不替换其他 facet 的有效身份。
- 服务 API、extension wire、UI SDK/renderer 各自演进：本次 extension wire 升到 3；源码核对发现 services API 2 把 capabilities.extensions 硬编码为 2，因此 services 也升到 3，workbench 保持 2。新能力响应中的其他协议版本是有界的声明值，由实际消费者独立判兼容；不再让更新 extension 必然更改 services 的字段形状。固定前端 manifest 同步要求 services 3 / extension 3。

### 分 facet 控制与回执

控制请求包含 extension、facet、enable/disable/reload、预期 generation 和稳定原 requestId。宿主绑定当前 Person，要求 extensions.install，在接纳和受控效果前重验；不把 lookup 当成再次控制。

相同原请求返回原控制结果；同身份不同参数拒绝。控制效果开始后异常、丢响应、未确认初始化不解释为未发生。控制回执与 Backend 业务 operation 分开，均复用现有公开 Runtime records；不建立领域业务账本。返回的是该请求当时的结果，当前状态另行发现。

Backend disable 停止该注册的新调用及未通过有效性检查的后续效果；已接纳的独立持久 job、历史及原请求回执由原服务继续管理。UI/Client disable 控制其公开装载资格，不声称能撤回已交付给浏览器的字节。原资源服务的 dispose 仍属于资源所有者，不因关掉某个 UI 或 RPC 入口而销毁。

Backend 初始化 loading/unknown 必须持久记录；重开不自动重入未确认代码。准备失败保留仍确认的原 registration；初始化有未知效果时只封闭受影响 facet。旧保存的整体 disabled / Backend unknown 需被保全为相应 facet 状态，不能因本次改造重新激活。

### Agent 接缝

Pakka Agent SDK 提供可信启动使用的受控 Agent 贡献，固定 id/version、明确 profiles、工具和指令。贡献默认关闭；Runtime 只在批准 profile 中把当前贡献组合到其原生 extension。启停通过原生 Registry 的同名发布体现，既不向所有 profiles 安装，也不改变 Conversation 身份/配置或重启 Harness。

控制端与贡献定义由可信 composition root 接线，WebUI 只获得绑定后的控制能力；Agent-only 消费不安装 WebUI。Native Registry、工具执行 API 和 Session 对象不离开 durable-adapter。

停用阻止新工具调用并移除后续请求的对应工具/指令；旧已接纳调用与持久工作不因 UI/Client/Backend 开关被取消。旧注册的延迟调用须按自身有效性拒绝，不借重新启用恢复旧调用资格。Agent 代码更新仍以可信启动提供的定义/版本为界，浏览器 reload 不成为任意模块安装器；未有对应新定义时明确拒绝，而非假装热更。

### UI 实例接缝

纯浏览器 SDK 形成一个 WebUI facet generation 下的实例集合。禁用或替换该 generation 时清理其实例与订阅/监听/计时器/可中止读取，晚到结果不能更新新实例。其他 facet generation 变化不触发 UI 清理；UI host 不持有后端控制 URL 或持久任务取消权。

该接缝由真实消费检查驱动，不在阶段 1 建完整 registry、路由或产品页面。

## 验证选择

1. Agent：真实 Runtime/本地确定性 provider 核对工具与指令是否实际进入请求、native 工具是否执行、profile 隔离、关停/再启用的旧调用与已接纳工作边界。新增必要回归只保护这条此前不存在的能力启停边界。
2. 服务：真实 HTTP 分别控制四类 facet；UI/Client 操作不增加模型调用、不改 Backend/Agent 身份；Backend 未确认初始化不封死健康 UI；错误 generation/权限拒绝，丢响应只查原控制回执；产品重开保全 disabled/unknown。
3. UI：公开 SDK 消费者核对 generation 实例集合的清理与旧回调，必要的真实浏览器检查不宣称完整应用验收。
4. 独立安装：实际协议/client/UI SDK 和产品归档，以真实公开导入/类型/执行验证；不使用 sibling 源码、根 overrides、第二份 React 或手改依赖。
5. 复用现有 extension 原请求、资产、ingress、权限、初始化、RSI/MAS 和 Agent 恢复回归，按实际改动维护 test-selection。原 Windows 长路径与上游严格声明限制保留，不为变绿放宽门禁。

过程探针放 docs/.temp/facet-control/；关键结果另入 verification，原始证据仅本地保全。文档或类型通过不勾选后续 UI 产品任务。
