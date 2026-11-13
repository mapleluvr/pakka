# 2026-11-13：History 候选分支与独立插件重构参考

## 本阶段保存的范围

用户要求把已有改动提交、推送到各自工作分支，不创建 PR、不合并、不发布 npm。以下分支是开发候选参考：

| 仓库                                                                            | 工作分支                    | 实施来源基线                             | 范围                                                                |
| ------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| [Pakka](https://github.com/mapleluvr/pakka/tree/pakka/history-book)             | pakka/history-book          | cc1cdd8aead42cd0afe018c75973f09fd369184d | 宿主持久/历史能力、Memo 消费、RSI/HTTP 等限定整改、测试与设计交接。 |
| [Dynamite](https://github.com/mapleluvr/pakka-dynamite/tree/pakka/history-book) | pakka/history-book          | e074c14c15b423f4b094d11c1e94a297fa99c116 | Book、Historian、普通 Agent 工具、自身授权与消费示例。              |
| [EI](https://github.com/mapleluvr/pakka-ei/tree/pakka/verification-evidence)    | pakka/verification-evidence | 8cdd69aadb1459ded79d02dd0e5b65ef49a5af71 | 验证摘要/本地证据治理，产品字节未改。                               |

基线是实施来源，不是包含新实现的提交号。分支用于查看源码和公开能力；消费者固定自己实际读取的 commit/安装归档，不把同一包版本号当作字节身份，不把本次 push 当作 release 或全体验收。

2026-11-13 已完成三仓的提交、推送及实际远端 ref 核对。初次实现保存点如下；Pakka 后续仅补分支交接文档，不改变已验证的产品/测试字节，也不倒写固定验证归档身份：

- Pakka：[0a4e2865c2717bc32d62e47d5e7321146f5bfa22](https://github.com/mapleluvr/pakka/commit/0a4e2865c2717bc32d62e47d5e7321146f5bfa22)。
- Dynamite：[445f7063dd6585b692c9f3877a58618a6117bbc8](https://github.com/mapleluvr/pakka-dynamite/commit/445f7063dd6585b692c9f3877a58618a6117bbc8)。
- EI：[58cb5c8d59e444e8c0307ad1fe8d83e3dfe67dcd](https://github.com/mapleluvr/pakka-ei/commit/58cb5c8d59e444e8c0307ad1fe8d83e3dfe67dcd)。

完整初次暂存范围分别为 86/33/30 文件；非文档原始字节逐项对照审查候选，无漂移。文档格式、15 份文档的 127 个本地链接/10 个锚点及三个相关 OpenSpec strict 通过；两份既有本地证据包整体 hash 再核对一致。没有新建 PR、更新 main/dev、发布 npm 或上传原始证据。

## 实现与验证的位置

Book/Historian、宿主页式产物/历史工作及真实 Memo/Patchouli headless 消费已实现并经多轮实际验证。Dynamite 是 Book 服务所有者，Memo 适配已移到下游。非 Board 授权整改及最后 RSI mutation 窗口修正完成；Board 继续暂缓。

关键结果和本地证据包整体 hash 见[整改验证](../verification/REVIEWED-PUBLICATION.md)，各历史候选、旧 BLOCK 和 Windows 全量子进程失败保持原时点。原始日志、TAP、逐文件清单、依赖树及证据包均只在本地保全，不随分支上传。产品安装归档 hash 与证据包 hash 分开记录，历史归档不倒写新提交号。

最后八阶段双方 OK with notes 限 RSI 六文件修正，不能称为整包 release 放行。整包组合审查/收口、Historian 对 MAS 的能力映射、未分类 Windows 子进程退出和 GUI 仍有未关闭事项。接续见[History 任务](../../openspec/changes/add-history-book/tasks.md)及[整改任务](../../openspec/changes/fix-reviewed-publication/tasks.md)，不默认重跑全部历史验证。

## 新采用的发布/插件边界与待实现需求

用户明确 pakka-webui 将独立于 monorepo 发布；RSI、MAS、Memo 通过插件实现自己的可视化、业务控制及管线。通用宿主默认有足够公开能力，不把领域模型耦合进核心。本分支仍保留旧 apps/webui 作为当前实现/兼容参考，未搬迁目录或发布独立产品。

[通用插件能力需求](../requirements/WEBUI-PLUGIN-CAPABILITIES.md)面向远端重构规划；[RSI 原工作与报告](../requirements/RSI-WORK-REPORTS.md)是消费侧领域设计。报告/状态分离核心已获认可，具体接口、贡献关系和修订尚待设计，当前代码仍追加 reported 事件并推进 state。通用 Session 浏览与交接 UI 也未据此获得验收。

形成与任务见[独立插件规划](../../openspec/changes/plan-independent-webui-plugins/proposal.md)、[设计](../../openspec/changes/plan-independent-webui-plugins/design.md)、[任务](../../openspec/changes/plan-independent-webui-plugins/tasks.md)和[扩展场景](../../openspec/changes/plan-independent-webui-plugins/specs/webui-extensions/spec.md)。现有扩展场景入口为[活动 WebUI change](../../openspec/changes/pakka-webui/specs/webui-extensions/spec.md)，暂无独立主 spec；新规划未归档为已实施产品。

本阶段只保存已有候选和设计接续，不要求远端复制本工作树、把 RSI 页面写入 WebUI 核心，或自动实施/合并所有外围功能。
