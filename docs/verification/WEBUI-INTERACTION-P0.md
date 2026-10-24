# WebUI Conversation/composer 状态可观测性 P0

## 候选与范围

- 实施分支：`feat/webui-interaction-p0`；基线 `5295c25`；最终完整候选 SHA 在冻结后记录于此。
- 变更归属：[improve-webui-navigation-and-local-recovery](../../openspec/changes/improve-webui-navigation-and-local-recovery/) 的 [P0 tasks](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#41-conversationcomposer-状态可观测性-p02026-10-24)、[设计第 6 节](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#61-2026-10-24-conversation-状态可观测性批次) 和 [frontend delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md)。[变更摘要](../changes/webui-navigation-and-local-recovery.md) 与 [frontend state](../state/frontend.md) 同步维护。
- 本切片不改 `reference.css`，不实现 Sessions 行运行状态、Plan mode 或 Goals/Done when。恢复入口和设置路由仍是各自待确认方案。

## 实现前实测及修正

- 首个工具卡测试把 pending 到 running 的合法时序当成固定初始状态；改为等待真实 running，并直接读取同一 Conversation DTO 证明 live/持久声明共存，而非仅看 DOM。
- 错误形状的 Host 工具返回曾产生 `[object Object]`，不构成“合法图片不可达”证据。图片测试改用公开 Durable API 在隔离目录写合法历史，关闭 writer 后经正常 reopen、授权 HTTP/SSE 和真实 DOM 消费；没有伪造浏览器 DTO 或安装包。
- 可控 SSE 分块暴露 `stopReason:"pending"` 被 Pocket 终态校验拒绝，导致 SSE 中断。live 投影只省略这个非终态字段；历史消息保留真实终态，协议没有新增伪造终态。
- provider 400 的 `model_error` 不是 policy `blocked`。测试改用实际选中 Conversation 的公开策略 projector 验证 blocked；撤回使用真实 queued/withdraw 路径验证 `aborted`，不混称策略拒绝。
- `PocketInputReceipt` 原先丢失 catalog 已有的 `reason`；协议 schema 与 catalog/MAS source 透传已补齐。浏览器只依据 DTO reason 选择文案。reason 是自由文本而非枚举，只有精确 blocked/aborted 字面量分类，其他整句说明或缺省值一律中性 not delivered；缺省属性不造 unspecified。
- 旧候选独立全量虽通过，A-1/A-3/A-4 仍被真实新回归揭露：回执 badge 与正文不一致、partial toolCall 初次落盘丢展开态、原生工具错误折叠后无明确标识。已先 RED 再修复，完整意见、反驳与失败 workflow 见 [逐项处置](evidence/webui-interaction-p0/review-disposition.md)。

## 当前直接验证

以下数字属于执行时的工作树，不代替最终固定 SHA 的独立复核：

| 命令/范围                                                                                        | 结果                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `node --test apps/webui/test/transcript-parts-browser.test.ts`                                   | tests 7 / pass 7 / fail 0 / exit 0；duration_ms 7068.6284。之后 JSON 元组键改动又由实现者重跑为 7/7。 |
| `npm run build`                                                                                  | exit 0；包含固定 Durable 下游补丁校验及全部 workspace 构建。                                          |
| `npm run check`                                                                                  | exit 0；固定补丁校验与 `tsc --noEmit -p tsconfig.test.json`。                                         |
| `openspec validate improve-webui-navigation-and-local-recovery --strict --no-interactive --json` | valid=true，issues=[]。                                                                               |
| 新用例全量后的最终检查                                                                           | 见下方冻结记录，未完成前不得宣称最终候选通过。                                                        |

七条新用例分别覆盖：

1. 真实阻塞工具的 live/持久声明共存、跨转换单卡、同 DOM 节点和展开态、结果归位及 Streaming 不误显。
2. 合法 user AVIF 和 tool-result AVIF 的可见中性占位、支持图片保留、真实截断窗口的孤儿结果卡。
3. 本地 SSE 分块生成的 `message-live[data-live]`、紧凑 Streaming、原始 read 解码与结束清理。
4. 正常 fork 后，同 provider call ID 的 inherited result 与 live 调用按 `sourceConversationId`/当前 Conversation 分离，输出不串卡。
5. 当前 Conversation 的真实 policy blocked 指引，而非权限 denied。
6. 通过注册的公开 Conversation source 消费真实 Host unknown receipt，显示 needs review 和先核对指引，无自动重放按钮、零 provider 调用。此用例不是主 catalog 存储故障恢复验收。
7. 真实 queued/withdraw 的 `aborted` 指引，不误称 policy refusal，也不产生新 provider 调用。

## 未覆盖与后续边界

- **P0-4 Sessions 行状态**：列表 DTO 只有 version/archived，没有 per-Conversation 运行状态；需独立协议及 server 变更，不能以 busy 猜测代替。
- **键盘焦点恢复**：实现只在 `:focus-visible` 时回落 textarea；现有 browser harness 的键盘路径尚未提供可重复验收，保留为未覆盖。
- **主 catalog 存储故障的浏览器 receipt 恢复**：真实故障实验只得到 HTTP generic unknown，未证明能恢复原 receipt。测试中的 unknown 是真实 Host source 回执，不得冒充主 catalog 故障修复。generic unknown 也不得以 transport request ID 冒充 receipt ID。
- **receipt 清除时机**：本批不改既有 send 时清除策略。
- **tool-only busy 状态**：不显示 Streaming，因为不存在 live.message；这不是新增 live 文本不可达的借口。
- 视觉、独立 adversarial 和最终 GUI 结论必须关联精确完整候选，不沿用旧工作树数字。

## 冻结候选与独立验收

### 原候选 5f43d9d（已被复核修复取代）

完整 SHA：`5f43d9d1dceced674fff6c565ebf59a9e2ee9cc4`。独立 worktree 的 npm ci、build、npm test 结束，616 tests/614 pass/0 fail/2 skip/exit 0；[原始输出](evidence/webui-interaction-p0/5f43d9d/full-suite.txt) 已保留。Kairos 的 r5 固定 SHA 门禁为 19/19，7 张截图与 2 份 JSON 保存在 [r5 证据目录](evidence/webui-interaction-p0/5f43d9d/kairos-r5/)。其渲染证据只覆盖所述几何/Streaming/工具转换，不证明 receipt 三态已独立运行。

指定 adversarial workflow 在 A 完成后因 B 模型缺失失败，未形成双方意见或讨论。A 原文及错误完整保留于 [逐项处置](evidence/webui-interaction-p0/review-disposition.md)。独立 GUI 因当前工具无 agent-workspace-linux 入口而 BLOCKED，未用 ownedBrowser 冒充指定桌面。

### 复核修复候选

修复已通过对应 RED/GREEN，正待冻结新 SHA 和同版本全量/独立渲染复验；不得用原候选的绿色结果替代。两方 adversarial 和指定 GUI 未通过，P0 不作最终验收通过声明。
