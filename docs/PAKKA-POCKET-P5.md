# Pakka-Pocket P5 — 协作与保留工作流（实施中）

状态：**P5 部分实施，不是产品交付/复审结论**。已接通人类协作、可选文件/Git、原生工具审批、受控浏览器、模型/用量设置、私密 provider 配置与真实通知服务；原生通知点击、可选自动化以及完整远程部署清单仍继续验收，不能用本阶段测试总数替代 P6 的实际产品验收。

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

## 7. 当前可执行证据

| 主体                                                  | 证据                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/server/test/pocket-collaboration.test.ts`       | 真实 Durable 记录、两人 notes/driver 竞争、期限/资源边界、正常重开                   |
| `apps/webui/test/collaboration-http.test.ts`          | 实际认证 HTTP/SSE、viewer 参与、服务端过滤及确定冲突                                 |
| `apps/webui/test/collaboration-browser.test.ts`       | 两人桌面/手机交互、typing、pin/reaction、notes 草稿、driver、实际模型 payload        |
| `apps/webui/test/collaboration-late.test.ts`          | 真正延后的读取不能影响新 Conversation                                                |
| `apps/server/test/pocket-files.test.ts`               | 真实磁盘、Git、链接/配置拒绝、原生忙碌、effect 记录和重开                            |
| `apps/webui/test/files-browser.test.ts`               | 文件编辑/上传、安全文本显示、diff、分支/worktree 的实际鼠标流程，0 次模型 HTTP       |
| `apps/webui/test/files-boundaries.test.ts`            | 本地草稿与外部文件冲突、真实 PNG 解码、手机 viewer、直接 RPC 越权拒绝，0 次模型 HTTP |
| `packages/protocol/test/pocket-collaboration.test.ts` | 有限协作命令/DTO 的结构检查，不作为实际能力证明                                      |
| `scripts/consumer-pocket-workflows.mjs`               | 仓库外实际 CLI 的多人、真实文件/diff、原请求去重和正常重开；2 次模型 HTTP、额度保持 2 |
| `apps/webui/test/files-effect-boundary.test.ts`       | 真实 intent 提交后关闭扩展/abort，不产生迟到磁盘写入，原请求不重放                     |
| `apps/server/test/pocket-approvals.test.ts`           | 原生 invocation、允许/拒绝、撤权/abort/失效界面和不明效果的真实存储回归                |
| `apps/webui/test/approvals-browser.test.ts`           | 实际操作者/手机 viewer 面板、原工具效果与模型终态                                     |
| `apps/server/test/pocket-browser.test.ts`             | 真实独立页面、PNG 解码、origin/resource 权限、原 intent 及正常重开                    |
| `apps/server/test/pocket-browser-network.test.ts`     | 实际 HTTPS 隧道与未批准 CONNECT 拒绝                                                 |
| `apps/server/test/pocket-browser-network-reset.test.ts` | 24 次真实拒绝连接后 reset，错误留在该连接且目标请求为 0                            |
| `apps/webui/test/browser-contribution.test.ts`        | 桌面/手机真实动作、丢响应后的可见核对与内层 unknown 保留，0 次模型 HTTP                |
| `apps/webui/test/extension-http.test.ts`              | 原操作查询、错误 profile/incarnation、跨用户、撤权与 403/denied                     |
| `scripts/consumer-pocket-controlled.mjs`             | 实际 CLI 审批与浏览器控制、2 次页面效果、原操作核对和正常重开；4 次模型 HTTP            |
| `apps/server/test/pocket-notifications.test.ts`      | 真实 TLS/独立解密与 VAPID、晚撤权、定向收件人、输入捕获、未知投递及重开 |
| `apps/webui/test/notifications-http.test.ts`          | 实际完成/旁聊事件、有限设备协议、当前 Cookie metadata 和越权探针 |
| `apps/webui/test/notifications-browser.test.ts`       | 真实 worker 原生通知、登出清理、手机偏好隔离和桌面/手机布局 |
| `apps/webui/test/notifications-main.test.ts`          | 非法 push authority 在存储和 provider 效果前被拒绝 |
| `scripts/consumer-pocket-notifications.mjs`          | 实际 CLI/TLS/worker/reopen；2 次模型 HTTP、3 次 push、原未知投递不重发 |

冻结副本的构建、类型和全量回归 **387/387** 通过，无 skip/cancel/todo；完整 `smoke:package` 的所有既有及新增消费者通过。386 个源码/夹具 SHA 在门禁前后保持一致，原树未变时才合回 12 个已测试文件。合回后的构建、类型和主动诊断通过；补充了“面板重新加载后等帧已解码再点击”的验收等待条件，原查询与效果断言未变，相关 8 项组合连续 5 轮通过，更新后的消费者再次通过同一安装产物。生产字节与已通过的全量/安装身份一致。

原失败、red/green、386 文件身份、合并记录、阶段日志和桌面/手机截图保存在 `artifacts/pakka-pocket/p5/`。`writer-check/operation-lookup/` 记录这次单 writer 合并；`installed-recovery-final.json` 绑定实际安装档案及补充消费者 SHA。Markdown lint 按用户指示留到收尾，不阻塞功能推进。

设置补充用例为 `apps/server/test/pocket-configuration.test.ts`、`pocket-credentials.test.ts`、`pocket-credentials-boundaries.test.ts`，协议/client 的 configuration/credentials 用例，以及 `apps/webui/test/configuration-browser.test.ts`、`configuration-recovery.test.ts`、`credentials-http.test.ts`、`credentials-browser.test.ts`。它们分别核对真实持久状态、HTTP 身份与反关联、provider Authorization、实际界面/迟到读取和丢响应，不以 schema 通过替代功能证据。

## 8. 不应混同的证据

- 恢复 running intent 的测试通过受控公开 store 写入状态，不称为 kill-process/断电实验。
- 图片使用真实 PNG 在浏览器解码；看到文字占位符不算图片字节证据。
- provider payload 排除了人类内容；没有发起 HTTP 的文件操作还独立核对了实际磁盘/Git 效果。
- 阶段中间基线不是 P6 的两方独立对抗复审，完整 source-to-target ledger 和远程部署目标没有取消。
