# 个人模式与设备

用户批准以同一人的多端工作空间为使用目标，将预算备注改为可选，接入宿主持久模式、同 Person 的设备连接与独立撤销，并简化人类角色与控制权界面。采用的长期契约见 [WebUI state](../state/webui.md#个人模式与设备)。

People schema 3 保存个人 owner 与模式代际；旧 schema 读取为协作模式，正常写入才保存新格式。进入个人模式要求唯一活跃成员为当前全局管理员；拒绝扩大其他现有成员权限。模式切换推进代际，使旧 driver 不再影响新输入。独立登录凭据保留设备级撤销，Agent 策略和工具审批仍独立执行。

预算 wire `reason` 保留字符串字段，允许空内容；Runtime 审计自动保存其余字段。前端使用公开 protocol/client 归档，services 6 与 workbench 3 配对，旧 services 5 请求在执行前拒绝。旧数据升级后不直接降级旧 People decoder。

新增测试仅覆盖原有检查缺失的身份合并/独立撤销、模式冲突、跨模式 driver 与空备注持久恢复边界；界面通过隔离实例直接验收，未新增布局快照测试。已有协作测试发现首次笔记写入缺 driver 代际，已补齐新建与旧记录投影。既有 schema-1 测试需投影出真实旧字段，不能把 schema-3 新字段伪装为旧记录。

完整[提案](../../openspec/changes/add-personal-mode/proposal.md)、[任务](../../openspec/changes/add-personal-mode/tasks.md)和[增量规范](../../openspec/changes/add-personal-mode/specs/personal-mode/spec.md)维护范围与验证分类。

组件实验室按用户要求退出默认应用：移除演示页、导航与欢迎页入口，重新固定前端归档并更新 8854。共享通知、Dialog 和插件 SDK 仍服务正式功能。该次变更选用两仓类型检查、前端构建、静态产物与桌面/390px 浏览器验证，不增加布局测试；结果见[移除实验室验证](../verification/REMOVE-COMPONENT-LAB.md)。

## 任务

- [x] 宿主模式、同身份设备连接、单设备撤销与原请求恢复。
- [x] 空预算备注、自动审计与旧历史读取。
- [x] 个人模式 driver 简化与协作入口整理。
- [x] 两仓公开消费、类型检查与初轮桌面/390px 操作。
- [x] 扩大回归、最终安装消费及浏览器复验；基线 MAS 锁库失败独立记录。
- [x] 正常停止、冷备份后更新 8854，核对原 Session 历史和用量。
- [x] 本地证据保全与交接，见[验证摘要](../verification/PERSONAL-MODE.md)。

本轮实施基于已回审预算/界面候选，使用独立 `pakka/personal-mode` 分支。TUI 的具体界面接入另行核验；本轮核对 WebUI 和宿主公开能力。提交、PR 与分支集成单独处理。
