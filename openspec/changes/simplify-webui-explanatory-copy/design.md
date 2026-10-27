## Context

用户已授权采用 [文案调查](../../../docs/verification/WEBUI-COPY-AUDIT.md) 的推荐方案，并纠正此前回答引入了项目不存在的产品术语。主工作台、内置贡献保持自己的业务边界，协作入口明确指向人类聊天和共享笔记；不创建新实体或权限层。菜单/创建入口样式由前一个 change 独立记录，最终快照共同验证。

## Goals / Non-Goals

使页面以字段、准确名称、状态和相关动作反馈表达用户所需信息。实现只调整 UI，不改协议、原生 Job/receipt 状态、授权、输入接纳、密钥存储或额度计数；不改用户内容、外部扩展文案、开发者示例或历史原始证据。

## Decisions

1. D1–D13 的常驻教学及已确认结果的保证尾句直接删除/缩写；加载、拒绝、原回执与 unknown 核对、部分成功、冲突、显示截断保留。不是对 `not/never` 做全局替换。
2. 服务器位置通过 `Server Directory` 和现有 Project Browser 的短服务器范围标签表达；收藏/最近项标明 `On This Device`，标题帮助保留登出清空。Appearance 的正常保存状态缩短，存储失败仍独立报警。
3. 人类通道统一为 `People Chat`，共享笔记沿用 `Shared Notes`，聊天区使用 `Messages`。保留底层 chat 模式与 collaboration API、driver 租约及主体归属，不改 MAS 页面或其生命周期概念。
4. 密钥留 Session/新请求的短范围提示；attempt 不退与 Webhook 连接/限制放原生 details，按需阅读且默认收起。使用现有字体/theme 与 SVG；不建立帮助系统或额外配置。
5. 语音仅在实际 listening 时显示浏览器服务短状态，按钮 title 在启动前已包含服务来源；停止后移除正文和无效 aria-describedby。语音状态与显式 Send 语义不变。
6. 归档沿用真实动作 toast；UI 禁用仅在请求确认后通知后台工作继续；worktree 创建后用成功状态说明当前目录未更改，切分支的失败保留实际错误。
7. 定时输入 `done` 在 UI 显示 `Inputs Submitted`，原 `data-schedule-state` 对应值、backend/native 状态不改；取消成功说明已提交输入仍继续。以真实调度/额度/请求验证，而非将模型完成当作投递完成。
8. Memory 沿用已有全局/项目和 Awaiting approval 标记，删除介绍与逐行重复说明；Webhook 的输入记录使用准确标题，秘密地址/外部作者/轮换后果可见。

## Risks / Trade-offs

精简可能掩盖 unconfirmed 或安全后果 → 继续跑原恢复/冲突/撤权/秘密/取消路径，精确断言保留。按需内容可能在小屏难找 → summary 可键盘展开、44px 触达、主题/20px 及手机截图。被删文案关联的旧定位器按真实新 UI 同步，不削弱原副作用断言。

## Migration Plan

静态资产整体更新，无数据迁移。先 RED，再最小实现和受影响真实浏览器、旧契约回归；冻结最终版本跑全量及隔离预览，归档命令/版本/原始失败。按用户本会话决定不安排独立复核，指定独立桌面不可用仍单独记录。
