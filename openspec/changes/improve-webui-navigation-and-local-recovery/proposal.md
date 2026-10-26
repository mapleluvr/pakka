# Proposal

## Why

pakka-webui 的登录拒绝只显示通用提示；当唯一管理员退出后，初始登录令牌已被轮换且当前没有有效会话，现有 CLI 缺少保留数据的恢复路径。设置页已经能单击进入，但分类仍由本地 Sheet 状态驱动，与 Devin 生产前端的可寻址路由存在差距。

## What Changes

- 增加受操作系统文件权限与独占 writer 约束的本机管理员恢复命令，向原产品 owner 颁发短时、一次兑换的登录凭证。
- 明确恢复目标、旧会话撤销、私有文件交付、持久化核对和失败语义；保持现有用户角色、Conversation、已接纳请求与额度。
- 让登录与操作界面区分凭证拒绝、安全校验、冲突、容量和未确认结果；给出与实际状态对应的下一步。
- 将设置建立为真实页面路由，支持分类 href、深链接、刷新、前进/后退、正常链接行为与当前授权上下文。
- 按真实页面分批完善表单语义、错误与焦点、长内容阅读、会话反馈和响应式细节。继续采用已保存指南与 Devin 生产参考。
- 2026-10-24 指挥交接后，先行实施 Conversation/composer 状态可观测性 P0：live/part 保形、工具跨载体归卡、禁用/停止反馈和 blocked/needs review 指引。该切片仅消费现有 DTO，不表示本提案其余范围已获采用。
- 将前一条指南变更中的后续工作统一接到本 tasks，保留它已经完成的首批结果。
- 用户明确授权开始执行 design §6.3/tasks §4.3 的 Session/Conversation 创建方案：独立配置向导、真实父子关系与 New Session / New Conversation、首次预填与两步结果，以及 Sort Per Session / Default 个人导航分组。删除首页内嵌命名及其旧快捷键分支，不保留双轨 UI；采用不表示实现已经完成。

- 2026-10-25 按用户纠偏采用模型权限精简：单独模型选择使用已配置 provider 的模型目录，不叠加逐模型或逐 Session 白名单；完整 Agent 预设的工具/指令授权保持独立。检查配置提示与真实写权限、目录边界及创建/文件夹草案中的重复授权，见 design §6.5/tasks §4.5。

## Capabilities

### New Capabilities

本轮沿用已有能力边界，新增要求进入下列 delta。

### Modified Capabilities

- `authenticated-mas-apps`：本机受信任认证维护、保留数据的 owner 登录恢复、发行核对与原有网络授权边界。
- `devin-frontend`：可寻址设置页面、授权导航、分层错误反馈及面向实际页面的交互质量。该能力的当前声明位于 adopt-devin-frontend 及后续活动 delta；主 specs 尚无同名文件，本轮沿用其能力名并协调归档顺序。

## Impact

- 目标：apps/webui 的 CLI、bootstrap、HTTP shell 路由、浏览器页面、服务端 people 认证状态与持久化封装，以及 packages/agent 的受限维护端口。模型精简切片修改 apps/server 的 workspace 模型目录/配置/继承与能力提示，保持有限协议和原生调度。
- 浏览器 RPC 仍使用原授权协议；恢复发行仅由本机可信 CLI 触发，浏览器通过现有 exchange 兑换凭证。
- 认证持久化格式需要兼容当前 schema 1，并为发行记录提供与会话变化同次提交的版本化数据；旧数据升级与回退条件在实施时说明。
- 当前 Pi 1.0.3 cohort 和下游补丁保持各自现状；独立的 1.4.0 patch 任务与本轮分开。
- 恢复入口、新设置路由继续保持各自采用状态；Session/Conversation 创建方案已由用户明确授权执行。§6.5 的模型权限纠偏已由用户明确要求；对应 state、契约与任务同步，文档齐备不代替行为验证。
