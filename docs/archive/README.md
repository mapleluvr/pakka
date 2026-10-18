# Deprecated 历史资料

这里保存已由当前指南、契约或新版设计接替的材料。**Deprecated 指作为当前使用／实施指引的地位**；各版本的验收、失败、来源和约束仍按其原范围保留。

日常使用从[文档导航](../README.md)或[当前产品状态](../PAKKA-POCKET-STATUS.md)开始；继续设计使用[MAS Board 第二稿](../MAS-BOARD-DESIGN.md)，当前范围见[实施计划](../plans/README.md)。

## 分类索引

### 早期迁移计划

- [PLAN.md](plans/PLAN.md) — 原路径 `docs/PLAN.md`，最早的 host slice 计划。
- [PI-DURABLE-MIGRATION-PLAN.md](plans/PI-DURABLE-MIGRATION-PLAN.md) — 原路径 `docs/PI-DURABLE-MIGRATION-PLAN.md`。
- [MONOREPO-MIGRATION-PLAN.md](plans/MONOREPO-MIGRATION-PLAN.md) — 原路径 `docs/MONOREPO-MIGRATION-PLAN.md`。

### 迁移调查与历史延期

- [MIGRATING-DYNAMITE.md](investigations/MIGRATING-DYNAMITE.md) — 原路径 `docs/MIGRATING-DYNAMITE.md`。
- [DEFERRED-DYNAMITE-COMPATIBILITY.md](investigations/DEFERRED-DYNAMITE-COMPATIBILITY.md) — 原路径 `docs/DEFERRED-DYNAMITE-COMPATIBILITY.md`。

### M1–M6 固定阶段验收

- [MIGRATION-M1-ACCEPTANCE.md](acceptance/MIGRATION-M1-ACCEPTANCE.md) — 原路径 `docs/MIGRATION-M1-ACCEPTANCE.md`。
- [MIGRATION-M2-ACCEPTANCE.md](acceptance/MIGRATION-M2-ACCEPTANCE.md) — 原路径 `docs/MIGRATION-M2-ACCEPTANCE.md`。
- [MIGRATION-M3-ACCEPTANCE.md](acceptance/MIGRATION-M3-ACCEPTANCE.md) — 原路径 `docs/MIGRATION-M3-ACCEPTANCE.md`。
- [MIGRATION-M4-ACCEPTANCE.md](acceptance/MIGRATION-M4-ACCEPTANCE.md) — 原路径 `docs/MIGRATION-M4-ACCEPTANCE.md`。
- [MIGRATION-M5-ACCEPTANCE.md](acceptance/MIGRATION-M5-ACCEPTANCE.md) — 原路径 `docs/MIGRATION-M5-ACCEPTANCE.md`。
- [MIGRATION-M6-ACCEPTANCE.md](acceptance/MIGRATION-M6-ACCEPTANCE.md) — 原路径 `docs/MIGRATION-M6-ACCEPTANCE.md`。

### WebUI P0–P5 阶段快照

- [PAKKA-POCKET-P0.md](webui/PAKKA-POCKET-P0.md) — 原路径 `docs/PAKKA-POCKET-P0.md`。
- [PAKKA-POCKET-P1.md](webui/PAKKA-POCKET-P1.md) — 原路径 `docs/PAKKA-POCKET-P1.md`。
- [PAKKA-POCKET-P2.md](webui/PAKKA-POCKET-P2.md) — 原路径 `docs/PAKKA-POCKET-P2.md`。
- [PAKKA-POCKET-P3.md](webui/PAKKA-POCKET-P3.md) — 原路径 `docs/PAKKA-POCKET-P3.md`。
- [PAKKA-POCKET-P4.md](webui/PAKKA-POCKET-P4.md) — 原路径 `docs/PAKKA-POCKET-P4.md`。
- [PAKKA-POCKET-P5.md](webui/PAKKA-POCKET-P5.md) — 原路径 `docs/PAKKA-POCKET-P5.md`。

### 累计与逐轮验证记录

- [VERIFICATION.md](verification/VERIFICATION.md) — 原路径 `docs/VERIFICATION.md`。
- [PAKKA-POCKET-LINUX.md](verification/PAKKA-POCKET-LINUX.md) — 原路径 `docs/PAKKA-POCKET-LINUX.md`。

### 设计旧稿

- [MAS-BOARD-DESIGN.v1.md](design/MAS-BOARD-DESIGN.v1.md) — 原路径 `docs/MAS-BOARD-DESIGN.v1.md`。

### 试写与复核经过

- [MAS-BOARD-REVISION.md](reviews/MAS-BOARD-REVISION.md) — 原路径 `docs/MAS-BOARD-REVISION.md`。

## 迁移与保留规则

本轮迁移 35 份文档：21 份历史资料进入本目录，其余 14 份按当前用途进入 guides、reference、development、plans 或 verification。历史页增加 Deprecated 状态和现行入口，正文保留；相对链接随位置修正。早期试写的冻结哈希对应迁移前原始副本，带归档标识的阅读版本另有自己的文件身份。

Pi Durable 兼容性账本保持追加式正文原样；正在阅读／编辑的 MAS Board 第二稿保持原路径和字节内容。下列旧路径只保留简短迁移指引，以维持两份稳定文档中的既有引用：

- [`docs/MIGRATION-M3-ACCEPTANCE.md`](../../docs/MIGRATION-M3-ACCEPTANCE.md) → [MIGRATION-M3-ACCEPTANCE.md](acceptance/MIGRATION-M3-ACCEPTANCE.md)。
- [`docs/MIGRATION-M4-ACCEPTANCE.md`](../../docs/MIGRATION-M4-ACCEPTANCE.md) → [MIGRATION-M4-ACCEPTANCE.md](acceptance/MIGRATION-M4-ACCEPTANCE.md)。
- [`docs/MIGRATION-M5-ACCEPTANCE.md`](../../docs/MIGRATION-M5-ACCEPTANCE.md) → [MIGRATION-M5-ACCEPTANCE.md](acceptance/MIGRATION-M5-ACCEPTANCE.md)。
- [`docs/MAS-BOARD-REVISION.md`](../../docs/MAS-BOARD-REVISION.md) → [MAS-BOARD-REVISION.md](reviews/MAS-BOARD-REVISION.md)。
- [`docs/MAS-BOARD-DESIGN.v1.md`](../../docs/MAS-BOARD-DESIGN.v1.md) → [MAS-BOARD-DESIGN.v1.md](design/MAS-BOARD-DESIGN.v1.md)。

OpenSpec 的规范、活动变更与其历史继续由原目录及工具管理，本次文件整理没有执行变更归档。仍被显式可选产品配对引用的 [Dynamite 有界验收](../verification/DYNAMITE-PRODUCT-ACCEPTANCE.md)保持当前证据角色。

本轮整理的原始文档副本、原工作树 diff、迁移清单和检查结果保存在开发机的 `pakka-evidence/documentation-reorg-r1/`。这些外置文件用于核对迁移；历史验收正文中的产物身份继续是对应版本的依据。
