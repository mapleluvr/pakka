# HANDOFF — pakka-webui 交互 P0 变更（worktree webui-p0）

> 创建：Orosphires（lead）· 2026-10-24
> 分支：`feat/webui-interaction-p0` · worktree：`D:\Projects\pakka-wt\webui-p0` · 基线 commit：`5295c25`
> 证据来源：`D:\Projects\TempProjects\pakka-webui-investig\interaction-gaps-final.md`（52 项五档判定，三方核对通过）。

---

## 0. 一句话

把调查确认的 **P0 状态语义差距**落成代码：让界面能表达「处理中 / 已确认 / 待核对 / 被拒绝」，而不是把它们压平成布尔与三色。
**只实现 DTO 真实下发的状态**（见 §2 可观测性清单），不为凑设计而发明服务端没有的字段。

---

## 1. 变更范围（做什么 / 不做什么）

### 本次实现（Phase A，全部在既有契约内）

| ID   | 变更                                                                                                                           | 文件（唯一写者）                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| P0-1 | composer 禁用原因文本（SubmitHint），四类拒绝各有可读原因 + `aria-describedby`                                                 | `apps/webui/web/native-composer.js`（Orosphires） |
| P0-5 | Stop 移入 send-group 主位；点击后进入 `stopping` 态（禁用重复点击、文案切换），abort 完成/失败都退出                           | 同上（Orosphires）                                |
| P0-2 | 流式消息与已落盘消息可区分（`data-live` + 仅在 busy 时的 Streaming 指示）；**合法但不可渲染的 part 显式占位**，禁止静默 `null` | `apps/webui/web/app.js`（Atnor）                  |
| P0-3 | tool 卡按 `callId` 稳定键控、同 ID 更新而非并存；历史 toolCall 与 live tool 用同一套卡结构                                     | 同上（Atnor）                                     |
| —    | receipt 词汇：`unanswered`→blocked（下一步：改输入）、`unknown`→待核对（下一步：核对而非重发）                                 | 同上（Atnor）                                     |

### 明确不在本次范围

| 项                                                         | 原因                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0-4 Sessions 行状态徽标**                               | **契约缺口**：`states[id]` 只有 `{version, archived}`，列表 DTO 没有任何 per-conversation 运行状态（详见 §2）。做徽标必须先扩展 protocol + server，属独立变更（需 OpenSpec delta）。**本 worktree 不做**，只在 HANDOFF 记录设计输入。 |
| P1-1 草稿按会话隔离 / P1-2 视图 URL 化 / P1-3 虚拟化       | 批次 3/4，本次不动                                                                                                                                                                                                                    |
| Team/MAS 可视化、移动端注意力收件箱                        | 后续批次                                                                                                                                                                                                                              |
| reference.css 任何改动                                     | SHA-256 被 `devin-reference.test.ts:11` 锁定（`084adce8…`），**禁止触碰**                                                                                                                                                             |
| Devin 的 switch-version / replay / 双栏 / queue / 附件上传 | 调查判定「有意不追平」，理由见 final 稿 §2                                                                                                                                                                                            |

---

## 2. 状态可观测性清单（批次 1 前置，已完成实检）

> 规则：**UI 只覆盖服务真下发的状态**。以下全部来自 `packages/protocol/src/pocket.ts` 实读。

### 2.1 可用（可直接驱动 UI）

| 来源                 | 字段                                                             | 值域                                        |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `view.live`          | `busy`                                                           | boolean                                     |
| `view.live.tools[]`  | `callId`, `name`, `status`, `taskId?`, `output?`                 | status ∈ `pending｜running｜done`           |
| `view.live.message?` | 完整 PocketMessage                                               | 仅在进行中有                                |
| `view.entries[]`     | 已落盘消息（含 `entry.id`、`entriesTruncated`、`olderBeforeId`） | —                                           |
| receipt              | `status`                                                         | `queued｜placed｜done｜unanswered｜unknown` |
| `states[id]`         | `version`, `archived`                                            | 仅此两项                                    |

**结论**：`callId` 存在 → P0-3 可行；`unanswered/unknown` 存在 → blocked/待核对词汇可行；`busy` 存在 → 流式区分可行。

