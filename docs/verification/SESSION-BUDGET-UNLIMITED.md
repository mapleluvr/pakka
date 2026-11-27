# Session 预算默认不限制：验证摘要

2026-11-27，Windows / Node 24.15.0 / npm 11.12.1。后端基线 `7a329040efc3fc49bb11ad6e7280e28338765924`，最终源码随此记录提交；前端归档及八包身份见 [固定配对](../../integrations/webui/pairings/app-17e7382fb3a2e441.json)。源码基线、构建输入、制品摘要和后续提交身份分别记录。

类型/构建、OpenSpec strict 校验通过。受影响回归按每个文件的最终结果汇总：48 文件、153 测试通过，0 失败、0 跳过，非全仓 suite。覆盖零上限的直接创建、分叉、MAS 批量接纳、主/辅助尝试与持久计数；正数继续限额；省略 limits 重开保留管理政策；显式 bootstrap 改动继续审计；权限、版本 CAS、未知结果和原请求核对保留。

八包仓外安装与 Edge 实测默认 control/child 为 0/0/0；有限值保存、三个 0 保存、丢回执后刷新并仅核对原请求、正常停止与重开均通过。配置实验没有推理；另一额度实验对本地确定性 provider 实际发出主/辅请求各一次。旧前端在打开 Session 前被拒绝，旧 workbench 2 创建与 services 4 写入返回 VERSION_MISMATCH/denied，无持久效果。Headless v1、extensions 3 和存储 schema 不变。

父会话独立核对八个归档、两份浏览器公开包锁、713 项前端资产及两次前端重建字节一致。完整本地证据包 `webui-budget-pr-evidence.zip` 的 SHA-256 为：

`a5c79d2048437c9413b9e7b968897ce96e2592c0ce5d0bd3a54dda66265f2a2c`

包保留原始失败、修正后的 TAP、安装探针和截图；包与原始证据不提交 Git，不上传 GitHub。TUI 等旧 Pocket 客户端需另行升级；只更新前端不能改变 Runtime 的接纳语义。独立回审结果见下节，尚未合并。

## 独立回审

2026-11-27，唯一 reviewer 使用 `zzz-codex/gpt-6-astra:xhigh`，对 WebUI `38b9306fa7ed74e382ac5122806a9959dcb4f4be` 与 Pakka `7ab502516d741f6133f9c9b830dd52aca668120b` 的完整 base...HEAD 给出 PASS，未确认需修复的产品缺陷。审查后仅补充本节与交付记录，产品源码、包锁和制品保持受审身份。

reviewer 独立执行两仓类型检查、Durable patch 核验、9 项 reader 检查和 6 文件 37 项后端回归；还在隔离安装中检查通知生命周期/关闭、参数树跨宽度编辑/保护字段/原子写回/冲突/丢回执、个人默认快捷键/触屏长按以及预算保存与同 Session 重开。全部最终结果通过。父会话核对报告、最终 TAP 和浏览器探针输出；首次探针装配与路径失败按实际原因保留，没有计作通过或产品缺陷。

reviewer 对原 48 文件 153 项结果执行的是原始 TAP 复核，独立重跑范围为上列 37 项与 9 项。未重跑全部历史 UI 流程、全仓 suite、WebKit/Firefox、真机辅助技术或全部 provider 的真实模型参数。

本次独立报告与完整本地证据单独打包为 `webui-single-review-evidence.zip`（1,065,603 字节），SHA-256：

`fe38a91c83f947129533f3bea938ff9e4edabe0509b09da73dfc1ec086e950a5`

原候选证据包保持原字节与 hash；两包均仅本地保管。回审完成后将 PR 设为可评审，合并单独处理。
