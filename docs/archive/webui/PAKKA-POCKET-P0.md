# Pakka-Pocket P0 — 来源固定与原生端口证明

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前产品状态](../../PAKKA-POCKET-STATUS.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

状态：**实施中的阶段记录，不是 WebUI 产品验收**。范围与后续条件仍以 [迁移计划（外置备份）](../../verification/DOCUMENTATION-CLEANUP.md#备份与恢复)、[开发规范](../../development/WEBUI-DEVELOPMENT.md) 和 active OpenSpec change 为准。没有引入 `@pakka/webui` 空包，没有扩大旧 headless v1 的网络或权限默认值。

## 1. 采用树不是扩展参考树

[固定来源](../../../integrations/pocket/source-lock.json) 与可执行 [来源检查](../../../integrations/pocket/source.mjs) 分别记录：

| 身份     | Commit / tree                                                                           | 用途                                                  |
| -------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 主 UI    | `de612d5622cdc66b6b8b4900c650c6f2efdf4c63` / `0586dc7e9242dc5eca52d67b61abfd1f10b5d16b` | 采用 UI、页面、移动与多人交互；其 Durable 为 `1.1.0`  |
| Phase 2  | `58a4fdcc88ed755023aea9fac897735fca7396fe` / `fb7d4df3d773c91994883daa02209e40a55a14d3` | 人工命令和自定义界面的独立参考；其 Durable 为 `1.0.2` |
| Phase 1  | `2cb652c465f670ba8c66fc3ee639798caca8afbc`                                              | Phase 2 的直接 parent                                 |
| 共同祖先 | `096b7e198cb69846ce91ca45a18d144f688d478e`                                              | 两棵分叉树，不是新 UI 已合并 Phase 2                  |

主树 **259** 个文件，参考树 **215** 个文件。逐文件 mode、Git blob、SHA-256、长度由 Git 对象生成；拒绝错误 commit/tree、修改过或混入未跟踪文件的 checkout 和未批准的 symlink/submodule。不会把旧依赖或其 `node_modules` 搬进生产图。

[MIT](../../../integrations/pocket/licenses/pi-pocket-MIT.txt) 与 [JetBrains Mono OFL](../../../integrations/pocket/licenses/JetBrains-Mono-OFL.txt) 保留原始字节及 copyright。以后真正迁入组件/字体时，交付包也必须保留来源、原 notice 和逐文件映射；现在的来源记录不代表已经完成 UI 采用。

## 2. 真实上游基线：失败保留

原源码在独立 HOME/AppData/temp/data 下安装和执行，没有继承用户凭据或 npm 配置，没有使用用户的 Pi 目录。仅此树的 npm install/check 通过；测试结果是：

**548 项：378 passed、40 failed、130 skipped，cancelled/todo 为 0。**

平台为 Windows x64，Node `24.18.0`。这是 FAIL，不是 Pakka 的通过数字。Chromium 未被上游检测到而跳过的案例也不能当作已验证。原始日志未修改；[机器记录](../../../integrations/pocket/upstream-baseline.json) 保存执行身份、结果和证据位置，[重跑脚本](../../../integrations/pocket/upstream-baseline.mjs) 始终使用新隔离 profile。

观察到路径/文件名的 Windows 差异、git/worktree 与归属断言、browser/snap 检测、被截断 shell、skills/docs/旧 session import 等失败。**不把全部失败都解释为平台问题**，也不改上游断言换取绿色。后续按新服务逐项验证迁入行为。上游 faux provider 只服务这份原始基线；不是当前 Pakka 真实生产路径的替代品。

## 3. 页面与 action ledger

[adoption-map.json](../../../integrations/pocket/adoption-map.json) 为全部 **61 个 Web 模块** 指定唯一归属、scope、model effect 和实际测试路径；检查拒绝漏项和双重归属。AST 原始清单包含主树 **364 个调用位置、113 个路由条件、880 个旧 authority 候选引用**，位置保存在 `artifacts/pakka-pocket/p0/source-inventory.json`。

这些数字不是“364 个功能”或“880 个已确认漏洞”。公共 store/API 的调用按下表拆到真实服务；嵌套路由条件和 AST 候选引用保留原始位置，不用纯 grep 的命中数宣称删除完成。

| 屏幕/实际 action                                           | 目标服务 / writer                                          | 人类授权与模型效果                                        | 必须完成的消费者证明                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Home/session list、切换/重命名/archive、peek、running      | 产品元数据服务 + 受控 Conversation 读取；一个元数据 writer | 当前人可见资源；浏览不触发模型                            | 两个角色浏览器、改名/恢复、跨资源泄漏、断线后刷新                          |
| Transcript、find/history、show earlier、tool call/result   | adapter-owned read DTO + 有限分页                          | 显式 read；不发布 system/config/private docs              | 原生工具活动、历史分页、旧/外域 cursor、实际 HTTP 数不增加                 |
| Composer prompt/steer/followUp、edit/resend/withdraw/abort | Pakka 原生 input/admission/task 路径                       | actor、requester、driver 和 profile ceiling；明确模型输入 | busy 原生队列、late revoke、original receipt、lost response、不重复执行    |
| People/sign-in/invite/QR/viewer/driver                     | people/invitation/browser-session 服务                     | owner/guest/viewer 与资源域；不触发模型                   | 一次邀请竞争、expiry/revoke/正常 reopen、CSRF/Origin、两人实际浏览器       |
| Side chat、notes、pin/reaction/quote、take turns           | 人类协作元数据 / scoped CAS                                | 当前人归属；默认零模型贡献                                | 并发冲突、明确 by/at、下一次真实 payload 不含旁聊、driver 切换             |
| Theme、appearance、back/gesture、keyboard、sheet           | generic shell / public UI primitives                       | 本地偏好或 scoped settings；无模型输入                    | 桌面/手机、focus/back、键盘、错误边界；保持上游视觉基座                    |
| Extensions、slash/action、custom Sheet/page/panel          | 公共四面宿主 + typed backend/client                        | extension generation + 当前人；默认无模型输入             | GUI-only / 后端设置独立插件、typed/tapped/button 同路径、reload/disable    |
| MAS Board/bar、member/receipt、管理操作                    | MAS DevPack 公开 facets，业务 writer 仍为 MAS              | 服务端过滤 membership/ownership；显式 MAS 输入            | 真模型 tool 创建、人类通信/退役、UI 拆除不删除成员、普通插件插槽同等能力   |
| Files/folder/changes/branch/worktree、upload/export        | 批准根目录的文件/git 服务                                  | 独立 file/git 权限；显式模型通知才提交输入                | 真隔离文件与 diff/branch/worktree、path/link/size/MIME、只读拒绝、字节核对 |
| Browser、artifact/run frame、approval                      | 受控 browser/artifact/pending-call 服务                    | 具体资源/实例/真实待审批 call                             | 浏览器真实动作、sandbox、迟到批准无效、无原生 handle 进入 Web              |
| Provider/model、budget/spend、private settings             | 宿主批准配置与额度服务                                     | 仅公开 model/profile ref；secrets replace/clear 不回传    | 后续真实行为变化、跨人 canary、辅助/主调用 spend 不重置                    |
| Notifications/service worker                               | per-person notification 服务                               | 按人和资源过滤；不可全局广播秘密                          | 浏览器订阅/撤销、通知内容/导航和权限缩小后的清理                           |
| Voice dictation                                            | 可选浏览器能力                                             | 显式麦克风授权；只改草稿，不自动发送                      | recognizer 生命周期和浏览器界面；说明浏览器语音服务，测试不采集用户音频    |
| Schedules                                                  | 通用 automation 贡献 + 受控 durable jobs                   | 保存 originating actor，到期重验；意图明确的输入          | 真 checkpoint/reopen、取消回执、到期撤权、lost response 无重复             |
| Memory/project settings                                    | 可选公开贡献，scoped records/settings                      | 项目/global owner 域；Agent contribution 独立选择         | read/write/CAS/批准、跨项目过滤、后续模型输入、禁用不删历史                |
| Webhooks                                                   | 显式 Conversation 的通用贡献                               | endpoint 与签名校验、当前来源 authority                   | 真实本地 signed webhook、rotation/replay/body bounds、原生 receipt         |
| 原 CLI/Pocket session picker/import                        | 改为 Pakka 自有 Conversation 搜索/正常 reopen              | 不发现旧 Pi 目录或导入旧 storage                          | 当前产品所有权与搜索；不依赖 SessionManager/oracle/旧数据                  |

### 必须拆除的旧 authority

- 不迁入 `src/server/pip.ts`、`pip-compact.ts`、`extensions/pip.ts`、`subagent-runs.ts`、`extensions/subagents.ts` 及其注册器。
- 不迁入原 `PocketApp`/`Room` 的 writer、projection、HTTP handler、provider registry 或 SQLite 运行底座。
- 复用 `web/subagents*.js` 的展示思路，但只能由 MAS DevPack 提供；重写 `web/app.js`、`store.js`、menus、commands、voice 等对旧状态的引用。
- 移除 `web/pip.js`、PiP 专用对话/快捷键/持久状态、PiP-only hook/watch/dispatch；不创建另一个隐式特权助手。
- generic schedules/memory/webhook 等独立 UI 只有在新受控服务真实实现后才启用；不能通过接回旧 task registry 恢复控件。
- P6 的生产图和交付 asset 审计必须逐项关闭候选边，不能只证明 `subagents.ts` 未加载。

## 4. 原生能力与必要端口

### 已实现的最小端口

`Runtime.readConversation(ref, check)`：冻结的、当前受控 Conversation 的 transcript/display/live-tool/usage DTO；不暴露 Harness、Tx、配置、provider session identity、system instructions 或 opaque native fields。读取不 resume、不创建任务、不 commit。tail 有限且明确报告 truncation；完整 UI 分页由 P1 补齐，不能把 tail 当完整历史。

`Runtime.writeDisplay(ref, record, check)`：显式 namespace/actor/request/payload 去重，Conversation-local receipt 和有限容量；native entry 无模型贡献，保持 model head/requester，稳定回执经正常 reopen 保留。显示 card/chat 不是模型输入。

这两个口是 **trusted bootstrap port**，不是 Web 远端 API，也不是 Agent 可拿到的 capability。服务端负责把当前真实人类 authority 绑定成 check。错误/迟到撤权不会自动释放已 admission 的工作或退还调用额度。

### 实验与修订

- 初始真实端口案例先因不存在 API 失败；实现后从 `createRuntime` 到真实 pinned Durable、本地 HTTP、原生 tool 和 storage 验证。
- native watch 的 `stop()` 会 yield。追加反例证明清理间撤权仍可能返回 acquired snapshot；修订为清理后再检查，之后不再 await 才发布 DTO。
- 完整旧 suite 揭示了一个新测试的错误前提：本地模型默认 price `0` 不代表宿主给出了权威免费价格。恢复既有 `UsageDTO.cost = null` 语义；不改旧推理断言，不用 GUI 端口扩大计费声明。先前的 `usage-zero-red.log` 不是有效缺陷证明，完整失败与修订结果均保留。
- display 并发相同请求只提交一次；actor/namespace 独立；错误 shape、过大文本、旧引用无新 commit；运行中 chat/card 不改变原输入来源或下一次真实 HTTP。
- [原生 task probe](../../../integrations/pocket/native-jobs.test.mjs) 仅证明 public API 的取消/恢复机制：取消 waiter 的 exact reason 被观察到，任务继续存在；显式 abort 得 terminal receipt；checkpoint 经 writer close/reopen 后只恢复下一阶段，不重放 prepare。
- 早期 scratch `native-jobs.log` 的宽泛 rejection 曾接受无关 API error；已作废，不作为取消证明。只认修订后的 exact-reason 运行与已提交测试。后台任务服务仍须在 P1 绑定人类、额度和 effect-time checks，不能向插件直接暴露 native task。

### 权限/profile 决策

现有 DevPack 模式拒绝 RPC `spawn/configure/fork` 的 guard 保持原样。新 GUI 不能仅凭“人是 owner”或“profile 已在列表中”移除它。P1 必须建立 actor 可选 profile 与 profile 所含工具/Agent grant 的 ceiling，且在真实创建/配置/fork 的效果边界重验。普通 read 权限不等于 MAS send/discover；旧 v1 token 不自动变成人类 cookie session。

原生机制 **不需要新增 Durable patch**；采用公开配置/entry/watch/task API。controlled job、人类元数据、ceiling 和新版协议属于新 public port/service 工作，不能通过私有 import、改安装包或换 Durable cohort 解决。

## 5. 阶段证据与下一步

P0 日志、raw 本地 HTTP 与生成清单集中在 `artifacts/pakka-pocket/p0/`；[重现说明](../../../integrations/pocket/README.md) 指向版本化脚本和固定输入。最终阶段门禁：

| 主体                              | 结果                                                                            | 证据                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 编译 / build                      | pass，原 Durable patch SHA 未变                                                 | `check-final.log`、`build-final.log`                                                                                  |
| 核心全量                          | **263/263**，无 skip/todo/cancel                                                | `full-final.log`；前次计费前提错误的 262/263 失败保留                                                                 |
| 新读取/显示与既有推理             | **18/18**                                                                       | `usage-contract-green.log`；8 个新案例被全量 suite 包含，不重复加总                                                   |
| 固定来源 / 模块清单 / native task | **8/8**，无 skip/todo/cancel                                                    | `source-native-verified.log`、`source-inventory-final.log`；新增未跟踪 executable 的 red/green 保留                   |
| 仓库外真实 tarball                | 所有公开类型反例和 legacy/runtime/MAS/broker/DevPack/apps/product consumer pass | `package-final-green.log`；各类 HTTP 为 **7/3/3/3/8/2/18**，product 有 7 个原生 tool call/result                      |
| 新端口的 installed consumer       | pass                                                                            | runtime 仍为 3 次 HTTP；scoped/frozen/passive read、清理后撤权、display-only reopen dedup 与下一轮 payload 均实际验证 |

`package-final.log` 记录了一次类型反例注释被 formatter 移到错误行导致的失败；修正的是注释位置，不是类型边界或旧断言。重跑通过后才记录门禁。该 tarball 是新代码的开发快照，不更新已验收 M6/Dynamite 原 archive 的字节身份，也不发布或声称 Web 产品已经接受。

P0 不开启任何新的 broker receipt publication；[既有 provenance 跟进](../acceptance/MIGRATION-M5-ACCEPTANCE.md) 保持 fail-closed。P1/P2 下一步是持久人类身份/邀请、受控 jobs、profile ceiling、分页/事件和有限 Pocket protocol，再创建真正可运行的产品消费者。MAS Board 要等通用扩展与独立例子验证，不能先成为核心页面。
