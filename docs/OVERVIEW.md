# Pakka

Pakka 将 Pi 的 Conversation、权限、持久化和 MAS 服务接到可选的 pakka-webui Web 工作台。

## 当前工作

[Compresser 会话修复与封存](changes/compressor-repair-session.md)已按用户纠偏修正为 Conversation 级计数／封存与原生并发：显式试行 Dynamite 0.5.0 × agent 0.7.0 在固定 Durable 1.4.0-pakka.1 上运行一个长期容器，以多个 source-job Conversation 服务容器外的业务 Session／Conversation；一个外部 Conversation 可触发多个压缩 Conversation。原生 steer／失败边界接续保留轨迹，每次请求计入原辅助额度并保留回执；两类错误在各 Compressor Conversation 内独立累计，达到容忍值只封存该条，其他独立任务保留调度与采用资格；跨任务 P2/P3 合并属于额外异步机制。真实进程中断后的未确认工作在可信解除旧 writer 锁后重开为 quarantined，不自动重发。见[当前状态](state/compressor-session.md)、[Conversation 隔离验证](verification/COMPRESSOR-CONVERSATION-ISOLATION.md)、[设计](../openspec/changes/add-compressor-repair-session/design.md)与[剩余任务](../openspec/changes/add-compressor-repair-session/tasks.md)。[1.4 能力探针](verification/COMPRESSOR-SESSION-1.4-FEASIBILITY.md)与[初轮 1.0.3 证据](verification/COMPRESSOR-SESSION-FEASIBILITY.md)保留原范围。

[Dynamite P2/P3/P4 受控 Tool Calling 生产](changes/auxiliary-tool-output.md)的实现及已选执行验证保留在[原任务](../openspec/changes/add-auxiliary-tool-output/tasks.md)和[验证记录](verification/AUXILIARY-TOOL-OUTPUT.md)。两次部分复审保留原始失败；按用户后续指令不再使用 adversarial review，历史未完成协议不改写为通过。

