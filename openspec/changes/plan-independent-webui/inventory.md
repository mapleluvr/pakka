# 阶段 0：独立 WebUI 基线与消费清单

2026-11-14。用于执行[阶段 1](tasks.md#3-阶段-1可独立消费的接缝)，不是新接口定义或新产品验收记录。本文固定的是当前消费者、职责归属、替换范围和后续真实切片；确切包名、wire schema 与 UI props 仍由实际消费形成。

## 1. 基线与覆盖范围

| 对象            | 固定身份与用途                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实施源码基线    | 成功 fetch 后的 Pakka `origin/dev@cc1cdd8aead42cd0afe018c75973f09fd369184d`。文档工作树 `pakka/webui-design-principles@bb3f7c7a8ae9badad94dc1ea28d767b08f43e3d3` 的 `apps/`、`packages/`、`scripts/`、`integrations/`、根 package/lock 与该 dev 无差异。                                                                                                                                       |
| 需求/实现参考   | Pakka `pakka/history-book@170aa153e7dad0cda8f6172665d709407dfa703a`，包含[通用插件要求](https://github.com/mapleluvr/pakka/blob/170aa153e7dad0cda8f6172665d709407dfa703a/docs/requirements/WEBUI-PLUGIN-CAPABILITIES.md)。相对基线，Agent 历史能力和 RSI repository 等有变化；所核 WebUI 宿主、HTTP、协议/client 与 workspace 资源来源接口没有变化。不能通过整包采用该分支跳过本文的通用接缝。 |
| Pi 执行制品     | `packages/agent/vendor/earendil-works-pi-durable-1.4.0-pakka.3.tgz`，811400 bytes，SHA-256 `fc1268481542417fd1ada943854c5972cd2b42c9456a6f60cc78a68ba70c2761`。pi-ai / pi-coding-agent 依赖声明为 `1.4.0`。                                                                                                                                                                                    |
| 已知跨仓来源    | Dynamite 当前 checkout `969312afffb05c031e1cba3dbcef0001f8832689` / 参考 `445f7063dd6585b692c9f3877a58618a6117bbc8`；EI 当前 `8cdd69aadb1459ded79d02dd0e5b65ef49a5af71` / 文档参考 `58cb5c8d59e444e8c0307ad1fe8d83e3dfe67dcd`。检查源码、package 声明及引用，不改动这些工作树。                                                                                                                |
| 新前端/SDK 制品 | 尚不存在。React 19 / TSX / Astryx 是采用路线；Astryx `0.7.15` 的公开包研究不是新前端安装证据。阶段 1–2 固定实际消费组合，不能用上述后端归档代替前端制品身份。                                                                                                                                                                                                                                  |

盘点覆盖十个 workspace、37 个 package exports、587 个受跟踪的 JS/TS 源文件，包含产品、插件、示例、构建与消费脚本、测试；浏览器目录含 32 个 JS 模块、44 个静态文件。核对六个默认 contribution、两个示例的 JSON manifest，以及 RSI/MAS DevPack 的生成 manifest 和 browser 构建入口。另检查已知跨仓候选；这不是对任意第三方插件的全网枚举。

方法为结构化 import/call/URL 枚举、实际 package 声明、关键生产路径阅读及独立的 JS/声明导入图投影。导入图使用 TypeScript `7.0.2 --noCheck` 输出，只用于辨认依赖，不声称类型检查、运行或安装成功。完整枚举、声明图、探针与来源 hash 留在本地证据包；[验证摘要](../../../docs/verification/INDEPENDENT-WEBUI-PHASE-0.md)记录方法、限制和包身份。

## 2. 功能保留与实现归属

WebUI 路径在表内简写：浏览器 JS 位于 `apps/webui/web/`，`src/`、`contributions/`、`examples/` 以 `apps/webui/` 为根，同组可省略前缀；其余 `packages/` 等路径相对仓库根。保留功能不等于移植旧 Preact 文件；UI 以新 SDK 实现，已有服务按公开契约复用。通用 `host` 与 `integrations/pakka` 的分工见[架构](../../../docs/development/WEBUI-ARCHITECTURE.md)。

| 功能 / 当前入口                                                                                                                                                                | 新前端或插件拥有                                                                                      | Pakka 保留 / 接续                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录、邀请、角色、人员撤权：`web/app.js`，主 RPC / exchange                                                                                                                    | 身份页、合法目的地恢复、可操作错误；Pakka 接入层接线                                                  | People/会话、Cookie/CSRF、scope 校验、邀请与恢复登录链接。清理旧 UI 不删除凭据或用户记录。                                                                       |
| Session 创建、选择与重开：`web/creation.js`、`session-settings.js`                                                                                                             | Session/Conversation 入口与状态，不另建执行器                                                         | `src/sessions.ts` 的原登记、独立 storage/writer、创建/lookup/显式 reopen；未加载原历史另见 G2。                                                                  |
| Conversation 创建、命名、归档/恢复、fork：`creation.js`、`navigation.js`                                                                                                       | 用户意图、冲突与原请求核对                                                                            | workspace/catalog 与持久回执；普通删除/retention 仍是旧 backlog，不把归档等同删除。                                                                              |
| 个人文件夹与排序：`conversation-groups.js`、`resource-identity.js`                                                                                                             | 单层组织、选择及导航展示                                                                              | `src/navigation.ts` 的 Person namespace；不改变 Session 归属、资源权限或业务数据。                                                                               |
| 对话、原生输入与队列：`app.js`、`native-composer.js`                                                                                                                           | 草稿、prompt/steer/followUp、停止/撤回/待核对显示；键盘与触控共用意图                                 | 受权 submit/wait/withdraw/abort、原回执、pi-durable 调度与执行。模型输入与人类 slash 命令分开。                                                                  |
| 正文、工具、历史与原文：`message-parts.js`、`virtual-transcript.js`、`virtual-window.js`、`content-reader.js`、`original-search.js`、`content-cache.js`、`disclosure-state.js` | 有界渲染、搜索/复制/展开/下载、可访问性                                                               | preview/read、内容引用/range、原文下载、权限过滤；前端缓存不成为原历史。                                                                                         |
| 观察与重连：`observation-client.js`、`observation-worker.js`、`observation-hub.js`                                                                                             | 订阅与窗口生命周期、快照/patch 合并、旧结果隔离                                                       | SSE、server/stream/sequence、当前权限与 incarnation。public client 的单 Session reconnect 限制见 G2。                                                            |
| 人类协作：`collaboration.js`                                                                                                                                                   | side chat、notes、pins/reactions、presence、driver 显示                                               | collaboration 服务及各自权限、冲突、持久性；不是自动把侧聊送入模型。                                                                                             |
| 模型、Thinking、工作目录、Agent preset：`configuration.js`、`conversation-configuration.js`                                                                                    | `/model` 悬浮选择、完整 provider/model 精确直接选择、`/thinking` 与点击/触控；常用提供商/模型参数控件 | Conversation 当前配置、Person 默认、实例连接定义；复用 pi-ai 契约及公开 pi-coding-agent 配置能力，Pakka 提交到 pi-durable。新配置写入/校验接缝待形成。           |
| 旧认证 UI：`credentials.js`、`product-model-settings.js`                                                                                                                       | 新 Provider `/login` 按 roadmap 延后；不移植这两个旧页面作为替代                                      | `credential.*` 是旧单凭据控制；旧 `auth.*` 是 native provider 流程桥接。保全已有凭据与宿主解析，不把旧单 secret 模型当成新 provider 配置。WebUI 人类登录不延期。 |
| Session 预算：`budget-settings.js`                                                                                                                                             | 预算与历史/回执显示                                                                                   | 原生预算及授权变更；从旧 models transport 分离，不放进 provider 配置。                                                                                           |
| 通知：`notifications.js`、`sw.js`                                                                                                                                              | 设备开关、偏好、系统通知与导航                                                                        | 通知/推送服务、受权事件读取；浏览器注册、原生显示/点击与远端传递是不同验收。                                                                                     |
| 外观、壳层、设置与移动端：`appearance.js`、`frontend.js`、`settings-page.js`、`sheet.js`、CSS/fonts/SVG                                                                        | React/Astryx 主题、容器、可寻址设置、焦点与响应式布局                                                 | 保持服务授权；不迁移旧 CSS/DOM 组织。现存功能与尚未完成的深链接需求分开。                                                                                        |
| 语音草稿：`voice.js`                                                                                                                                                           | 浏览器 SpeechRecognition、草稿插入/取消/清理与支持状态                                                | 当前没有 Pakka 语音 HTTP 入口；语音识别可能依赖浏览器的语音服务，不宣称离线或自建 STT。语音结果仍须人类提交。                                                    |
| 文件/Git：`contributions/files`                                                                                                                                                | 默认插件的目录、文件读写/上传导出、changes/diff、分支/worktree 界面                                   | `@pakka/server/pocket` files 服务及受控路径、权限、效果回执；不开放浏览器任意文件系统。                                                                          |
| 审批、owned browser：`contributions/approvals`、`browser`                                                                                                                      | 各默认插件的列表/决策、浏览与控制                                                                     | approvals/browser 服务、实际工具/浏览器操作与独立清理确认。                                                                                                      |
| Memory、scheduled inputs、Webhook：`contributions/memory`、`schedules`、`hooks`                                                                                                | 各默认插件的读取、编辑、操作与结果显示                                                                | 对应服务、调度、签名/凭据与投递回执。Memory 的当前审批要求保留；scheduled inputs 在范围内。                                                                      |
| RSI、MAS DevPack                                                                                                                                                               | 各插件的新 SDK 界面、数据适配、命令/管线；RSI 首片限读取/编辑                                         | 原服务、权限与持久效果留所属包。旧 browser facet 不迁移；Board 整改、报告状态演进不进入 WebUI 核心。                                                             |
| Memo                                                                                                                                                                           | 后续由 Memo 所有者设计自己的插件                                                                      | 当前基线仅有 library/Agent/Patchouli/MAS 出口，没有现成 browser/Backend facet 可搬。GUI、History Book 后续接入及小恶魔不成为首片前置。                           |
| 启动、恢复、维护、默认分发：`src/main.ts`、`launcher.ts`、`product-*`、`maintenance*`                                                                                          | 消费固定前端产物的前端应用                                                                            | Node 装配、PAKKA_HOME、原身份恢复/备份/升级留 Pakka；`pakka --connection` 的 headless v1 不随 WebUI namespace 改名。                                             |

### 2.1 旧实现清理与 backlog

可以随替代能力就绪清理：旧 `web/` Preact/htm、旧 components、旧 UI 装载/样式和相应 browser 构建、旧 examples/browser facets、无消费者的旧公开出口。不给旧 SDK 增加兼容 facade，不因清理页面删除服务、数据或已接纳工作。Node launch/HTTP/Backend 代码不能随 `apps/webui` 整目录删除。

逐项检查了 14 份相关 tasks，其中 48 项仍未勾选；未改写旧候选的失败/阻塞记录。接续分组如下：

| 旧任务来源                                                                                 | 本次处理                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pakka-webui` 6.4–6.8、7.1–7.5                                                             | 所选功能进入新前端阶段 4；真实安装、恢复、部署与发布进入阶段 5。Conversation 删除/retention 保留独立设计，不能借重构偷偷实施。旧全部 legacy-consumer 门禁不变成保留旧 SDK 的理由。 |
| `pakka-webui` preferences 初始化问题                                                       | 已记录真实旧例的迟到 read 覆盖用户输入；旧例不迁移、不单独修补以阻塞分仓。新参数/编辑页仍须保护已编辑草稿，不能继承该行为。                                                        |
| `improve-webui-navigation-and-local-recovery` 设置路由、登录目的地、逐页/移动端/焦点与反馈 | 功能预期保留，在新实现安排；原“先补用例”等方法不覆盖当前少测试政策。旧 `Send` 偶发命中与候选 GUI/review 阻塞保留原时点，不冒称在新 UI 已复现或已修复。                             |
| `adopt-devin-frontend` 的 native/安装进程、symlink/Chrome 占用、视觉与跨设备未验收         | 保留调查线索与原证据；新候选单独验证。不要为了重跑旧实例的 DOM 门禁移植旧渲染器。                                                                                                  |
| `enable-product-runtime-and-launcher`、`add-local-maintenance-and-delivery`                | 长上下文/重试、附件、RSS/heap、observer 字节预算、idle unload、worker/OOM、POSIX 维护仍归其后端/性能切片；不把完整资源治理设为 UI 分仓前置。具体影响原 Session 读取的缺口进入 G2。 |
| `add-memo-knowledge` 与参考分支领域任务                                                    | Memo GUI/Book/助手、RSI 报告/状态演进、Board 暂缓项由所属任务接续，不复制为核心功能或首片依赖。                                                                                    |
| 已完成的 grouping、invitation menu、copy、guidelines、RSI 等任务                           | 当前功能列在上表；完成 checkbox 不证明新 SDK 已实现。                                                                                                                              |

Plan mode、Goals/Done when、插件市场、通用任意后端平台、全 Session 自动发现/总览/全局搜索均未纳入。Provider `/login` 仍等待用户确定多端交互偏好。

## 3. 网络、命令与资产

### 3.1 HTTP 面

`apps/webui/src/http.ts` 的完整分发有下列九类服务入口，另有固定静态资源 Map。新服务面统一归 `/pakka-webui`；下表指定职责和必须一起迁移的消费者，不冻结新的子路径。

| 当前入口                                                 | 消费与实际边界                                                                                                                        | 归属 / 迁移                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /pocket/exchange`                                  | `web/app.js`；signin/invite fragment 交换、轮换 Cookie；Host/Origin 与有限闭合 JSON                                                   | Pakka 人类身份服务 + 接入层。登录链接/二维码、合法返回目的地与代理一起核对。                                                             |
| `POST /pocket/rpc`                                       | `@pakka/client/pocket`、页面与消费脚本；48 个命令；Cookie/CSRF、运行时 decoder、关联/权限/denied/unknown                              | 公开服务/client；URL validator 与调用者一起迁移。不是所有 `Pocket*` 类型改名。                                                           |
| `POST /pocket/extensions/rpc`                            | `@pakka/webui/client`、插件宿主；list/call/operation/operationByRequest/enable/disable/reload                                         | 公开 extension wire/client 留服务消费面；通用 UI host 不直接拼 URL。                                                                     |
| `POST /pocket/models/rpc`                                | 私有 `web/models-client.js`，模型设置/选择与预算页；13 个命令                                                                         | **退役，不提取为新公共 API。** 配置/目录按 pi-ai 对齐的新服务形成，预算单独维护；auth 交互延期。                                         |
| `GET /pocket/extensions/assets/{id}/{generation}/{path}` | 真实动态 import 及插件资源；有限 public paths、已接受字节/hash、当前 actor/resource/generation                                        | Pakka 接入层给 host 明确加载来源；修正完整资源绑定。字段名 `conversationId` 当前实际由 HTTP 按资源标识解释，见 G2。                      |
| `GET /pocket/content/download?target=&reference=`        | `content-reader.js` 的流式原文下载；真实 target/reference、每段重新授权                                                               | 内容服务 + typed 读取/下载入口；不是任意文件路径或大响应一次性加载。                                                                     |
| `GET /pocket/notifications/event?eventId=&deviceId=`     | `sw.js`；Cookie、device/event 归属及目标 read 权限                                                                                    | 通知服务；更换 worker/URL 时保全注销、旧通知清理和当前授权检查。                                                                         |
| `GET /pocket/events`                                     | observation client/SharedWorker/fallback EventSource；Session/Conversation、preview targets、expectedPersonId/serverId、Last-Event-ID | 观察服务 + 接入层；重连、server/stream/sequence、snapshot/patch 与代理长连接一起迁移。                                                   |
| `POST /pocket/ingress/{extension}/{service}/…`           | 外部 Webhook sender，hooks UI/构建服务产生入口；不消费浏览器 Cookie authority，排除 Cookie/CSRF/proxy-authorization 转发              | 仍由 Pakka 可信 ingress/service 验签与限流。虽然不由普通页面发请求，也必须随服务 namespace、生成 URL 和外部配置迁移；不套用浏览器 CSRF。 |

所有入口先经过公共 Host/Origin/可信代理边界；普通非 GET 再要求 Origin，已登录 RPC 再要求 Cookie/CSRF。GET、exchange、外部 ingress 各有不同身份来源，不能概括成“全加 CSRF”或“跨域全放开”。

开发代理要使浏览器看到一个同源站点，并与后端的 `publicOrigin`、允许 Host、转发头/peer、Cookie 和事件流相符。两个 public client 都硬性要求旧 pathname 且在浏览器校验 `location.origin`；只改 dev-server target 不能完成迁移。当前 Cookie 为 `pakka_pocket` / `pakka_csrf`、`Path=/`、SameSite Strict，HTTPS 加 Secure；不因为 URL 改名顺手改变凭据含义。

### 3.2 命令归类：不漏掉仍在主 RPC 的能力

| 主协议命令组 | 全部相关 op / 所有者                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 握手与身份   | `hello`、`people`、`invite`、`invite.revoke`、`person.set`、`person.revoke`、`session.rotate`、`session.logout` → People/接入层                                                                 |
| Session      | `session.list`、`session.create`、`session.lookup`、`session.reopen` → managed Sessions                                                                                                         |
| 导航与创建   | `list`、`create`、`fork`、`conversation.set`、`conversation.lookup`、`creation.directories`、`navigation.read`、`navigation.update`、`navigation.lookup` → workspace/navigation                 |
| 配置         | `configuration`、`configure`、`configure.agent`、`directory.list` → Conversation 配置；`credential.status`、`credential.replace`、`credential.clear` → 旧单凭据能力，不作为新 Provider 登录形状 |
| 读取与工作   | `read`、`preview`、`content.read`、`display`、`submit`、`receipt`、`wait`、`withdraw`、`abort` → 受权原历史、显示与执行/回执                                                                    |
| 人类协作     | `collaboration.read/post/note/react/pin/driver/presence` → collaboration 服务                                                                                                                   |
| 通知         | `notification.status/subscribe/unsubscribe/preferences` → notifications 服务                                                                                                                    |

旧 models 的 `status/catalog/refresh` 属配置/目录，`auth.prepare/start/state/answer/cancel/logout` 属延期的 Provider 认证交互，`budget.read/history/receipt/change` 属预算。endpoint 重命名不能把这三组继续捆成一个对外 transport。

文件上传/导出、Git、浏览器控制、审批、Memory、定时输入和 Webhook 管理经 manifest action → extension RPC，不各自偷偷增加一个浏览器网络 API。具体领域 schema 由所属服务/插件维护。

### 3.3 静态文件、模块与浏览器原生入口

- `src/bootstrap.ts:publicAssets()` 从 `web/` 收集 44 个文件，并增加 14 个 SDK/vendor 路径；`index.html` 有 13 项 import-map 映射。JS、七份 CSS、两份字体及许可、HTML/SVG、SharedWorker/ServiceWorker 都属于前端交付清单，不只搬 `app.js`。
- 当前公开模块包括 Preact/hooks、htm、virtual-core、marked、DOMPurify、protocol/client 及旧 SDK；还显式读取非公开出口 `extension-rpc.js` 和 `browser-virtual-core.js`。这一 Node 内部复制方式不是仓库外 SDK 分发契约。
- `build-browser-vendors.mjs` 固定 virtual-core `3.19.11` / esbuild `0.28.2`。RSI/MAS DevPack 当前用 `tsc -p tsconfig.webui.json` 保留 Preact/Pakka 的 bare imports，再由 `scripts/write-manifest.mjs` 复制 browser JS/CSS 到 public；这是 TypeScript 输出与静态复制，不是配置了 external 的 bundler。新构建若打包共享依赖，须将 external、类型依赖、主题/context、CSS 与模块映射成套落实，不能只改 peerDependencies。
- HTTP 的 `options.assets` 已能接收固定 Map，但 `startPocket()` 自己执行 `publicAssets()`，其 transport 明确排除 `assets`。默认 launcher 的前端制品注入仍需打通到产品装配层，不能以底层存在参数声称整条分发已解耦。
- CSP 从真实 import-map 文本生成 script hash；当前 script/style/connect/font 以 self 为边界，img 允许 data/blob、frame 允许 self/blob。新 HTML/CSS/worker/build 必须与 CSP、MIME、URL 和缓存一起交付，不复制旧 hash 或直接放宽策略。
- SharedWorker 入口 `/observation-worker.js` 与 fallback EventSource、ServiceWorker `/sw.js` / root scope、通知 click 的页面 fragment 都是可执行消费边界。当前 `sw.js` 不是离线 app-shell 缓存；更新不应误删 Session 持久历史。
- SpeechRecognition/系统 Notification/PushManager 是浏览器原生服务边界；后端连接模型端点又是另一段网络关系。它们不因新 HTTP 前缀而自动兼容，也不计为新增 Pakka 模型请求。

## 4. 包、出口与消费者

### 4.1 `@pakka/webui` 的九个出口

| 当前出口 / 源码                       | 真实消费者                                                                        | 处理归属                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.` → `src/bootstrap.ts`              | RSI workbench example、Devin MAS demo、产品/安装消费、部分测试；自身资产 resolver | Node 产品装配留 Pakka；新前端不安装这个混合包。                                                                                            |
| `/launcher` → `src/launcher.ts`       | `apps/cli/src/main.ts` 的默认 `pakka` 分支                                        | Node launcher 留 Pakka，保留默认启动/恢复职责。                                                                                            |
| `/http` → `src/http.ts`               | 源码 bootstrap 相对 import；扫描域没有该 bare 出口消费者                          | HTTP 服务留 Pakka；旧公开出口不因历史存在而必须保留。                                                                                      |
| `/extension` → `src/extension.ts`     | 宿主；RSI/MAS manifest、contract、Backend/client；消费脚本                        | 惰性 DTO/schema/validator 可复用；按 UI 贡献与服务 wire 的职责形成独立出口，不能把后端安装带进浏览器。                                     |
| `/backend` → `src/backend.ts`         | 六默认 contribution、preferences Backend、RSI/MAS Backend、Node 类型消费者        | Backend SDK 留 Pakka。JS 几乎只有 defineBackend 不代表该包或声明是 UI SDK；声明引用 agent/server 的服务类型。                              |
| `/client` → `src/extension-client.ts` | 宿主、浏览器消费类型、安装脚本生成的真实浏览器代码                                | 可复用 checked client；连同 wire/validator 一起可消费。其 graph 不含 UI runtime，但包安装目前仍带 Node。                                   |
| `/ui` → `src/ui.ts`                   | RSI/MAS browser、RSI client 的 call 类型与消费类型；静态模块映射                  | 新前端 SDK 拆开通用界面能力与 Pakka service binding。当前必需 person/call 与可选 target 把界面声明绑定到 Pakka，不是纯 UI 宿主的最终形状。 |
| `/workflows` → `src/workflows.ts`     | Node 类型消费者、controlled/hooks/memory/schedules/workflows 安装脚本             | 可信后端 workflow/service 组合留 Pakka，不能按名称移入前端。                                                                               |
| `/components` → `src/components.ts`   | 页面、六默认插件、两示例、RSI/MAS browser、浏览器类型消费者                       | 当前直接依赖 Preact；以新 React/Astryx UI 能力替代，不做 Preact facade、不限制插件只能用宿主已封装的几个组件。                             |

由生成 JS/声明图可见，`extension`、`ui`、`client` 与 Node 启动的模块职责已经不同；`components` 的运行和声明都依赖 Preact；Backend 声明需要服务/Runtime 类型。外部包的声明内部没有被这次投影递归安装验证，不能仅凭“零 node: import”断言 browser-safe。

安装层面九个出口共享一个 package：其 dependencies 包括 agent、server、pi-coding-agent、pi-ai、Preact 和 vendor 库。根 workspace 还固定 Pi overrides；`@pakka/protocol` / `client` 以及其他 workspace 都是 private 包。现有 exports、按类型消除 import、或同仓 build 均不等于新仓能标准安装。

### 4.2 其余 28 个出口与装配入口

| 包 / 全部出口                                                                      | 消费与归属                                                                                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pakka/protocol`：`.`、`/pocket`                                                  | v1 与 WebUI v2 的 DTO/decoder；client/server/CLI、SDK、browser worker 与检查脚本。纯协议制品可复用，单一来源，不复制到新仓。                              |
| `@pakka/client`：`.`、`/pocket`                                                    | headless v1 与 WebUI browser client；CLI、页面、SDK、独立消费脚本。服务前缀只影响所选 WebUI 面；修正 v2 reconnect 的单 Session 假设，不修改无关 v1 语义。 |
| `@pakka/agent`：`.`                                                                | Runtime、MAS、Backend 和产品装配；仍叫 agent，执行/存储与 Pi mutable objects 留后端。                                                                     |
| `@pakka/mas`：`.`、`/broker`                                                       | DevPack、RSI、Memo/Patchouli 与应用脚本；MAS 服务不进入前端，插件读其公开 DTO/服务绑定。                                                                  |
| `@pakka/server`：`.`、`/pocket`、`/http-listener`、`/http`、`/bootstrap`           | worker 管理、Pocket 服务、v1 HTTP、产品/应用装配；保留服务实现与 headless 边界。                                                                          |
| `@pakka/mas-devpack`：`.`、`/agent`、`/workbench`、`/backend`、`/client`、`/webui` | trusted preset/产品、Backend、生成 manifest 及 browser bundle。领域能力在该包；新 UI 用新 SDK 接入，不因分仓把每个 facet 再拆仓。                         |
| `@pakka/rsi`：`.`、`/agent`、`/mas`、`/backend`、`/client`、`/webui`               | 工单服务、工具/Bot、dispatcher、workbench example、浏览器与类型消费者。首片复用服务/有限读取/编辑与回执，而不是迁移旧页面。                               |
| `@pakka/memo`：`.`、`/agent`、`/patchouli`、`/patchouli/mas`                       | 当前 headless library、工具与馆员/MAS；没有 WebUI/Backend 出口。其新插件由领域所有者形成，不猜造一个现成入口。                                            |

`@pakka/cli` 无 exports，提供 `pakka` bin；`@pakka/server`、旧 `@pakka/webui` 还分别声明 bin。Node 命令归属与浏览器 SDK 名称是两件事。

RSI/MAS 的 WebUI/Preact peers 是 optional，现有 Agent-only/root 导入图未指向 browser facet；这个已具备的分离应复用。选择 browser/client facet 时所需公开类型、构建 external、可解析的共享 runtime 与标准安装仍在阶段 1–2 验证。源码使用私有相对入口的本仓测试不能代替该验证。

已知跨仓候选的引用核对不产生新的前端消费者；reference 分支仍按其原职责保留。构建入口、manifest 路径、import map、动态 import 和安装脚本里的浏览器代码均作为消费者处理，不把“没有 bare import”误判为无人使用。

## 5. G1–G6：事实、缺口与阶段 1 接续

| 能力           | 已有基础                                                                                                             | 本次确认的通用缺口 / 所有者                                                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1 独立消费    | 惰性 extension/ui 声明、checked client；RSI/MAS 可选 facets 与分开的 headless graph                                  | **GAP-1**：混合安装包、private 产物、根 overrides 和静态复制仍耦合。前端 SDK 与 Pakka 协议/client/Backend 分工后，做仓库外标准消费；对接 tasks 3.1/3.6。                                                                                                                                                                       |
| G2 通用导航    | `AgentRef`、Session/Conversation 双地址、workspace 资源注册、UI open/navigate；真实双 Session/同号 ID fixture 已有   | **GAP-2**：UI 只描述 AgentRef/所属界面，没有任意资源类型的视图/解析入口。由通用 host 与 Pakka 适配分别形成最小能力；对接 3.2。                                                                                                                                                                                                 |
| G2 原历史      | managed Sessions 已按 Session 路由；workspace read/preview/content 使用受权 Runtime                                  | **GAP-3**：`PocketConversationSource` 提供导航、配置、提交/回执，但不提供 read/preview/content。managed Session 路由只找已登记/已发布 Runtime，SSE 和资产查找也枚举已加载 Runtime；启动 eager reopen、显式 `session.reopen` 不等于无需 writer 接管的未加载历史读取。由原 owner 的公开服务补受控解析/读取及状态；对接 3.2/4.3。 |
| G2 资产地址    | generation 与资产 hash、当前 actor/resource 重检                                                                     | **GAP-4**：`web/extensions.js:HostInterface` 只把 `target.conversationId` 放入资产 query；HTTP 按 `people.resourceId(ref)` 查找，非控制 Session 的后者是双身份 hash。该源码不一致需在服务/接入层修正，验证同号对象不会借根 Session 匹配；不是只替换 URL 前缀。                                                                 |
| G2 公共重连    | `request(hello/list)` 支持现有多 Session DTO；页面有自己的观察恢复                                                   | **GAP-5**：`packages/client/src/pocket.ts:reconnect()` 仍拒绝任何 `ref.sessionId !== hello.sessionId` 的列表，与 managed Sessions 不相符。所读旧页面未用此 helper，不因此宣称整个旧 UI 不能多 Session；独立消费前必须对齐并验证。                                                                                              |
| G3 有限数据    | 主协议 preview/read、内容引用/range 与下载；RSI list/history/observe 与按 action 校验；UI subscribe 是有界 read 轮询 | 验证真实合法内容、分页/搜索/版本与重连身份。业务分页/索引留服务，不因轮询本身新建事件总线；通用原历史缺口由 GAP-3 处理。                                                                                                                                                                                                       |
| G4 命令与工作  | manifest namespaced commands/actions、call、operation、operationByRequest、Backend service/jobs                      | 保持浏览器 requestId → host operation → service receipt 的真实对应。BackendContext.requestId 是 host operation ID，不是浏览器 requestId；未知结果不改 ID 重投。新 host 不拥有统一业务账本，关闭 UI 不声明取消已接纳工作。                                                                                                      |
| G5 自定义 UI   | page/sheet/panel/settings、navigation、组件 export、错误边界/焦点；并非 schema-only 表单                             | **GAP-6**：共享 React/JSX/Astryx/主题/portal 尚未接入；当前 host 同时握有 API URL、person、service call 与容器。前端拆 host/integration，用 GUI-only 与实际业务插件验证；对接 3.5/4.1。                                                                                                                                        |
| G6 facets/实例 | 可信 `ExtensionSource.facets` 能选择 Backend/WebUI/Client；generation、open-instance 与 AbortSignal 已接线           | **GAP-7**：browser control 与持久 disabled 状态按整个 extension，reload 仍复用原 facets；Agent 被此 host 明确拒绝，走 approved-profile 启动装配。现有组合选择不是动态分 facet 启停。按实际依赖形成控制/清理，不能让 UI 关闭停止 Backend/Agent；对接 3.2。                                                                      |
| 服务与制品     | v2 closed decoder、原请求/权限边界；底层固定 assets Map                                                              | **GAP-8**：新 model-connections 的公开配置校验/写入/冲突/回执、Person 默认/新建接线、服务/SDK/资产兼容组合、产品级静态制品注入待形成；对接 3.3–3.5。不通过放宽 decoder 或另建 credentials registry 解决。                                                                                                                      |

GAP-3/4/5 是源码/契约核对所得，不是已经执行的新 UI 故障回归；阶段 1–2 补真实路径证据。阶段 0 不修改这些产品行为，也不把“已定位”记作“已解决”。

## 6. 固定最小真实切片

这里固定后续验收对象、数据来源与边界；阶段 0 没有创建新的插件实现或一套用户数据库。下列真实样例的生成/浏览发生在阶段 2，现有测试只作固定源码参考，不把其旧 Preact 页面当成新切片。

| 切片                    | 固定内容与原路径                                                                                                                                                                                                                                                                                            | 后续退出证据                                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GUI-only：UI Playground | 一个普通页面/导航和 Dialog 或 sheet，局部表单/状态，直接消费 Astryx 公开入口、主题/portal；不依赖 RSI/MAS/Memo，不声明 Pakka service 或工作 Session。旧 `examples/hello` 仅说明 page/sheet 能力，不复制其 Preact facet。                                                                                    | 仓库外公开 SDK 消费；真实新宿主挂载、键盘/触控/焦点/关闭；不需要启动后端或模型服务，联网切片同时核对打开/关闭零新增模型请求。                                                                                                                   |
| RSI：工单读取/编辑      | `@pakka/rsi` + `/backend` 的真实 TicketService，普通新 SDK UI；capabilities/list/get/history/observe、一次带 expectedVersion 的 edit。`packages/rsi/test/webui.test.ts` 给出真实服务、已提交后丢响应、原请求核对及历史分页的参考。                                                                          | 同样的公开入口与权限；受控编辑、断线后的原 operation/服务 receipt、重新打开后的记录；失败时不重提、不替换 request ID。报告状态、dispatch/recover 和 MAS 工作流不混入这个首片。                                                                  |
| 两 Session 的原历史     | 沿 `apps/webui/test/session-creation.test.ts` 的真实创建方式：两个独立 Session，各用相同 create requestId 建 Conversation，原生 Conversation ID 相同而 Session/storage 不同。各自经本地确定性 provider 完成一个不同标记的工作并保存原回执/历史；坏源状态参考 `session-isolation.test.ts` 与 recovery 场景。 | 保存真实 Session/Conversation/binding/原内容身份；从插件引用 A→B 并浏览原历史，同号不串线。浏览期模型请求增量为 0；测试未加载、不可得、无权、错身份与旧结果污染，不能自动 reopen writer 或创建替代 Session 来通过。GAP-3 未补齐时明确阻塞该项。 |
| 模型/Thinking/连接参数  | 使用项目已有本地确定性 provider 与公开 ModelRuntime 探针来路；两个 provider 可有同 model ID，覆盖原生 endpoint/API/覆盖语义。新表单和 slash 共用实际操作，不依赖延期的 Provider `/login`。                                                                                                                  | 真实 Pakka → pi-durable → pi-ai 请求及原回执；Conversation 当前、Person 默认、实例定义三个作用域、精确匹配与失败状态。模型请求用于该切片明确配置的本地端点，不读取用户凭据或付费服务。                                                          |

两种业务插件的等权充分性检查仍在阶段 4；首片 RSI 不被授予额外核心能力。实际建仓/可见性/发布渠道在阶段 3 前按授权处理，阶段 0 不以这些尚无执行需要的决定打断工作。

## 7. 阶段 0 退出与下一步

本次已为纳入范围的网络/资产、公开出口与消费者、现有功能及 backlog 指定归属，并固定普通插件/原历史切片。新发现落实为上述 GAP 与阶段 1 tasks；不重新询问已采用的 renderer、旧实现处理、模型作用域或分仓方向。

阶段 1 先使协议/client/SDK/Backend 可独立消费，补通用资源/生命周期与模型配置接缝，打通固定资产装配；阶段 2 才验证新宿主和真实插件。阶段 0 的源码/声明图、OpenSpec 或文档检查均不能代替标准安装、React/Astryx 共享运行时、真实浏览器、跨 Session 原历史或部署验收。
