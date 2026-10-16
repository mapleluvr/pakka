# Pakka-Pocket P5 — 协作与保留工作流（实施中）

状态：**P5 部分实施，不是产品交付/复审结论**。已接通人类协作、可选文件/Git、原生工具审批、受控浏览器、模型/用量设置、私密 provider 配置、真实通知服务、项目记忆和可选 Webhook；原生计划输入及插件长任务也已通过实际安装验收；原生通知点击、其余可选界面以及完整远程部署清单仍继续验收，不能用本阶段测试总数替代 P6 的实际产品验收。

## 1. 人类协作

- 受控服务：`apps/server/src/pocket-collaboration.ts`。有限命令由 `@pakka/protocol/pocket` 解码，经 `@pakka/client/pocket` 连接实际 HTTP/SSE。
- 旁聊记录包含服务端绑定的作者、时间、稳定 request ID；quote、mention、pin、reaction 都作用于当前可见 Conversation 的真实记录，不从请求体接受作者或权限。
- 共享 notes 使用明确版本；确定没有写入的版本冲突返回 `409 / CONFLICT / denied`。已有胜出版本不被覆盖，本地未保存草稿保留。持久化/执行结果不明仍为 `unknown`。
- presence/typing 有限时效，不当作持久成员或后台任务；正常重开不恢复陈旧 typing。
- driver 使用真实持久状态和版本竞争；原生模型输入在预检和准入边界再次核对持有者与期限。取得 driver 不会提高资源可见性或 profile ceiling。
- 人类旁聊和 notes 不自动成为模型输入。真实浏览器随后提交显式工作，并捕获 provider payload 验证隔离；不能仅用命令 schema 或没有请求作为证明。
- 切换 Conversation、身份失效或关闭实例后，迟到结果不能重新打开或填充旧资源的界面。

## 2. 可选文件/Git 贡献

宿主显式通过 `@pakka/webui/workflows` 的 `workspaceFilesExtensionRoot` 和 `workspaceFilesService` 安装普通 Backend/Client/WebUI facets。通用壳层没有文件操作分支，浏览器不能指定宿主模块或任意根目录。

```js
import { workspaceFilesExtensionRoot, workspaceFilesService } from "@pakka/webui/workflows";

export default {
	// runtime/owner/initial 均为宿主明确批准的启动配置。
	extensions: [{ root: workspaceFilesExtensionRoot, facets: ["backend", "webui", "client"] }],
	extensionServices: async (context) => ({
		files: await workspaceFilesService(context, {
			namespace: "project.files",
			roots: [{ id: "project", path: "/host/approved/project", resources: "*", writable: true, git: true }],
		}),
	}),
};
```

示例为需要合并进完整启动配置的组装片段，不是无需 Runtime 即可启动的配置。路径、写权限、resource 范围和可选 worktree 目录都来自宿主，不由浏览器或模型提高。

### 已实现的行为与边界

- 目录/文件、有限文本编辑、图片预览、上传与原始字节导出；HTML/SVG 等不以活动页面执行。只读用户的服务端权限检查独立于按钮显隐。
- 编辑使用预期内容 hash 检查冲突，同一服务串行控制其写操作。此处不声称能原子排除所有不合作的外部进程在任意系统调用间改写文件。
- 拒绝 traversal、原生数据目录、受保护路径、junction/symlink 和文件硬链接；将 Windows 短路径与宿主批准路径 canonicalize 后再比较。
- Git 只提供有限命令，不提供任意 shell/参数透传；关闭 hooks，并拒绝不在政策内的本地配置/外部 config include。原生模型工作仍忙时不能切分支。
- 真实 Git changes/diff、分支创建/切换和宿主管理的 worktree 创建/删除；结果通过独立 Git 命令和磁盘字节核对，不只检查 RPC 成功。
- 外部效果先保存原请求身份。已完成请求正常重开后重试只返回原结果，不能覆盖后来发生的磁盘编辑；恢复为 running/未确认的记录保持 `unknown`，不重进效果。
- 不透明宿主 guard 或实际效果可能已经执行时，后续异常不能伪装成确定无效果的 conflict/denied。

## 3. 原生工具审批

`@pakka/server/pocket` 提供 `createPocketApprovals` 和 `approvalTool`；宿主显式包装已批准的工具，并通过 `workspaceApprovalsService`、`workspaceApprovalsExtensionRoot` 安装普通扩展面板。

