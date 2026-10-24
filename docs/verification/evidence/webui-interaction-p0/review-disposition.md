# P0 复核处置（非双评通过记录）

## 评审身份与失败

原候选：`5f43d9d1dceced674fff6c565ebf59a9e2ee9cc4`。指定 workflow：`D:/Pi/extensions/pi-adversarial-review/workflows/adversarial-review.js`，run `d0e34e5c-efec-4088-869d-36c5ff5695ad`。

[A 的完整原文](5f43d9d/reviewer-a.md) 保留原始 BLOCK 结论。B 启动即失败：`Unknown subagent model 'Mapleluv-ChatCompletions/deepseek-flash:high' in the active Pi model registry.` [完整失败回执](5f43d9d/workflow-receipt.json) 已保留；**没有 B 意见、双方讨论或组合通过结论**，没有替换模型或 reviewer workflow。Atnor/Kairos 的只读复核不冒充 B。

## 逐项处置

| 项 | 核验及处置 |
| --- | --- |
| A-1 | 成立。真实 provider 400 的 `model_error` 和真实 queued/withdraw 的 `aborted` 均被旧 badge 硬编码成 blocked。先收紧测试取得两条 RED；修为只认原 DTO 精确 `blocked`/`aborted`，其余中性 not delivered，缺省 reason 不造属性值。 |
| A-2 | 对当前原生路径反驳。固定 Durable `generation.js` 的 `startToolRound`（548–582）在同一次 commit 内 appendAssistant、创建工具任务、删除 live.generation 并赋值 live.tools；`finishToolRound`（584–641）先清 tools 再交给下一 generation。同一调用不存在 A 假设的 partial 与 live.tools 重叠。新分块测试在 partial 期确认该工具尚未出现在 live.tools，旧测试在工具 running 期证明持久声明存在而 live.message 不存在。Atnor 独立只读核验了原子顺序。未加入不可达分支。 |
| A-3 | 症状成立，修法收窄。真实 SSE partial toolCall 展开后放行终态，在第一次工具 running 时旧实现 count=1/open=false/same=false。原因是 live Message 与持久 section 的父链不同，不是仅缺静态 key。统一 section 渲染序列并使用来源/首个调用键，工具子卡使用来源/调用键；GREEN 为 count=1/open=true/same=true，结果仍归同卡。没有伪造 entry、调度或原生状态。 |
| A-4 | 成立。原生工具实际 throw 产生 isError:true；旧折叠卡虽保存数据，却无显式失败标识。加入真实工具回归，确认 RED 后在 summary 增加由 isError 驱动的 error 文本，使用既有 danger token；替换同色死规则。审批 denied 是普通工具返回，不能冒充原生 isError 的证据。 |
| A-5 | 维护性建议保留，比例论断不成立。A 自列 244+64=308 行，而 308/754≈40.85%，并非超过一半；其 seed 行号亦与候选不符。真实 JSONL seed、公开 Host source 和 SSE provider 用于不绕过生产路径，不是伪造 HTTP DTO。新测试仅为 A-3/A-4 增加已复现边界，没有为“减少行数”抽取无新消费者的通用框架。 |

Kairos 先前 r5 报告未覆盖 receipt 分支，不能抵消 A-1；其后已独立静态确认 A-1 和 A-3。对于自由文本 reason 的额外两条建议，保留中性 fallback 和缺省属性省略，不从散文推断撤回、不造 unspecified，Kairos 已撤回其两项建议。

## 可复跑证据

- [旧产品代码上的四条 RED](5f43d9d/followup-red.txt)：验收 worktree 固定原 SHA，仅覆盖新测试文件后运行；4 tests/0 pass/4 fail/exit 1。结束后恢复测试文件，产品代码及验收树均未遗留改动。这不是旧 SHA 原测试集失败，而是新回归揭示旧代码缺陷。
- 原 SHA 独立全量：616 tests/614 pass/0 fail/2 skip/exit 0，见 [原始输出](5f43d9d/full-suite.txt)。两个 skip 为既有 Windows/POSIX 条件测试；绿色旧集并未覆盖后来找到的问题。
- 修复后工作树：A-1 相关 9/9；A-3/A-4 真实新用例 2/2。固定新 SHA 的全量、独立渲染和修复复验结果以 [验证主记录](../../WEBUI-INTERACTION-P0.md) 为准，不沿用旧候选结论。
- d966f7f 的隔离全量 618/615 pass/1 fail/2 skip，失败原始输出已保留。Atnor 又独立复现 A3 测试竞态（13 次中 4 次）；仅新增真实输出 DOM 等待，保留原 done 等待及精确断言，产品文件不改。[诊断](d966f7f/receipt-before-tool-release-probe.txt) 排除了 gate 未放行时的提前 done，[五次收紧后定点](followup/a3-correct-wait-5-runs.txt) 均过；新 SHA 全量仍需实跑，不能靠定点冲绿。
- Kairos r6 独立重造三态/partial 卡/真 throw 对照，8图+3JSON 已由父会话实读并逐 SHA-256 复制。Atnor 只读确认 A-1/A-3/A-4 的产品修复；另指出纯文本 Reasoning disclosure 连续性未覆盖，保留 P2，不外推工具卡结论。
- GUI 的 agent-workspace-linux 入口未提供，独立 GUI 为 BLOCKED；两方 adversarial 为 FAILED/不完整。此处置不是最终验收通过。
