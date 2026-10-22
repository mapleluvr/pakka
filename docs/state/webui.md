# WebUI 服务与扩展

## 人类身份与资源

Pakka-Pocket 的人类身份与权限由服务端绑定，浏览器请求按该绑定解释。邀请消费、session/role、资源 scope、当前 driver 和 Agent profile ceiling 共同约束读取与效果。

发现、HTTP/RPC、SSE、assets、历史、查询、导出和操作核对在序列化前按当前授权过滤。撤权停止后续读写与事件发布；已发布字节处于接收端。模型密钥通过独立的受控凭据命令提交、保存和解析；输入提交后清空，状态读取返回版本与 configured。表单回填、通用 settings、URL、浏览器持久存储、模型历史和广播对已存模型密钥仅读取公开配置状态。

人类 presence、side chat、notes、pins/reactions 和 turn-taking 各自处理 scope、冲突与持久性。明确发送动作把选定内容送入模型；SSE 重连使用当前 incarnation、cursor、snapshot 恢复读取并核对原操作。mutation 的接纳使用独立的显式请求和原请求身份。

## 服务与可选 facets

宿主拥有认证、namespace、路由/实例、focus、generation、权限检查、受控操作和有限持久化服务。可信扩展可分别提供 Agent、Backend、WebUI、Client facets：

- 声明与 browser 入口提供公开协议、组件和浏览器侧绑定，共用宿主 Preact/组件；server、存储和推理由显式后端启动流程建立。浏览器与后端分别使用各自的公开 exports 和模块依赖图。
- 自定义 Preact 页面、panel、sheet、settings 与导航通过公共 slots 及宿主绑定的接口接入。
- slash、suggestion 和等价按钮使用同一 namespaced dispatcher；人类命令处理协作与显示，模型输入由明确的工作发送动作提交。
- 外层 operation、内层 job/native receipt 和实际业务效果各自核对。界面关闭、wait 取消和卸载处理各自生命周期；已接纳工作及其结果继续由所属服务管理，效果终态依据该服务的原生记录与实际结果确认。
- generation、resource、actor 与 open-instance 共同绑定调用。回调只作用于仍有效的所属实例；安装/handler 未确认时保持闭锁并核对原操作。
- 文件/Git、审批、owned browser、Memory、schedules、Webhook、通知和语音分别通过有限服务访问批准资源。每项效果按该服务的 schema、权限和资源 scope 校验。

页面结构、菜单位置和视觉交互见[前端声明](frontend.md)。服务 schema、请求身份、期限、权限和组件 API 细则由[WebUI 开发契约](../development/WEBUI-DEVELOPMENT.md)及公开 exports 维护。

## 领域场景

| 主题                                                                                 | 维护位置                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 产品、files/Git、审批/browser、配置、通知、schedules、Memory、Webhook、context、语音 | [Pakka-Pocket 场景](../../openspec/changes/pakka-pocket-webui/specs/pakka-pocket/spec.md)                                                |
| 人类角色、协作、stream 与远程部署                                                    | [协作场景](../../openspec/changes/pakka-pocket-webui/specs/pocket-collaboration/spec.md)                                                 |
| facets、command、RPC、assets、生命周期及 unknown                                     | [扩展场景](../../openspec/changes/pakka-pocket-webui/specs/webui-extensions/spec.md)                                                     |
| browser-safe 协议与独立的 WebUI 桥接                                                 | [应用 API](../guides/MAS-APPLICATION-API.md)、[桥接场景](../../openspec/changes/pakka-pocket-webui/specs/authenticated-mas-apps/spec.md) |
