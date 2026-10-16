# Pakka-Pocket WebUI 与扩展开发规范

状态：`@pakka/webui` 的**目标开发契约**，与 [迁移计划](PAKKA-POCKET-PLAN.md) 和 [OpenSpec 设计](../openspec/changes/pakka-pocket-webui/design.md) 一起使用。[P3 公共扩展宿主](PAKKA-POCKET-P3.md)已实现 `extension`、`ui`、`components`、`client`、`backend` 子路径与非 MAS 示例；[P4 MAS DevPack facets](PAKKA-POCKET-P4.md)已用真实 Agent 组装和 Board/member panel 消费同一公共接口。完整 UI/部署和产品验收仍在 P5/P6。下面的目标约束继续有效，具体已实现 API 以 P3 记录和独立消费者为准。

## 1. 产品核心与扩展的分工

| 产品宿主拥有                                  | 扩展贡献                                   |
| --------------------------------------------- | ------------------------------------------ |
| 登录/邀请、当前人类身份、权限检查             | 已声明 scope 下的业务查询与操作            |
| 路由 namespace、导航、Sheet/panel 容器、focus | 导航项、子页面、自定义 Preact content      |
| 组件/主题 tokens、loading/error boundary      | settings、图表、表单、成员板等交互内容     |
| command registry、触发器、operation identity  | namespaced command、参数/结果 schema       |
| checked RPC/events、连接/取消/重连            | extension action、client binding、订阅处理 |
| generation、安装/启用/更新/卸载与 assets      | 可选 Agent/Backend/WebUI/Client facet      |

MAS Board 必须通过右侧的通用贡献方式实现。不为 MAS 增加特权的 core store、专用 router 分支或“内置可绕过”标志。另一份 GUI-only 扩展必须能使用同一机制。

## 2. 四个 facet 与构建边界

- **Agent**：真实 native invocation 下的 tools/instructions/策略服务；保持现有受控端口，不向插件返回 raw Pi 对象。
- **Backend**：认证后业务查询/命令、scoped persistence、受控 job。注册 schema 和权限，不直接把任意 callback 暴露为网络 handler。
- **WebUI**：普通 Preact content、command/action 和界面贡献。采用宿主同一份 Preact/htm/组件，不自带另一份运行时。
- **Client**：对已存在 backend action/event 的类型化编码、解码和调用，不自行授予权限或定义服务端没有的命令。

一个扩展可以只实现任一面。WebUI-only 不要求工具、模型或 Conversation；Agent-only import 不加载 Preact/Web server。一个 extension package 的 browser、backend、Agent exports 应有明确的 module graph 边界。

`@pakka/webui` 作为单一产品包，可以暴露纯声明、组件等 public SDK 子路径；扩展只 peer-consume 这些明确 exports。不得跨 workspace import `src/`、私有 `dist/`、页面 store/router 或可执行入口。核心 agent/MAS 库不反向依赖产品。

## 3. 界面作者可以做什么

公共扩展面包括：

- 注册导航项和 extension namespace 下的页面。
- 注册 app/Conversation 范围的 sheet、panel 和设置入口。
- 编写完整 Preact 交互内容，不限于配置表单或 schema form。
- 使用宿主 UI primitives、主题 tokens、状态/订阅 hooks。
- 注册 slash/command-palette/button action，共用 command identity。
- 返回私有 toast、共享 display card、打开 interface 或 operation receipt。

宿主负责容器 title、close/focus、返回导航、加载与错误状态；扩展不要嵌套第二个应用壳层或通过 DOM monkey patch 抢占它。完整全局布局/store override 不是首版稳定第三方接口；需要新插槽时用真实消费者证明，而不是复制内部代码。

设置界面只是自定义 interface 的一种用途。简单设置复用标准 input/select/toggle；复杂 MAS topology、receipt inspector、策略预览可以自行组成组件。

## 4. 组件、交互和样式