[设置路由、前端调优与本机管理员恢复](changes/webui-navigation-and-local-recovery.md)的恢复与路由仍为待确认方案；当前已实施其中 [Conversation/composer 状态可观测性 P0](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#41-conversationcomposer-状态可观测性-p02026-10-24)：真实 live/part 保形、工具跨载体归卡、禁用/停止反馈与回执下一步指引。该切片只补齐既有 catalog reason 到 Pocket 的透传及 live 投影，Sessions 行运行状态另待协议扩展；见[设计边界](../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#61-2026-10-24-conversation-状态可观测性批次)。原候选复核暴露的徽标误标、流式工具卡展开态和折叠错误辨识已由真实 RED/GREEN 修正；固定版本及受阻的两方评审/独立 GUI 见 [P0 验证记录](verification/WEBUI-INTERACTION-P0.md)。其余[proposal](../openspec/changes/improve-webui-navigation-and-local-recovery/proposal.md)及[统一 tasks](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)保持各自采用状态。

用户实查后的 [排版、SVG、标题与焦点整检](verification/WEBUI-TYPOGRAPHY-SVG.md)已固定产品及测试候选；真实浏览器覆盖主次文字、凭据、扩展公共原语、麦克风与外层圆角焦点，全量 638/636 pass/0 fail/2 skip。后续发送组 Tab 描边被裁到接缝的问题另见[组合按钮焦点修正](verification/WEBUI-SPLIT-BUTTON-FOCUS.md)，已覆盖真实像素四侧与受影响输入路径。A 原文及监督者逐项实测已封存；旧候选的指定 B 模型未注册、独立桌面工具缺失保留原 BLOCKED。2026-10-25 操作者取消本会话后续独立复核，组合按钮候选按自检与实际回归记录交付，已停止工作流。用户提出的独立创建弹窗及 Session → Conversation 关系由 [创建方向任务](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#43-session--conversation-创建方向2026-10-24) 承接；现已实现真实多 Session 创建/重开、专用配置向导、完整资源寻址及两种 sidebar 投影，删除首页命名旧路径。候选 `440e9cc` 构建/类型与全量 659/657 pass/0 fail/2 skip 已通过，原始证据及恢复边界见[创建与分组记录](verification/WEBUI-SESSION-CREATION.md)。

用户实查后另起[分组菜单与首页创建入口](changes/webui-grouping-and-creation-controls.md)：复用主题化菜单，首页两个创建入口同型透明并由灰色短竖线分隔。已有创建能力先独立封存，本轮范围及实际门禁由[新任务](../openspec/changes/polish-webui-grouping-and-creation-controls/tasks.md)承接。

同阶段的[UI 澄清文案调查](verification/WEBUI-COPY-AUDIT.md)保留静态快照与原引文。用户后续授权按 D1–D13/Q1–Q8 推荐精简，明确人类聊天为 People Chat，省去重复教学，把必要范围和后果放进短标签、状态、按需帮助及实际动作反馈；未知、部分成功、冲突、秘密和截断不削去。[独立文案变更](changes/webui-explanatory-copy.md)与[任务](../openspec/changes/simplify-webui-explanatory-copy/tasks.md)承接采用和验证，不把原调查当作实施或 GUI 验收。菜单/入口与文案已固定于产品 `04fcf4a`，旧消费者测试补正 `59ff465` 产品零 diff；最终全量 664/662 pass/0 fail/2 skip，build/check 通过，见[菜单记录](verification/WEBUI-NAVIGATION-CONTROLS.md)和[文案记录](verification/WEBUI-COPY-SIMPLIFICATION.md)。新预览使用独立 `45009` 数据/profile/本地 responder；独立桌面工具缺失仍保留 BLOCKED。

用户另指出 People & Invitations 的 Invite Role 漏改，现由[独立变更](changes/webui-invitation-role-menu.md)补齐为同套主题菜单，保留四角色与原一次性邀请授权。候选 `ba2b2f0` 受影响 9/9、全量 666/664 pass/0 fail/2 skip，构建/类型通过；新隔离预览 45010，旧 45009 原始资产保持，证据及未完成的独立 GUI 边界见[固定记录](verification/WEBUI-INVITATION-ROLE-MENU.md)。

按用户指定的 Pi TUI `/model` 交互，Model Selection 已加入常驻模糊检索、保留输入焦点的循环候选索引、Enter/Escape 与位置计数；保持已配置模型目录和模型独立配置边界。候选、真实 provider/浏览器结果和预览见[模型索引记录](verification/WEBUI-MODEL-INDEX.md)，由[统一 tasks §4.4](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#44-model-selection-检索索引2026-10-25)承接；不混入 Session 创建与设置路由。

用户纠偏后的模型目录与整组 Agent 预设权限已分离，不再让模型选择、继承或检索叠加逐模型/逐 Session 名单；多个预设引用同一模型只展示一项，候选不携带预设 cwd。canConfigure 与现有资源写权限一致，合法最大 JSON 模型目录 65 项可通过真实 HTTP 与客户端解码。候选 `f4ed91c` 的全量 650/648 pass/0 fail/2 skip 及相关权限审计见[版本记录](verification/WEBUI-MODEL-PERMISSIONS.md)，由[统一 tasks §4.5](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#45-模型与相关权限精简2026-10-25)承接；Session 创建与个人文件夹继续复用现有人类/资源权限，不增加另一套模型或文件夹 ACL；本轮创建实现与验证由 §4.3 单独承接。

设置直达、命名及[规范采用与首批排版/焦点改进](changes/webui-frontend-guidelines.md)已实现；结果留在[指南 tasks](../openspec/changes/adopt-webui-frontend-guidelines/tasks.md)和[设置 tasks](../openspec/changes/correct-webui-settings-and-name/tasks.md)。后续队列由上述统一 tasks 承接。

生产 package.json/lock 已选择 Pi AI/Chord/Telemetry `1.4.0` 与捆绑的 Durable `1.4.0-pakka.1`；[cohort 任务](../openspec/changes/prepare-durable-1-4-0-patch/tasks.md#4-后续产品接入)和追加兼容性账本记录本次接入与存储范围。开发 verification 的选用见[交付声明](state/delivery.md#verification-的选用)。

后续文档工作是确定通用测试方法补全与 verification 历史瘦身的采用方案，见[本轮评估](../openspec/changes/streamline-verification-and-patch-state/design.md#验证方法与进一步瘦身)和[待决定任务](../openspec/changes/streamline-verification-and-patch-state/tasks.md#4-待决定的后续方案)。

- **预期**：[state](state/README.md)，包括 [Durable 源补丁](state/durable-patch.md)。
- **产品后续工作**：[前端交付任务](../openspec/changes/adopt-devin-frontend/tasks.md)、[服务与生命周期任务](../openspec/changes/pakka-webui/tasks.md)。
- **本地执行安排**：`docs/.temp/active-plan.md`；文件缺失时从上述 tracked 任务接续。
- **方法与记录**：[验证方法](development/VERIFICATION.md)、[固定验证记录](verification/README.md)。
- **完整导航与变更**：[文档导航](README.md)、[changes](changes/README.md)。

## 保留 OpenSpec 组织方式

完整变更在 [OpenSpec changes](../openspec/changes/)维护 proposal、design、tasks 与 `specs/**/spec.md`，完成后按其生命周期归档并合入 [主 specs](../openspec/specs/)。

每条 docs/changes 摘要完整引用相关 change、proposal、已有 design、tasks、全部 delta 及有关主 spec；归档时同步引用。state 维护预期与细则映射，OpenSpec tasks 承接实际差距和具体工作。
