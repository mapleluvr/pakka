# 本机维护与交付：固定候选验证

## 候选与环境

- 原维护实现：`3a1d08816d3cc3723c1e6c6db613e30649c13b1e`，原保存 head `aa83eedecc92ec3d7b0f46010814344da721b0c6`。
- 原构建基线：`83246bacee72efe21d10b522588b211b9892b30f` 加 20 个 TS/MJS 文件，源码摘要 `0a962daae2e8600d809a5d1b5ad8217892f0bdbb5f26d8486c2614b585e85f68`；运行时字节与 Git 的 CRLF/LF 映射单独保全，不改写原摘要。
- Windows x64 / Node `24.15.0` / npm `11.12.1` / Durable `1.4.0-pakka.2`。独立 HOME、Pi 目录、数据库与本地模型夹具；没有操作用户实际数据或付费模型。

## 实际结果

- build/check 通过；完整回归 **838 项：836 通过、0 失败、2 项原有 POSIX 专用平台跳过**。
- 八个归档的 **34 步**独立打包、安装、声明及消费通过，包含实际 pwsh `pakka`、原 Session 重开、固定归档升级/回退与重复回退核对。
- 原 owner 恢复、一次性登录及交付失败核对、活跃 writer 拒绝、真实退出原 claim、损坏/缺失数据库保全、目录发布中断续作及长路径快照通过。
- 维护不创建执行 Harness，不运行模型/工具/native Job；恢复保持停机，撤销旧登录，显式核对原工作集后才继续。
- 最终 17 个主动诊断路径中 16 个无诊断，适配器超 LSP 范围由完整 TypeScript 检查覆盖；不宣称全仓诊断为零。
- 新维护 change 的 strict 检查通过；前序 navigation change 的三个既有条款因长度失败，保留该失败，不重写为通过。开发阶段失败与修正亦在本地包分别保留。

## 适用与保全

本结果针对本机停服维护及同一固定候选归档；不推导在线热备、任意旧版本迁移、整个 HOME 重建、POSIX 设备通过或整体 OOM 上界。外部效果不能由恢复撤销。

原始证据与报告：`pr4-pr6-verification-evidence.zip`，1,257,613 B，整体 SHA-256 `15a4f9057e658d4c866ede588b3d535be697e0ee37050fdcb1a800863131562b`；259 个条目均与原字节核对，仅本地保留、不上传 GitHub，云端由用户处理。原固定 release 归档另保全于工作区 `.backups/2026-11-07-local-maintenance-release/`，与本证据包身份分开。

使用见[维护指南](../guides/LOCAL-MAINTENANCE.md)，预期见[维护 state](../state/local-maintenance.md)，后续见[所属 tasks](../../openspec/changes/add-local-maintenance-and-delivery/tasks.md)。
