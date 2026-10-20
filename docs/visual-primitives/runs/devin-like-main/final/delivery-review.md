# 评审入口：Devin-like 真实前端迁移

本分支把 `origin/main@df76ea4` 的真实前端迁移到 Devin-like 外观，不以静态演示替换后端。产品源码候选固定为 `fe02dd2`；后续图像与文档提交不改变该产品源码身份。

## 先看这些

- [桌面深色首页](candidate-desktop.png)／[浅色首页](candidate-light.png)
- [真实 Conversation](candidate-conversation.png)／[会话搜索](candidate-search.png)
- [390×844 手机](candidate-mobile.png)／[360×600 短屏](candidate-short.png)
- [独立运行的参考原型](reference-desktop.png)
- [详细验证记录](../../../../verification/DEVIN-LIKE-FRONTEND-R1.md)

`accepted-render.png` 是本轮接受进入用户评审的桌面图，不表示全部发布门禁已通过。所有截图的来源、尺寸、SHA-256 与原始日志见 [身份清单](candidate-identity.json)。

## 已迁移什么

300px 平整侧栏、Inter、中性深浅主题、居中首页卡片、桌面收起、全局搜索和手机抽屉。真实 Conversation、角色权限、模型／目录独立选择、原生 Prompt／Steer／Follow up、Team chat、工具／回执和公开扩展继续使用 main 的能力。

首页只创建并进入 Conversation，不调用模型。实际工作仍要显式 Send。丢响应时保留原 requestId 并只读核对，不因为离开／返回首页而创建第二份工作。

## 建议重点评审

1. 首页“先创建、再 Send”的语义与按钮是否清楚。
2. 真实导航的密度、Inter 和较大的触摸点击区是否合适；没有为了贴图隐藏扩展／权限能力。
3. 手机 360px 下提示语已完整换行；Commands & extensions、People & invites 与抽屉仍可访问。
4. 从首页直接进入普通全页扩展或 MAS Board，再返回的视觉与焦点衔接。
5. 会话页的信息密度：当前保留真实目录、模式、回执和语音草稿能力，并非原型推测会话页的逐像素复刻。

## 交付状态

这是**可评审的实现候选，尚非完整验收／发布通过**。全量、专项和安装结果分开报告；独立 GUI 与指定两方审查受阻，没有以程序化 Chrome 冒充。未推送或合并 main。

继续工作前读 [剩余限制](remaining-limitations.md)、[复跑方式](reproduce.md)和[直接视觉检查](final-inspection.md)。
