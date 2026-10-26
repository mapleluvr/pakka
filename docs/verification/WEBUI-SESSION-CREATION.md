# WebUI 独立创建与 Session / Conversation 分组

日期：2026-10-26～27。实施基线 `8df0bf5`，产品/测试固定于 **`440e9cceb007a6f130be5c4bd8cf51f74cfbccd9`**。这是用户要求删除首页命名复用路径、执行已有创建方案后的实现者自检，不是独立桌面 GUI 验收。

## 采用与实现

- [change / proposal](../../openspec/changes/improve-webui-navigation-and-local-recovery/proposal.md)、[design §6.3](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#63-session--conversation-创建关系调查)、[tasks §4.3](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#43-session--conversation-创建方向2026-10-24)、[创建与导航 delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md#requirement-dedicated-creation-distinguishes-native-sessions-and-conversations)。
- [形成摘要及全部相关 specs](../changes/webui-navigation-and-local-recovery.md)、[前端 state](../state/frontend.md#创建与导航)、[服务 state](../state/webui.md#session-管理与个人导航)、[有限 API / 重开契约](../development/WEBUI-DEVELOPMENT.md#session-管理创建与个人导航)、[Runtime 初始配置](../reference/RUNTIME-API.md)。
- 主体：[Session 目录](../../apps/webui/src/sessions.ts)、[个人导航](../../apps/webui/src/navigation.ts)、[独立创建弹窗](../../apps/webui/web/creation.js)、[两种 sidebar 投影](../../apps/webui/web/conversation-groups.js)、[完整资源键](../../apps/webui/web/resource-identity.js)。

New Session 用公开 Runtime 建立独立 Durable storage、writer 和预算域。New Conversation 在明确父项内创建；初始模型/cwd 与 Conversation 在同次原生提交中建立，不用创建后再配置补丁。没有可用父项时只预填草稿，确认才顺序执行两步；父项成功后保留它及第二步原身份。创建、查看、检索、分组均不提交模型输入。

首页的命名 textarea、旧菜单和快捷键内嵌创建分支已删除；首页、sidebar 与快捷键都进入独立配置向导。已有消息 composer 只用于 Conversation 的明确 Send，保留原生 Prompt/Steer/Follow up、Stop、语音与未发送草稿。

Sort Per Session 按原生父项分组；Default 按每人持久单层文件夹及 Uncategorized（未分类）分组。跨 Session 归类、刷新及删除文件夹不改变归属、cwd、资源权限或已花额度。原有资源 grant、当前人类身份与创建权限复用，不新增模型名单、Session ACL 或文件夹 ACL。所有服务按完整 Session/Conversation 路由，receipt ID 保持原值，另带父 Session 寻址并核对响应。

## 可执行证据

测试使用真实 Pi Durable、`startPocket`、已认证 HTTP/SSE、真实浏览器和隔离存储；provider 均为本地确定性 HTTP。完整 runner 隔离 HOME、PI_CODING_AGENT_DIR 与浏览器 profile，不读取用户凭据或调用付费模型。客户端的错父项响应测试是有限 decoder 负向测试，不冒充真实服务效果。

| 证据                                                                                                                                                                                                                       | 结果与边界                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [基线 RED](evidence/webui-session-creation/red-baseline.log)                                                                                                                                                               | 真实 session.list 为 400；New Session 没有独立配置弹窗。2 fail。                                                                                                     |
| [初始配置 RED](evidence/webui-session-creation/initial-configuration-red.log) / [GREEN](evidence/webui-session-creation/initial-configuration-green.log)                                                                   | 原创建忽略初始模型；修复后原生配置与下一次本地 provider 请求使用选定模型，基础指令不被替换。                                                                         |
| [Session 寻址 RED](evidence/webui-session-creation/authorization-red-v2.log)                                                                                                                                               | 旧单 runtime 路径对新 Session 的合法读取返回 500；不是证明发生了越权泄漏。最终真实正向读取与同号 peer 拒绝同时通过。                                                 |
| [客户端关联 RED](evidence/webui-session-creation/client-scope-red.log) / [回执父项 RED](evidence/webui-session-creation/receipt-selector-red.log)                                                                          | 固定同号回执、协作响应不得跨父项误认；原生 ID 不被改造成 UI 别名。                                                                                                   |
| [创建 defaults](evidence/webui-session-creation/creation-defaults-red.log)、[只读目录](evidence/webui-session-creation/creation-directories-red.log)、[扩展寻址](evidence/webui-session-creation/extensions-scope-red.log) | 草稿配置与新 Session 服务的开发期失败保留，最终从真实弹窗选择模型/cwd 并创建、发送验证。                                                                             |
| [个人导航服务 RED](evidence/webui-session-creation/navigation-red.log) / [浏览器 RED](evidence/webui-session-creation/navigation-browser-red.log)                                                                          | 最终跨 Session 同号资源打开各自内容，归类/删除/刷新保留原生身份和已消费额度；不同人的元数据与资源授权分开。                                                          |
| [通知寻址](evidence/webui-session-creation/notification-scope-red.log) / [完成观察](evidence/webui-session-creation/notification-observer-red.log)                                                                         | 新 Session 沿所属 Runtime 读取/观察，不从根 Runtime 猜测完成。                                                                                                       |
| [超长模型 RED](evidence/webui-session-creation/long-model-red.log)、[首页命中区 RED](evidence/webui-session-creation/home-controls-check.log)、[句子粘连 RED](evidence/webui-session-creation/guidance-spacing-red.log)    | 直接截图补获的呈现问题；模型表单预览最多三行、完整名称由 picker 读取；图标按钮 44px；说明保留词句间距。                                                              |
| [开发期首轮全量](evidence/webui-session-creation/full-first.log)                                                                                                                                                           | 未固定的实施中快照：663 项 / 633 pass / 28 fail / 2 skip。包括仍定位已删除首页结构的旧用例，以及 source 内部字段导致有限 list 出口拒绝的真实 500。失败未改写成通过。 |
| [MAS 首轮](evidence/webui-session-creation/mas-first.log) / [修复](evidence/webui-session-creation/mas-green.log)、[旧入口迁移](evidence/webui-session-creation/migrated-green.log)                                        | HTTP 出口只投影声明字段，不放宽 schema/授权。旧首页用例迁到独立弹窗；保留真实配置、输入、手机 sidebar、MAS 和焦点行为断言。                                          |
| [受影响回归](evidence/webui-session-creation/affected-final.log) / [最终呈现补正](evidence/webui-session-creation/guidance-spacing-green.log)                                                                              | 49/49；另补正后的真实创建/布局 2/2。两步丢响应分别核对原 Session/create 请求，不自动补发；创建为零推理，之后明确 Send 才产生本地请求。                               |

## 固定候选门禁

同一 `440e9cc` 上运行 [build](evidence/webui-session-creation/build-440e9cc.log)、[check](evidence/webui-session-creation/check-440e9cc.log)、`npm test -- --test-reporter=tap`，三项退出码均为 0。全量原日志：[659 项 / 657 pass / 0 fail / 2 skip](evidence/webui-session-creation/full-440e9cc.log)。两项跳过仍为 Windows 不运行的既有 POSIX CDP 控制测试。

前一候选 `84c1dfe` 的[全量](evidence/webui-session-creation/full-84c1dfe.log)也为 657/0/2；直接读[预览首页](evidence/webui-session-creation/home-baseline-red.png)又发现创建图标与文字错位。[RED](evidence/webui-session-creation/home-baseline-red.log)测得中心差 7px、间距 0；`440e9cc` 增加 4 条布局声明和 10 行测量回归，[7/7 GREEN](evidence/webui-session-creation/home-baseline-green.log)实测间距 8px、中心差小于 1px，并重新执行上述全量，不沿用旧候选的像素结论。用户随后要求统一分组菜单、移除首页 New Session 圆角底并加短分隔线，另由后续 change 承接，不称本候选已完成该视觉要求。

另用[真实 New Session 正向脚本](evidence/webui-session-creation/session-entry-positive.mjs)补验勾选/不勾选首 Conversation 两条实际浏览器路径：[通过日志](evidence/webui-session-creation/session-entry-positive.log)确认两个独立父项、一条 Conversation、零模型请求。脚本是额外 1 个文件级检查，不计入上述 659 项。

相对开发期 663 项，删除了四个已不存在的首页 composer 子用例，由独立创建与布局矩阵替代，不把这个设计变更隐瞒成相同测试集。现存 Conversation composer 与 native 调度仍保留回归。

- [局部格式](evidence/webui-session-creation/format-check-final.log)、[OpenSpec strict](evidence/webui-session-creation/strict-final.log) 和 whitespace 通过。局部格式排除大文件 durable-adapter 的既有格式噪声，只保留 11 行功能增量；不宣称全仓 Prettier 已清零。
- 主动 LSP：[四个服务路径](evidence/webui-session-creation/lsp-final.txt) 4 clean；[其余十五个路径](evidence/webui-session-creation/lsp-source-final.txt) 9 clean / 6 inconclusive，无已报告错误但不称全部路径零诊断。[按钮补正两路径](evidence/webui-session-creation/lsp-alignment.txt)为 1 clean / 1 inconclusive；全仓 TypeScript check 的通过独立记录。
- [gate receipt](evidence/webui-session-creation/gate-receipt.json) 绑定实际命令/退出码；[manifest](evidence/webui-session-creation/manifest.json) 绑定候选 40 个产品/测试 Git blob 与 57 个原始证据文件的字节数/SHA-256。raw 证据受仓库 -text 规则保护。最终封存提交相对该候选的 apps/packages 为零 diff。

## 浏览器呈现与预览

[布局证据](evidence/webui-session-creation/layout/dark-14-1440x900.png)覆盖 1440×900、360×600、390×650，dark/14px 与 light/20px；每图附同名 JSON。真实键盘覆盖初始焦点、嵌套 model/directory picker、Tab 循环和 Escape 回返，检查视口溢出、字段间距和命中区。另保留[开发期长名称失败图](evidence/webui-session-creation/layout-red/dark-14-1440x900.png)。这些是功能/几何与实现者直接读图证据，不是独立 GUI 验收。

新隔离预览为 **http://127.0.0.1:45007**：独立 data/profile、本地 responder、13 个明确的本地模型条目；初始无已创建的用户 Session，便于检查首次两步向导。已有 45006、45005 和更早预览的数据/登录未替换；不宣称旧进程仍在线。

- [10 个实际静态资源](evidence/webui-session-creation/preview-served-assets.json) 均 HTTP 200，与固定候选 checkout 字节一致，包含三个新模块、样式和不变的 reference.css。
- [登录核对](evidence/webui-session-creation/preview-login-status.json)：在独立持久 profile 登录，完整退出并重启浏览器后仍认证，设置过程模型请求为 0；之后已请求打开可见新窗口。token 仅留在 ignored 本地文件，不放入聊天或正式证据。
- [预览首页](evidence/webui-session-creation/preview-home.png)保留明确创建入口，不再提供命名消息框。

## 未覆盖与非目标

- 按操作者本会话 note48，不安排独立 reviewer/双评；历史失败与未完成记录不改写。
- 指定 agent-workspace-linux 独立桌面工具仍不可用，GUI acceptance 为 **BLOCKED**，普通 browser/Windows 预览不替代它。
- 当前页面内关闭/重开可保留并核对创建原请求；整页刷新/关闭浏览器后的未确认创建草稿恢复未实现/未验收。已登记 Session、模型/cwd、回执与额度的正常服务重开已由真实测试验证，不能与前者混淆。
- 丢响应测试不证明任意 native IO 故障可自动恢复。未知初始化不自动再进，writer claim 不自动清除；已确认子存储重开失败时当前工作区启动失败。
- Session 删除/迁移、共享或多层文件夹、跨 Session 全局预算、进程隔离不是本次交付。Plan mode、Goals/Done when 继续不在范围内；其他路由/本机管理员恢复任务保持独立未完成。
