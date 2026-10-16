# Pakka-Pocket P5 — 协作与保留工作流（实施中）

状态：**P5 部分实施，不是产品交付/复审结论**。已接通人类协作、可选文件/Git、原生工具审批和受控浏览器贡献；settings/notification、可选自动化以及完整远程部署清单仍继续实施，不能用本阶段测试总数替代 P6 的实际产品验收。

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

## 5. 当前可执行证据

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

冻结副本的构建、类型和全量回归 **387/387** 通过，无 skip/cancel/todo；完整 `smoke:package` 的所有既有及新增消费者通过。386 个源码/夹具 SHA 在门禁前后保持一致，原树未变时才合回 12 个已测试文件。合回后的构建、类型和主动诊断通过；补充了“面板重新加载后等帧已解码再点击”的验收等待条件，原查询与效果断言未变，相关 8 项组合连续 5 轮通过，更新后的消费者再次通过同一安装产物。生产字节与已通过的全量/安装身份一致。

原失败、red/green、386 文件身份、合并记录、阶段日志和桌面/手机截图保存在 `artifacts/pakka-pocket/p5/`。`writer-check/operation-lookup/` 记录这次单 writer 合并；`installed-recovery-final.json` 绑定实际安装档案及补充消费者 SHA。Markdown lint 按用户指示留到收尾，不阻塞功能推进。

## 6. 不应混同的证据

- 恢复 running intent 的测试通过受控公开 store 写入状态，不称为 kill-process/断电实验。
- 图片使用真实 PNG 在浏览器解码；看到文字占位符不算图片字节证据。
- provider payload 排除了人类内容；没有发起 HTTP 的文件操作还独立核对了实际磁盘/Git 效果。
- 阶段中间基线不是 P6 的两方独立对抗复审，完整 source-to-target ledger 和远程部署目标没有取消。