- 只有真实、当前有效的 native tool invocation 能创建待审批项；浏览器不能提交另一个工具、参数或 owner 来替换原调用。
- 操作者允许或拒绝当前 Conversation 已存在的调用；viewer 只读。决定在工具效果开始前再次检查 invocation、当前审批人权限与界面有效性。
- 拒绝不执行工具；native abort、审批人撤权或界面失效会阻止尚未开始的效果。已有效果但结果丢失保持 `unknown`，不假称撤销。
- 正常重开不重新执行未确认的原调用。真实浏览器和安装消费者分别核对了被允许的磁盘字节、拒绝时的零写入，以及模型后续响应。

## 4. 受控浏览器与原操作核对

宿主通过 `workspaceBrowserService`、`workspaceBrowserExtensionRoot` 显式批准 executable、origin 和 resource 范围。服务使用独立 Chrome profile 与私有 CDP pipe，面板提供导航、填写、点击、页面文本和可解码的 PNG 帧；客户端没有任意 JavaScript 或 debugger 地址接口。

- 页面检查和进程范围的过滤代理共同覆盖直接导航、redirect、子资源及 popup；未批准 origin 不触达目标。真实批准 HTTPS 隧道保留 TLS 证书校验。
- 过滤代理在拒绝前绑定客户端 socket 错误清理；真实拒绝 CONNECT 后的 TCP reset 不再成为未处理的 `ECONNRESET`。不因此放宽 origin 或重试页面动作。
- 原生页面动作先持久化 intent。正常重开复用已记录的结果；恢复为 running/未知的 intent 保持 `unknown`，不重新点击。
- 丢响应时，面板保留按 person 和精确 AgentRef 隔离的外部 request ID，关闭再打开后可选择“核对原操作”。`ExtensionClient.operationByRequest` 由服务端绑定当前身份、extension、request ID 和原资源；`UIContext.operationByRequest` 进一步绑定当前界面实例。查询不重新进入 handler。
- 外层 extension operation 为 `done` 只说明 handler 结果已保存；若内层 browser action 仍为 `unknown`，面板继续保留待确认状态并禁用新动作。
- 产品正常关闭或启动注册失败都会调用已创建服务的 `dispose`；逐项清理失败不会跳过其余服务或 Runtime 的关闭。

## 5. 模型、用量与私密 provider 设置（6.4 部分完成）

`ConversationProfile.model` 是宿主启动时批准的同 provider 模型 ID；未指定时沿用默认模型，显式值限制为 1–256 code units 且不含控制字符或首尾空白。profile 不能替换 endpoint、凭据或 cwd。JSON 产品、server bootstrap 和 worker IPC 都以有限 schema 保留该字段，浏览器仅可在自己的 profile ceiling 内选择 profile。

受控 configure 在同一 native commit 更新 model/tools/instructions 并生成新 incarnation。真实 provider payload 验证下一次请求使用确切 ID；正常重开保留配置与已消费额度，原请求不重放。更改持久 bootstrap 中某个 profile 的模型定义会拒绝重开，不会悄悄重定向原工作。费用不确定仍为 `null`。

模型端口基线的组合回归 13/13、全量 392/392 与全部实际安装消费者通过。安装 runtime 消费者在 3 次本地 HTTP 中独立核对默认/另一模型和重开后的同模型；391 个源码/helper/TLS 资产 SHA 一致，记录在 `artifacts/pakka-pocket/p5/model-port/`。以下界面与私密配置另有后续门禁，未沿用该端口计数作为验收。

- 实际设置面板仅列出当前人类 profile ceiling 内的选择；configure 后使用新的 incarnation。下一次 provider 请求使用所选模型，原引用不能继续写入。
- Conversation 用量按资源过滤，不确定费用显示为 `Unknown`；全 Session 配额只返回给具有全局资源范围的管理员。viewer 和 scoped admin 均不能借由直连 RPC 取得总额或管理主凭据。
- 模型切换已提交但响应丢失时，显式重载工作区只读当前引用，不重复 configure；关闭或切换资源后的迟到设置读取不能填入新面板。
- 专用密码表单提供 replace/clear；输入提交后立即清空，不进入浏览器持久存储、slash、操作结果或错误。公开返回值仅包含配置状态与版本，不返回旧值。
- 宿主原有 `resolveApiKey` 在显式覆盖前继续调用；替换改变下一次实际 provider Authorization，clear 后拒绝 dispatch，正常重开仍不回退启动密钥。延迟返回的旧 resolver 不能越过已提交的 clear。
- 已解析凭据或已开始的请求不能被事后撤回；凭据失败也不退还已准备调用的尝试额度。持久存储/备份包含宿主批准保存的密钥，未承诺加密或清除历史字节。
- 未确认的提交保持 `unknown`；表单禁用新写入，允许只读核对状态，核对不自动重发。存储损坏、迟到撤权和不透明错误失败封闭，私密错误文本不进入 transcript 或浏览器。

