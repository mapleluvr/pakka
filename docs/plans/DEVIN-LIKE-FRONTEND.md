# Devin-like 前端迁移

> **R1 产品映射已被否定。** 本轮做成了旧 WebUI 换皮，不符合用户要求；以下保留为历史记录。当前实施以 [R2 前端接入与 MAS 交互设计](DEVIN-FRONTEND-ADOPTION-R2.md)为准，不能继续用本页的旧布局取舍指导前端。

本轮从 `origin/main@df76ea4` 开始，分支 `feat/devin-like-frontend`，独立 worktree `pakka-devin-ui`。用户要求确认参考仓库的复刻结果并迁移真实前端，不是替换为静态演示。

## 参考核对

来源：[mapleluvr/devin-ui-comparison](https://github.com/mapleluvr/devin-ui-comparison)，固定提交 `ed20cec`。采用 `clean-room/current` 的视觉与交互参考；它已参考 dump 核对过，不能声称严格隔离审计的 clean-room 实现。**不导入 Devin 生产 bundle、可读化代码、认证数据、截图中的组织信息或代理脚本。** 字体沿用 Inter 的 OFL 许可。

本机以全新 Chrome profile、无 Devin/Pakka 外部连接运行静态原型，重跑内置自测 12/12 通过。实际测量：1440×900 下侧栏总宽 300px（包含边线）、内容列 700px、输入卡片 688×154px／20px 圆角、notice 686×36px；手机 390×844 和 360×600 的卡片宽分别 346px 和 316px，无横向溢出。页面 `#141414`，卡片 `#1f1f1f`。部分旧说明的数值已过时：实际 toolbar 和 send 高 28px，不是表格所写的 30px；PR 卡 border-box 高 98px。原型会话布局是其作者明确标注的推测，不是已观察的 Devin 会话。

归档清单 2,090 个文件均核对到 SHA-256；Windows `core.autocrlf=true` 改变了 444 个文本文件的工作区字节，归一化回 LF 后全数一致。以上是本次本机结果，不把归档的历史 GUI 结论当作本轮产品验收。

## 产品映射

- 平整、无 tiling 间隙的双栏布局、300px 侧栏、居中窄内容列；深浅中性配色、Inter 默认字体、圆角输入卡片与浮层。
- 首页仍是真实 Workspace：新建 Conversation 只调用原有 create API，不伪造 Agent/Ask 模式、仓库连接、额度、PR、Security、Review 等服务。先创建并进入会话，再显式 Send；不因点首页、新建或搜索暗中发模型请求。
- 侧栏保留真实人员、Conversation、归档／搜索与 WebUI／Extensions 分组；增加首页、搜索和桌面收起入口。公开扩展机制与 MAS Board 的权限／生命周期保持原样。
- 会话仍呈现真实历史、reasoning、tool、receipt、stream 状态；保留原生 Prompt／Steer／Follow up 与人类 Team chat，不把外观模式映射成串行 prompt。
- 模型在输入区，cwd 只在标题下；保留工作中变更拒绝、viewer 限制和不确定结果的核对路径。
- Appearance 保留已保存的字体／字号与深浅主题；新用户默认 Inter，仍可选 Pocket Mono、系统无衬线和衬线。图标保持共享 SVG，独立图标按钮的点击区至少 44px，必要时有意大于参考原型。
- 手机维持 390×844 和短屏 360×600／390×650；抽屉、Escape、focus return、可滚动扩展区域与大字号均需回归。

## 验证与进度

1. 参考原型独立运行、来源与边界核对：已完成。
2. Windows 基线启动：发现 import map 的 CSP 哈希未按 HTML 规则归一化 CRLF；增加 LF／CRLF／CR 的真实浏览器回归，修复后再迁移。
3. 产品 shell 测试先失败，再改真实 Preact 页面与样式；产物在 `artifacts/integration/devin-shell/`。
4. 回归输入、协作、配置、文件、扩展、MAS Board、通知、Appearance 和短屏；build／check／test／打包消费者分别记录实际执行结果。
5. 独立 GUI 验收按 [WebUI 开发规范第 10 节](../development/WEBUI-DEVELOPMENT.md)进行。程序化 Chrome 测试不替代指定 GUI 子代理验收；环境不可用时明确记录 blocked，不冒称通过。

交付记录见后续验证文档；尚未完成的检查不因以上计划而视为 passed。
