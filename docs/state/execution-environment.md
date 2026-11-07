# 执行环境

## 关系与入口

可信 bootstrap 通过 `HostOptions.execution` 或 `RuntimeOptions.execution` 提供执行配置。`ConversationProfile.execution` 覆盖该 profile 的默认配置；省略时继承默认配置。每条 Conversation 使用其有效 profile、cwd 和 incarnation 取得环境，模型参数中的路径或 cwd 只用于已批准环境内的操作。

`ExecutionConfiguration` 包含版本身份 `id`、`open(target)`、显式的原生工具选择 `tools` 和可选 `powershellPrograms`。目标是冻结的 Session/Conversation/profile/cwd DTO，managed Conversation 还包含 incarnation。配置身份须随驱动语义或权限变化而更新；工具选择及 PowerShell 程序选择一并参与配置核对。配置对象和选择数组在接入时复制、冻结，factory 的实现及所捕获的状态由可信 bootstrap 负责。

适配器通过 Durable 的公开 `HarnessOptions.env` 提供原生环境。`read`、`write`、`edit`、`bash`、`powershell` 按显式选择注册，和自定义工具使用同一 invocation 校验。配置错误与工具重名在建立 Session 存储前拒绝。配置了环境的 Conversation 在主模型请求前完成取得；取得失败用原生 block 结算已接纳输入，保持零 provider HTTP，缺失能力返回明确错误。

## 默认本地产品装配

无参数 `pakka` 的产品 bootstrap 显式装配本地环境：`default` 提供 read/write/edit 与 Windows PowerShell 或 POSIX Bash，`read-only` 仅注册 read。SDK 省略 execution 时仍不启用环境，不把产品默认反向变成所有 SDK 宿主的隐式权限。环境按原生 Conversation 当前 cwd 和 incarnation 建立；更改配置仍使旧绑定失效。

命令子进程仅继承 PATH、系统目录、临时目录、用户目录和基本 locale 等明确运行变量，不继承模型宿主的凭据、Node 启动钩子或完整环境。可信工具显式提供的 env 属于其宿主授权。这是环境卫生，不是文件系统或网络沙箱；本地命令仍具有当前 OS 用户权限。

产品资源源按每次 generation 的批准 cwd 使用 Pi 公开加载器读取 instructions，并提供 skills/templates 的元数据与文件位置。资源设置使用原生 global/project settings 的只读 skills/prompts 视图；不解析 packages，不执行扩展或 MCP，不覆写用户文件。资源正文与模板参数不因出现在索引中而自动加载或展开。数据快照不授予权限；Runtime 在实际请求派发前核对原引用、cwd 与 authority。

## 能力与数据

合作工具通过 `executionFor(scope)` 取得冻结的 `ExecutionAccess`。它提供文件、目录、reader、watch、临时资源和命令能力，方法使用标准 AbortSignal；Pi Context、可变 env、原生 reader 和工具 API 留在 `durable-adapter.ts`。二进制数据使用冻结的 `{ base64 }` DTO，命令输出按 stdout/stderr 分开回调。工具能力不包含 owner 的 `cleanup()`。

`ExecutionDriver` 是可信 bootstrap 的中性驱动接口。`id` 标识文件命名空间，`cwd` 必须匹配批准目标；这与标识策略/配置版本的 `ExecutionConfiguration.id` 是两个不同身份。可选方法缺失时得到 `not_supported`，缺失命令执行能力得到 `shell_unavailable`。驱动通过返回可关闭的 reader/watch 能力保持跨调用状态；binary reader 在路径替换后仍关联原打开对象。

`createLocalExecutionEnvironment()` 是显式的本地实现，内部使用公开 `NodeExecutionEnv`，具有所在宿主进程的本地权限。它是功能驱动，不是 OS 安全沙箱。直接使用宿主 fs、child_process、网络或独立服务的插件仍属于自己的执行域。模型请求、辅助 inference、Durable 存储和 codemode 的独立运行器具有各自的控制入口。

## 寿命、失败与恢复

- 环境按配置身份和冻结目标复用。配置切换产生新绑定，旧 invocation 失效；已经取得的 owner 保留至所属 Host/Runtime 关闭。
- 工具返回后停止接收新操作，等待已启动操作结算，再使能力失效并关闭该 invocation 的 reader/watch。复制 scope 或保留能力不能延长授权。
- 单次取消传入该调用的 AbortSignal，和 owner cleanup 分开。timeout 是执行时限，单位秒。输出 spill 和临时文件由环境保持到其约定的消费/清理边界。
- 驱动拒绝 `open()` 时负责收回尚未返回的资源。已返回但身份不匹配的 driver 仍由 adapter 负责清理；缺少 cleanup 或 cleanup 失败保留未确认的 ownership，阻止释放 writer。
- 生命周期或权限撤销拒绝后续效果和过期结果的交付，与驱动报告的未知效果分开分类。原生工具在异步读取之后同样重验 invocation，重开不会允许旧 edit 写回。
- 未分类的执行失败、无法识别的结果封套或未知效果使 Host 失败关闭；reader 和普通方法遵守相同规则，工具捕获异常或请求取消不解除未知状态。已观测到的文件效果保留，不自动重放。
- Session provenance 保存默认执行配置的指纹，managed Runtime 还保存各 profile 的指纹。重开保持相同配置，显式添加、移除或改变执行配置需重新选择 Session，不能绕过原存储核对。进程内能力和打开的句柄由本次宿主重新建立。

细粒度场景见 [Runtime 补充](../../openspec/changes/add-execution-environment/specs/conversation-runtime/spec.md)，类型见 [execution-types.ts](../../packages/agent/src/execution-types.ts)，用法见[执行环境指南](../guides/EXECUTION-ENVIRONMENT.md)。原生拒绝与结算由 [Durable 补丁契约](durable-patch.md)维护。
