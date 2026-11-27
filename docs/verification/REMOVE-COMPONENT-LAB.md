# 移除组件实验室

候选为 WebUI `c936312` 与 Pakka `1a5b8ed` 基线加本次实验室移除。前端源码输入摘要为 `8e03a8a3ac9efdb8d8d2a4fbc344e144c5bb56b18bfc7eff7903013c4f40c4df`（算法见 Pakka integrations/webui）。

固定应用归档 SHA-256：`6076b13bc181c9f6dc8648a21a207f55e1ece1652ab86bc1321994e56d1bb69e`；manifest SHA-256：`28242cb569f25b227ec40e3bb93e192cb70f00868c192d2e2067cdf62ec0b360`。要求 services 6 / workbench 3 / extensions 3，共 713 项资产。

Windows、Node 24、Ego Lite。两仓 `npm run check`、前端 `pack:app` 和 Pakka WebUI 固定产物构建通过。源码与产物均无实验室插件注册及页面内容。隔离预览验证未登录首页、登录 Dialog、390px 导航和旧链接不可用状态；8854 实屏验证已登录首页、Conversation 与桌面/390px 导航。

原服务正常退出、writer 释放并冷备份后重开同一 Session；原浏览器登录有效。全部 713 项 HTTP 资产与候选 hash 一致；Proj 的 19 条历史和用量在重启前后逐字节一致。此次操作未发送模型输入。

本次是演示页面删除与固定产物更新，选用类型、构建、资产和直接浏览器检查；未新增永久布局测试或重复执行个人模式全回归。原个人模式验收范围仍见 PERSONAL-MODE.md。

本地完整证据包 `remove-component-lab-evidence-final.zip`，74,091 字节，SHA-256：

`31e9c452f6846ed2a8eab2cbc2bb3677721a4213627cf656a4eefd322e0880c7`

原始脚本、构建日志、截图、部署与历史核对材料仅保存在本地证据包；冷备份单独保管，未上传。