本次设置/私密配置门禁：定向 **16/16**，全量 **408/408**（无 skip/cancel/todo），构建、类型、公开声明、代码格式和全部仓库外安装消费者通过；406 个源码/helper/TLS 资产 SHA 在三个阶段保持一致。实际 CLI 的产品消费者完成模型选择、替换/清除、手机 viewer、两次正常重开与撤权；**1 次模型 HTTP、3 次计费尝试**，没有重复配置或清除后的凭据回退。日志、身份、恢复反例与桌面/手机截图位于 `artifacts/pakka-pocket/p5/settings/`；`scripts/consumer-pocket-product.mjs` 是该安装路径。后续通知门禁见第 6 节；其余可选界面仍未完成，6.4 不勾选。

## 6. 原生通知、Web Push 与恢复（6.4 继续实施）

`@pakka/server/pocket` 提供 `createPocketNotifications`；`startPocket` 组装人类身份、持久设备/偏好、真实完成事件的被动观察与服务关闭。`PocketServiceContext.notifications` 是宿主受信任 producer，可供实际审批等贡献发布已有业务事件；浏览器的有限 `notification.*` 命令只控制自己的设备、偏好和状态，不能选择 actor、通知文案或收件人。

- UI 仅在显式浏览器通知权限下注册实际 service worker/PushSubscription，支持当前 Conversation 的本设备启用/注销、个人偏好和系统通知测试；旁聊、定向 mention、真实待审批和原生任务完成均有事件回归。偏好属于当前人类，不能修改另一个人的偏好。
- 设备绑定当前人类与获准 Conversation。服务在真实 dispatch intent 提交后、请求发送前和 metadata 发布前复查当前资源权限。wake-up 只包含 opaque event/device ID；实际文案由 worker 经当前 Cookie 查询，失效/撤权/注销后不能用旧 push 恢复权限。登出清理本机通知。
- 使用 `aes128gcm` Web Push 加密和 VAPID 签名。真实 TLS 接收端独立解密并验证签名，不以本实现的返回值自证；HTTP 接受仅记为 `accepted`，不能证明 OS 显示。真实浏览器另检查 service worker 创建的原生通知记录。
- 注册响应丢失时，服务端只返回当前人类/资源设备的 `subscriptionKey`：对固定顺序的 `{ endpoint, keys: { p256dh, auth } }` 计算 SHA-256。UI 用本地实际订阅计算同一摘要，再只读当前状态识别本设备，不猜新设备 ID，也不再次发送注册写入。响应不返回 endpoint/auth 或 VAPID 私钥。
- 业务事件和控制操作有稳定身份；已接受或未知的投递在原请求重试、正常 writer 重开后都不自动重发。真实已接受请求被接收端断开时保留 `unknown`；不能把已发送效果记成拒绝或回滚。
- 默认批准的 push origins 为 `https://fcm.googleapis.com`、`https://updates.push.services.mozilla.com`、`https://web.push.apple.com`。宿主可用 `notifications: { endpointOrigins, subject?, trustedCa? }` 显式覆盖，JSON 与 ESM 启动均可组装。origin 必须为精确 HTTPS origin；有限 schema 拒绝未知字段，私有 CA 仍启用真实 TLS 校验。
- 有限保留范围为每 Session 256 个事件、512 个控制操作、128 个设备记录和 128 份人类偏好；单人最多 10 个活动设备，每设备最多 64 个资源，store 上限 1 MiB。容量用尽拒绝新增记录，不通过遗忘原请求扩大容量。持久存储含生成的 VAPID 私钥与 push 订阅材料，未承诺加密或历史擦除；它们不进入模型或界面状态响应。

