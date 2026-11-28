# Conversation 笔记与置顶配对验证

候选：Pakka 基于 `e475795f` 的本轮工作树，WebUI 基于 `847521e7`；实际源码身份与安装归档由 Pakka `integrations/webui/pairings/app-65f598476697a145.json` 固定。应用归档 SHA-256 为 `65f598476697a1452cbdcd9518213908890ae6c52d143b69b7c97bcab9375079`，要求 services 7 / workbench 3 / extensions 3。

环境：Windows、Node 24、Ego Lite 0.6.3.17；干净目录安装本轮 protocol/client/agent/runtime/server/config/webui 等八个包。隔离实例使用 localhost:8868，与实际 127.0.0.1:8854 的浏览器登录分开。

结果：两仓类型检查及构建通过；Pakka 所选 12 文件、35 项回归通过，覆盖个人模式、旧聊天、笔记/置顶、HTTP、客户端及原文引用。真实旧版数据升级保留旧笔记的正文、作者、版本和修改时间，删除后重开不会重新导入；旧聊天与原回执保持可读。安装版浏览器验证草稿关闭重开、保存、笔记置顶/取消、消息置顶和原文定位、刷新读回。注入保存成功后的响应丢失时，写请求一次、原请求查询一次、最终只保存一条笔记。390px/320px 无横向溢出，两个纯 SVG 入口均为 44×44px。隔离工具链使用两次本地确定性 provider 请求，未使用真实模型。

部署：8854 已更新，716 项 HTTP 服务资产与候选 manifest 完全一致。用户关闭原 PowerShell 后留下两个已退出 writer 记录，原数据和记录先保全，再用原生 `recover writer` 核对 PID/nonce 及 Session 后释放并重开；未更换 Session 或签发登录凭据。部署后未接管用户已结束的 Ego Lite 任务空间；浏览器交互结果来自同归档安装态，实际入口以 HTTP 资产核验。

范围限制：本轮执行所选回归和安装态场景，没有运行全仓测试或真实模型质量评估。完整本地证据包 `notebook-evidence.zip`，21,335,830 字节，SHA-256 `f43eed5ebe65b862e4e127c70ae94675bfe32ee6a25361cae7a1ed60c3a0e521`。原始证据仅本地保全。
