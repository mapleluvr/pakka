# Pakka-Pocket 准备与迁移计划

状态：**已进入实施，产品尚未验收**。P0 已固定来源与页面/action ledger；[P1 受控服务](PAKKA-POCKET-P1.md)已增加人类身份、人工工作区、有限历史分页、原生后台任务及独立 v2 协议/client。阶段门禁见 [P0 记录](PAKKA-POCKET-P0.md)、P1 记录和 [P2 实际工作台](PAKKA-POCKET-P2.md)。P2 已创建有真实安装消费者的 `@pakka/webui`，贯通多人邀请、Cookie/RPC/SSE、原生输入与 TLS 代理；完整 UI、扩展宿主与 MAS Board 仍在后续阶段。没有迁移旧数据。实施入口为 [pakka-pocket-webui](../openspec/changes/pakka-pocket-webui/proposal.md)，技术决策见 [design](../openspec/changes/pakka-pocket-webui/design.md)，开发约定见 [WEBUI-DEVELOPMENT.md](WEBUI-DEVELOPMENT.md)。

## 1. 已确定的产品目标

1. 单一产品包 `@pakka/webui`，产品名 Pakka-Pocket，收编 pi-pocket 的 UI 和 Web 产品基座，计划源目录为 `apps/webui`。
2. 不导入旧 pi-pocket SQLite、用户、邀请、settings、pending task 或 transcript；新产品使用独立数据目录。
3. 完全移除旧 subagent backend/authority，以及 PiP（Pi in Pocket）专用助手。不是关掉工具而保留隐藏 scheduler/documents。
4. MAS Board 和可复用的 subagent UI 改为 `@pakka/mas-devpack` 的可选 WebUI/Backend/Client facet。普通 Conversation 工作台不依赖该界面。
5. 同步保留多人、邀请、远程与移动体验；局部阶段可以先本机开发，最终不能用单人 loopback 子集宣称迁移完成。
6. 扩展可选 Agent、Backend、WebUI、Client 四面。授权安装者添加插件即确认代码可信，不建设不可信插件沙箱；普通用户业务权限仍由服务端执行。
7. 自定义 Preact sheets/panels/pages、settings、导航、slash command 和自定义 backend RPC 是公共扩展能力。MAS Board 不使用特权内部旁路。
8. Slash command 默认是人的操作，不自动创建模型输入、推理或 requester 变化；显式发送任务的 action 才进入受控模型路径。

这是用户对后续产品范围的调整，不重写 M1–M6 的 headless 验收，也不自动扩大 [Dynamite 已验收配对](DYNAMITE-PRODUCT-ACCEPTANCE.md)。

## 2. 固定来源与现有基线

