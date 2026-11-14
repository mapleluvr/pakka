# 阶段 1：独立消费接缝

## 执行授权与边界

用户于 2026-11-14 授权阶段 1，并明确旧 monorepo WebUI 不必作为设计起点，必要时可以重写，即使构建成本更高。本轮从已采用的独立前端与 G1–G6 能力出发：旧浏览器页面、Preact 组件树及 HostInterface 不作为新 UI SDK 模板；已有受权服务、持久回执和经过核对的 wire 契约按其职责复用。

后端工作树从 fetched dev@cc1cdd8 及文档提交 29cb207 开始。用户另行授权建立的公开前端仓库为 [mapleluvr/pakka-webui](https://github.com/mapleluvr/pakka-webui)，初始化基线 0ee6bdc。前端 SDK/构建基础直接在新仓形成；建仓不代替阶段 2 的真实功能验收。

本轮不切换默认发行、不实现完整页面、不迁移旧 Preact 插件、不增加 Provider /login，不发布 npm 包或合并分支。

## 消费面的所有者

| 消费面                 | 所有者与入口                                                                            | 依赖边界                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 工作台 wire 与检查     | Pakka 的 `@pakka/protocol/pocket`；新接缝在 `@pakka/protocol/webui` 与 extension 子路径 | 纯数据/校验，无 React、Node 产品、Agent 或 Coding Agent 依赖                              |
| 浏览器服务客户端       | Pakka 的 `@pakka/client` 子路径                                                         | 消费协议产物，不伸入 Node 产品源码；同源和响应关联检查保留                                |
| 新 UI SDK              | pakka-webui 的 `@pakka/webui-sdk`                                                       | 全新 React 公共面；纯 UI 宿主/贡献/实例/资源视图，无 Pakka 服务、Session 或 HTTP URL 前提 |
| Pakka 接入（后续应用） | 目标为 pakka-webui 的 `src/integrations/pakka/`，本轮尚未形成完整应用接入层             | 明确消费 checked client、稳定引用、服务绑定、认证与资产来源                               |
| Backend 与 Node 产品   | 留在 Pakka                                                                              | 使用公开 Pi SDK、当前身份与资源授权；固定前端字节由产品装配注入                           |

`@pakka/webui-sdk` 与现有混合 Node 产品包 `@pakka/webui` 不共用包身份。新消费者不通过旧 `ui/components` 出口接入，亦不提供 Preact facade。旧模块清理以其实际消费者与默认产品准备情况为依据，不承担旧用户兼容义务。

现有工作台 v2 DTO/decoder 不因 URL 改名而重写所有 Pocket 类型。模型配置不复用旧 `/pocket/models/rpc` 的消息形状；服务兼容声明独立于 UI SDK 与资产版本，不给 closed hello 响应偷偷附加字段。

## 新服务及模型配置

实际出口、命令/回执、同源代理、默认值与 Node 资产参数见[公共消费接缝](../../../docs/reference/WEBUI-SERVICES.md)。服务包以 ESM 和声明消费，不承诺 CommonJS require；包仍 private，开发候选使用固定归档和 hash 配对。

新入口集中在 `/pakka-webui`，接入层负责具体路由。工作台、extension、资源解析和模型配置分别校验其消息、响应及原请求；浏览器不传入可信 actor。原有 Host/Origin、Cookie/CSRF、安全响应头与有界读取不因开发代理而放宽。

模型设置遵循 Conversation 当前 / Person 默认 / 实例连接定义三个作用域。人类默认只影响该 Person 后续创建的缺省选择，不修改已有 Conversation 或覆盖工作流显式配置。实例配置由具有实例配置权限的身份管理。

配置仍以 pi-coding-agent 的原生 models.json 及公开 ModelRuntime 为加载/组合来源，pi-ai 拥有 Provider/Model 契约。写入接缝负责版本冲突、原请求、原子保存、脱敏与重载状态；配置保存、运行时重载、目录刷新与推理成功分别表达。常用字段与高级原生配置不另建 registry。

参数编辑不增加 API key/OAuth 输入或可执行 callback 上传。已存凭据、可执行来源与受保护配置由可信后端维护；保留值不经表单回填或通用回执输出。模型/连接参数更改不抹除未编辑的原生覆盖和认证来源。

公开 ModelRuntime 的无刷新创建可用于候选配置校验：使用独立内存 credential/catalog stores、显式文件与 `refreshOnCreate: false`，不为校验解析认证或请求模型。校验会接受一部分未知 JSON 属性；因此成功加载不是每个字段已生效的证据，服务需保全未编辑字段并明确支持范围，不能把 `getError()` 原文作为公开错误。

## 原 Session 读取的明确能力边界

稳定 Session/Conversation 引用不携带授权，不等于当前 incarnation。解析结果区分已加载、未加载、不可得、无权和身份不符；插件导航只消费所属服务的结果。资产寻址及 reconnect 必须使用完整 Session 身份，不将 root Session 误当成所有条目的所属 Session。

固定 Pi Durable 1.4.0-pakka.3 的 SQLite 初始化会执行迁移；其 Node database 事务为 BEGIN IMMEDIATE，关闭还会 checkpoint。隔离公开 SDK 探针将现有库以 readOnly 打开后交给 SqliteStorage.open，实际拒绝为 `attempt to write a readonly database`，原库字节未变。

因此阶段 1 的资源 API 不通过自动 reopen、私读 SQLite schema 或替代 Session 伪造未加载历史。已有 owner 提供公开读取时按该来源读取；否则明确报告未加载/读取不可用，并公开缺失能力。该状态不能算作阶段 2 的原历史浏览通过。需要补原生只读能力时，应沿已记录的下游源补丁流程形成公开接口和独立消费证据，不修改安装中的 Pi。

## UI 与资产边界

新 SDK 区分 UI 实例与显式业务绑定；UI host 只处理贡献、容器、资源视图、命名空间命令、错误与清理。界面卸载不取消已接纳服务工作。Backend/Agent/WebUI/Client 的启停不能用同一个 UI dispose 代替，未实现的 facet 控制不得返回假成功。

React/ReactDOM/JSX、Astryx 公开浏览器入口及所需 StyleX runtime 由前端共同构建。SDK peer 声明、插件 external 与浏览器模块映射分别落实；不以宿主已包装的组件清单限制 Astryx。普通 HTML/CSS、自定义内容和局部主题保留。

固定资产 manifest 说明入口、文件内容身份、服务需求、UI SDK/runtime 组合、共享模块及 CSS/worker。后端提供已核对的字节，不在启动时构建前端或拉取 latest。共享 runtime 的 entry 为 null、workers 为空；完整应用须另行纳入 HTML 与实际 worker，不能把 runtime 构建直接当成完整 WebUI。开发代理保留浏览器原 Host/Origin/Cookie 语义，后端显式配置相应 public origin。

默认主题使用上游 Neutral 的 built object 与静态 theme.css，不触发 inline 注入；使用上游支持的系统字体 fallback，不自动访问远程 fonts.css。未构建 Theme 会被现有 CSP 拦截，静态自定义主题沿上游 theme build；不手工伪造 \_\_built、不加入 unsafe-inline。接口与构建入口见 [pakka-webui UI SDK](https://github.com/mapleluvr/pakka-webui/blob/pakka/independent-webui-seams/docs/development/UI-SDK.md)。

## 开发制品与验证

阶段 1 使用固定 tgz 与锁文件作为开发消费渠道；不以建立 public Git 仓库推定 npm 发布许可。消费者只安装清单中声明的产物，不依赖 sibling 源码、workspace alias 或根 overrides。协议/client 的单一源在 Pakka，UI SDK 的单一源在 pakka-webui。

按实际影响选择类型/构建、公开服务、现有授权/持久回执回归和仓库外安装。少测试政策继续适用，新增长期断言只保护尚未覆盖的公开兼容、安全或持久效果风险。SDK 可安装、静态图和文档检查不等于 React/Astryx 宿主、跨 Session 浏览或完整模型交互已验收；后者仍由阶段 2 承接。

实施状态由 [tasks](tasks.md)记录，原始探针和运行材料保存在本地 `docs/.temp/phase-1/`，最终验证摘要只记录候选、范围、限制与本地证据包整体 hash。