### 2.2 不可用（阻塞 P0-4）

`states[id]` 无 busy/unknown/失败域字段；列表页也无法知道别的会话是否在处理。
→ **P0-4 阻塞于契约**，需一次协议扩展（建议新增 `PocketConversationState.status`，值域与 receipt 对齐，且必须 fail-closed：未知即 `unknown`）。

### 2.3 一处调查结论需要更正（写代码前必读）

final 稿 P0-2 原文「未识别 content part 静默渲染 null（fail-open）」需要收窄：
`packages/protocol/src/pocket.ts:471-492` 的 `part()` 对未知 `type` **返回 false**，整个 view 校验失败 → 未知类型根本到不了 UI（这一侧本来就是 fail-closed）。
真正的漏洞是**合法但 UI 不渲染**：`part()` 允许任意 `image/*`，而 `app.js` 的 allowlist 只有 `png|jpeg|webp|gif` → `image/avif`、`image/svg+xml` 等**通过校验的图片被静默丢弃**。
→ P0-2 的正确修法：**校验通过的数据必须渲染出可见结果**（占位卡 + mime 文本），不是"给未知类型兜底"。

---

## 3. 角色与文件所有权（一文件一写者）

| 角色                   | 职责                                                                                                                  | 独占文件                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Orosphires（lead）** | P0-1/P0-5 实现；`elements.css` 新增样式；集成；跑门禁；最终验收决定                                                   | `apps/webui/web/native-composer.js`、`apps/webui/web/elements.css`、`apps/webui/test/composer-hints-browser.test.ts`、本 HANDOFF |
| **Atnor**              | P0-2/P0-3 + receipt 词汇实现；结构正确性自查                                                                          | `apps/webui/web/app.js`、`apps/webui/test/transcript-live-browser.test.ts`                                                       |
| **Kairos**             | 验证角色（不改代码）：渲染态像素/computed 实测、a11y（aria-describedby 关联、焦点、44×44 命中区）、对比度、独立跑门禁 | `vp-p0-verification.md`（调查目录）                                                                                              |

冲突规则：

- 任何跨文件改动先在 intercom 报备，由 lead 派工；**不并行编辑同一文件**。
- `elements.css` 只有 lead 写；Atnor 需要新样式时提交「类名 + 期望视觉」给 lead，由 lead 落盘。
- 合并前 HANDOFF 删除（工作文档不入主分支）。

---

## 4. 逐项实现要求

### P0-1 禁用原因文本（native-composer.js）

现在：

```js
const disabled =
	(mode !== "chat" && !canInput && !slash) ||
	working ||
	!view ||
	(mode === "prompt" && view?.live.busy && !slash);
```

四类原因合并成一个布尔，用户看到灰按钮不知道为什么。

要求：

1. 抽出一个纯函数 `submitState({...}) → { disabled, reason }`，`reason` 取四类之一（`read-only` / `working` / `no-view` / `busy-prompt`），无原因时 `null`。
2. 渲染 `<p class="submit-hint" data-submit-hint data-reason="…">` 于 toolbar 之下（**只在 disabled 且有 reason 时出现**），文案为可执行指引：
   - `read-only` → "Read-only: 当前身份不能发送"
   - `working` → "正在处理上一条，完成后可继续"
   - `busy-prompt` → "会话忙碌中；用 Steer 插话或等完成"
   - `no-view` → "正在连接会话…"
3. send 按钮加 `aria-describedby="submitHint"`（id 存在时才加），hint 元素 `id="submitHint" role="status"`。
4. **不得改变**现有禁用布尔语义（四类判定结果必须与当前 `disabled` 完全一致），只新增原因通道；用测试锁住等价性。

### P0-5 Stop 主位 + stopping 态

现在：Stop 在 `toolbar-left`，是 `pill-btn`；abort 后无任何反馈。

要求：

1. Stop 移入 `send-group`（与 send 同组，Devin 三主态位置），保留 `pill-btn` 视觉但放入 `.send-group` 内；send 按钮在 busy 时让位（隐藏或禁用，**不可两个都可点**）。
2. 点击 Stop → 本地 `stopping=true`：Stop 按钮 `disabled`、文案 "Stopping…"、`aria-busy="true"`；
   `abort()` 返回/抛错后都要复归（用 `finally`），且**只有 `view.live.busy === false` 才算真正结束**——不得仅凭 abort 请求成功就把界面切成空闲（AGENTS.md：不得因 abort 请求就释放 admission）。
