# Thinking 级别菜单验证

- 候选：WebUI `pakka/personal-mode` 基于 `847521e` 的工作区；Pakka 基于 `e475795` 更新默认前端。源码输入摘要 `a61c3b34158a687e214d900a5beb7a64a4c0b79de2730524ed49daecb9fb0064`。
- 产品归档：`pakka-webui-app-0.1.0-66cf02bfae03ff3e.tgz`，SHA-256 `66cf02bfae03ff3ee6c98223eef1f4872537067dbdc4ee97e5fb338b54e9b82a`；manifest `8020a06e172b7e8a8c8f540999b07ee577292ab6164b2d9b15595b5790849f26`。715 项资产；services/workbench/extensions 6/3/3。
- 环境：Windows、Node 24.15.0、npm 11.12.1、Ego Lite 0.6.3.17。验收主机 localhost，原实例主机127.0.0.1，Cookie 作用域分离。
- 结果：前端类型检查、完整 build/pack、Pakka 根类型检查和固定归档安装构建通过。源码 LSP 首次检查 clean；最终三文件复查两项 clean、一项 silent，编译结果独立通过。diff 检查通过。
- 行为：安装态键盘选择、保存后刷新读回、保留普通输入草稿、Escape 回焦、`/thinking` 菜单及 `/thinking low` 精确保存通过；模型请求为0。手机390/320无横向溢出，选项高度44px、入口44×44px。暗色和乌梅浅色实屏可读。
- 上线：正常停止并冷备份后重开原8854；715项服务资产逐项匹配。原 Proj 21条历史与用量逐字节一致，配置及控制Session身份保持一致，登录继续有效。真实实例只打开及关闭菜单。
- 范围：本轮沿用既有配置原请求和 unknown 核对路径，未再次注入丢失响应；无真实推理请求。初次验收服务错指旧归档和不存在的workspace check命令已纠正，原记录保存在本地。
- 完整本地证据包：`evidence.zip`，3,109,747字节，SHA-256 `aef60ba036101858943c27081689c606777e32d0108855b25beb3e96569aff6d`。原始证据不提交或上传。
