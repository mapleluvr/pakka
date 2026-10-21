# WebUI 服务与扩展

## 人类身份与资源

Pakka-Pocket 的人类权限由服务端绑定。邀请消费、session/role、资源 scope、当前 driver 和 Agent profile ceiling 共同约束读取与效果；浏览器传来的 person/principal/grants 不构成 authority。

发现、HTTP/RPC、SSE、assets、历史、查询、导出和操作核对在序列化前按当前授权过滤。撤权停止后续读写与事件，不声称撤回已发布字节。模型密钥不回填到表单、通用 settings、URL、浏览器持久存储、模型历史或广播。

人类 presence、side chat、notes、pins/reactions 和 turn-taking 保留自己的 scope、冲突与持久性。只有明确发送动作把选定内容送入模型；SSE 重连以当前 incarnation、cursor、snapshot 核对原操作，不重放 mutation。

## 服务与可选 facets

宿主拥有认证、namespace、路由/实例、focus、generation、权限检查、受控操作和有限持久化服务。可信扩展可分别提供 Agent、Backend、WebUI、Client facets：

- browser/声明 import 不启动 server、存储或推理，不加载 Pi/后端私密实现；共用宿主 Preact/组件。
- 自定义 Preact 页面、panel、sheet、settings 与导航使用公共 slots，不私有导入 store/router，不依赖 MAS built-in 身份。
- slash、suggestion 和等价按钮使用同一 namespaced dispatcher；纯人类命令不自动提交模型工作。
- 外层 operation 与内层 job/native receipt 分开核对；关闭、取消 wait、卸载和普通异常均不证明效果回滚。
- generation、resource、actor 与 open-instance 绑定。旧回调不能作用于新实例；未确认安装/handler 不能自动再进。
- 文件/Git、审批、owned browser、Memory、schedules、Webhook、通知和语音各自使用有限服务与批准资源。UI 展示不授予任意 shell、目录、脚本求值、原始 Tx/Harness 或凭据访问。

页面结构、菜单位置和视觉交互由[前端声明](frontend.md)维护。服务 schema、请求身份、期限、权限和组件 API 的细则由[WebUI 开发契约](../development/WEBUI-DEVELOPMENT.md)及公开 exports 维护；实现偏离时不以实现反向取消目标。

## 领域场景

| 主题                                                                                 | 维护位置                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 产品、files/Git、审批/browser、配置、通知、schedules、Memory、Webhook、context、语音 | [Pakka-Pocket 场景](../../openspec/changes/pakka-pocket-webui/specs/pakka-pocket/spec.md)                                                |
| 人类角色、协作、stream 与远程部署                                                    | [协作场景](../../openspec/changes/pakka-pocket-webui/specs/pocket-collaboration/spec.md)                                                 |
| facets、command、RPC、assets、生命周期及 unknown                                     | [扩展场景](../../openspec/changes/pakka-pocket-webui/specs/webui-extensions/spec.md)                                                     |
| browser-safe 协议、不扩大 headless v1                                                | [应用 API](../guides/MAS-APPLICATION-API.md)、[桥接场景](../../openspec/changes/pakka-pocket-webui/specs/authenticated-mas-apps/spec.md) |