本批定向 **21/21**、全量 **419/419**（无 fail/skip/cancel/todo），构建、类型、公开声明、代码格式及全部实际安装消费者通过；421 个冻结源码/helper/TLS 文件 SHA 在定向、全量和安装阶段保持一致。`scripts/consumer-pocket-notifications.mjs` 从仓库外实际 CLI 贯通 native completion、TLS 加密、worker 显示、手机偏好/权限、撤权、未知投递及正常重开：**2 次模型 HTTP、3 次 push 请求、已消费 attempts 保持 2**。桌面/手机截图直接检查通过，日志和实际归档位于 `artifacts/pakka-pocket/p5/notifications/`。

外部 FCM 单独测量：全新本任务 Chrome profile 的一次真实订阅/完成通知/注销成功；后续全新 profile 存在订阅等待。复用本任务自建的 probe profile 后，丢失注册响应通过只读状态恢复、没有第二次注册写入，随后 FCM 通知生成了原生记录；每次测量 2 次本地模型 HTTP。结果分别在 `live-result.json`、`live-recovery-result.json`，不作为确定性 suite 的环境保证。

真正的 OS 通知点击还未验收。补测用实际通知对象构造 `NotificationEvent` 时，Chrome 明确拒绝脚本事件的 `waitUntil` 和窗口 focus；这是触发方法的限制，既不是生产 handler 通过，也不据此认定生产缺陷。原诊断保存在 `native-navigation-diagnostic.log`。6.4/P6 仍须从真实通知动作检查重新授权导航；本阶段不修改 worker 迁就该触发方法。

## 原生计划输入与插件长任务（4.4 / 6.5）

`createPocketSchedules({ namespace, maxSchedules })` 在打开 Runtime 前提供有名称/版本的 `definition`；宿主把它加入既有 `RuntimeOptions.jobs`，再在公开 service factory 中调用 `workspaceSchedulesService(context, prepared)`。可选 `workspaceSchedulesExtensionRoot` 使用普通 Backend/Client/WebUI 插槽，不增加通用 shell 的调度分支，也不装入模型工具。实际 ESM 组装见 [安装消费者](../scripts/consumer-pocket-schedules.mjs)。

- 每条计划绑定真实创建人、精确资源引用、原请求和文本。到期在 native 准入边界复查当前人类权限与 driver；引用变更后不追随新 incarnation。viewer 只读，浏览器不能选择执行程序、actor、endpoint 或 credentials。
- 文本原样传入受控 `followUp`，不另加前缀挤占原 8192 code-unit 上限。首个到期时间限定在未来 366 天内，单计划最多 32 次，周期在 1 秒至 366 天之间；宿主最多保留 128 个计划，另有 1 MiB store 上限。已完成/未知记录不自动遗忘以扩充容量。
- native checkpoint 保存绝对 `nextDueAt`、已准入次数和稳定投递身份；每次等待递增有限 `waits`。重开只连接已存在任务，不从不明 intent 新建替代任务。关闭页面或 service waiter 不取消已接受工作；保留定义但移除 WebUI 后仍可完成原任务。
- 取消在等待持久回执前建立实时阻断；已提交但尚未返回的取消也拦住到期新输入。只有 native terminal 确认为 `aborted` 才展示取消，不能声称已准入输入被回滚。
- `done` 表示计划输入已准入，不表示模型已回答。真实准入结果丢失或确认视图为 `unknown` 时，不假定无效果，也不计为完成或开始下一个周期。原请求和面板重开只读核对，不再次调度或退还尝试额度。
- 实际原生任务反例发现同一 JSON checkpoint 会造成 native fault 与公开 queued 错位。适配器现于排入新 queued 状态前拒绝无进展的 `advance`；未处理失败保留 `unknown`。空对象、嵌套键重排和 JSON 正负零的真实磁盘效果均未因原请求重试/重开而重复，保留容量未释放。该改动不迁移历史 faulted job。