3. 新增 `data-stopping` 标记供测试与视觉核对。

### P0-2 流式区分 + 合法 part 显式呈现（app.js，Atnor）

1. `view.live.message` 渲染时传 `live` 标记：`data-live="true"`，class 加 `message-live`；
2. 仅当 `view.live.busy` 时显示流式指示（复用 `status-pill`，文本 "Streaming"，`data-streaming`），落盘后消失；
3. part 渲染改为「穷尽 + 兜底」：
   - `text` / `thinking` / `toolCall` 照旧；
   - `image` 且 mime 在 allowlist → 照旧渲染；
   - `image` 但 mime 不在 allowlist → **显式占位**：`<p class="part-unrenderable" data-part-type="image">` 内含 mimeType 文本（"无法预览 image/avif"），**不得 return null**；
   - 其它（理论上不可达，防御性）→ 同样占位并带 `data-part-type`。
4. 边界：占位文案不得回显未净化的字符串（mime 已由协议正则约束，仍按文本节点渲染，不用 innerHTML）。

### P0-3 tool 卡统一（app.js，Atnor）

1. live tools 用 `callId` 作为 key（现在是数组下标式无键），同一 `callId` 状态推进时**原地更新**，不得出现同名卡并存；
2. 历史 `toolCall` part 与 live tool 共用一套卡结构：head = 名称（`code`）+ 状态（`status-pill`），body = 参数或输出；
3. 历史 toolCall 无 status 时不得编造状态（不显示状态 pill），只显示名称与参数；
4. 状态值必须来自 DTO（`pending|running|done`），不做映射猜测。

### receipt 词汇（app.js，Atnor）

| receipt.status      | 呈现                                                 | 指引                                                 |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `queued` / `placed` | 进行中（现状保留）                                   | —                                                    |
| `done`              | 已确认                                               | —                                                    |
| `unanswered`        | `blocked` 徽标（`data-receipt-status="unanswered"`） | "未送达：策略拒绝，请修改输入后重发"                 |
| `unknown`           | 待核对徽标（`data-receipt-status="unknown"`）        | "结果未知：请核对后再决定是否重发，**不要直接重发**" |

`blocked` 与 `denied` 必须是**两个不同原因徽标**（blocked=策略/输入问题；denied=权限交集问题，指向管理员/换身份）。本次只实现 receipt 侧，权限侧若 DTO 无来源则不做（不发明）。

---

## 5. 样式规则（lead 统一落 elements.css）

- 新增类一律 `p0-` 前缀或语义类名（`.submit-hint`、`.part-unrenderable`、`.tool-status`），**只写 `apps/webui/web/elements.css`**；
- 颜色只用既有变量（`--accent`、`--muted`、`--border`、`--card-outer`、`--faint`），不引入新色值；
- 图标用既有 `Glyph`（SVG path），**禁止 Unicode 字形/emoji**；
- 独立图标控件命中区 ≥44×44（现有 `.pill-btn` 已满足则复用）；
- 不改变 `devin-adoption-browser.test.ts` 断言的几何：home card `526,373,688,154`、hero `520,327,700,30`、newSession `8,44,278,30`、toolbar `539,486,662,28`、移动端 home `22, w−44, 154`。

---

## 6. 测试与门禁

每个写者自带测试（`node --test`），并保证既有门禁不回归：

```powershell
# 新增
node --test apps/webui/test/composer-hints-browser.test.ts      # Orosphires：P0-1/P0-5
node --test apps/webui/test/transcript-live-browser.test.ts     # Atnor：P0-2/P0-3/receipt

# 必跑回归（几何 + 引用锁定 + 移动端抽屉）
node --test apps/webui/test/devin-adoption-browser.test.ts
node --test apps/webui/test/devin-reference.test.ts
node --test apps/webui/test/mobile-sidebar.test.ts

# 相关既有行为
node --test apps/webui/test/busy-browser.test.ts
node --test apps/webui/test/input-failure.test.ts
```

