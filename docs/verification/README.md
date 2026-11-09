# 固定版本验证记录

本目录只保存按版本和环境限定的关键信息，以及完整本地证据包的包名、字节大小和整体 SHA-256。原始验证证据与证据包在本地保留，不上传 GitHub；云端存储由用户处理。包内逐文件清单、原始日志/TAP、截图和重复候选输出不进入本目录，执行步骤见[本地证据包](../development/VERIFICATION.md#验证记录与本地证据包)。通用方法在[验证工作方式](../development/VERIFICATION.md)，当前工作由 [OVERVIEW](../OVERVIEW.md)和所指 OpenSpec tasks 承接。

| 核对对象                        | 记录                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| #4/#6 干净交付重组              | [原候选覆盖、本地保全与替代 PR](CLEAN-DELIVERY-REORGANIZATION.md)                                            |
| 本地验证证据提交规范            | [文档、ignore 与产物检查](LOCAL-EVIDENCE-POLICY.md)                                                          |
| 有界观察、原文与 DOM 懒加载     | [冷打开、333 ms 增量、原长历史与固定安装消费](BOUNDED-LAZY-OBSERVATION.md)                                   |
| 本机登录、冷备份与升级恢复      | [维护内核、真实故障与安装升级/回退](LOCAL-MAINTENANCE-DELIVERY.md)                                           |
| 长期投递与原请求核对            | [累计门槛解除、旧格式迁移与安装消费](LONG-LIVED-DELIVERIES.md)                                               |
| Pi 原生配置与默认 WebUI 入口    | [Runtime 演进、Session 隔离与安装消费](PRODUCT-RUNTIME-LAUNCHER.md)                                          |
| ExecutionEnv / 1.4.0-pakka.2    | [.2 复建、切换与安装消费](EXECUTION-ENVIRONMENT-PAKKA-2.md)                                                  |
| ExecutionEnv / 1.4.0-pakka.1    | [初轮执行环境接入与安装消费](EXECUTION-ENVIRONMENT.md)                                                       |
| WebUI Invite Role 菜单/紧凑布局 | [邀请角色菜单记录](WEBUI-INVITATION-ROLE-MENU.md)                                                            |
| WebUI 分组菜单与创建入口        | [菜单/入口记录](WEBUI-NAVIGATION-CONTROLS.md)                                                                |
| WebUI 情境文案精简              | [文案验证](WEBUI-COPY-SIMPLIFICATION.md)                                                                     |
| WebUI 独立创建与分组            | [创建与分组记录](WEBUI-SESSION-CREATION.md)                                                                  |
| WebUI 模型目录与权限精简        | [模型权限记录](WEBUI-MODEL-PERMISSIONS.md)                                                                   |
| Model Selection 检索索引        | [模型索引记录](WEBUI-MODEL-INDEX.md)                                                                         |
| WebUI 组合发送按钮 Tab 焦点     | [组合按钮焦点记录](WEBUI-SPLIT-BUTTON-FOCUS.md)                                                              |
| WebUI 排版、SVG 与焦点          | [排版整检记录](WEBUI-TYPOGRAPHY-SVG.md)                                                                      |
| WebUI Conversation/composer P0  | [P0 记录](WEBUI-INTERACTION-P0.md)                                                                           |
| Devin 接入 R2、固定候选 004     | [R2 记录](DEVIN-FRONTEND-R2.md)                                                                              |
| MAS Board r1 实现和后续专项     | [MAS 记录](MAS-BOARD-R1.md)                                                                                  |
| Compressor Conversation 隔离    | [独立计数、并发与故障域验证](COMPRESSOR-CONVERSATION-ISOLATION.md)                                           |
| Compresser native 第一版试行    | [隔离修正后的固定配对](COMPRESSER-SESSION-TRIAL-ISOLATION.md)                                                |
| Compresser native 会话调查      | [固定基础设施刻画](COMPRESSOR-SESSION-FEASIBILITY.md)                                                        |
| Dynamite Tool Calling 库候选    | [受控输出验证](AUXILIARY-TOOL-OUTPUT.md)                                                                     |
| Dynamite 已接受的有界配对       | [配对记录](DYNAMITE-PRODUCT-ACCEPTANCE.md)、[机器配对身份](../../integrations/dynamite/core-m6-pairing.json) |
| 2026-10-21 文档清理与外置恢复   | [清理记录](DOCUMENTATION-CLEANUP.md)                                                                         |
| 更早阶段                        | [历史资料索引](../archive/README.md)                                                                         |

## 静态调查（不构成产品验收）

- [UI 澄清文案调查](WEBUI-COPY-AUDIT.md)：全仓前端及内置扩展的删除建议、待用户决定项和应保留状态；尚未批量采用或删改。

当前补丁的产物与行为见 [Durable state](../state/durable-patch.md)，兼容性变化查[追加式账本](../PI-DURABLE-COMPATIBILITY.md)。视觉运行目录 `docs/visual-primitives/` 是本机工作材料；保留报告对其原版本的引用使用固定 Git 链接。
