# 个人模式与设备

## ADDED Requirements

### Requirement: 同一身份独立设备登录

personal 模式 MUST 仅包含当前唯一活跃全局管理员，设备邀请 MUST 指向此 Person；各凭据独立撤销。进入 personal MUST 撤销未兑换的新成员邀请。模式与变更回执在同一 People CAS 保存，旧数据按 collaboration 读取。

#### Scenario: 撤销手机而桌面继续使用

手机和桌面登录同一 Person；撤销手机立即拒绝其后续请求并终止授权 lease；桌面继续有效，重开仍拒绝手机。

### Requirement: 人类控制简化

personal 模式 MUST 允许本人设备直接提交输入，模式切换推进代际以失效旧 driver。Agent 权限、队列、预算版本和原请求核对继续生效。UI 收起多人协作功能，保留笔记与置顶。

#### Scenario: 旧 driver 已过期

切到 personal 后输入不受旧 driver 阻塞；再回 collaboration 不复活旧租约，新的领取按原版本完成。

### Requirement: 可选预算备注

预算 `reason` MUST 允许空字符串并保存其确切回执。自动审计身份、时间、版本与额度变化继续保存，重开读回相同原结果。services 6 MUST 在执行前拒绝旧服务 API 写入。