本批最终构建、类型、公开声明与代码格式通过，定向 **33/33**、全量 **437/437**（无 fail/skip/cancel/todo）及全部实际安装消费者通过；435 个冻结源码/helper/TLS 文件 SHA 在定向、全量与安装阶段保持一致。新安装归档的实际 CLI 消费者验证 **2 次 provider HTTP、2 次已消费额度**、正常重开、原请求只读核对，以及移除 WebUI facet 后原 native job 继续工作。8 个实际归档与 lock integrity 逐一匹配，另保存 native storage、provider payload、原生投递回执和消费脚本 SHA。Task 4.4 的实际插件长任务消费已完成，6.5 的完整产品恢复仍随其余工作流继续验收。重开初次失败的原存储已保留：任务实际按 305 秒延迟等待，夹具填写顺序修正并在提交前断言精确值 5，不改生产延时或恢复规则。日志、red/green、native journals、桌面/手机截图与最终交付归档放在 `artifacts/pakka-pocket/p5/automation/`。其余可选界面、真实通知点击、部署与 P6 仍未完成。

## 项目记忆与独立 Agent 贡献（6.4 部分完成）

固定上游 `de612d5622cd` 的 `web/sheets/memory.js`、`src/server/memory.ts` 和 `src/server/extensions/memory.ts` 在本批分别映射到普通 Memory 面板、受控持久服务和宿主显式选择的原生工具/当前上下文来源。项目由宿主批准的 Conversation key/ID 集合定义；请求不选择目录、作者、成员归属或原生 scope，也不接回原 PiP 控制面。`resources: "*"` 只用于单一项目的当前产品 Session。

- `createPocketMemory({ namespace, profiles, projects })` 从 `@pakka/server/pocket` 提供相互独立的 `.tools`、`.source` 和 `.attach()`。`workspaceMemoryService(context, prepared)` 与 `workspaceMemoryExtensionRoot` 从 `@pakka/webui/workflows` 装配普通 Backend/Client/WebUI 插槽。仅启用人类 facet 不宣告工具，也不自动注入内容。
- 当前上下文来源走 [Runtime 公共端口](RUNTIME-API.md)，只取得冻结的精确 reference 与取消信号，在真实 provider dispatch 前重验已读版本。项目 A/B 的已批准内容隔离，global 记录只属于当前产品 Session；source 定义身份与固定 profile 集合一起校验重开。
- sender 和真实模型工具只能提出待审批的新记忆、更新或遗忘；全局管理员的明确操作才改变获准内容。待审批更新保留原已批准文本，待审批删除仍保留原内容。只读 viewer 看不到他人的未批准提议，也不能写入；模型不能指定人类作者或伪造 invocation。
- 每条文本最多 300 个 UTF-16 code units，项目/global 分别最多 40/30 条，未批准提议最多 20 条；已保留记录和 mutation ledger 分别有限额 256/512。编辑、审批和遗忘带精确 `expectedVersion`。冲突保留获胜版本和当前面板的本地草稿，状态刷新及审批分组移动不会清空编辑。
- `enabled` 是已安装来源的自动注入开关，界面显示允许/暂停；它不会安装 Agent facet。暂停保留记忆、提议与原生历史，只省略后续请求的当前记忆贡献。历史中的真实工具结果照常保留，不把省略当前 system 文本称作删除历史。
- 写入绑定 actor/resource/request。浏览器丢响应和后端提交后抛错都通过原操作只读核对；界面重开不再进入写 handler。已准备的 attempt、损坏/不明状态及未确认操作继续遵守封闭规则，不推断回滚或退还额度。

本批最终定向 **38/38**、全量 **464/464**（无 fail/skip/cancel/todo），构建、类型、独立公开声明和代码格式均通过，10 个关键路径主动诊断清零；450 个冻结源码/helper/TLS 文件在定向、全量和实际安装前后 SHA 一致。完整 `smoke:package` 的全部消费者通过，8 个实际归档逐一匹配 lock integrity 并保存到 `artifacts/pakka-pocket/p5/memory/delivery/`。新归档的实际 CLI 驱动原生 `memory` 工具提议、审批、暂停、profile 切换、两次正常重开和移除 WebUI，核对 **5 次模型 HTTP、5 次已消费额度、1 次原生工具结果**，原写入未重放且记录保留。重开验收用 Chrome 原生 `Page.reload` 并核对 `timeOrigin`，不把 hash 导航当作新页面；旧页面跨服务重启的重连留给 P6 独立验证。

