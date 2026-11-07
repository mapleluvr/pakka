# WebUI 服务与扩展

## 默认启动与停止

`pakka` 无参数启动前台 WebUI；`--connection` 保留协议客户端。默认本地产品无需宿主 JSON 或已选模型，模型配置来自 Pi agent directory。PAKKA_HOME 保存已选启动来源、工作区、原控制 Session 和数据；首次启动绑定当前目录，之后重开该已记录工作区，不因 shell 当前目录改变而替换存储。高级 JSON 或可信模块仍可显式选用。

初始 owner 登录链接只写入新私密文件并用于登录 fragment，不打印密钥。正常停止关闭 owned 资源后释放 writer；关闭网页不停止工作。`--no-open` 不调用 OS 浏览器。未确认启动要求显式 `--recover` 或同一 reopenSessionFile；恢复核对原定位，不猜测缺失状态、不清 writer 锁、不创建替代库或重放输入。启动和重开不提交模型工作。

## 人类身份与资源

pakka-webui 的人类身份与权限由服务端绑定，浏览器请求按该绑定解释。邀请消费、登录 session/role、资源 scope 与当前 driver 分别约束读取和相应效果；整组 Agent profile ceiling 约束工具/指令预设。单独选择模型共用 Conversation 配置权限，完整模型目录来自可信宿主注入的 Pi Models；原生 provider/modelId、真实能力和可用认证状态不以 Agent profile 数量或伪造的统一元数据代替。

产品通过公开 ModelRuntime 接入 Pi agent directory 的模型与认证配置，不另建单-provider 配置格式。没有选定模型或配置暂不可用时，工作台仍可打开；设置入口支持配置来源、刷新和受权认证。默认选择与当前 Conversation 选择分开，刷新不自动发送工作或重放旧请求。模型目录分页查询，不以兼容响应的有限前缀表示全部可选模型。

发现、HTTP/RPC、SSE、assets、历史、查询、导出和操作核对在序列化前按当前授权过滤。撤权停止后续读写与事件发布；已发布字节处于接收端。模型密钥通过独立的受控凭据命令提交、保存和解析；输入提交后清空，状态读取返回版本与 configured。表单回填、通用 settings、URL、浏览器持久存储、模型历史和广播对已存模型密钥仅读取公开配置状态。

人类 presence、side chat、notes、pins/reactions 和 turn-taking 各自处理 scope、冲突与持久性。明确发送动作把选定内容送入模型；SSE 重连使用当前 incarnation、cursor、snapshot 恢复读取并核对原操作。mutation 的接纳使用独立的显式请求和原请求身份。

## Session 管理与个人导航

一个 WebUI 身份可管理多个真实 Durable Session；每项各有独立 storage、writer、Runtime 和原生预算，服务按完整 Session/Conversation 地址路由。New Session 复用现有创建权限，稳定原请求登记与 native ready 确认分别核对；unknown 不自动初始化、解锁或重放。已有单 Session 的资源 grant 不向另一个 Session 的同号 Conversation 扩权。

个别已确认子 Session 打开失败时，工作台保留原登记并显示 unavailable，健康成员继续服务。具有全局 Session 创建权限的人类可显式请求重新打开该原身份；重开不创建替代存储、不清 writer 锁、不重新初始化 unknown 登记、不重放历史输入。运行中已封闭或清理未确认的 Runtime 不通过此动作再次打开。状态与结果发布前重新检查当前权限；底层异常不作为公开诊断正文。

个人单层文件夹和 Sort Per Session / Default 偏好在控制 Session 的每人 namespace 中持久化，只整理当前可读资源，不改变原生归属或新增 ACL。具体命令、有限容量、重开与恢复边界见[开发契约](../development/WEBUI-DEVELOPMENT.md#session-管理创建与个人导航)，界面见[前端声明](frontend.md#创建与导航)。

## 服务与可选 facets

HTTP listener 自动分配端口时，仅发布 Fetch 与浏览器可访问的端口；遇到被 Fetch 禁用的临时端口先关闭该监听再有限重选。显式指定禁用端口时拒绝，不擅自改端口，不修改系统范围或关闭浏览器保护。

宿主拥有认证、namespace、路由/实例、focus、generation、权限检查、受控操作和有限持久化服务。可信扩展可分别提供 Agent、Backend、WebUI、Client facets：

- 声明与 browser 入口提供公开协议、组件和浏览器侧绑定，共用宿主 Preact/组件；server、存储和推理由显式后端启动流程建立。浏览器与后端分别使用各自的公开 exports 和模块依赖图。
- 自定义 Preact 页面、panel、sheet、settings 与导航通过公共 slots 及宿主绑定的接口接入。
- slash、suggestion 和等价按钮使用同一 namespaced dispatcher；人类命令处理协作与显示，模型输入由明确的工作发送动作提交。
- 外层 operation、内层 job/native receipt 和实际业务效果各自核对。界面关闭、wait 取消和卸载处理各自生命周期；已接纳工作及其结果继续由所属服务管理，效果终态依据该服务的原生记录与实际结果确认。
- generation、resource、actor 与 open-instance 共同绑定调用。回调只作用于仍有效的所属实例；安装/handler 未确认时保持闭锁并核对原操作。
- 文件/Git、审批、owned browser、Memory、schedules、Webhook、通知和语音分别通过有限服务访问批准资源。每项效果按该服务的 schema、权限和资源 scope 校验。
- owned browser 进程停止与临时 profile 删除分别确认；OS 占用导致残留时保留私密清理记录，不通过强删或终止其他组件伪造清理完成。浏览器缓存不属于 Session 持久历史或备份。

页面结构、菜单位置和视觉交互见[前端声明](frontend.md)。服务 schema、请求身份、期限、权限和组件 API 细则由[WebUI 开发契约](../development/WEBUI-DEVELOPMENT.md)及公开 exports 维护。

## 领域场景

| 主题                                                                                 | 维护位置                                                                                                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 产品、files/Git、审批/browser、配置、通知、schedules、Memory、Webhook、context、语音 | [pakka-webui 场景](../../openspec/changes/pakka-webui/specs/pakka-webui/spec.md)                                                  |
| 人类角色、协作、stream 与远程部署                                                    | [协作场景](../../openspec/changes/pakka-webui/specs/pocket-collaboration/spec.md)                                                 |
| facets、command、RPC、assets、生命周期及 unknown                                     | [扩展场景](../../openspec/changes/pakka-webui/specs/webui-extensions/spec.md)                                                     |
| browser-safe 协议与独立的 WebUI 桥接                                                 | [应用 API](../guides/MAS-APPLICATION-API.md)、[桥接场景](../../openspec/changes/pakka-webui/specs/authenticated-mas-apps/spec.md) |
