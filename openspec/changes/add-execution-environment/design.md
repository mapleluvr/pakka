# 执行环境接入设计

## 固定条件

Pakka main 547c496，Durable 1.4.0-pakka.1。Pi mutable objects 留在 durable-adapter；外部只取得冻结 DTO 和身份绑定命令。模型权限与 OS 执行能力分开。

## 版本化交付

初轮在 `.1` 上取得接入证据后，用户指定使用 `1.4.0-pakka.2` 命名交付。`.2` 目录固定同一上游 commit 和 source.patch；baseline、构建锁中的 Durable workspace 版本及包内版本调整为 `.2`，由既有构建脚本产生独立归档。根与 agent 的依赖/lock 指向 `.2`，build/check 使用生产选择器，安装消费核对实际版本。`.1` 目录与原检查不覆盖；新的复建和运行证据单独记录。

## 关系

可信 bootstrap 通过 HostOptions/RuntimeOptions.execution 提供有版本 ID 的配置，profile.execution 可覆盖默认配置。open(target) 收到 Session/Conversation/profile/有效 cwd 的冻结目标，managed 目标还含 incarnation。ExecutionConfiguration.id 标识策略版本，ExecutionDriver.id 标识文件命名空间。native env 和可变 reader/watch 对象在 adapter 内保留，对外使用中性 signal、base64 二进制 DTO 与命令闭包。完整公开类型位于 packages/agent/src/execution-types.ts。

原生工具显式选择，与自定义工具同样经过当前 control.invoke；合作工具从不透明 scope 获取执行能力。自定义工具直接使用宿主 fs 不会自动被重定向。当前本地驱动使用公开 NodeExecutionEnv，它是本地能力实现而不是安全沙箱。

## 生命周期和恢复

环境在目标首次需要时取得，按配置版本和冻结目标复用。默认配置身份写入 Session provenance，各 profile 的身份计入 managed 恢复指纹；工具和 PowerShell 程序选择也参与核对。原生工具与合作工具同样经过 control.invoke。工具返回时先停止接收新操作，等待已启动操作结算，再关闭 invocation 的 reader/watch。失效 scope 的新调用拒绝；已取得的 owner 保留至所属 Host/Runtime 关闭。

单次 abort 与环境 cleanup 分开。关闭成功和原生执行结束均须明确后才释放 writer；真实未配合取消的文件操作由关闭回归检查。已返回而身份不匹配的 driver 仍纳入 owner 清理。open 抛错前尚未交出的资源由 factory 收回。无法识别的结果封套、unknown/callback_error 或未分类执行异常在 invocation 收尾时失败关闭，即使工具作者捕获了异常也不继续发模型请求。

## 实跑形成的区分

原生 edit 等待读取期间发生 reload 的回归暴露了一个误判：阻止后续写入是有效撤销，不等于未知执行效果。adapter 对自己产生的作用域撤销单独分类；驱动报告的 unknown、未识别错误码和 reader 错误仍走失败关闭，取消和工具捕获异常不会解除它。遗漏 await 的回归则要求先停止准入、排空已开始操作，再失效能力及关闭句柄。

## 验证

先用真实本地 provider 请求原生 write/edit/read 和命令，独立从宿主检查文件和输出。环境不可用时检查零 HTTP、无本机退路及持久 blocked。再验证并发目标、恢复配置、旧 scope、句柄路径替换、取消和 cleanup。具体接口在这些调用示例中形成；固定版本、夹具修正及实际结果见 docs/verification/EXECUTION-ENVIRONMENT.md。

本次未发现需要扩大 1.4.0-pakka.1 源补丁的原生缺口：公开 env 接缝加已有 block/check/settlement 足以完成该切片。新增代码留在 Pakka 适配层，补丁归档及其固定身份不变。
