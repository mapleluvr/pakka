# 产品与范围

## 产品组成

Pakka 提供受控 Pi 运行时、MAS 服务与可选 Pakka-Pocket Web 工作台。它是有明确边界的集成产品，不承诺完整 developed-Kappa、stock Pi TUI/CLI 或任意原生插件兼容。

- `@pakka/agent` 承担 Conversation、authority、admission、策略和原生持久化端口；名称保持不变，不增加转发 gate 包。
- `@pakka/mas` 提供成员、通信、资源控制及有界多 Session 协调。
- `@pakka/mas-devpack` 提供可选 Agent/Backend/WebUI/Client facets。
- `@pakka/protocol` 与 `@pakka/client` 提供有限、可验证、browser-safe 的协议和客户端。
- server、CLI 和 `@pakka/webui` 是实际应用。Pakka-Pocket 作为单一产品包携带可执行入口、Web 资产及纯公开 SDK 子路径，不增加无真实消费者的占位包。

包、仓库、进程、Session 与 Conversation 是不同边界。一个 Harness 不提供进程隔离；每个 Durable storage 只由一个 writer 持有。依赖方向与拆仓条件由[仓库规范](../development/MONOREPO-CONVENTIONS.md)维护。

## 使用范围

普通 Conversation 工作不要求安装 MAS 界面。工作台通过受控服务提供原生输入、历史/工具显示、独立模型与工作目录选择，以及多人邀请、权限、协作、项目文件/Git、审批、浏览器、记忆、定时输入、Webhook、通知和可选语音能力。

- 模型配置只选择宿主批准的引用；浏览器不引入 endpoint、凭据、任意配置模块或更强 Agent grants。
- 人类侧聊、显示卡片、导航和查看不隐式进入模型；显式发送工作才进入原生受控输入。
- 多人、远程与手机是产品目标。局部本机子集不能代替最终范围，也不能以未测部署为由取消这些目标。
- local、LAN、tailnet 与公网 tunnel 各自有明确的传输和认证条件；headless v1 的 loopback 默认不随 WebUI 扩大。
- 普通 Conversation 的归档、恢复、删除和 MAS 退休保持不同含义；未明确删除契约时，不用重命名现有动作冒充删除。

服务行为细则见 [WebUI](webui.md)，界面结构与交互见[前端](frontend.md)，多 Agent 边界见 [MAS](mas.md)。

## 排除与信任边界

- Plan mode 与 Goals/Done when 不属于产品范围；scheduled inputs 属于范围。
- 不加载旧 pi-pocket SQLite、用户、邀请、settings、任务或 transcript；产品使用独立数据目录。
- 不保留旧 subagent/PiP 的隐藏助手、调度或 authority 路径。MAS 使用自己的受控服务和公共扩展槽。
- 授权安装扩展意味着信任其代码，不提供恶意同进程插件沙箱；业务 API 仍必须执行当前人类/资源授权。
- 不承诺共享 storage 多 writer、完整 forced-crash 恢复、legacy C2 跨重启 claim 重建、通用任意 host RPC 或工具副作用回滚。
- Dynamite 仅在宿主明确选择的固定支持配对和静态成员范围内启用，不默认为策略，不推断 worker/动态子成员支持。精确边界由[产品 API](../reference/DYNAMITE-PRODUCT-API.md)维护。

采用这些范围的来路见[文档分工与初始状态记录](../changes/2026-10-21-documentation-system.md)；当前实现差距不改变本页的目标。
