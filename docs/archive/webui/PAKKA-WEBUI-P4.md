# pakka-webui P4 — MAS DevPack 的公共 Web facets

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前工作](../../OVERVIEW.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

本页记录 P4 的真实 MAS 插件消费和阶段门禁。Board 在 [P3 公共扩展宿主](PAKKA-WEBUI-P3.md)中提供成员格子和操作面板；[移除前状态快照](https://github.com/mapleluvr/pakka/blob/200af506913ee38d7a357e5da96ea5e2afc03d67/docs/PAKKA-POCKET-STATUS.md)区分既有能力与验收范围。新的关系画布和交流记录见 [MAS Board 原设计](../../../openspec/changes/mas-board-relationship-workbench/design.md)，属于后续实现。

## 包入口与独立选择

`@pakka/mas-devpack` 保留原 `.` Agent export，增加以下公开子入口：

| Export                         | 内容                                                                  | 运行边界                                                              |
| ------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `@pakka/mas-devpack/agent`     | `createMasProfilePacks`、`validateRetainedMasRoots`                   | 宿主批准 profile；每次工具调用核对真实 invocation 与完整 owner 祖先链 |
| `@pakka/mas-devpack/workbench` | `createMasWorkbench` 与冻结的人类 Board DTO/命令接口                  | 只组合现有 `@pakka/mas`、`@pakka/agent` 受控接口，不启动 Web          |
| `@pakka/mas-devpack/backend`   | manifest、backend handlers、`masExtensionRoot`、`masWorkbenchService` | 由可信启动根绑定当前人类身份，不持有浏览器自报权限                    |
| `@pakka/mas-devpack/client`    | 浏览器安全的 DTO 校验与 Board action client                           | 无 Runtime、Node、模型或凭据初始化                                    |
| `@pakka/mas-devpack/webui`     | Board 与 member panel                                                 | 宿主同一份 Preact，公共 page/panel/command/subscription context       |

WebUI 与 Preact 是可选 peer。Agent/headless 消费只需要原有 Agent/MAS 依赖；独立 headless 安装消费者验证两者既未安装也无法解析。浏览器声明消费使用 `types: []`，不从 Node ambient types 获得伪兼容。

`createMasProfilePacks` 是此前 server/worker 的原生组装算法的公开归属；`apps/server/src/profile-devpack.ts` 继续兼容导出。模型选择更强 profile 不会扩大有效 grants：实际源成员及其完整祖先的 profile grant 求交。三代原生反例覆盖受限根 → 高权限子 → 高权限孙，受限动作有明确 guard 结果且 peer 收到零 HTTP。

## 可信组装与实际启动

JSON 配置保留有限数据输入。需要同时组装 Agent tools 和人类服务时，操作者可以显式指定绝对路径的本地 `.mjs` 配置：

```powershell
pakka-webui --config-module D:/approved/pocket.mjs --owner-file D:/private/pocket-owner.txt
```

该模块是受信任的 composition root，default export 为 `PocketProductOptions`；不是 browser/RPC 接受的路径。`--config` 与 `--config-module` 二选一，入口验证路径、类型和文件大小；opaque import 失败输出脱敏，不自动重入或宣称 rollback。原 JSON 默认值和旧 headless v1 不变。

下面展示组装要点，完整真实可执行消费者是 [consumer-mas-board.mjs](../../../scripts/consumer-mas-board.mjs)：

```js
import { createMas } from "@pakka/mas";
import { createMasProfilePacks, validateRetainedMasRoots } from "@pakka/mas-devpack/agent";
import { masExtensionRoot, masWorkbenchService } from "@pakka/mas-devpack/backend";

let mas;
const pack = createMasProfilePacks(
	{ profiles: { coordinator: ["spawn", "send", "reply", "steer"] } },
	() => mas,
).get("coordinator");

export default {
	runtime: {
		// cwd/dataDir/endpoint/model/apiKey/limits 由操作者明确提供。
		...approvedRuntime,
		profiles: [
			{ id: "coordinator", tools: pack.tools, systemPrompt: pack.instructions },
			{ id: "plain", tools: [] },
		],
	},
	owner: "Operator",
	profiles: ["plain"],
	initial: [{ name: "Ordinary work", profile: "plain" }],
	extensions: [{ root: masExtensionRoot, facets: ["backend", "webui", "client"] }],
	extensionServices: async (context) => {
		mas = await createMas({
			runtime: context.runtime,
			namespace: "my.team",
			maxDeliveries: 32,
			maxPending: 8,
		});
		const roots = [{ key: "coordinator", owner: context.ownerId, profile: "coordinator" }];
		const members = (await mas.view()).members;
		if (members.length) validateRetainedMasRoots(members, roots);
		else await mas.bootstrap(roots);
		await mas.activate();
		return { mas: masWorkbenchService({ ...context, mas }) };
	},
};
```

`PocketServiceContext` 从 `@pakka/webui/backend` 导出；服务 factory 取得当前 writer、受控 people/workspace 以及原 product owner ID。重开验证保存的根成员和完整祖先关系，不重复 bootstrap 动态 roster。ID 是描述值，调用仍需当前权限。

只有明确放入 runtime profile 的 Agent contribution 才装模型工具。仅添加 Board facets 不广告 `mas_*`。人类工作区的 `profiles` ceiling 与模型内部创建分开：页面、模块 import 或浏览器选择不能扩张 profile allowlist。

## 真实 Board 与权限

Board 用公共导航页、`/team` 人工命令和资源 member panel，展示成员、管理来源、内部寿命、成员阶段及原投递回执。`WorkbenchMember.parent` 是 owner 匹配出的管理来源，不是创建事件；`view()` 的持久成员阶段与 `inspect()` 核对的原生 readiness 也分别保留。当前格子的 Available 表达成员可用性，实时 thinking／tool／reply 活动需要另一份观测，见 [设计稿的数据对应](../../../openspec/changes/mas-board-relationship-workbench/design.md#6-活动观测怎样得到)。布局采用固定来源 `pi-pocket@de612d5622cd` 的状态筛选、tile/detail 和窄屏交互，保留 MIT attribution；原 `SubagentsDoc`、courier/reporter/anchor、PiP authority 均未迁入。

读取先经过当前人类资源过滤，parent 不可见时也不回传其关系标识。查看、send、steer 和 manage 分开：viewer 无写控件且服务拒绝写操作；manage 还必须在可信 root-owner 归属链内。等待期间和实际受控效果时重新检查，不把 human admin 映射为任意 native owner。

- Send/steer/followUp 返回原 native admission/receipt，Board 继续查询原 ID。`placed` 不代表 provider 已进入；`queued` 不代表工作完成。
- Inbox 只取该成员实际接收的回执；reply 由原回执确定发送/接收成员，并检查两侧当前权限。外来成员回执和不可见 peer 均不能提供授权。
- Abort 观察原生事实。现契约可返回 `status: "unanswered", reason: "aborted"`，界面同时显示 reason；测试另外读取 native live 状态，确认原生停止。
- Retire 使用所有者控制端口；退出 UI 不等于 retire。临时/task-bound/background/persistent 的原生寿命保持原契约。

通用 host 的 `open(interface, { target })` 在目标资源上重新取得 registration；打开实例按该资源重新校验。这个机制由 member panel 消费，不含 MAS 特权分支。

## 移除与恢复

关闭 registration 使页面、命令、panel 与订阅退出，拒绝旧 generation 的新调用；不会取消已准入 native 工作或删除成员、历史和回执。无 WebUI facet 的正常重开仍可绑定 backend/client 服务。Runtime 固定的批准 profile 集不能通过重写工具定义来隐式移除 contribution；首次启动同时批准 enabled/disabled 配置，随后由真实 owner 通过 `configure` 选择 disabled profile。Conversation 身份与历史保留，配置变化产生新的 incarnation/ref，后续调用必须使用新引用；不可变的历史系统更新不删除。

真实浏览器回归先把 provider 阻塞，再关闭扩展，独立确认 native work 仍忙碌、原回执仍 placed，释放后原工作 done。随后无扩展重开，成员/原回执/历史保留，普通工作台仍可发起新工作。

## 阶段证据

全量 **343/343** 后新增一项固定 profile 集/Agent 移除恢复回归；最终定向 **22/22**，无 skip/todo/cancel；build/check/format 通过。独立 identity 检查确认全量与安装所测的生产源码未变，变化仅为 MAS 安装 helper 和新增测试，不以补充回归伪报完整 344 项 suite。关键源码的主动 LSP 检查无错误。

隔离安装的原有 legacy/runtime/MAS/broker/DevPack/apps/product/WebUI services/WebUI product 消费者全部通过；新增实际 CLI + 两个 Chrome 的 Board 消费者完成原生 spawn/send/reply、受限 viewer、关闭 facets/正常重开、原生历史/回执与已消费 **8 次 primary attempts** 的独立核对，共 **8 次本地 HTTP**。独立 headless 安装不含 WebUI/Preact；DOM-only/NodeNext 公开声明消费通过。桌面和手机截图已直接检查，手机无横向溢出，viewer 仅返回获准成员和脱敏的 owner/parent。

原始日志、HTTP/原生存储、截图与 source/helper SHA 位于 `artifacts/pakka-pocket/p4/`；这是 P4 中间身份。初轮忙碌回归暴露 `placed` 与 provider 进入的时序差异，红日志保留；最终测试使用有限的真实 provider 进入断言，不放宽生产状态或增长截止时间。安装消费者的两处错误预期（重写固定 profile 定义、把内部冲突码当作 HTTP 预检码）保留原失败后修正；未修改生产恢复校验或拒绝分类。

P5 继续补齐协作、文件/Git、审批/browser、通知与其余页面、完整部署工作流；P6 执行完整安装身份、privacy/recovery 与最多两轮指定独立对抗复审。