| 材料               | 固定身份                                                                                                                          | 用法                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Pakka              | `90a235f`；agent `0.5.0` / Durable `1.0.3-pakka.1`                                                                                | 本轮准备基线；旧消费者与 patch 账本保留                               |
| pi-pocket upstream | [de612d5622cdc66b6b8b4900c650c6f2efdf4c63](https://github.com/TannerMidd/pi-pocket/tree/de612d5622cdc66b6b8b4900c650c6f2efdf4c63) | UI、交互、目录和多人/远程功能调查；该 package 使用 Pi/Durable `1.1.0` |
| Native commands    | [2cb652c465f670ba8c66fc3ee639798caca8afbc](https://github.com/mapleluvr/pi-pocket/tree/2cb652c465f670ba8c66fc3ee639798caca8afbc)  | issue #35 Phase 1：人工命令、toast/card 与稳定请求身份                |
| Native interfaces  | [58a4fdcc88ed755023aea9fac897735fca7396fe](https://github.com/mapleluvr/pi-pocket/tree/58a4fdcc88ed755023aea9fac897735fca7396fe)  | Phase 2：叠在 Phase 1 上的 Preact interface、RPC/assets generation    |
| 讨论来源           | [issue #35 及评论](https://github.com/TannerMidd/pi-pocket/issues/35)                                                             | 需求与已存在实现线索，不是 Pakka 的通过证据                           |

准备阶段的调查副本位于被忽略的 `artifacts/research/pi-pocket/`；当时没有执行 upstream suite，评论自报数字不是本仓验收。P0 实施已经独立重跑主树：548 项中 378 pass、40 fail、130 skip，安装与 check 通过；失败原样保留，见 [固定基线](../integrations/pocket/upstream-baseline.json)。

P0 采用上表主 UI 树，Phase 2 是独立旧分支（Durable `1.0.2`），没有包含主树的 Durable `1.1.0` UI；两者共同祖先为 `096b7e198cb69846ce91ca45a18d144f688d478e`。[来源锁](../integrations/pocket/source-lock.json)、[61 个 Web 模块映射](../integrations/pocket/adoption-map.json) 与 [重现脚本](../integrations/pocket/README.md) 固定 ancestry、代码/字体许可证及逐文件来源。采用 MIT 代码保留 copyright/license；字体等其他资产单独核对授权。只收编所需 UI，不复制另一套 `node_modules`、Harness、SQLite writer、provider registry 或用户 sign-in discovery。

## 3. 来源到目标的迁移清单

下表是必须在 P0 细化到实际页面/action/test 的工作清单，不表示对应能力已迁移。除用户明确删除的旧 subagent/PiP authority 外，不用静默删控件缩小完成范围。

| 来源/能力                                                           | 目标归属                        | 必须替换或核实的部分                                                      | 关键验收                                                  |
| ------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `web/app.js`、composer、Conversation timeline                       | WebUI 基础壳层                  | 以受控 Conversation/read DTO 替换 PocketApp/Room store 耦合               | 实际输入、native steer/followUp、tool result、断线重连    |
| session list、peek tiles、launcher、主题/移动布局                   | 基础壳层 + 通用 view slots      | UI session 标签对应 Conversation，不改写 Pakka Session 身份               | 桌面/手机导航、多个 live view、可见域过滤                 |
| `web` 中 subagent board/bar、member tile                            | MAS DevPack WebUI facet         | 只复用展示/交互组件，状态来自 MAS；generic shell 不持有 member store      | 安装/关闭贡献、真实创建/通信/退役、未知结果展示           |
| `extensions/subagents.ts`、SubagentsDoc、reporter/courier/anchor    | 删除旧实现                      | 包括 app/projection/http 对这些路径的引用；不用删除 UI 代替拆除 authority | 生产 import/产物审计 + Board 在新路径上的行为             |
| PiP extension、专用 Conversation、特权跨会话管理                    | 删除旧实现                      | 不移植隐藏助手、PiP 专有跟踪/dispatch；独立保留功能另找真实归属           | 无后台隐式模型请求/Conversation，产物不含 PiP authority   |
| `auth.ts`、sign-in、people/invites、QR、角色                        | WebUI backend 的人类身份服务    | 当前 principal、作用域、邀请并发消费、expiry/revoke、session rotation     | 两人真实浏览器、一次链接竞争、重启后不复活撤权            |
| side chat、presence、notes、pins/reactions、take turns              | 通用协作服务/界面               | 私有人类数据与模型输入隔离；notes 冲突和 driver 在效果时重验              | 两人并发、更换 driver、provider payload 无旁聊            |
| `extension-commands.ts`、`extension-sheets.ts`、extension UI        | 通用扩展宿主                    | 不搬运原始 Tx/DocumentReader/PocketHost；扩充为公共多界面 slots           | typed/tapped/button 同路径、custom Preact、普通第三方示例 |
| files/changes、git branch/worktree views、exports/uploads/artifacts | 对应受控服务与 UI/可选贡献      | 文件根、path/size/MIME、工具/文件权限、HTML sandbox 和导出域              | 隔离文件夹真实读/改/拒绝；泄漏与 XSS canary               |
| approval/browser panels                                             | 通用 view slot + 实际服务贡献   | 审批必须绑定真实 pending call；browser 操作绑定批准资源，不能只移画面     | 显式批准/拒绝真实 call、scope 变更、browser 实际动作      |
| model/provider、settings、budget、notifications                     | owner/scoped settings 与服务    | 公开选项/私密配置分离，模型只选批准引用，saved secrets 不回传             | 配置影响后续真实行为；通知按用户/资源过滤                 |
| upstream memory/plan/goals/schedules 等可选界面                     | 逐项映射到独立通用贡献/受控后台 | 不以直接加载原 Durable extension 兼容替代迁移；不自动接回 PiP             | P0 登记保留位置、后端与测试；P5 清单逐项闭合              |
| launcher local/LAN/tailnet/tunnel                                   | WebUI 产品启动路径              | 明确 TLS/proxy/auth 边界；不放宽 headless v1 默认入口                     | 实际代理+浏览器测试，真实外部部署另记测量身份             |

## 4. 依赖顺序与退出条件

```text
P0 来源/界面清单/原生端口可行性
 ↓
P1 受控读写与人类授权契约
 ↓
P2 @pakka/webui 基础产品 + 多人/邀请/远程基础链路
 ↓
P3 通用四面扩展宿主 + 非 MAS 独立示例
 ↓
P4 MAS DevPack WebUI/Backend/Client + Board
 ↓
P5 补齐原 UI/协作功能与各远程模式，关闭迁移清单
 ↓
P6 真实安装/浏览器/隐私/恢复/独立复审与交付
```

### P0 — 先证明边界，不先搬大仓

- 固定 adopted commit、Phase 1/2 ancestry、license/asset provenance 和最小保留清单；记录 upstream 与 Pakka 的实际基线失败，不沿用自报数字。
- 针对公开 Durable/adapter 跑最小真实反例：完整 committed display projection、display-only append、受控后台 job/取消、效果时人类权限检查。测试使用独立数据和本地 provider。
- 确定有无必要的新 public port/版本 delta；若需要 patch，先保留失败与追加式兼容决策，不以私有 import 解围。
- 明确 action-to-service/read-model 对应和每个 store 的 writer。界面是否进入模型上下文、谁能看/操作、效果是否可重试必须能回答。

退出：固定来源可重取；所有必需界面都有目标归属与测试计划；原生端口缺口有测量和明确决策。不以整包升级 Durable/加载原 PocketHost 跳过此阶段。

### P1 — 受控读取、身份和协议

- 在 adapter 内提供最小只读/显示/job 能力，对外仅 DTO 和绑定命令；区分人类 read 与 MAS send/discover。
- 定义 Pocket 版本化协议、独立 browser client export、people/invite/session 元数据、每 action 的有限 schema/预算/超时；原 v1 原样保留。
- 建立 human actor 到 Agent profile 的 ceiling；未证明的 profile-changing action 继续拒绝，不能因为有 UI 就解除 M6 guard。
- 补 public broker receipt 的 exact endpoint/namespace provenance，若不暴露则保持原边界；不将 shape decode 当送达证明。

退出：真实读/显示/任务、跨身份读取、迟到撤权、假 grant/来源、lost receipt、存储未知有失败先行回归；捕获下一次 HTTP 验证 display-only 内容和私密字段不入模型。

### P2 — 最小可启动产品但不缩减最终范围

- 创建有真实消费者的 `apps/webui`（`@pakka/webui`），接入 workspace/build/check/pack；不新建独立 SDK/转发包。
- 迁入基本壳层、登录、Conversation/工具呈现、输入与导航；不依赖 MAS Board。
- 接通多人身份、邀请、view/drive/admin、Origin/CSRF、HTTPS/proxy、SSE snapshot/cursor/gap；所有路由服务端过滤。
- 保留 headless CLI/client 和单 writer；新数据目录不探测旧 Pocket 数据或用户凭据。

退出：真实两个浏览器完成 invite、不同角色、普通工作、实时更新及撤权；未授权浏览器不能拿到 payload。最小产品是阶段证据，不叫完整 UI 迁移。

### P3 — 用非 MAS 扩展先验证公共性

- 明确一份 manifest/compatibility 与可选 facets；纯 SDK exports、宿主单 Preact、namespaced commands/RPC/events、settings/storage/job 边界有独立类型消费者。
- 提供 GUI-only 示例和带后端设置的示例，不是只为 MAS 命名的假接口。
- typed/tapped/button 统一执行；toast、shared card、interface、receipt 结果分开；稳定请求身份和 unknown 状态可核对。
- 实现 registration generation、asset bytes、failed reload、旧实例和旧 calls 拒绝；明确不能回滚任意 import/handler 效果。

退出：示例从干净安装产物加载，slash 操作影响其真实运行配置；无模型/Conversation 的 GUI 可打开；跨角色、冲突、重载/卸载、丢响应不重放及私密 canary 全部有实际证据。

### P4 — MAS Board 作为普通贡献

- MAS DevPack 增加可选公开 facet exports/peers；保持现有 Agent-only 消费路径不引入 Web/Preact/服务启动。
- 从 upstream board/bar 迁入可用组件，实现成员/owner/lifetime/ready 状态、receipt inspector 和明确的操作控件。
- 所有读取和操作走同一公开 extension host、受限 client/backend 服务；不复制 MAS scheduler，不访问旧 documents。
- 关闭 UI contribution 仅清理 UI/订阅；已 admitted work、members 和历史不能被当作组件资源删除。

退出：真实 model tool 创建/人类 Board 观察/授权通信与退役贯通；UI-only 不安装 Agent tools；移除 Board 后基础工作台仍工作。独立扩展与 Board 使用同一 slots，没有 built-in bypass。

### P5 — 完成 UI 与远程保留清单

- 补齐文件/变更、审批/browser、settings、协作、通知等实际后端与交互；其他 upstream 可选界面按 P0 归属清单闭合。
- 两人并发 notes/driver/commands、resource 撤权、slow SSE、重连/resnapshot、closed/unknown jobs、正常重开身份与预算均从产品入口验证。
- local、LAN、tailnet、公网 tunnel 的 launcher/config 行为分别验证。自动测试使用真实本地代理/TLS；外部基础设施测量不得用 mock 域名替代。
- UI development rules 落入组件、例子、type/browser test；新增主题/图标优先 repo 原生资源，保留许可证。

退出：迁移清单无未说明的空控件或隐含删除；多人/邀请/远程不是下一版 deferred。尚未实测的部署模式不得标为支持完成，也不得反过来取消用户已确认的目标。

### P6 — 交付而不是加总测试

- 干净安装/build/check/format，受影响全量及原有 headless/DevPack/Dynamite 配对回归；无变化的昂贵 patch 重建不机械重跑。
- 在仓库外安装实际 tarballs，独立编译 browser/extension 声明，实际启动 executable/静态资源/浏览器；不带 root overrides、workspace 源码或第二套 Pi runtime。
- 保存输入、tool/HTTP 次数、receipt/job 终态、原始 storage、author/role、界面截图和泄漏探针；必需 case 的 skip/todo/cancel 均不算过。
- 使用指定 `adversarial-review.js`，最多两轮，保留两方原文、structured opinions、争议与 closing；总期限按已选 90 分钟，不能因 provider/runner 失败换协议。
- source identity 独立枚举 tracked/untracked candidate、全部门禁脚本/helper 和 delivered assets；变异包/漏项在启动任何 build/install 前被拒绝。

退出：同一个实际产品身份同时证明工作台、通用插件、MAS 插件和多人远程能力，留下精确版本/产物/残余项；不能把 OpenSpec 完成或各 library 的总测试数称为产品通过。

## 5. 验收矩阵与正向证据

| 场景                    | 最小真实主体                                         | 除零效果外必须保留的证据                                                  |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 无 MAS 的基础工作       | installed executable + browser + native Conversation | provider payload、native admission/generation、tool result                |
| 通用 GUI/RPC/设置       | 原样安装的非 MAS extension                           | settings version、实际后续行为、operation receipt/conflict                |
| display card 非模型输入 | command + 后续真实模型请求                           | card 的显示 projection、provider payload、requester 未变                  |
| MAS Board 与模型工具    | DevPack facets + 两个真实成员                        | 原 tool call、membership/readiness、原始 receipt 和 UI 渲染               |
| 多人可见性/邀请         | 三个独立浏览器上下文                                 | redeemed/expired/revoked 记录、服务端过滤的 HTTP/SSE/export               |
| 预算/拒绝/撤权          | 正在执行的实际 action                                | 明确 refusal/job 状态和计费/准入记录，不只缺少额外 dispatch               |
| reload/unmount/断网     | 活动 handler、旧实例和新 generation                  | old request/generation、late completion、原 operation 的 unknown/terminal |
| remote/TLS/proxy        | 真实代理和浏览器；实际工具另测                       | 连接身份、TLS 边界、Origin/CSRF/转发头拒绝、实际部署记录                  |

## 6. 开始实施前的技术收敛

产品范围不再待确认。P0/P1 负责确定：最小 public read/display/job API、actor ceiling、最终 adopted tree；P1/P3 固定具体 exports/schema/finite limits/reload 行为。发现契约无法实现时，用可复现反例修订当前设计/spec，而不是另加一个 raw runtime 通道。

本计划不创建未来占位命令；实现时才把真实 acceptance command 加入 manifest。任务细目由 active OpenSpec 的 `tasks.md` 投影，不能作为行为已完成的证据。
