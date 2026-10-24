# WebUI Conversation/composer 状态可观测性 P0

## 候选与范围

- 实施分支：`feat/webui-interaction-p0`；基线 `5295c25`；产品修复候选 `d966f7fe64bdd9d5651606609b1b6989c670df1e`。后续仅测试/证据提交与门禁结果见下方冻结记录。
- 变更归属：[improve-webui-navigation-and-local-recovery](../../openspec/changes/improve-webui-navigation-and-local-recovery/) 的 [P0 tasks](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#41-conversationcomposer-状态可观测性-p02026-10-24)、[设计第 6 节](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#61-2026-10-24-conversation-状态可观测性批次) 和 [frontend delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md)。[变更摘要](../changes/webui-navigation-and-local-recovery.md) 与 [frontend state](../state/frontend.md) 同步维护。
- 本切片不改 `reference.css`，不实现 Sessions 行运行状态、Plan mode 或 Goals/Done when。恢复入口和设置路由仍是各自待确认方案。

## 实现前实测及修正

- 首个工具卡测试把 pending 到 running 的合法时序当成固定初始状态；改为等待真实 running，并直接读取同一 Conversation DTO 证明 live/持久声明共存，而非仅看 DOM。
- 错误形状的 Host 工具返回曾产生 `[object Object]`，不构成“合法图片不可达”证据。图片测试改用公开 Durable API 在隔离目录写合法历史，关闭 writer 后经正常 reopen、授权 HTTP/SSE 和真实 DOM 消费；没有伪造浏览器 DTO 或安装包。unsupported image/avif 验证的是合法 DTO part 的占位保形，不是 AVIF 编解码能力。
- 可控 SSE 分块暴露 `stopReason:"pending"` 被 Pocket 终态校验拒绝，导致 SSE 中断。live 投影只省略这个非终态字段；历史消息保留真实终态，协议没有新增伪造终态。
- provider 400 的 `model_error` 不是 policy `blocked`。测试改用实际选中 Conversation 的公开策略 projector 验证 blocked；撤回使用真实 queued/withdraw 路径验证 `aborted`，不混称策略拒绝。
- `PocketInputReceipt` 原先丢失 catalog 已有的 `reason`；协议 schema 与 catalog/MAS source 透传已补齐。浏览器只依据 DTO reason 选择文案。reason 是自由文本而非枚举，只有精确 blocked/aborted 字面量分类，其他整句说明或缺省值一律中性 not delivered；缺省属性不造 unspecified。
- 旧候选独立全量虽通过，A-1/A-3/A-4 仍被真实新回归揭露：回执 badge 与正文不一致、partial toolCall 初次落盘丢展开态、原生工具错误折叠后无明确标识。已先 RED 再修复，完整意见、反驳与失败 workflow 见 [逐项处置](evidence/webui-interaction-p0/review-disposition.md)。

## 最初工作树直接验证

以下为最初七条用例的历史记录，不代替新增回归或最终固定 SHA 的独立复核：

| 命令/范围                                                                                        | 结果                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `node --test apps/webui/test/transcript-parts-browser.test.ts`                                   | tests 7 / pass 7 / fail 0 / exit 0；duration_ms 7068.6284。之后 JSON 元组键改动又由实现者重跑为 7/7。 |
| `npm run build`                                                                                  | exit 0；包含固定 Durable 下游补丁校验及全部 workspace 构建。                                          |
| `npm run check`                                                                                  | exit 0；固定补丁校验与 `tsc --noEmit -p tsconfig.test.json`。                                         |
| `openspec validate improve-webui-navigation-and-local-recovery --strict --no-interactive --json` | valid=true，issues=[]。                                                                               |
| 新用例全量后的最终检查                                                                           | 见下方冻结记录，未完成前不得宣称最终候选通过。                                                        |

最初七条用例分别覆盖：

1. 真实阻塞工具的 live/持久声明共存、跨转换单卡、同 DOM 节点和展开态、结果归位及 Streaming 不误显。
2. 合法 user AVIF 和 tool-result AVIF 的可见中性占位、支持图片保留、真实截断窗口的孤儿结果卡。
3. 本地 SSE 分块生成的 `message-live[data-live]`、紧凑 Streaming、原始 read 解码与结束清理。
4. 正常 fork 后，同 provider call ID 的 inherited result 与 live 调用按 `sourceConversationId`/当前 Conversation 分离，输出不串卡。
5. 当前 Conversation 的真实 policy blocked 指引，而非权限 denied。
6. 通过注册的公开 Conversation source 消费真实 Host unknown receipt，显示 needs review 和先核对指引，无自动重放按钮、零 provider 调用。此用例不是主 catalog 存储故障恢复验收。
7. 真实 queued/withdraw 的 `aborted` 指引，不误称 policy refusal，也不产生新 provider 调用。

复核后新增两条真实用例：工具实际 throw 后折叠卡仍标识 error；partial toolCall 展开后第一次 AssistantEntry 提交保持同一节点及展开态。现有转录/回执文件共有九条用例。

## 未覆盖与后续边界

- **P0-4 Sessions 行状态**：列表 DTO 只有 version/archived，没有 per-Conversation 运行状态；需独立协议及 server 变更，不能以 busy 猜测代替。
- **键盘焦点恢复**：实现只在 `:focus-visible` 时回落 textarea；现有 browser harness 的键盘路径尚未提供可重复验收，保留为未覆盖。
- **主 catalog 存储故障的浏览器 receipt 恢复**：真实故障实验只得到 HTTP generic unknown，未证明能恢复原 receipt。测试中的 unknown 是真实 Host source 回执，不得冒充主 catalog 故障修复。generic unknown 也不得以 transport request ID 冒充 receipt ID。
- **receipt 清除时机**：本批不改既有 send 时清除策略。
- **纯文本回合 Reasoning disclosure 连续性（P2）**：当前非工具 live/entry 的键不同，可能重挂载；未独立覆盖展开态，不把工具卡修复外推为该能力已修。
- **同一 Conversation 跨轮重用 provider call ID**：现有回归证明的是不同来源 Conversation 的同 ID 分离，未证明同一来源跨轮重用的归属。当前工具键使用来源/call ID；原生 `createToolTask` 同时接收 entry ID 和 call ID，但尚未实测跨轮重用或证实全局唯一约束，不能由 fork 回归外推为覆盖。
- **tool-only busy 状态**：不显示 Streaming，因为不存在 live.message；这不是新增 live 文本不可达的借口。
- 视觉、独立 adversarial 和最终 GUI 结论必须关联精确完整候选，不沿用旧工作树数字。

## 冻结候选与独立验收

### 原候选 5f43d9d（已被复核修复取代）

完整 SHA：`5f43d9d1dceced674fff6c565ebf59a9e2ee9cc4`。独立 worktree 的 npm ci、build、npm test 结束，616 tests/614 pass/0 fail/2 skip/exit 0；[原始输出](evidence/webui-interaction-p0/5f43d9d/full-suite.txt) 已保留。Kairos 的 r5 固定 SHA 门禁为 19/19，7 张截图与 2 份 JSON 保存在 [r5 证据目录](evidence/webui-interaction-p0/5f43d9d/kairos-r5/)。其渲染证据只覆盖所述几何/Streaming/工具转换，不证明 receipt 三态已独立运行。

指定 adversarial workflow 在 A 完成后因 B 模型缺失失败，未形成双方意见或讨论。A 原文及错误完整保留于 [逐项处置](evidence/webui-interaction-p0/review-disposition.md)。独立 GUI 因当前工具无 agent-workspace-linux 入口而 BLOCKED，未用 ownedBrowser 冒充指定桌面。

### 产品修复候选 d966f7f

完整 SHA：`d966f7fe64bdd9d5651606609b1b6989c670df1e`。build、check、strict 和 30 条受影响门禁通过，见 [冻结前原始输出](evidence/webui-interaction-p0/followup/pre-freeze-checks.txt)。随后隔离 worktree 的完整运行是 **618 tests/615 pass/1 fail/2 skip/exit 1**，见 [完整失败日志](evidence/webui-interaction-p0/d966f7f/full-suite-failed.txt)，不记为全量通过。

唯一失败在 A3 用例最终读取输出：测试只等 receipt.done 就断言 SSE DOM，两个通道没有这个顺序保证。Atnor 独立 13 次运行中 4 次在同一行失败；受控反证在工具 gate 未放行时保持 placed/running、等待 done 超时，排除了 native 提前 done，见 [诊断原始输出](evidence/webui-interaction-p0/d966f7f/receipt-before-tool-release-probe.txt)。修正仅新增具体输出 DOM 条件等待，保留 done 等待和精确 PARTIAL-RESULT 断言；产品代码不改。修后 [五次定点原始输出](evidence/webui-interaction-p0/followup/a3-correct-wait-5-runs.txt) 均通过，不以此替代新 SHA 全量。

Kairos r6 在该 SHA 独立重造三类回执、partial 工具卡三阶段、原生 throw/正常 denied 返回对照。8 张截图与 3 份 JSON 在 [r6 证据目录](evidence/webui-interaction-p0/d966f7f/kairos-r6/)；父会话已逐图/逐 JSON 实读、逐文件 SHA-256 比对后复制。partial 卡阶段 endpoint 数为 1/1/2，保持同节点/open，工具结果归位且正常后续 generation 可见；工具错误有显式 error 文本，denied 普通返回不伪造 isError。此取证通过不代替上面的失败全量，也不代替指定 GUI。

### 已测候选 737f2f3

完整 SHA：`737f2f3a25b225aef8df4705b333b94a1cdd9075`。相对 d966f7f 唯一代码差异是 A3 测试新增 4 行等待（未删除 done 等待或精确断言），其余为文档/证据；产品文件无变更。

隔离验收 worktree 从 clean 的该 SHA 执行 `npm run build`、`npm run check`、`npm test`，**618 tests / 616 pass / 0 fail / 2 skip / exit 0 / duration_ms 442834.0943**。见 [完整输出](evidence/webui-interaction-p0/737f2f3/full-suite.txt) 和 [结构化结果](evidence/webui-interaction-p0/737f2f3/result.json)。两个 skip 是原有 owned-browser 的 POSIX CDP interception 用例在 Windows 不执行，不是新增通过项。

Kairos 独立核对四个产品文件哈希全等于 d966f7f，并复跑 A3 一次通过；r6 的产品证据可沿用（仅沿用 r6，r5 继续绑定原 SHA）。Atnor 只读终核确认精确 +4 行、断言未放宽、产品零改，并报告其 5 轮 11/11 定点均通过；这些定点不冒充父会话的全量。双方意见与身份在 [独立复核记录](evidence/webui-interaction-p0/737f2f3/peer-verification.md)。最后活跃 LSP probe 对改动的测试文件确认 clean；此前 4 文件检查有 2 项 unconfirmed，完整类型检查通过不等同这些 LSP 检查全部确认。

**最终验收仍未通过**：指定双评因 B 模型缺失未完成，指定桌面 GUI 因 agent-workspace-linux 工具缺失 BLOCKED。分支保留完整失败历史及未覆盖项，不合并冒充验收通过。后续需提供可用的 B 模型配置和规定的独立桌面入口，再对精确候选补齐这两项；本次收口仅提交文档/证据，不改已测代码。
