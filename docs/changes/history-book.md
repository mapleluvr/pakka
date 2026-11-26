# History Book 与 opt-in Historian

2026-11-10：用户批准设计并要求按 state-evo 展开实施。产品归属明确为 Dynamite 的独立 Book 读写服务，Memo 通过 Patchouli 复用产物并保存图书馆知识。采用每来源串行、每批独立原生 Conversation；业务域保存版本/进度/回执，独立服务域保存执行。原始设计调查发现现有 artifacts()/journalCache 全量物化及 Compresser 累计注册表，新增路径需要有界读取。

- 当前预期：[History Book](../state/history-book.md)。
- 完整变更：[proposal](../../openspec/changes/add-history-book/proposal.md)、[design](../../openspec/changes/add-history-book/design.md)、[tasks](../../openspec/changes/add-history-book/tasks.md)。
- Delta：[history-book](../../openspec/changes/add-history-book/specs/history-book/spec.md)。新能力尚待完成后归档到 main spec。
- 已有相关契约：[dynamite-persistence](../../openspec/specs/dynamite-persistence/spec.md)、[Compresser](../state/compressor-session.md)、[Memo](../state/memo.md)。

两轮独立交叉审查推动补齐退休终态、跨 Book 补注身份、版本范围授权、首次读取停机、来源预算与初始化清理。第二轮又明确了溯源祖先的最外层发布复查及外部来源续页的有序窗口绑定。沿该路径的受控补查又复现 Book 自身返回包装层与来源元数据的发布间隙；共同包装层和固定版本实体读集覆盖这些返回点，修正与独立失败用例见 tasks。

第三轮两份已完成的首轮意见又指出子引用的末级授权与原生工具异步包装后的权限失效。交叉质询因 provider 历史响应 resource 不匹配而中断，保留原 BLOCK 意见，不视为完整复审。修正以同一 Client 的原冻结结果绑定同步发布校验，由来源与工具在最终返回前核验；只保存规范化引用与校验，不复制正文或积累结果缓存。

扩大回归还暴露 runner 未沿用 product fixture 的隔离目录契约，以及 C2 对照遗漏新增 Session 辅助 head。修正隔离装配和测试对照，保留真实原生记录检测与独立红测，不修改宿主产品实现。

## 2026-11-12：独立能力与消费适配的前提澄清

在 provide-as-is 回查之后，用户明确 package/repo 拆分的根本依据：上游向通用下游负责最小而充分的能力，下游负责实际适配；必要时可以演进能力设计。用户同时明确 Memo → Dynamite/MAS（opt-in RSI/EI）、Dynamite → MAS（opt-in EI）、RSI → EI/MAS。此处箭头表示依赖方到被依赖方。该规则采用于[仓库规范](../development/MONOREPO-CONVENTIONS.md#21-独立能力与下游适配)，本轮设计与 tasks 按其接续。

此前把单向依赖主要解释为无反向 import 或将适配文件移包，未充分区分上游能力充分性和下游组合责任。后续应先列实际所需能力及其公开提供者，再判定是上游契约/能力问题，还是下游适配问题；不能把“上游保持 provide-as-is”误解为能力永远不变，也不能由某个下游失败直接指定上游新增接口。

本次采用的是架构前提，不是所有依赖关系已经实现的验收结论，也不构成改写 Historian 执行、依赖元数据或现有持久化机制的实施结果。既有回查实验与 reviewer 报告保留原事实，具体修正按重新明确的职责落位。

## 2026-11-12：先完成 Memo 的依赖与消费职责

用户指定先处理 Memo。核对真实公开端口后，Book 的目录、固定版本、实体、回源与同步读权检查已充分；不需要新增 Dynamite 专属接口。Memo 的书库身份、分享策略、字段转换及导航移到 `@pakka/memo/dynamite`，Dynamite 移除原适配导出及实现。MAS 继续由 Memo 现有公开驱动消费，RSI/EI 保持独立 opt-in。

真正修复的消费缺口是：结果复制或异步包装后仍要保留实际对象的当前授权。Memo 在转换 provider 结果前取同步校验，传过自己的 read/search、Patchouli 过滤与原生最终返回；独立 Wiki 正文不因引用目标撤权而变成不可读。旧引用连带检查的假设不再作为新 state/spec 的要求，但 Dynamite 本体的相关实现及测试仍待下一切片修正；下游没有绕过上游现有拒绝。

本切片通过核心＋Memo 115 项、安装版来源契约 12 项、独立 Memo 261 页及重开、独立 Book 和真实图书馆组合；构建、严格类型与指定 OpenSpec 检查通过。完整结果和测试分类见 tasks，完整两仓源码审查与 PR 尚未完成。

验证结果随 tasks 记录；当前切片完成不意味着整体 History 交付完成。原始证据本地保留，交付摘要仅记录关键结果与证据包整体 SHA-256。

## 2026-11-12：获准的非 Board 整改

全仓问题收集后，用户授权 A-1/A-2/A-3/A-4/A-5/B-2，暂缓 MAS Board 至独立重构。A-1 按 Dynamite 自身契约修正 Book 正文、图和保存引用的授权，并保存版本化来源键快照；实际回源仍拒绝无权目标。A-2 由 Memo 原生 `research_finish` 返回层复查工具包、invocation 及原结果；A-3 由 HTTP transport 在 dispatch 后复查 issuer；A-4 由 RSI 公共层核验最终结果；A-5 分别由 Agent 历史查询与 Dynamite 状态读取复查自身读权。读取失权拒绝发布，已提交写入失权保留 unknown 和原业务回执，不回滚或重放已生效动作。

六个原始发布反例先在正式回归中失败；Book 又以引用失权、目标不可用、索引替换、重开和后来装配来源端口作对照。新文件仍按真实 SQLite/native/HTTP 归 heavy，选用核心＋Memo/RSI/History及四个 HTTP 文件；没有混入 Board、执行层重构、UI/OOM 或付费模型试验。EI 独立文档工作树先逐项保全 23 个原文件，核验后移出 21 项原始材料并保留历史摘要；EI 产品、类型、测试、脚本和锁文件的 24 个选定文件与原审查候选字节一致。

源码与选用测试已有绿色结果，固定安装组合和指定八阶段复审继续执行。旧 review、原始失败和两次 Windows native crash 保留各自时点，不因本轮局部整改改变结论。完整结果随 tasks 与最终验证摘要登记；原始材料只在受限本地包保全。
