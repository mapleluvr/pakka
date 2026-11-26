# Tasks

- [x] 历史限制审计及四项本地确定性现状探针。
- [x] 用户授权实施，采用原生 Models 与默认 WebUI 方向。
- [x] 普通模型错误后可继续，slash 字面文本通过；保留 unknown 负向回归。
- [x] SDK 原生 Models/getter、完整模型身份、真实 metadata、thinking 与未选模型。
- [x] WebUI 使用公开 ModelRuntime 配置来源，模型目录、刷新与凭据管理。
- [x] Runtime profile/预算安全演进及持久审计、v1/v2 升级与原 Session 重开。
- [x] WebUI 预算查看、调整和原请求核对界面。
- [x] Windows owned-browser 停机与 Fetch 安全端口选择；真实占用/监听与 WebUI 回归。
- [x] 标准执行预设、项目 instructions/skills/templates 资源接入。
- [x] 子 Session 打开隔离、状态与恢复；保留原身份、实时授权、writer 及 unknown 边界。
- [x] 收敛并完成 pakka 默认启动、停止、初始 owner 登录与重开，包含仓库外安装后的 pwsh 命令。
- [x] 包/构建/check/回归和实际消费验证，记录准确范围。
- [x] 同步 state、指南、变化记录与后续边界；不自动提交/推送/合并。

## 2026-11-07 入口切片交付

固定源码清单 559 项，完整回归 805/803 pass/0 fail/2 原平台 skip；完整八包安装消费的 33 个步骤通过。全仓格式检查仍有 16 个未改动的基线文件，本次 97 个改动源码文件检查通过；未改写固定配对。源码、归档身份、失败过程、实际方法与范围见[交付记录](../../../docs/verification/PRODUCT-RUNTIME-LAUNCHER.md)。本切片仍为未提交工作，不据此宣称所有审计限制都已解除。

## 后续独立切片

- [ ] 长上下文由[默认 Dynamite 策略](../adopt-default-dynamite-context/tasks.md)承接，核对预算/owner；受控重试仍为独立待设计事项。
- [ ] 附件和容量治理切片；不得以放大常数冒充生命周期。

本机管理员重新登录恢复仍由[既有设计任务](../improve-webui-navigation-and-local-recovery/tasks.md)承接；`--recover` 是原 Session 打开，不是重新签发 owner 或清除锁。
