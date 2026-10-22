# Dynamite 兼容性：延期记录与功能目标

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前产品状态](../../PAKKA-POCKET-STATUS.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

历史配对状态：**deferred / failed，不是 passed**。M6 核心已完成；后续 `agent@0.5.0 × dynamite@0.2.1` 的显式可选产品配对已在 [限定范围](../../verification/DYNAMITE-PRODUCT-ACCEPTANCE.md) 带 notes 验收，不覆盖本文件的历史失败身份，也不默认启用或承诺未验证组合。用户明确要求先完成 Pakka monorepo / MAS 迁移，再回到 Dynamite。该决定只解除 Dynamite 作为 M1–M6 核心迁移的前置门禁；不解除 agent、权限、持久化、恢复、native protocol 或隔离安装的其他验收条件。Dynamite 不作为迁移期间的默认策略或已支持功能。

入口：[迁移计划（外置备份）](../../verification/DOCUMENTATION-CLEANUP.md#备份与恢复)、[固定配对门禁](../../../integrations/dynamite/README.md)、[仓库规范](../../development/MONOREPO-CONVENTIONS.md)。保留外部仓库 `mapleluvr/pakka-dynamite`，不更名 `@pakka/agent`。

## 1. 已确认问题与证据

- 固定外部 commit：`5ff775aee041fe63a82a7fcd1d108d17c206da4e`，`@pakka/dynamite@0.1.0`。
- 被测 Pakka 生产基线：`6c77632`；门禁 checkout：`84bffb141bc610ed0c322e081c192a0e39508c4b`；Durable：`1.0.3-pakka.1`，构建 hash 见 `integrations/dynamite/pairing.json`。
- 原始运行：`artifacts/dynamite/run-JVQkFr/`；加固后的复跑：`artifacts/dynamite/run-pANLhY/`。后者保留两个实际 tarball、命令日志、HTTP payload、原始 Durable storage 和两轮只读复审。
- 安装后的 host smoke 通过 7 次本地 HTTP，原有 Pakka 回归 127/127；Dynamite 行为矩阵 **1/6 通过、5 失败**，无 skip/todo/cancelled。门禁自身 8 项反例通过，不改变这五项真实失败。
- 外部 `src/pakka-adapter.ts` 的 `toRuntimeFrame()` 只从旧 `message/custom_message` 取消息，不能从 Durable `pi.*` entry 的 `raw.model[]` 提取消息。编号缺失，`reduce("#1")` 无目标，压缩没有形成摘要候选，恢复测试在初始 reduce 处失败。step/compaction/boundary 映射也需要按真实新契约核对。

上述数字仅描述固定历史配对，不能被复用为迁移后版本的结果。迁移可以改变公开 DTO、namespace、版本和生产 graph；恢复此项时必须更新双方受支持版本、构建身份和 pin，再运行实际消费者。若旧 pin 已不匹配新 agent，门禁继续非零退出，不能把配置/安装失败算作兼容通过。

## 2. 保留的功能目标

| 编号  | 目标                                                         | 必需的实际效果证据                                                                                                                             |
| ----- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| DC-01 | 明确、版本化的 entry / raw-message / model-contribution 映射 | 安装产物从真实 Durable frame 得到正确消息；不依赖私有 Pi 类型、读取 storage 或伪造旧 raw records                                               |
| DC-02 | 编号与 source provenance                                     | 下一次本地 HTTP 的编号与来源对应真实 entry；excluded/system/host boundaries 保留，不给无效或不可写记录授予目标权                               |
| DC-03 | step、turn、compaction、fork/navigation 边界                 | 使用真实多轮与分支记录验证候选范围，不跨受保护边界、不把别的 Conversation 当作当前上下文                                                       |
| DC-04 | reduce / flush / omission                                    | 被接受目标在下一次 wire 中正确省略；原始历史保留；拒绝路径无额外 dispatch 或写入                                                               |
| DC-05 | 压缩与摘要 adoption                                          | 实际候选触发受控辅助 inference，64/128 output cap 到达真实 HTTP；只在 scope/source 仍有效时采用摘要                                            |
| DC-06 | native tool-call/result 完整性                               | 真实工具回合保留 call identity、name、arguments、对应结果和顺序；非法 patch/range 在 provider 之前阻断                                         |
| DC-07 | source edit / ABA / tail growth                              | 源或前文修改、导航 ABA 撤销旧 job；无关尾部增长按已声明契约处理；旧结果不取得新写权                                                            |
| DC-08 | reload / reopen / rehydration                                | 同一合法历史与 strategy journal 可恢复；旧 capability/lease/invocation 不复活，不重放旧辅助花费                                                |
| DC-09 | Conversation namespace 与并发                                | 同一 Session 的两个 Conversation 可使用相同 strategy ID，记录、projection、job、permit、预算与 receipt 不串用                                  |
| DC-10 | unknown-storage / late completion / cancellation             | 未知持久化或已请求 abort 不被当作回滚/未送达；保留未知费用和失败 scope，迟到结果被隔离                                                         |
| DC-11 | 权限、预算与可选启用                                         | Dynamite 经 principal-bound StrategyBinding 工作；没有 grant 时零未授权 HTTP/写入；导入或安装不自动授予 owner / model.infer                    |
| DC-12 | 真实发布图与产品装配                                         | 更新外部 peer/dev 配对，安装实际 tarball，无 root overrides/workspace/private imports/oracle；迁移后的 server/MAS 按 Conversation 显式选择策略 |

这些目标保留原 M0 完整退出矩阵，并补上迁移后必需的多 Conversation 作用域。初始六项消费者回归不能替代 DC-01–DC-12。

## 3. 迁移期间的规则

1. 保留 `integrations/dynamite/`、固定输入、失败断言和原始证据；不改成 expected pass，不删除失败用例、不跳过后声称通过。
2. 迁移阶段的常规 agent/MAS/DevPack/server/CLI 验收不依赖这个已延期的外部组件；独立报告核心结果与 Dynamite 状态。
3. 迁移中若涉及公开 DTO、namespace 或版本变化，记录对 DC 目标的影响，不在此阶段修改外部算法或兼容 mapper。
4. 不默认装配 Dynamite；明确拒绝依赖未实现兼容能力的配置，不能静默换用另一种算法或把全部 transcript 拼到 prompt。
5. 所有其他 fail-closed 与独立 review 门禁继续生效。延期仅适用于本文件列出的外部兼容工作。

## 4. 完成迁移后的恢复顺序

1. 从迁移后的公开 agent contract 和真实 frame 固定受支持映射；在明确的 producer DTO 或外部 adapter 中实现，不改已安装 dependency。
2. 在外部仓库修复并建立版本/commit；更新 peer/dev artifact 与 `integrations/dynamite/pairing.json`，保留此前失败身份。
3. 对 DC-01–DC-12 补齐失败先行回归，先运行定向真实 Durable / 本地 HTTP，再运行完整消费者和产品装配。
4. 进行限定轮次的独立只读对抗复审。只有实际新产物和完整效果矩阵通过后，才把本项从 deferred 改为 accepted，并决定是否作为可选/默认策略启用。

恢复工作仍不包含全部旧 Kappa 数据导入、全 provider 兼容、任意 Pi extension 或共享 storage 多 writer。
