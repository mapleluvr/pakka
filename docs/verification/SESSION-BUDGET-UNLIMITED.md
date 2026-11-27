# Session 预算默认不限制：验证摘要

2026-11-27，Windows / Node 24.15.0 / npm 11.12.1。后端基线 `7a329040efc3fc49bb11ad6e7280e28338765924`，最终源码随此记录提交；前端归档及八包身份见 [固定配对](../../integrations/webui/pairings/app-17e7382fb3a2e441.json)。源码基线、构建输入、制品摘要和后续提交身份分别记录。

类型/构建、OpenSpec strict 校验通过。受影响回归按每个文件的最终结果汇总：48 文件、153 测试通过，0 失败、0 跳过，非全仓 suite。覆盖零上限的直接创建、分叉、MAS 批量接纳、主/辅助尝试与持久计数；正数继续限额；省略 limits 重开保留管理政策；显式 bootstrap 改动继续审计；权限、版本 CAS、未知结果和原请求核对保留。

八包仓外安装与 Edge 实测默认 control/child 为 0/0/0；有限值保存、三个 0 保存、丢回执后刷新并仅核对原请求、正常停止与重开均通过。配置实验没有推理；另一额度实验对本地确定性 provider 实际发出主/辅请求各一次。旧前端在打开 Session 前被拒绝，旧 workbench 2 创建与 services 4 写入返回 VERSION_MISMATCH/denied，无持久效果。Headless v1、extensions 3 和存储 schema 不变。

父会话独立核对八个归档、两份浏览器公开包锁、713 项前端资产及两次前端重建字节一致。完整本地证据包 `webui-budget-pr-evidence.zip` 的 SHA-256 为：

`a5c79d2048437c9413b9e7b968897ce96e2592c0ce5d0bd3a54dda66265f2a2c`

包保留原始失败、修正后的 TAP、安装探针和截图；包与原始证据不提交 Git，不上传 GitHub。TUI 等旧 Pocket 客户端需另行升级；只更新前端不能改变 Runtime 的接纳语义。独立 reviewer 回审待完成，尚未合并。
