# Pakka

Pakka 是基于 Pi Durable 的 Agent 宿主与协作系统。它提供独立 Conversation、受控上下文与工具、MAS 成员通信，以及可选的 pakka-webui 工作台。受信任的应用脚本可以组合这些能力，编写并行工作、交接、讨论与结果汇总流程。

## 使用入口

- [WebUI 使用与启动](docs/guides/WEBUI-GUIDE.md)：配置 provider、登录、创建 Session/Conversation、设置与扩展。
- [协作流程编程](docs/guides/MAS-WORKFLOWS.md)：Mermaid、可运行脚本、完成条件、产物与状态保存、分级可行性测试。
- [MAS 应用指南](docs/guides/MAS-APPLICATION-API.md)：显式 loopback server、client token 和 CLI。
- [API 参考](docs/reference/README.md)：Runtime、策略、MAS、DevPack 与 Broker。
- [预期声明](docs/state/README.md)：产品组成与跨模块契约。

## 安装与构建

要求 Node 24+、npm 11。下列命令从仓库根目录运行：

```sh
npm ci --ignore-scripts
npm run check
npm run build
```

启动 WebUI 使用显式、受保护的配置与 owner 文件：

```sh
node apps/webui/dist/main.js --config /absolute/private/pakka.json --owner-file /absolute/private/owner-link.txt
```

配置结构、目录权限和一次性登录说明见 [WebUI 指南](docs/guides/WEBUI-GUIDE.md)。模型 endpoint、模型标识、凭据来源、工具、权限和预算由宿主明确装配。

## 单 Conversation

以下示例要求本地已有 OpenAI-completions-compatible provider；示例值需要替换为实际配置。

```js
import { createHost } from "@pakka/agent";

const host = await createHost({
	cwd: process.cwd(),
	dataDir: "/absolute/project/.pakka",
	endpoint: "http://127.0.0.1:1234/v1",
	model: "your-local-model",
	apiKey: "local-only",
});
try {
	const input = host.connect("operator", ["input.submit"]);
	const receipt = await input.submit({ key: "work-1", text: "Inspect this project." });
	await host.waitForIdle();
	console.log(receipt, host.view());
} finally {
	await host.dispose();
}
```

`createRuntime()` 在一个持久 Session 中管理多个 Conversation；MAS 负责成员、投递和原生回执，DevPack 将批准的能力装配成模型工具。端到端协作示例见 [workflow.mjs](examples/workflow.mjs)。

## 持久化与效果

业务 Session 与长期 Compresser Session 各自使用 SQLite、WAL 和 FULL 同步策略。每份存储只有一个 writer。显式重开核对数据库、backend 描述与产品身份，保留资源及已消费额度；重新授权后取得新的运行命令。存储细则见 [Dynamite 持久化声明](docs/state/dynamite-persistence.md)。

`committed` 由公开 Pi 提交与原记录回读确认。策略产物、精确采纳回执和本地 checkpoint 可以在同一业务提交中保存；模型 HTTP、文件和其他外部效果各有自己的确认边界。`unknown` 保留原请求与预约，调用方先核对，不能推断已回滚或自动换 ID 重试。

Prompt、Steer 和 Follow up 使用原生调度。停止等待、请求 abort、关闭页面和进程退出均不能单独证明未送达、未产生效果或应退还预算。

## 组件与装配

| 组件                                | 职责                                            |
| ----------------------------------- | ----------------------------------------------- |
| `@pakka/agent`                      | Pi 适配、身份授权、输入、上下文、受控存储与推理 |
| `@pakka/mas`                        | 成员 catalog、所有权策略、投递、回复与 Broker   |
| `@pakka/mas-devpack`                | 批准的模型工具、指令与可选 Team facets          |
| `@pakka/protocol` / `@pakka/client` | 有界协议与共享远端 client                       |
| server / CLI                        | 受信任服务装配及命令行客户端                    |
| `@pakka/webui`                      | 工作台与公开扩展 SDK                            |
| `@pakka/dynamite`                   | 独立仓库中的上下文策略、产物与宿主端口适配      |

Dynamite 由宿主显式选用；固定配对及执行入口见 [integrations/dynamite](integrations/dynamite/README.md)。程序化 SQLite 接入和 headless server 可选贡献各遵循自己的配对与配置契约。

Pi 可变对象与凭据留在 Durable adapter，调用方取得冻结 DTO 和身份绑定命令。受信任的 Node 工具与插件仍拥有宿主进程权限；Conversation、Session、package 和 OS process 是分别选择的边界。

## 开发与维护

- [开发指南](docs/development/README.md)：架构、包边界、前端规范与检查方法。
- [Durable 补丁](docs/state/durable-patch.md)：生产依赖、固定 baseline、构建锁、安装包与维护命令。
- [工作入口](docs/OVERVIEW.md)：当前任务与所属 OpenSpec change。

检查可按任务需要选用，实际结果按其版本与范围记录。自动回归使用本地确定性 provider；真实模型可行性试跑按[协作指南](docs/guides/MAS-WORKFLOWS.md)取得适用的用户授权。
