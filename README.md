# Pakka

Pakka 是基于 Pi Durable 的 Agent 宿主与协作系统。在 shell 中运行 `pakka` 可打开管理 Session 和 Conversation 的 WebUI；可信应用也可通过 SDK 使用原生输入、上下文、工具及 MAS 协作能力。模型目录与认证接入 Pi 原生配置，执行与持久化沿用各自的权限和身份边界。

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

将当前源码安装的命令链接到 shell，随后在 pwsh / bash 中运行：

```sh
npm link --workspace @pakka/cli --ignore-scripts
pakka
```

首次运行前切到希望使用的项目目录。`pakka` 启动 WebUI 并打开浏览器，模型与凭据可随后在设置中配置。也可直接运行 `node apps/cli/dist/main.js`；`pakka --no-open` 只启动服务，Ctrl+C 正常停止。

产品定位与数据使用 `PAKKA_HOME`（默认 `~/.pakka`），Pi 配置使用 `PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）。首次启动绑定当前目录，后续运行重开已记录的工作区与原 Session。

模型、provider 和认证沿用 Pi 原生目录，可继续使用外部配置工具，再在 **Settings → Models & Providers** 刷新或认证。默认本地编码预设装配原生文件与命令工具，另有只读预设；这些工具具有本机用户权限，并非沙箱。安装来源仍是本仓库或配套归档，不假定私有 workspace 已发布到 npm。高级宿主配置、私密 owner 文件、预算及恢复见 [WebUI 指南](docs/guides/WEBUI-GUIDE.md)。

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

默认 `pakka` 产品已采用启用 Dynamite 的上下文策略方向，启动器接入仍待实现，进展见[所属任务](openspec/changes/adopt-default-dynamite-context/tasks.md)。独立 SDK/headless 宿主选择自己的策略装配；既有固定配对及执行入口见 [integrations/dynamite](integrations/dynamite/README.md)，程序化 SQLite 接入和 headless server 贡献各遵循自己的配对与配置契约。

Pi 执行和存储的可变对象留在 Durable adapter；Models、凭据和原生配置加载器属于可信宿主装配。操作调用方取得冻结 DTO 和身份绑定命令。受信任的 Node 工具与插件仍拥有宿主进程权限；Conversation、Session、package 和 OS process 是分别选择的边界。

## 开发与贡献

日常贡献在独立工作分支完成，通过 PR 汇入 `dev`。阶段发布通过获明确授权的 `dev → main` PR，`main` 禁止直接 commit/push；`dev` 的直接集成遵循显式授权和本地检查门禁。

- [贡献指南](CONTRIBUTING.md)：建支、实施、文档同步、检查与提交。
- [Git 协作规范](docs/development/GIT-WORKFLOW.md)：分支职责、PR 内容、批量集成与发布条件。
- [开发指南](docs/development/README.md)：架构、包边界、前端规范与检查方法。
- [Durable 补丁](docs/state/durable-patch.md)：生产依赖、固定 baseline、构建锁与安装产物。
- [工作入口](docs/OVERVIEW.md)：当前工作和仍需接续的任务；[文档导航](docs/README.md)提供完整索引。

文档按 state-evo 分工维护：state 描述采用的预期，OpenSpec 保存形成与任务，changes 提供引用摘要，`.temp` 承接本地材料。README 保持产品与使用入口，固定候选和检查结果在 verification 中保存。

日常检查按任务需要选用；批量集成 `dev` 的推送前检查按 Git 协作规范强制执行。自动回归使用本地确定性 provider，真实模型可行性试跑按[协作指南](docs/guides/MAS-WORKFLOWS.md)取得适用授权。