测试硬要求：

1. **真实路径**：`runtimeFixture` + 本地确定性 provider + `ownedBrowser`，不 mock UI 内部；
2. 断言基于 DOM 契约（`data-submit-hint`、`reason` 值、`data-stopping`、`data-live`、`data-part-type`、`data-receipt-status`、`callId` 键控效果），不断言像素；
3. P0-1 必须有一条**等价性断言**：新 `submitState().disabled` 与旧布尔表达式在四类组合下逐一致；
4. P0-2 必须有一条**反 fail-open 断言**：非 allowlist mime 的 image part 必须在 DOM 里留下可见节点（证明不再静默丢弃）；
5. 禁止读取用户凭据、禁止调付费模型。

门禁口径（沿用调查阶段）：`pass/fail` 数字 + 退出码 + 用时，逐条贴原始输出；跑不动就贴失败原文。

---

## 7. 汇报格式（防伪口径）

任何「完成 / 已测量 / 已通过」声明必须同时满足：

1. 脚本 `exit 0`（或明确失败原文）；
2. 产物 `Test-Path` 为真且非空，JSON 实读；
3. 消息发送时间晚于脚本 mtime + 运行时长（同秒即判伪）。

读图/像素结论一律由 Kairos 给出，其他人不得预填。

---

## 8. 交接顺序

1. lead：写 HANDOFF（本文件）→ 派工 → 实现 P0-1/P0-5 + elements.css → 自测 → 通知；
2. Atnor：实现 P0-2/P0-3/receipt → 自测 → 通知（与 lead 并行，文件不重叠）；
3. Kairos：等两侧落盘后做渲染态/a11y 核对 + 独立跑门禁 → 出 `vp-p0-verification.md`；
4. lead：集成、跑全部门禁、处理分歧、提交（commit 信息按仓库惯例 `fix(webui): …`）；
5. **交付 Blower**：完工后用 intercom `handover` 把 worktree 路径、commit、门禁数字、未覆盖边界一次性交出去（cwd 同为本项目）；
6. 合并前删除本 HANDOFF，并把结论与遗留（P0-4 契约缺口）写进 `docs/changes/` 对应记录（如需 spec delta，另开 OpenSpec 变更）。

---

## 9. 已知风险

| 风险                                                      | 处理                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elements.css` 新增样式影响既有几何断言                   | 每次改动后立即跑 `devin-adoption-browser.test.ts`                                                                                                     |
| Stop 移位破坏 busy-browser 既有断言                       | 先跑 `busy-browser.test.ts` 看现状，再改；必要时只调位置不动语义                                                                                      |
| 流式指示闪烁（busy 抖动）                                 | 仅在 `live.busy === true` 且 `live.message` 存在时渲染，落盘后立即消失，不加过渡动画                                                                  |
| 占位卡被误认为错误态                                      | 占位用中性色（`--muted`），文案描述事实（"无法预览"），不用红色                                                                                       |
| P0-4 被误当成遗漏                                         | 本文件 §2.2 与最终 commit message 都要写明「阻塞于契约，另行变更」                                                                                    |
| hint/receipt 两个 live region 可能抢播报（Kairos B4）     | 已知并接受：hint 仅 disabled 时存在、receipt 仅有回执时存在，重叠窗口极短；两者均 `role="status"`，且 `aria-describedby` 同时挂在 textarea 与 send 上 |
| Stop 的 44px 命中区被 `.send-group{overflow:hidden}` 裁剪 | 已解决：`.send-group:has(.stop-btn){overflow:visible}` + `::after` 扩边，`elementFromPoint` 实测命中                                                  |
| abort 失败（`run()` 吞错）会让 stopping 永久卡死          | 已解决：8s 后按钮变 “Stop again”（`data-stopping="retry"`）可重发 abort；真正的解除仍只由 `busy→false`                                                |
| `body[data-mode="ask"]` 的 28px 圆形 send-group           | 当前不可达（`frontend.js:94` 钉死 `"agent"`），仍做模式分流：`mode==="chat"` 时 Stop 回 `toolbar-left`                                                |