首次安装在既有文件/协作消费者登录前曾遇到 8 秒启动等待超时，页面停在 `Starting Pakka-Pocket`，原因未确认。同一失败归档加被动 CDP 诊断后连续 3 次通过；恢复原始驱动、生产与测试源码均未改的新一轮完整安装也通过，不能称为启动问题已修复。失败日志、诊断 driver/runner、8 个失败归档及其 SHA 独立保留在 `failed-install/`，P6 继续复查。其余 red/green、实际 provider payload、Runtime 视图、原生存储、桌面/手机截图和最终门禁位于 `artifacts/pakka-pocket/p5/memory/`。其余可选界面、部署及 P6 仍未完成。

## 外部 Webhook 与普通 ingress 贡献（6.4 部分完成）

固定上游 `de612d5622cd` 的 `web/sheets/hooks.js` 与 `src/server/hooks.ts` 分别映射到普通 Webhooks 面板和受控服务。只保留显式 Conversation 的外部 POST 工作流，不接回 PiP、repository-watch 轮询或 GitHub 凭据发现。公开组装、认证路径和容量见 [Webhook 使用说明](WEBHOOKS.md)。

- `workspaceHooksService` / `workspaceHooksExtensionRoot` 从 `@pakka/webui/workflows` 装配普通 Backend/Client/WebUI；底层 `createPocketHooks` 从 `@pakka/server/pocket` 导出。通用 shell 只负责 namespaced ingress，不含 hook/MAS 调度逻辑。
- 受信任 Backend 可声明有限 `ExtensionService.ingress`。handler 只取得复制的原始 body、过滤后的有限 header、验证后的路径、取消信号与当前 generation 检查；不取得 Cookie/CSRF authority、socket、模块或任意响应 header。超时保持未知，关闭扩展拦截尚未准入的效果。
- GitHub 用原始字节 HMAC-SHA256 验签，并保守筛选已签正文的作者；更改未签 delivery header 不能重放同一已记录正文。Generic 用专用 URL secret 与固定 idempotency key。轮换旧密钥、移除、创建人撤权、driver 交接和迟到失效均在原生准入前复查。
- 配置固定绑定真实创建人和精确 Conversation reference。原始 DTO 保留 Runtime 的字段顺序，规范排序仅用于独立指纹；损坏/跨资源回执拒绝恢复。已提交但未确认的投递保留 `unknown`，重试和正常重开不重新进入效果。
- 列表和 mutation/operation 不返回 secret。授权人显式读取的 setup 不落入通用操作记录；面板替换后的迟到响应不能显示到新实例。丢创建响应和后端提交后抛错都提供原请求只读核对，不重复创建。手机 viewer 没有私密设置，手机 operator 能实际操作。
- 每人最多 20 个活动入口，每 hook 每小时 30 个新的非忽略请求，body 最大 5 MiB；记录和 Store 有固定容量，不丢弃原回执扩容。真实第 31 次输入被拒绝。忙碌场景中已确认排入原生队列的输入在 HTTP 结束、禁用扩展后仍完成，不能称作随界面取消；只移除 WebUI 保留 Backend 的后续投递。
- 手机顶部 People 裁切反例已 red/green：操作区在窄屏换行，控件中心可见且能通过真实鼠标打开；桌面布局保留。直接检查 Webhooks 桌面/手机截图，记录由真实持久服务驱动。

本批最终定向 **31/31**、全量 **489/489**（无 fail/skip/cancel/todo），构建、类型、独立公开声明、代码格式及完整 `smoke:package` 的全部消费者通过；469 个冻结源码/helper/TLS 文件在定向、全量和实际安装前后 SHA 一致。新归档的实际 CLI 验证 **3 次模型 HTTP、3 次已消费额度**，包含签名去重、轮换、正常重开、viewer 隔离与只移除 WebUI 后保留 Backend 入口。8 个实际归档匹配隔离 lock integrity，原生存储、provider payload、回执和消费脚本身份保存在 `artifacts/pakka-pocket/p5/hooks/delivery/`。门禁后仅更新两份阶段记录，并把交付 helper 的初验计数 25 更正为实际最终 31；原 helper 与前后 SHA 均保留，不改变测试或生产字节。首次打包在隔离 npm 下载 `@esbuild/win32-x64@0.28.2` 时触发原 180 秒截止时间；同 URL 的独立测量也超时。未改截止时间/依赖的新一次打包完成，其中该包下载耗时 53.4 秒，环境等待不称为已修复。消费者首次错误将派生 `received` 当成原始字段；已按真实 accepted delivery 记录及 native budget 核对，在相同归档 SHA 下重跑通过。原始失败、对照测量、red/green、provider payload、原生存储及归档脚本位于 `artifacts/pakka-pocket/p5/hooks/`；初次截图 I/O 错误保留给 P6，不以本轮未复现宣称已解决。

