# Tasks

## 修订

- [x] 保存初步审查与执行安排，核对当前文件和未提交工作。
- [x] 建立补丁默认生产版本的真实脚本回归，观察红灯并实现修复。
- [x] 归档已完成 SQLite change，同步主规格和引用。
- [x] 对齐当前存储、分页、创建、设置和授权说明。
- [x] 清理入口、手册与集成说明的阶段／验收／计划混写。
- [x] 以 MODIFIED delta 收敛主规格中的历史表述，按生命周期归并。

## 检查与交付

- [x] 复读产物层，核对保留的运行边界与来源身份。
- [x] 执行聚焦脚本回归、格式、引用／锚点与 OpenSpec 检查。
- [x] 记录实际结果并更新接续入口。

## 实施与检查记录

- 初步发现、逐篇清单、执行安排和原始检查输出位于 `docs/.temp/product-doc-review/`。SQLite 变更经 CLI 归档，主 Runtime 的 legacy migration 要求按采用 delta 移除；归档原有验证结论与包身份保持不变，仅调整移动后的引用。
- 使用手册对齐 SQLite 重开、公开分页、专用设置页、独立创建和批准权限；开发规范直接保存 Memory／通知限制与维护方法。集成入口按固定配对和契约组织，原形成经过仍在固定记录中。
- 补丁脚本省略版本时读取生产 manifest。新回归先暴露四项失败；修正脚本与旧测试 fixture 后，九项聚焦回归通过，生产及 1.0.3 固定归档完整性核对通过，`npm run check` 通过。
- 当前五个代码路径的 LSP 未发现类型错误；移除了新测试的 unused import。辅助 Semgrep 对构建脚本既有 `spawnSync(command, args)` 提示风险；已核对其受信调用使用独立参数、不启用 shell，本轮不改变该调用机制。
- 格式与引用检查通过：覆盖 72 份文档、450 个相对引用和 35 个 heading fragment。补齐两份新增主规格的 Purpose，并同步旧 WebUI delta 的 SQLite 重开／原生命令场景，消除归档丢失采用条件的错误。
- 受影响主规格与 WebUI change 的 strict 通过。全量 strict 为 18 项通过、6 项未过；未过项合计 10 条 requirement 超长 WARNING，无 ERROR。这六份文件经 `git diff --quiet HEAD` 确认为未修改文件。另有 project-documentation MODIFIED 依赖尚未归档的基础 change 的 INFO，保留其生命周期顺序。完整结果在本地 `post-sync-strict.log`；没有将全量 strict 标为通过。
