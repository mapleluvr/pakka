# 使用执行环境

执行环境把工具所需的文件/命令能力交给可信宿主指定的驱动。入口在 `@pakka/agent` 的 JS API，配置是 bootstrap/control plane，不是模型可授予自己的权限。

## 本地文件工具

```ts
import { createHost, createLocalExecutionEnvironment } from "@pakka/agent";

const host = await createHost({
	cwd: approvedDirectory,
	dataDir,
	endpoint,
	model,
	apiKey,
	execution: {
		id: "local-project-v1",
		tools: ["read", "write", "edit", "powershell"],
		open: (target) => createLocalExecutionEnvironment({ cwd: target.cwd }),
	},
});
```

`approvedDirectory`、模型连接和凭据由宿主提供。示例选择本机权限，不能作为隔离配置。结束时调用 `await host.dispose()`；managed Runtime 则调用 `await runtime.close()`。

可选原生工具为 read/write/edit/bash/powershell。省略 `tools` 时只提供合作工具的执行能力，不自动装载任何原生工具。原生参数沿用 Durable schema：例如 edit 使用 `edits: [{ oldText, newText }]`。PowerShell 可以通过 `powershellPrograms` 指定程序候选；本地 string `exec` 的 Shell 可以由 `createLocalExecutionEnvironment({ cwd, shellPath, shellEnv })` 指定，Shell 须符合 NodeExecutionEnv 的命令传递约定。argv 执行不经过该 Shell 的字符串解析。

## 合作工具

```ts
import { executionFor, type HostOptions } from "@pakka/agent";

const build: NonNullable<HostOptions["tools"]>[number] = {
	name: "build_project",
	description: "Run the approved project build",
	parameters: { type: "object", properties: {}, additionalProperties: false },
	execute: async (_args, _signal, scope) => {
		const env = await executionFor(scope);
		const result = await env.exec([approvedNodePath, "scripts/build.mjs"], {
			timeout: 60,
			onOutput: (text, info) => hostLog(info.stream, text),
		});
		if (!result.ok) return `Build unavailable: ${result.error.code}`;
		return `Exit code: ${result.value.exitCode}`;
	},
};
```

`approvedNodePath` 与 `hostLog` 来自宿主配置。scope 是框架传入的不透明身份，不能序列化后恢复。正常工具代码应 await 每个操作；框架也会等待已启动的环境操作，再结算工具。工具返回后不能开启新操作，保留的 env 或 reader 不会成为长期授权。

文件内容可用字符串或 `{ base64 }`。`readBinaryFile`/binary reader 的 read 返回 base64 DTO；`scanLines` 使用从 0 开始、结束位置不包含的 `[startLine, endLine)`。reader/watch 可显式 close，遗漏的句柄由 invocation 收尾关闭。工具没有 owner cleanup 权限。

## 多 Conversation 与配置身份

Runtime 默认使用 `RuntimeOptions.execution`。profile 可声明自己的 `execution`，省略时继承默认值；各 Conversation 的 factory 目标包含实际 cwd，而不是另一个 profile 的示例目录。通过 catalog 改变批准的 cwd/profile 后，后续调用取得新绑定。单独选择模型仍遵守原有的模型/cwd 独立配置契约。

配置 ID 为 1–128 个字符，以字母或数字开头，后续可用字母、数字、点、下划线、连字符。改变驱动语义、目录/网络权限或权限策略时使用新的 ID。它不是函数源码的自动哈希；闭包捕获的状态由宿主负责管理。原生工具列表及 PowerShell 程序选择也参与保存与重开核对。

`ExecutionDriver.id` 则描述文件命名空间，供同一命名空间的文件操作协调使用。它不代替配置版本，也不授予权限。driver.cwd 必须匹配冻结目标。相同配置可重开原 Session；不同配置被拒绝，而不是在旧记录上静默替换执行条件。

## 提供其他驱动

`ExecutionConfiguration.open(target)` 返回中性的 `ExecutionDriver`。按需实现文件/目录/命令方法，缺失方法明确返回不可用，不退回宿主 Node。完整签名在 [execution-types.ts](../../packages/agent/src/execution-types.ts)。驱动须负责：

- 在实际执行位置落实权限、路径规则和网络规则，而不只校验返回文本。
- 正确传递 argv、cwd、环境、stdout/stderr、超时及 AbortSignal；超时以秒计，是执行时限，不是前台等待预算。
- 让 reader 关联打开的对象，让 spill/临时文件存活到消费者完成读取；以明确结果报告失败和未确认效果。
- open 拒绝时收回未交出的资源；返回 owner 后由 cleanup 完成真实收尾，且 cleanup 可安全重复调用。

如果采用 MXC，宿主侧 driver 可将这些操作转发给 MXC 内的文件服务和命令进程。仅换 `exec`、其余方法留在宿主，不会隔离原生文件工具。

直接使用 `node:fs`、`child_process`、`fetch` 或独立 MCP 服务的插件不会自动经过 env。需要约束任意插件时，插件加载与执行进程本身也要进入受控执行域。codemode 运行器及 models 调用不在这五个工具的装配范围，主模型与辅助模型授权仍各自执行。

## 可运行材料

- [原生文件与合作工具回归](../../packages/agent/test/execution-environment.test.ts)
- [真实 Shell 回归](../../packages/agent/test/execution-shell.test.ts)
- [多 Conversation、配置与恢复](../../packages/agent/test/execution-runtime.test.ts)
- [句柄、取消与清理](../../packages/agent/test/execution-lifecycle.test.ts)、[未完成操作与关闭](../../packages/agent/test/execution-disposal.test.ts)
- [配置/未知效果门禁](../../packages/agent/test/execution-guards.test.ts)、[reader 错误](../../packages/agent/test/execution-reader-failure.test.ts)、[原生工具跨重开撤销](../../packages/agent/test/execution-native-revocation.test.ts)
- [独立安装消费者](../../scripts/consumer-execution.mjs)：复制到安装了打包产物的独立目录，以 `node execution.mjs` 运行；脚本自己启动 loopback 确定性 provider，验证真实文件、命令与重开。`npm run smoke:package` 也包含该消费者。

当前关系见[执行环境声明](../state/execution-environment.md)；固定版本的检查结果保存在对应变更记录，而不是作为 API 定义。
