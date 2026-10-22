# Pakka — integrated Pi host

基于 Pi **1.0.3 发布包**和可重建的 Pi Durable 下游补丁 **1.0.3-pakka.1** 的 headless 整合宿主，并提供可选 Pakka-Pocket Web 工作台。默认生产路径为 Durable；AgentSession 用于测试对照。当前配对是 `@pakka/agent@0.5.0`、`@pakka/mas@0.4.0`、可选 `@pakka/mas-devpack@0.2.0`、`@pakka/protocol@0.1.0`、`@pakka/client@0.1.0`、`@pakka/cli@0.1.0` 和 private `@pakka/server@0.5.0`；暂不发布。

Web 工作台接入普通 Conversation、多人邀请、文件／Git、审批、受控浏览器、Memory、Webhook、定时输入和通知。前端以 Devin 原型结构/交互为主体接入真实服务；模型在输入区选择，cwd 从 Conversation 标题下独立选择，外观在 Settings 调整。当前固定候选仍有失败和独立验收阻塞，不据旧本机确认宣称 R2 完整通过。接续工作从 **[OVERVIEW](docs/OVERVIEW.md)** 和[实施状态](docs/PAKKA-POCKET-STATUS.md)开始。

MAS DevPack 作为普通扩展提供 **Team：Graph / Activity / Agents**、成员 inspector、真实 Conversation 导航与获准控制。安装 WebUI 与装配模型工具相互独立。操作见[Team 指南](docs/guides/MAS-BOARD.md)，目标见[前端声明](docs/state/frontend.md#team)；旧 MAS 设计保留为形成材料。

M1–M6 核心迁移与可选配对保留各自范围，见[应用 API](docs/guides/MAS-APPLICATION-API.md)、[支持矩阵](docs/guides/MAS-PRODUCT-SUPPORT.md)及 [M6 验收](docs/archive/acceptance/MIGRATION-M6-ACCEPTANCE.md)；历史验收不自动覆盖后续 GUI。当前整体预期见 [state](docs/state/README.md)，采用来路见 [changes](docs/changes/README.md)，实现与验证分别记录。DevPack 工具及 M3 残余项仍见[API](docs/reference/MAS-DEVPack-API.md)和[M3 记录](docs/archive/acceptance/MIGRATION-M3-ACCEPTANCE.md)。

它把会话封装、写权、生命周期和一部分 C2 放进同一个运行时，并用真实 Pi + 本地 HTTP provider + JSONL 做交叉测试。**不是完整 Kappa 迁移，也不是 stock Pi TUI/CLI 的替代品。**

## 文档

**[工作入口](docs/OVERVIEW.md)** · **[完整文档导航](docs/README.md)**。

- 使用：[WebUI 启动与操作](docs/guides/WEBUI-GUIDE.md) · [当前产品状态](docs/PAKKA-POCKET-STATUS.md) · [MAS 应用装配](docs/guides/MAS-APPLICATION-API.md)
- 接口：[公开 API 参考](docs/reference/README.md) · [Headless 产品支持](docs/guides/MAS-PRODUCT-SUPPORT.md)
- 开发：[架构、仓库与扩展规范](docs/development/README.md) · [验证工作方式](docs/development/VERIFICATION.md)
- 预期与来路：[state](docs/state/README.md) · [changes](docs/changes/README.md) · [完整 OpenSpec 变更](openspec/changes/)
- 证据：[验证导航](docs/verification/README.md) · [Deprecated 历史资料](docs/archive/README.md)

## 开发与验证

需要 Node 24+、npm 11。历史 M1–M6 门禁的 Windows 环境和固定产物见[阶段归档](docs/archive/README.md)；后续 Linux 与本机验收范围见[当前状态](docs/PAKKA-POCKET-STATUS.md)。

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm run format:check
npm run smoke:package
```

- 测试不读取真实凭据、不调用付费模型；使用独立临时 profile 与 127.0.0.1 provider。
- 浏览器门禁必须有真实 Chrome/Chromium，不会因缺少浏览器跳过。默认搜索系统 Chrome（Windows/macOS）及 `PATH`；Linux 或非标准安装可显式设置绝对路径，例如 `PAKKA_TEST_CHROME=/opt/chrome/chrome npm test`，打包门禁同样使用 `PAKKA_TEST_CHROME=/opt/chrome/chrome npm run smoke:package`。无效的显式路径直接失败，不退回另一浏览器；选择可执行文件不读取已有 profile，也不放宽产品受控浏览器的宿主批准规则。
- `smoke:package` 会打包 `@pakka/agent`、`@pakka/mas`、`@pakka/mas-devpack`、`@pakka/protocol`、`@pakka/client`、`@pakka/cli`、private `@pakka/server` 与 `@pakka/webui`，在 Git 仓库之外建立消费者、**不携带根 overrides** 安装 tarball，再编译公开声明，实际验证 legacy host、Conversation runtime、同 Session MAS 的 activation、native delivery、owner policy、retirement 和 reopen dedup，并验证跨 Session broker、真实 worker PID 与丢回执后的全进程重开去重；DevPack consumer 执行真实模型 tool call、撤权零投递与原生临时成员；apps consumer 启动实际 server/CLI 子进程、编译 DOM-only client 声明并验证 native A2A/reply、拒绝和重连；product consumer 从实际启动入口执行模型工具、owner grant 交集、四种 lifetime、动态成员 reopen 和已消费 quota，并独立保存 HTTP、工具结果及原始存储。Pocket consumers 另验证人类身份/任务/协议服务，以及真实产品可执行入口、静态资产、桌面/手机 Chrome、邀请、撤权与正常重开。需要访问 npm registry。浏览器回归使用本机 Chrome/Edge 的全新隔离 profile；不读取用户浏览器会话。
- `npm run test:dynamite` 运行 [固定 Durable × Dynamite 配对门禁](integrations/dynamite/README.md)，需要 GitHub/npm 网络，模型仅使用本地 HTTP。历史固定配对失败，按用户授权 **deferred** 后完成了核心迁移；[问题与功能目标仍留档](docs/archive/investigations/DEFERRED-DYNAMITE-COMPATIBILITY.md)。迁移后的 `dynamite@0.2.1 × agent@0.5.0` 显式可选产品配对已带 notes 验收，见 [固定身份与证据](docs/verification/DYNAMITE-PRODUCT-ACCEPTANCE.md) 和 [产品 API](docs/reference/DYNAMITE-PRODUCT-API.md)；不改写历史配对为 passed。
- `npm run test:dynamite:product -- <accepted-agent.tgz> <accepted-dynamite.tgz>` 运行新的固定 SHA 产品消费者，不以历史 M0 命令或库测试替代实际 server/CLI、撤权、摘要 adoption 和 reopen 的验收。
- `artifacts/integration/manifest.jsonl` 索引每个测试的 HTTP payload、宿主快照与原始 JSONL 副本。生成物被 Git 忽略，每次运行重建当前 manifest、保留旧目录。
- `artifacts/package-smoke/` 保存外部安装和执行日志。

## 目录

```text
packages/agent/
  src/types.ts           Kappa/Pakka DTO，不依赖 Pi 类型
  src/host.ts            每个 Conversation 的身份、权限、admission、epoch、生命周期
  src/runtime.ts         多 Conversation runtime bootstrap 与控制对象装配
  src/durable-adapter.ts  唯一持有生产 Pi mutable handles 与模型凭据的内部适配器
  test/pi-adapter.ts      AgentSession 对照 oracle，不进入生产依赖或 dist
  src/strategy-control.ts 策略 lease、frame/job/invocation scope 与请求授权
  src/strategy-projection.ts  纯 DTO patch/range 与 native protocol 验证
  src/artifact-journal.ts  受控命名空间、版本 batch 与物理 receipt
  src/index.ts           公开入口
  test/                  真实 Pi 的集成/回归测试
packages/mas/
  src/index.ts           同 Session registry、membership、A2A 与 owner policy
  src/types.ts           冻结 MAS DTO 与 capability-bound client
  src/broker.ts          持久 enrollment/outbox 与跨 Session 回执 reconciliation
  src/session-endpoint.ts  受信任的已有 Session transport port
  src/approved-sessions.ts  固定 template/slot 申请、lease 检查和恢复
  test/                  真实 Durable/local HTTP MAS 回归
packages/mas-devpack/
  src/index.ts           可选 tools/instructions contribution，真实 invocation 绑定
  test/                  实际 model tool call、创建模式、reply、撤权与移除
packages/protocol/
  src/index.ts           browser-safe finite versioned wire decoder，无 Node/Pi
packages/client/
  src/index.ts           Node/browser 共享 fetch、严格关联、deadline/reconnect
apps/cli/
  src/main.ts            操作员入口，仅消费 client/protocol
apps/server/
  src/http-server.ts     loopback listener，host-bound role/source/grants
  src/bootstrap.ts       明确 JSON 配置，批准资源与 finite budget
  src/main.ts            实际 server executable，受控本地关闭入口
  src/profile-devpack.ts  产品/worker 共享 invocation 绑定、祖先 grants 和恢复校验
  src/product-dynamite.ts  可选固定 peer、静态成员策略、scope 路由和 revoke/drain
  src/worker-manager.ts  批准 preset、独占 storage writer 与真实进程生命周期
  src/worker.ts          private validated IPC 入口，不是对外 HTTP server
  test/                 真实 PID、退出隔离、协议与 writer 拒绝回归
scripts/
  test.mjs               独立测试环境与证据目录
  pack-smoke.mjs          仓库外打包安装验证
integrations/dynamite/
  pairing.json           外部 commit、版本与 Durable artifact pin
  run.mjs                历史失败配对的真实 tarball/HTTP 门禁
  core-m6-pairing.json    新配对的精确 artifact/commit 与独立验收身份
  product-run.mjs        已安装实际 server/CLI、可选策略与恢复门禁
```

不创建空的 package 或 app。`@pakka/agent` 保留现名，承担 gate 职责；MAS 服务与可选 DevPack 放在 `packages/`，server/CLI/GUI 放在 `apps/`，Durable patch 继续留在 `patches/`，Dynamite 保持独立仓库。客户端只消费受控命令与 DTO。目标边界和分阶段验收见上方仓库规范与迁移计划；M0 跨仓门禁已建立并保存失败配对；Dynamite 历史延期已留档，核心迁移完成后恢复了兼容矩阵；可选产品配对已完成指定复审和身份遗漏修正，仅按显式限定配置启用，不默认为策略或扩展到 worker/动态子成员。MAS 相关 package/app 和能力仅随实际实现与验收更新，不由计划推定。

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

有活跃 run 时，使用 `mode: "steer"` 或 `"followUp"`。它们使用 **Durable 原生 submission placement**，保留不同的 drain 时机；不会在 run 结束后统一转成 prompt。

`prepareInput` 是受信任宿主提供的文本处理器，可返回 `{action:"handled"}` 或 `{action:"text",text:...}`。同一处理器作用于 prompt、steer、followUp。它不获得 Pi 对象。不要把具有不可逆副作用的工作放进预处理器。

## 核心边界

- **host vs client**：宿主决定身份与 grants；插件只拿绑定身份的 client。client 无法自行提升权限或伪造另一身份。
- **权限**：策略 hook 排他占用。仅 real_context.write owner 或其明确批准的 policy 可以 cut/edit；异步批准后重新核对快照、owner 和 idle。
- **快照**：`capture()` 返回 WeakMap 绑定的 opaque object。复制、跨 client 使用、旧 generation/epoch 使用均无效；不是 RPC 可序列化 token。
- **队列**：`cancelQueued()` 返回撤回请求的 `unknown` 快照；只有精确 Durable withdrawal 确认无 entry 后才变为 `released`。已 placed 的消息保持 committed。
- **切换**：reload/newSession 在任何 await 前撤权；并发切换拒绝，不隐式排队。新的会话不继承旧队列。
- **失败**：局部已归因的 provider/run 失败阻断对应 Conversation；未知 Session storage/commit/report 错误封闭所有成员。reload 不能恢复 failed 宿主；legacy Host 可显式 newSession，managed Host 不允许替换共享 Session。已 committed/unknown 的 key 不自动重放。
- **封装**：对象仅在 adapter 的 `#` 私有字段中；package 只导出根入口。不是针对恶意同进程 Node 代码的沙箱。

## 不能误解的语义

1. `submit()` 返回 admission 快照，不等于整个 run 成功。`waitForIdle()` 后还要检查 `view().phase` / `lastError`。
2. `committed` 是物理 JSONL entry 回读，不是 fsync，更不是工具事务成功。
3. `effects: "not-assessed"` **不表示没有副作用**；失败时为 `"unknown"`。
4. 稳定 client 身份和 per-operation capability 不同。reload/newSession 保留 client grants 和策略配置，但撤销旧操作快照；尚无 Kappa 插件热重载。
5. epoch/branchId 是宿主操作与 admission scope，不是旧 Kappa treeRevision 或持久化树分支身份。
6. 默认新建 session；bootstrap 可显式指定 `reopenSessionFile` 重开同 dataDir 下的 Pakka-owned session。缺失、损坏或 foreign 文件会拒绝，旧 token/lease/C2 admission 不会恢复。

## 策略控制

`Client.bindStrategy(id)` 返回冻结的策略 binding：一次性 provenance frame、lease-bound projector、scoped artifact journal，以及显式 `model.infer` grant 下的辅助 source job。它不包含 Pi session/registry、endpoint 或 credentials。详见 [精确接口与最小示例](docs/reference/STRATEGY-API.md)。

活动 projector 返回 entry-message patches 或 summary-range replacements；宿主保留 system/loadout checkpoints、excluded messages 和 native call/result IDs/names/arguments，在 Durable `beforeRequest` 与 provider `onPayload` 边界核验后才发送 HTTP。也可以明确返回 `{ status: "blocked", basis, reason }`：输入仍 committed，`receipt.generation` 标记 blocked，Host 保持 ready；非法协议或存储不确定仍失败关闭。普通 tail growth 不撤销 source job，源/前文 edit、导航 ABA、reload/newSession/lease 变化会撤权。journal 未知状态阻断调用，不能作为重新推理的理由。

辅助推理不经 `Client.submit`，不写主 transcript/C2；bootstrap 配置有限模型 allowlist、每 job 与 strategy/session 的持久调用预算。每次输出上限接入真实请求参数，外部 smoke 实测 `max_tokens: 64/128`。本组件没有 Dynamite 算法或默认策略装配。

## 暂未实现

已实现受信任 bootstrap 的单 Session 多 Conversation runtime 和同 Session MAS 服务，接口和限制见 [RUNTIME-API.md](docs/reference/RUNTIME-API.md) 与 [MAS-API.md](docs/reference/MAS-API.md)。M3 的多 Session enrollment、持久 A2A/outbox 与独立 worker 已验收（带明确限制），见 [BROKER-API.md](docs/reference/BROKER-API.md)。MAS DevPack 的可选受控 contribution 已验收（不是 stock Pi CLI 插件）；以下仍未实现：完整原生 Pi input/skill/template/image/extension-command 兼容（原生 Pi slash 不作透传；WebUI 已注册的扩展命令走自身 dispatcher）；任意原生 Pi 插件；任意运行期 boundary context 提案；完整 AgentSubject/claim receipt 与通用 host RPC（有限 MAS RPC 已在 M5 验收）；按次工具权限和 C2 tool-result 准入；legacy Host C2 的跨重启 claim 重建、完整 forced-crash 恢复、共享 storage 的多 writer、sandbox；全 provider 兼容、Dynamite 默认装配及 worker/动态子成员自动策略；TUI 和完整 stock CLI 兼容。

当前仅接入显式配置的工具；工具允许执行不等于其副作用可回滚。context_edit 的 author intent 与 mutation 仍是两次写入，不是原子事务。

## 依赖版本与 Durable 补丁

生产包只固定实际使用的 `pi-ai/chord/pi-telemetry@1.0.3`，并 bundle hash 校验的 `pi-durable@1.0.3-pakka.1`。`pi-coding-agent` 与 `pi-agent-core` 仅在 dev/test 中使用，外部安装不得解析到 oracle。

上游普通 `beforeRequest` 异常仍是 report-and-skip；下游补丁增加显式 block 和请求级 revalidation，版本、源码 patch、测试、构建命令与 hash 见 [补丁说明](patches/pi-durable/1.0.3-pakka.1/README.md)。它尚未合入上游。正常安装无需修改 node_modules 或执行 patch install hook。

根目录 overrides 不会传递给消费者；每次升级都必须追加 [兼容性账本](docs/PI-DURABLE-COMPATIBILITY.md) 并跑集成测试与隔离 tarball 安装验证。
