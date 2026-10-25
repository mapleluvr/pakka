# 产品与范围

## 产品组成

Pakka 提供受控 Pi 运行时、MAS 服务与可选 pakka-webui Web 工作台。

- `@pakka/agent` 承担 Conversation、authority、admission、策略和原生持久化端口。
- [Pi Durable 源补丁](durable-patch.md)提供 generation 的策略拒绝与请求级检查，包含固定基线、源补丁、构建输入及生产安装归档。
- `@pakka/mas` 提供成员、通信、资源控制及有界多 Session 协调。
- `@pakka/mas-devpack` 提供可选 Agent/Backend/WebUI/Client facets。
- `@pakka/protocol` 与 `@pakka/client` 提供有限、可验证、browser-safe 的协议和客户端。
- server、CLI 和 `@pakka/webui` 是应用入口。pakka-webui 作为单一产品包携带同名 `pakka-webui` 可执行入口、Web 资产及纯公开 SDK 子路径。

包、仓库、进程、Session 与 Conversation 各自划分发布、执行、存储和对话职责。同进程的 Harness 共享进程执行环境；每个 Durable storage 由一个 writer 持有。依赖方向与拆仓条件见[仓库规范](../development/MONOREPO-CONVENTIONS.md)。

## 使用范围

普通 Conversation 可独立使用，MAS 界面作为可选贡献安装。pakka-webui 面向多人、远程与手机使用，通过受控服务提供原生输入、历史/工具显示、独立模型与工作目录选择，以及邀请、权限、协作、项目文件/Git、审批、浏览器、记忆、定时输入、Webhook、通知和可选语音能力。

- 模型配置使用服务端已配置 provider 的可用模型目录，共用 Conversation 的配置权限。endpoint、凭据、配置模块与整组 Agent 预设由受信任宿主配置；整组预设的工具/指令授权与单独模型选择分别处理。
- 人类侧聊、显示卡片、导航和查看各自处理呈现与协作；明确发送的工作进入原生受控输入。
- local、LAN、tailnet 与公网 tunnel 按各自的传输和认证条件使用。headless v1 使用 loopback 专用令牌接口，WebUI 使用独立的人类认证与受控服务。
- 普通 Conversation 的生命周期区分归档、恢复与删除；MAS 成员退休按成员寿命契约停止接纳并处理已接纳工作。

服务行为细则见 [WebUI](webui.md)，界面结构与交互见[前端](frontend.md)，多 Agent 关系见 [MAS](mas.md)。

## 数据、信任与可选策略

pakka-webui 使用独立数据目录保存本产品的人类身份、邀请、设置与协作数据；Conversation 和原生工作由受控 Runtime 管理。MAS 通过自己的受控服务和公共扩展槽提供成员、通信与资源控制。

安装扩展的授权以其代码可信为前提。扩展在宿主进程或同源前端环境中执行；业务 API 按当前人类身份、资源 scope 与权限检查读取和效果。存储重开、writer 所有权及效果核对由 [Runtime](runtime.md) 的条件约束。

默认策略使用 native context。宿主可显式选择固定支持配对中的 Dynamite，为选定的初始 persistent 成员绑定策略。配置、产物配对与静态成员条件见 [Dynamite 产品 API](../reference/DYNAMITE-PRODUCT-API.md)。

## 形成记录

产品与协作范围的采用经过见 [WebUI 与 MAS](../changes/webui-and-mas.md)，核心模块与可选策略的形成见[核心集成](../changes/core-integration-lineage.md)，前端采用见 [Devin 前端](../changes/devin-frontend-adoption.md)。