## 6f. 明确排除 Plan mode / Goals

用户补充确认 Plan mode 与 Goals/Done when 为 non-goal，不再继续实现、补测试或验收，后续计划移除。此调整不影响已验收的定时输入（scheduled inputs）。

25 个未提交候选文件已单独暂存于本地 stash `7cb96c20df7562610ccddc9d3915403c2c0ac725`；原始字节、SHA 清单与停止门禁的记录保存在 `artifacts/pakka-pocket/p5/planning/parked-candidate.json` 及相邻目录。候选已从当前生产源码和默认测试/打包路径中撤出；未完成的候选门禁已停止，不作为新的交付基线。后续清理不阻塞范围内的 UI、部署和 P6 验收。

## 7. 当前可执行证据

| 主体                                                    | 证据                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/server/test/pocket-collaboration.test.ts`         | 真实 Durable 记录、两人 notes/driver 竞争、期限/资源边界、正常重开                    |
| `apps/webui/test/collaboration-http.test.ts`            | 实际认证 HTTP/SSE、viewer 参与、服务端过滤及确定冲突                                  |
| `apps/webui/test/collaboration-browser.test.ts`         | 两人桌面/手机交互、typing、pin/reaction、notes 草稿、driver、实际模型 payload         |
| `apps/webui/test/collaboration-late.test.ts`            | 真正延后的读取不能影响新 Conversation                                                 |
| `apps/server/test/pocket-files.test.ts`                 | 真实磁盘、Git、链接/配置拒绝、原生忙碌、effect 记录和重开                             |
| `apps/webui/test/files-browser.test.ts`                 | 文件编辑/上传、安全文本显示、diff、分支/worktree 的实际鼠标流程，0 次模型 HTTP        |
| `apps/webui/test/files-boundaries.test.ts`              | 本地草稿与外部文件冲突、真实 PNG 解码、手机 viewer、直接 RPC 越权拒绝，0 次模型 HTTP  |
| `packages/protocol/test/pocket-collaboration.test.ts`   | 有限协作命令/DTO 的结构检查，不作为实际能力证明                                       |
| `scripts/consumer-pocket-workflows.mjs`                 | 仓库外实际 CLI 的多人、真实文件/diff、原请求去重和正常重开；2 次模型 HTTP、额度保持 2 |
| `apps/webui/test/files-effect-boundary.test.ts`         | 真实 intent 提交后关闭扩展/abort，不产生迟到磁盘写入，原请求不重放                    |
| `apps/server/test/pocket-approvals.test.ts`             | 原生 invocation、允许/拒绝、撤权/abort/失效界面和不明效果的真实存储回归               |
| `apps/webui/test/approvals-browser.test.ts`             | 实际操作者/手机 viewer 面板、原工具效果与模型终态                                     |
| `apps/server/test/pocket-browser.test.ts`               | 真实独立页面、PNG 解码、origin/resource 权限、原 intent 及正常重开                    |
| `apps/server/test/pocket-browser-network.test.ts`       | 实际 HTTPS 隧道与未批准 CONNECT 拒绝                                                  |
| `apps/server/test/pocket-browser-network-reset.test.ts` | 24 次真实拒绝连接后 reset，错误留在该连接且目标请求为 0                               |
| `apps/webui/test/browser-contribution.test.ts`          | 桌面/手机真实动作、丢响应后的可见核对与内层 unknown 保留，0 次模型 HTTP               |
| `apps/webui/test/extension-http.test.ts`                | 原操作查询、错误 profile/incarnation、跨用户、撤权与 403/denied                       |
| `scripts/consumer-pocket-controlled.mjs`                | 实际 CLI 审批与浏览器控制、2 次页面效果、原操作核对和正常重开；4 次模型 HTTP          |
| `apps/server/test/pocket-notifications.test.ts`         | 真实 TLS/独立解密与 VAPID、晚撤权、定向收件人、输入捕获、未知投递及重开               |
| `apps/webui/test/notifications-http.test.ts`            | 实际完成/旁聊事件、有限设备协议、当前 Cookie metadata 和越权探针                      |
| `apps/webui/test/notifications-browser.test.ts`         | 真实 worker 原生通知、登出清理、手机偏好隔离和桌面/手机布局                           |
| `apps/webui/test/notifications-main.test.ts`            | 非法 push authority 在存储和 provider 效果前被拒绝                                    |
| `scripts/consumer-pocket-notifications.mjs`             | 实际 CLI/TLS/worker/reopen；2 次模型 HTTP、3 次 push、原未知投递不重发                |

冻结副本的构建、类型和全量回归 **387/387** 通过，无 skip/cancel/todo；完整 `smoke:package` 的所有既有及新增消费者通过。386 个源码/夹具 SHA 在门禁前后保持一致，原树未变时才合回 12 个已测试文件。合回后的构建、类型和主动诊断通过；补充了“面板重新加载后等帧已解码再点击”的验收等待条件，原查询与效果断言未变，相关 8 项组合连续 5 轮通过，更新后的消费者再次通过同一安装产物。生产字节与已通过的全量/安装身份一致。

原失败、red/green、386 文件身份、合并记录、阶段日志和桌面/手机截图保存在 `artifacts/pakka-pocket/p5/`。`writer-check/operation-lookup/` 记录这次单 writer 合并；`installed-recovery-final.json` 绑定实际安装档案及补充消费者 SHA。Markdown lint 按用户指示留到收尾，不阻塞功能推进。

设置补充用例为 `apps/server/test/pocket-configuration.test.ts`、`pocket-credentials.test.ts`、`pocket-credentials-boundaries.test.ts`，协议/client 的 configuration/credentials 用例，以及 `apps/webui/test/configuration-browser.test.ts`、`configuration-recovery.test.ts`、`credentials-http.test.ts`、`credentials-browser.test.ts`。它们分别核对真实持久状态、HTTP 身份与反关联、provider Authorization、实际界面/迟到读取和丢响应，不以 schema 通过替代功能证据。

计划输入补充用例为 `apps/server/test/pocket-schedules.test.ts`、`pocket-schedules-boundaries.test.ts`、`pocket-schedules-persistence.test.ts`、`apps/webui/test/schedules-browser.test.ts`、`schedules-recovery.test.ts`、`packages/agent/test/runtime-backend-job-progress.test.ts` 和实际 CLI 消费者 `scripts/consumer-pocket-schedules.mjs`。原生 progress 反例是直接执行真实 Durable 程序，准入状态反例则在真实原生准入/HTTP 后受控丢失确认视图：后者证明分类与停止后续周期，不称为真实磁盘断电实验。

Memory 补充用例为 `packages/agent/test/runtime-context.test.ts`、`runtime-context-boundaries.test.ts`、`apps/server/test/pocket-memory.test.ts`、`pocket-memory-boundaries.test.ts`、`pocket-memory-native.test.ts`、`pocket-memory-native-changes.test.ts`、`apps/webui/test/memory-browser.test.ts`、`memory-recovery.test.ts` 与实际 CLI 消费者 `scripts/consumer-pocket-memory.mjs`。未知结果恢复分别覆盖浏览器已消费响应后断连和真实写入后受控抛错；它们不称为断电实验。

Webhook 补充用例为 `apps/server/test/pocket-hooks.test.ts`、`pocket-hooks-boundaries.test.ts`、`pocket-hooks-persistence.test.ts`，`apps/webui/test/extension-ingress.test.ts`、`hooks-browser.test.ts`、`hooks-recovery.test.ts`、`hooks-read-boundary.test.ts`、`hooks-busy.test.ts`，以及实际 CLI 消费者 `scripts/consumer-pocket-hooks.mjs`。已提交后受控丢结果的测试证明固定身份核对与不重放；不称为断电实验。真实原生忙碌队列、GitHub HMAC、30 次小时额度和持久回执另有正向效果记录。

## 8. 不应混同的证据

- 恢复 running intent 的测试通过受控公开 store 写入状态，不称为 kill-process/断电实验。
- 图片使用真实 PNG 在浏览器解码；看到文字占位符不算图片字节证据。
- provider payload 排除了人类内容；没有发起 HTTP 的文件操作还独立核对了实际磁盘/Git 效果。
- 阶段中间基线不是 P6 的两方独立对抗复审，完整 source-to-target ledger 和远程部署目标没有取消。
