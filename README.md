# Pakka — integrated Pi host

基于 Pi **1.0.3 发布包**的 headless 整合宿主。当前 package 为 `@pakka/agent`，版本 `0.1.0`，暂不发布。

它把会话封装、写权、生命周期和一部分 C2 放进同一个运行时，并用真实 Pi + 本地 HTTP provider + JSONL 做交叉测试。**不是完整 Kappa 迁移，也不是 TUI/CLI 成品。**

## 开始

需要 Node 24+、npm 11；本轮验证环境为 Windows / Node 24.15.0 / npm 11.12.1。

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm run format:check
npm run smoke:package
```

- 测试不读取真实凭据、不调用付费模型；使用独立临时 profile 与 127.0.0.1 provider。
- `smoke:package` 会打包、在 Git 仓库之外建立消费者、**不携带根 overrides** 安装 tarball，再实际请求模型与提交 cut。需要访问 npm registry。
- `artifacts/integration/manifest.jsonl` 索引每个测试的 HTTP payload、宿主快照与原始 JSONL 副本。生成物被 Git 忽略，每次运行重建当前 manifest、保留旧目录。
- `artifacts/package-smoke/` 保存外部安装和执行日志。
- [设计与约束](docs/ARCHITECTURE.md) · [验证记录](docs/VERIFICATION.md)

## 目录

```text
packages/agent/
  src/types.ts           Kappa/Pakka DTO，不依赖 Pi 类型
  src/host.ts            身份、权限、admission、epoch、生命周期
  src/pi-adapter.ts      唯一持有 Pi mutable handles 的内部适配器
  src/index.ts           公开入口
  test/                  真实 Pi 的集成/回归测试
scripts/
  test.mjs               独立测试环境与证据目录
  pack-smoke.mjs          仓库外打包安装验证
```

不创建空的 tui 包；以后 TUI 只能消费 client 命令与只读 DTO，不能持有原生 AgentSession。

## 宿主 API 示例

以下代码需要一个 OpenAI-compatible HTTP endpoint；无需模型的本地演示直接运行 `npm run smoke:package`。

```ts
import { createHost } from "@pakka/agent";

const host = await createHost({
	cwd: process.cwd(),
	dataDir: "/absolute/path/to/project/.pakka",
	endpoint: "http://127.0.0.1:1234/v1",
	model: "your-local-model",
	apiKey: "local-only",
});

try {
	// host 是受信任的控制对象，不能交给插件。
	const user = host.connect("ui", ["input.submit"]);
	const strategy = host.connect("strategy", ["real_context.write"]);
	strategy.activateStrategy({ id: "working-set", hooks: ["real_context.write"] });

	const admission = await user.submit({ key: "request-1", text: "Hello" });
	await host.waitForIdle();
	console.log(user.receipt(admission.id)); // committed 只表示输入 entry 已回读

	const outcome = await strategy.commit(strategy.capture(), {
		type: "cut",
		summary: "A greeting was exchanged.",
		firstKeptEntryId: null,
		tokensBefore: 20,
	});
	console.log(outcome);
} finally {
	await host.dispose();
}
```

有活跃 run 时，使用 `mode: "steer"` 或 `"followUp"`。它们进入 **Pi core 原生队列**，不是等 run 结束后再调用一次 prompt。

`prepareInput` 是受信任宿主提供的文本处理器，可返回 `{action:"handled"}` 或 `{action:"text",text:...}`。同一处理器作用于 prompt、steer、followUp。它不获得 Pi 对象。不要把具有不可逆副作用的工作放进预处理器。

## 核心边界

- **host vs client**：宿主决定身份与 grants；插件只拿绑定身份的 client。client 无法自行提升权限或伪造另一身份。
- **权限**：策略 hook 排他占用。仅 real_context.write owner 或其明确批准的 policy 可以 cut/edit；异步批准后重新核对快照、owner 和 idle。
- **快照**：`capture()` 返回 WeakMap 绑定的 opaque object。复制、跨 client 使用、旧 generation/epoch 使用均无效；不是 RPC 可序列化 token。
- **队列**：`cancelQueued()` 只取消该 client 真正仍在 core 队列的对象。已 drain 的消息不会因相同文字被错误释放。
- **切换**：reload/newSession 在任何 await 前撤权；并发切换拒绝，不隐式排队。新的会话不继承旧队列。
- **失败**：存储/运行失败阻断新输入和 context 写入；reload 不能恢复 failed 宿主，必须显式 newSession。已 committed/unknown 的 key 不会自动重放。
- **封装**：对象仅在 adapter 的 `#` 私有字段中；package 只导出根入口。不是针对恶意同进程 Node 代码的沙箱。

## 不能误解的语义

1. `submit()` 返回 admission 快照，不等于整个 run 成功。`waitForIdle()` 后还要检查 `view().phase` / `lastError`。
2. `committed` 是物理 JSONL entry 回读，不是 fsync，更不是工具事务成功。
3. `effects: "not-assessed"` **不表示没有副作用**；失败时为 `"unknown"`。
4. 稳定 client 身份和 per-operation capability 不同。reload/newSession 保留 client grants 和策略配置，但撤销旧操作快照；尚无 Kappa 插件热重载。
5. epoch/branchId 是宿主操作与 admission scope，不是旧 Kappa treeRevision 或持久化树分支身份。
6. 当前 createHost 总是新建 session。已有 JSONL 保留，但尚无 reopen/resume API。

## 暂未实现

完整 Pi input/skill/template/image/extension-command 兼容（slash 输入显式拒绝）；任意原生 Pi 插件；运行期 boundary context 提案；完整 AgentSubject/claim receipt 与 RPC；按次工具权限和 C2 tool-result 准入；上下文 artifacts 存储；持久化 admission ledger、崩溃恢复、多进程 writer、sandbox；TUI 和产品 CLI。

当前仅接入显式配置的工具；工具允许执行不等于其副作用可回滚。context_edit 的 author intent 与 mutation 仍是两次写入，不是原子事务。

## 为什么声明了多于三个 Pi 依赖

Pi 包之间的版本范围允许安装器选择更新版本。实际外部安装曾将 tui/chord/codemode/mcp/telemetry 解析成 **1.0.4**，即使三个主要包固定在 1.0.3。

根目录 overrides 不会传递给消费者，因此 agent 包显式固定本次验证的八个运行时包。这是兼容版本组，不意味着已实现 MCP/codemode 功能；它们并未作为扩展加载。升级需同时跑集成测试与外部安装验证。
