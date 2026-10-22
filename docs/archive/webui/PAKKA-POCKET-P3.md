# Pakka-Pocket P3 — 公共扩展宿主

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前工作](../../OVERVIEW.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

本页保留 P3 当时的阶段验收。后续 Agent facet 组装和 MAS Board/member panel 已在 [P4](PAKKA-POCKET-P4.md) 实现并独立验证。

P3 在 [P2 实际产品](PAKKA-POCKET-P2.md) 上增加公共 Backend／WebUI／Client 宿主，并通过当时的实现阶段门禁。这里的非 MAS 示例证明相同插槽可以独立消费；后续 MAS 与本机工作台的实际范围见 [移除前状态快照](https://github.com/mapleluvr/pakka/blob/200af506913ee38d7a357e5da96ea5e2afc03d67/docs/PAKKA-POCKET-STATUS.md)。下文阶段结果保留原版本条件。

## 公共入口与示例

单一 `@pakka/webui` 产品包提供：

| Export                    | 职责                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `@pakka/webui/extension`  | 不执行模块的 manifest、有限 schema、DTO 与校验               |
| `@pakka/webui/ui`         | 浏览器 interface/context 类型                                |
| `@pakka/webui/components` | 宿主同一份 Preact 下的 Button、Stack、Field、Notice、Spinner |
| `@pakka/webui/client`     | 浏览器安全的版本化扩展 RPC、有限响应与 operation 查询        |
| `@pakka/webui/backend`    | 可信 backend 的 handler/context、服务声明与宿主组装入口      |

`examples/hello` 是没有 backend、模型或 Conversation 要求的 GUI-only 页面/Sheet；`examples/preferences` 提供 app 设置 Sheet、私有 CAS 设置、状态命令及 Conversation 范围的显示 card。两者原样随包交付，只依赖 public exports。生产库没有反向依赖 WebUI；现有 headless Agent extension import graph 不因 WebUI 安装而变化。

可信启动配置通过 `extensions: [{ root: <absolute approved directory>, facets?: [...] }]` 添加本地扩展。纯 JSON 配置不能注入函数、service、身份或运行权限；程序化 `startPocket` 可以由宿主显式提供已批准的 `extensionServices`。普通浏览器只能启停/重载已批准的扩展，不能选择服务端文件路径、模块或 provider 配置。添加代码即确认可信，不增加插件沙箱或重复的信任确认。

Agent facet 的动态模块安装不在这个宿主中隐式启用；它仍需批准 profile 的真实 native invocation 组装，留给 P4 的 DevPack 消费者验证。Backend、WebUI、Client 可以分别选择；client-only 只服务它声明的入口，不要求注册 UI 或工具。

## 声明与界面

Manifest `api: 1` 固定 id、version、facets、actions、commands、interfaces 和显式服务名。动作输入/输出使用有限递归 schema，未知字段、无限数组/字符串、原型键与错误引用会拒绝；不能以无约束 unknown 加 action 字符串代替契约。

公开 `page`、`panel`、`sheet`、`settings` 槽位接受普通 Preact content export。宿主提供导航、标题、关闭、加载/错误容器、focus trap/return、Escape、身份与资源切换清理。扩展可自行组成完整子界面，不限于配置表单。浏览器共用固定 Preact 与 hooks；组件没有私有 router/store 或 native Pi 对象入口。

Typed slash、点击 suggestion、命令面板按钮走同一个 dispatcher。GUI-only command 可以仅打开 interface；业务 action 才走有限 RPC。默认不产生模型输入。显示 card 通过 P1 display-only 端口保存，私有通知只回当前操作者；实际后续 provider 请求不包含 card 或私有设置文本。迟到结果需核对 person、resource、generation；已关闭实例的回调不能关闭、通知或重新打开替换后的实例。

## Backend 与权限

扩展 RPC 为 `/pocket/extensions/rpc`，沿用当前 Cookie 身份、精确 Origin/Host 与 CSRF，不接受浏览器自选 actor/principal。Handler 只得到冻结 DTO、当前身份与有限绑定服务。Conversation 写操作重验相应人类权限；app 范围写操作要求产品管理权限。Named service 必须由宿主声明，并在等待前后及受控效果处检查当前授权。

Settings 的键包括 extension、person 和可选 Conversation，采用 CAS；其他已获准用户也不能读取私有设置和 operation。长工作通过已有受控 native job/receipt 端口，不能把持续 HTTP callback 当成调度器。BackendContext 没有原始 Harness、Session、Tx、存储 reader 或 provider credential。

Mutation 在进入任意 handler 前持久记录 actor、resource、action/version、payload fingerprint 和 request identity。相同请求只核对原记录；不同参数冲突拒绝。已记录 pending/unknown 的任意 handler不自动重进。真实 native 准入后抛错或丢结果保持 unknown，不能从错误文本推断未发生效果，也不退还调用预算。读取不写 mutation 账本；有限超时、取消等待不等于取消已接受工作。

## 安装、重载与资产

整个启动批次先检查纯 manifest、名字/命令冲突、服务声明和资产，再运行可信 backend。冲突不允许留下已经导入的半个批次。每次接受/启停生成新的有限 generation；改变资产字节不能继续使用旧 generation 服务。Public 文件服务校验真实 root、路径、类型、大小与字节 SHA，拒绝 traversal、hidden/private、symlink/junction，backend 文件不作为浏览器资产。

无效果的准备失败可保留已确认的旧 registration。Backend import 已进入而失败的状态必须持久标为 unknown；进程在 loading 时退出也不能自动重新进入初始化。显式 reload 重新核对后才可继续。这是封闭与核对，不是任意 ESM 全局效果的回滚或整张模块图的热替换保证。原生 ESM 依赖图或全局副作用需要进程重启/整页刷新时，仍需明确处理。

Disable 或移除启动配置使新入口与宿主界面消失，不删除 Conversation、成员、历史或已接受工作。关闭某个 WebUI 贡献不会停止原生模型工作；没有 WebUI facet 的 headless 用法仍然独立。

## 验证记录

- GUI-only 页面实际使用公共组件和 hooks；backend 示例通过当前人类绑定保存 CAS 设置、生成显示 card、核对原操作。
- HTTP 和公开客户端验证 viewer/私有记录拒绝、等待中撤权、错误 generation、真实效果后 unknown、正常 writer 重开不重放。
- 原生 filesystem/模块反例验证冲突先于 import、加载失败封闭、有限 generation、client-only、持久 disable、junction 与改变资产字节。
- 真实桌面/手机 Chrome 验证 typed/tapped/button 命令、无 Conversation 界面、旧实例回调、窄屏导航与关闭扩展后仍可执行正常工作。
- 仓库外类型消费者分别使用 DOM-only 与 NodeNext 项目，验证 public exports 和 native handles/伪造身份的类型拒绝。实际安装消费者从可执行入口加载随包示例，不通过 workspace source 或 root overrides。

最终定向 **22/22**、全量 **332/332**，无 skip/todo/cancel；build/check/format 与全部隔离安装消费者通过。实际产品从 SDK 包外的原样示例目录加载 GUI-only/设置扩展，完成命令、card、模型输入和正常重开，模型 HTTP 仍为 **1 次**，没有私有设置或 card 泄漏。DOM-only 与 NodeNext 公开声明消费通过；关键源码/测试的主动 LSP 检查无错误。40 个冻结候选源码/helper 字节在门禁前后核对一致；这是 P3 中间身份，不替代 P6 的完整产品/source/asset 枚举。

初轮定向 20/20、全量 330/330 之后，新增真实重开反例确认初始化 unknown 只留内存的缺陷；原红绿与初轮安装日志保留，最终门禁针对持久化修复重新执行。过程与原生 HTTP/存储证据位于 `artifacts/pakka-pocket/p3/` 和 `artifacts/package-smoke/`。Agent facet 的共同安装消费者与完整槽位业务消费在 P4 继续，P6 指定独立复审尚未执行。
