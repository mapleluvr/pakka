## Context

现行契约见 proposal。SourceJob 的同一次调用已具备 source/job/lease 校验、持久预算 reservation、completion 和精确 artifact adoption receipt；Durable adapter 是唯一 Pi 可变对象边界。Dynamite 原设计 §3.2 以工具提交 P1、联合 P2/P3 和 P4，图合并和语义校验仍是独立问题。

## Goals / Non-Goals

Goals：通过公开 Pi API 完成一次辅助 Tool Calling；让结构化结果沿现有权限、预算、失败和采用路径进入独立策略。

Non-Goals：本轮不新增可执行辅助工具循环、文件/网络取证权限、图合并、语义评分或默认产品启用；保留原来明确批准的产品配对范围。

## Decisions

- 使用可选 outputTool（name、description、JSON Schema parameters）和 toolCall（id、name、arguments）DTO，限定一次回答恰好一个所声明调用。相比任意 tools/execute loop，这满足生产提交且不引入新的工具执行权限。
- Pi tools/context 使用公开 API；提示词要求调用且结果门拒绝普通文本，不依赖所有 provider 均提供强制 toolChoice；公开工具流的参数 delta 须构成完整 JSON 且与最终 DTO 精确一致，再经过公开 schema 校验并拒绝隐式类型转换；缺失完整 delta 或 SDK 自动修复的参数闭锁。stop/text、错误名称、多调用、截断或无效参数得到 failed 和实际 usage；已撤权结果仍 quarantined。
- Dynamite 使用 compressionFormat: text | tool，默认 text。tool 模式的 submit_compaction 同时提交 summary、graphs（nodes/edges/annotations）、clues、unresolved；每个事实项引用宿主提供的 entry IDs。宿主既有 source scope 与版本绑定替换范围，模型不能修改目标/快照身份。
- P2/P3/P4 放入现有 block 的可选 artifacts 字段，与 run/block 通过同一个 artifact transaction 和 exact attempt ID 持久化。读取返回当前 branch 中的冻结 DTO，并标识来源是否仍匹配；reduce 仅控制 P1 请求驻留。
- 版本采用 agent@0.5.1 与 dynamite@0.3.0，分别固定新归档；旧配对文件按原字节保存为历史。新能力支持以新消费者证据为依据。

## Risks / Trade-offs

- schema 合法并不证明事实/因果正确 → 提示词保留历史、计划、观察和不确定性，证据只声明机械生产与持久化。
- 多产物增加输出量 → 有限 output cap、schema 长度/条数和整体字节界限；截断拒绝采用。
- 恢复时 artifacts 损坏可能被旧 codec 忽略 → 可选字段存在即严格解码，损坏闭锁。
- 主线继续增长或编辑 → 沿用精确目标/上下文版本；尾部正常增长可接受，编辑/ABA/撤权后迟到产物不激活。

## Migration Plan

先取得宿主真实 HTTP 的 RED，再实现并构建固定归档；Dynamite 在该公开新归档上取得自身 RED/GREEN、安装消费者和独立复审证据。文本模式保持现行行为。两个包继续私有，交付不包含 push 或 publication。