- 沿用被采用 pi-pocket 的 Preact/htm、主题、移动布局和基本交互；固定依赖及复制代码/字体的许可证来源。
- 组件默认消费 DTO 和 host-owned context，不把整个应用状态注入扩展。
- 状态分别处理 loading、empty、denied、conflict、unknown、stale/disconnected 和 terminal；不要把它们合成同一个红/绿点。
- 显示已持久 membership 与 native live readiness 的区别；generation done 不等于业务目标或工具副作用已完成。
- 表单写入前展示 scope；危险操作需要明确目标和动作反馈，重复点击复用同一 pending operation，不能静默分配新请求。
- 使用公开 tokens/classes，CSS 作用于自身内容，不覆盖全局登录/权限/别的插件。小图标沿用或直接编写 repo-native SVG，不引入不必要的位图生成流程。
- 键盘可操作、focus trap/return、Escape、屏幕阅读标签、窄屏可滚动和触摸交互是组件要求，不是最后加的桌面补丁。
- 页面和面板卸载时释放 host subscriptions、listeners、timers 和 abortable reads；关闭界面不表示已接受的服务端工作取消或回滚。

## 5. Command contract

每个 command 的定义至少覆盖以下概念，具体 TypeScript API 在有独立类型消费者时固定：

| 字段/行为        | 要回答的问题                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| identity/version | 属于哪个 extension/generation/action？名称冲突怎么拒绝？                     |
| scope            | 无 Conversation 的 app 操作，还是指定 Session/Conversation/resource？        |
| actor/permission | 谁能发现、谁能执行？driver/owner 是否需要效果时重验？                        |
| input/output     | 哪个有限 runtime schema？参数错误发生在效果之前还是之后？                    |
| model effect     | 纯显示/设置，还是显式提交任务？不能由 slash 文本猜测                         |
| operation policy | read/write、deadline、cancel、request identity、conflict、unknown 如何表达？ |
| presentation     | private notice、shared card、interface、receipt 各自的可见域                 |

输入 slash、点击 suggestion 或按钮走同一 dispatcher。保留 built-in/template/skill 名称规则；冲突不以“最后加载覆盖”解决。Status/settings 命令不自动发 prompt、不改变 requester；显式 send-work 才调用受控 input/A2A，并返回真正的 native receipt。

Card 是显示记录，不是偷偷添加 system/user message。必须用下一次真实 provider payload 验证它不进模型，而不是只看前端没有渲染成聊天气泡。

## 6. Backend RPC、数据和任务

- 宿主验证 extension/action/version envelope；扩展注册有限 input/output/event schema、scope 和所需 action permission。任意 `unknown` payload 加一个 action 字符串不构成公开契约。
- 当前 actor 由服务端绑定；浏览器带来的 user/principal/source/grant 只是未经授权的数据。
- 从受控服务取冻结 DTO/绑定 closure。原始 Harness、Tx、DocumentReader、provider session/credential 不离开 adapter。
- 业务 settings/notes 等使用明确 namespace 与版本冲突规则；user、Conversation 和 extension 的 scope 不能仅靠 UI 选项约束。
- 长工作通过受控 job/receipt 服务；HTTP 与 wait 均有有限期限，关闭/取消 wait 不等于取消已接受的 job。
- 同 actor/resource/request 的相同参数只 reconciliation；不同参数拒绝冲突。未知 handler 不自动重进，不能宣称任意外部效果 exactly-once。
- 实际 public SDK 的 `ExtensionClient.operationByRequest({ extension, requestId, target })` 可在丢失 host operation ID 时只读查询原请求；服务端绑定当前 person 和精确 AgentRef，并在发布前重查原权限。`UIContext.operationByRequest(requestId)` 另绑定当前 open instance。
- 外层 operation 已记录 `done` 不证明内层 job/browser/native effect 已完成；内层仍为 `unknown` 时必须保留待确认身份，不解锁重复效果。
- 明确 pre-effect guard 的拒绝可报 denied；opaque callback 可能已有效果，其异常/断连/超时保持 unknown。不要解析报错文本推断 rollback。
- 不把 metadata 写和 native Durable effect 称为跨存储原子提交。保留各自 operation/receipt 与不确定状态。

