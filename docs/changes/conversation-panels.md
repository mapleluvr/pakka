# 搜索与输入浮窗交付

2026-11-28，用户要求搜索改为可拖动浮窗，并重新打磨「我的输入」。独立 WebUI 负责共享浮窗、拖动与主题、手机单窗切换及输入记录显示；Pakka 选择相应固定归档，服务保持 services 6 / workbench 3 / extensions 3。

桌面打开浮窗保留正文和输入框交互，关闭和恢复位置均有显式入口。手机切换窗口保留搜索词，以「筛选中」标识仍在生效的本页预览筛选。输入记录按消息、状态、原因和回执详情分层；停止、撤回与原请求核对继续使用原有服务。

[配对记录](../../integrations/webui/pairings/app-2e3b0404f60fc30a.json)固定候选来源和归档摘要；界面契约与形成过程由 pakka-webui 的 `docs/changes/conversation-panels.md` 维护。本地安装验收和部署接续见工作区 `handoff-2026-11-28-floating-panels.md`。