## 7. 多人可见性与私密数据

用户安装插件即确认代码可信。可信 backend/同源前端不是沙箱；规范不承诺限制恶意同进程代码。业务 API 仍必须执行：

1. 发现、快照、历史、文件/导出、审批、RPC/assets、SSE 都在服务端按当前 person/resource 过滤。
2. 查看不意味着 send/steer/manage；MAS 通信权限也不意味着完整 transcript read。
3. 驱动与授权变化在等待后的效果边界重验，撤权关闭后续 stream/读/操作；不声称撤回已经发给浏览器的字节。
4. 私有 toast 只回当前操作者；shared card/notes 明确共享 scope；人类 side chat/presence 默认不进入模型。
5. 已存 secret 不回填表单，不进 URL、command history、browser persistent storage、task/entry、广播或 export。配置敏感值区分 keep/replace/clear；provider credentials 不成为通用 plugin client 字段。

Pakka-Pocket 的主 provider key 使用独立 `credential.status / credential.replace / credential.clear` 命令，不进入扩展 command palette 或通用 settings 回填。只有具备全局安装权限的当前人类可调用；scoped admin 也不能改变全 Session 的凭据。写请求带稳定 request ID 和预期 version，只返回 `{ version, configured }`。表单提交即清空输入，未知响应后只能显式读取当前状态，不自动重发密钥；读到当前配置不等于证明原写操作的完整历史。

owned 私密服务会持久保存显式提交的值，供未来原生主请求解析；保留已有启动 resolver，直到明确替换/清除。清除会阻止后续解析且重开不回退，但不撤回已发请求、不擦除旧持久日志，也不宣称加密。它的稳定写回执有每 Session 256 次的上限，不以自动遗忘回执扩大容量。

## 8. 生命周期与资产

- extension identity、generation、resource scope 与 open-instance identity 都要绑定。旧回调不能关闭/通知/写入新的界面实例。
- 提前检查 names/schema/compatibility/assets 后再发布 registration。失败重建只有在旧状态可确认时才保留；partial/unknown installation 要封闭并核对，不假称全局回滚。
- disable/uninstall 移除新调用入口并清理 host-owned 界面资源，不删除 members/history 或把已接受工作记成未发生。
- public assets 来自真实批准目录的固定字节；拒绝 symlink/junction、traversal、hidden/private files 和超限内容。旧 generation 不得提供新字节。
- 任意 ESM 全局副作用不能被卸载撤销。需要整页 refresh 才能使用新 generation 时明确提示，不承诺全图热替换。

## 9. 实际开发与验证路径

每个扩展至少提供：

1. 能从 public exports 编译的独立消费者，无内部路径/根 overrides。
2. 一份可原样安装的例子：GUI-only 或真实配置影响后续行为的工具/服务。
3. 实际 WebUI/backend/browser 路径测试，而非只调用 handler 返回 success。
4. 两个获准人与一个越权身份，检查 HTTP/SSE/export/模型的 canary 泄漏。
5. typed/tapped/button 一致性、权限、冲突、reload失败、旧实例、断网后相同身份 reconciliation。
6. desktop 与手机 viewport 的直接浏览器检查。初始固定视口取 `1440×900` 和 `390×844`，作为测试配置而非产品适配上限。
7. local deterministic provider、独立 browser profile 和存储；不读用户 cookie/sign-in，不调用付费模型。
8. 正向 action/job/refusal 记录、原始 receipts/state 和 HTTP/tool 计数，防止“没有额外请求”掩盖根本没有触发功能。

只修改文档时检查文档结构、链接和格式，不重跑无变化的模型矩阵。代码实施后的通过依赖实际消费者与精确产物，不依赖 OpenSpec checkbox 或截图单独自证。
