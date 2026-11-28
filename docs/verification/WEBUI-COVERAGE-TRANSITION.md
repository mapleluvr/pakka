# WebUI 检查的覆盖接续

本记录用于阶段 5 退出旧前端时逐项核对独特风险。阶段 4 原回归的 failed/incomplete 状态保留在其候选记录中；新检查使用实际服务和新前端，分开记录结果。只在对应覆盖已核对后移除旧实现专属检查。

## 已核对的文件/Git

| 旧检查                                     | 独特风险与接续                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/webui/test/files-boundaries.test.ts` | 外部编辑冲突、只读成员读取/伪造写入、真实图片字节：`files-http` + `apps/server/test/pocket-files`。草稿保留、图片解码、390px 操作由阶段 4 文件插件真实页面检查覆盖。       |
| `apps/webui/test/files-browser.test.ts`    | 编辑/上传/导出、Git diff/分支与受控 worktree、零模型输入：`files-http` + `pocket-files`。HTML 不执行、主题字号与窄屏、弹窗/样式释放、丢响应恢复见阶段 4 文件插件真页证据。 |

`files-http` 通过真实 Cookie/CSRF 与 Person/Server 身份访问公开 extension RPC，额外核对另一资源拒绝、实际落盘后丢失返回、外层 operation → 原生文件 receipt 的准确身份与一次写入计数。首轮把确定冲突误写为 unknown，按原生 `PocketFileConflict` 与 backend 映射修正断言后通过，产品行为未改。

新文件保持 heavy；默认 release 和 webui affected 按目录纳入，原生边界测试继续保留。已读并核对旧检查的全部断言；永久 HTTP 检查不宣称证明浏览器图片解码、草稿或排版。

## 已核对的 MAS 执行与 Memory 恢复

| 旧检查                       | 独特风险与接续                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composition-main.test.ts`   | 保留 executable 的可信 ESM 装配、可选 Agent/WebUI 声明、私密 owner 链接和实际 spawn 工具；调用改走真实公开 HTTP，2 次模型请求创建成员通过。                                                   |
| `mas-board-busy.test.ts`     | `mas-http` 保留真实在途 prompt、steer/followUp 队列、abort 后 unanswered/aborted 及成员仍 active，核对 Provider 请求与原生回执。                                                              |
| `mas-board-removal.test.ts`  | `mas-http` 保留服务端按成员过滤的真实响应、只读写入拒绝、WebUI facet 停用不停止已接纳工作、成员/历史保持、无插件重开原 Session 后普通输入可用。页面/样式消失另由新 SDK 真页生命周期证据覆盖。 |
| `mas-board-recovery.test.ts` | `mas-http` 保留原 operation 查询与他人查询拒绝；阶段 4 `mas-send-recovery` 的真实页面断响应/刷新/原 Session 重开只有一次写入、一次查询，成员面板关闭/返回另有真页记录。                       |
| `memory-recovery.test.ts`    | `memory-http` 保留落盘后丢返回、两层身份、实际批准上下文；阶段 4 Memory 新页面记录覆盖外层响应丢失、刷新重开、内层 unknown 与一次恢复，列表状态不会代替原回执。                               |

上述 HTTP/原生检查均已运行通过；MAS 首轮登录邀请使用交换前旧身份、次轮用短数字 ID 做全文 substring 检查，均是测试准备/断言问题。分别修正真实登录顺序与精确 JSON 字段匹配后通过，没有放宽产品权限。新 HTTP 文件/共享登录 fixture 保持 heavy；没有把其结果当作 UI 验收。

## 已核对的 MAS 装载、视图与通知

| 旧检查                                    | 独特风险与接续                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mas-board.test.ts`                       | 原生 spawn/send/reply/retire、来源/owner/lifetime、真实 Provider 和原 Conversation：`composition-main`、`mas-http`、`mas-resource-navigation`、`packages/mas-devpack/test/workbench` 与阶段 4 MAS 真页。默认 CLI 新页面另核对成员输入、键盘图位置、Graph/Agents/Activity 切换、390px 关闭回焦；旧 CSS 坐标和固定选中 DOM 退出。 |
| `mas-devin-adoption.test.ts`              | 旧栏宽、圆角与 Preact composer 形状退出；真实成员输入/原 Conversation、确认前不 retire、窄屏与 modal 生命周期接续于上述 MAS 真页及原生权限/操作检查。                                                                                                                                                                           |
| `mas-stylesheet-browser.test.ts`          | 默认 CLI 的真实 `board.css` 被留置时无成员控件；真实 503 后无成员控件并显示失败，恢复后明确刷新插件能装载。记录 `mas-css-held/failed`，没有使用模拟 CSS 完成事件。                                                                                                                                                              |
| `notifications-browser.test.ts`           | `notifications-http` 与原生 `pocket-notifications` 保留设备/Person/资源授权、真实 TLS 接纳、正文过滤、偏好隔离和注销/撤权拒绝。阶段 4 原生浏览器订阅、关页远端唤醒、Windows 实际显示、撤权及晚到清理独立证明系统显示；旧测试中的自动授予通知权限退出。                                                                          |
| `notification-navigation-browser.test.ts` | 原事件再次授权、打开原历史且零重放接续于阶段 4 Windows 通知点击实测；目标地址隔离、打开配置窗时撤权清理与默认安装后的原 Conversation 恢复另有真页证据。旧 fragment 和旧设置页 DOM 退出。                                                                                                                                        |

阶段 5 默认 CLI 未传 frontend，登录使用其真实生成的私密链接；新的普通输入样例一次提交、刷新保留完整原请求、正常停止/重开同一 Session 后一次 `input.lookup`，Provider 共一次。首轮直接断开连接触发 Chromium 同 requestId 的网络重试，后端去重正确，但该轮不计只读恢复；第二轮返回不可解码正文才进入真实待核对，原失败记录保留。390px 的脚本/CSP 错误为零。MAS 的入场动画等待、`done` 状态文案和拖动把手未获键盘焦点造成的探针失败分别保留，后续沿原请求/实际键盘焦点复验，没有重复模型输入。

可信 ESM executable 同时补齐既有公开 `frontend`、`modelConfiguration` 选项的顶层校验；真实 executable 反例先失败，原测试扩展后通过。JSON 配置闭合字段不变。

## 已核对的旧外观与壳层形状

以下文件逐条对照断言后退出其旧 Preact 对象。新页面依据独立 React/Astryx 的已采用交互设计；不继续约束 Devin CSS 摘要、侧栏宽度、palette 结构、旧 split-button 或旧组件内部 class。

| 旧检查                                     | 保留的行为与证据                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devin-reference.test.ts`                  | 旧固定 CSS/HTML 链退出；固定前端由归档摘要、manifest 全成员/资产校验与仓库外安装保证来源和完整性。                                                       |
| `devin-adoption-browser.test.ts`           | 旧首页/设置栏的像素布局退出；新建/导航/设置不产生输入、实际发送、手机阅读和外观由阶段 4 工作台、配置、外观及最终安装真页承接。                           |
| `devin-palette-browser.test.ts`            | 旧 Commands palette 与 Settings rail 的同次渲染形状退出；新 SDK 页面导航、插件刷新/卸载、弹窗取消/回焦与四 facet 控制见阶段 4 facets/MAS/工作台证据。    |
| `devin-shell-browser.test.ts`              | 新建的初始配置和真实请求模型由 workspace/model HTTP 与阶段 4 创建/配置真页保留；旧首页命名方式、palette 和侧栏收起形状退出。                             |
| `appearance-browser.test.ts`               | 字体/字号/模式持久化、刷新与页面内草稿保留、零模型请求见 voice/appearance 和 WORKBENCH-INTERFACE；当前 24px 字体 token 与旧 14px/Inter 默认值分开。      |
| `composer-focus-browser.test.ts`           | 键盘可达、回焦、发送/停止与输入保留见工作台/实时输入真页；固定圆角/outline 所属节点和旧 split-button 像素检查退出。                                      |
| `composer-hints-browser.test.ts`           | 权限/忙碌准入、原生 steer/followUp 与明确停止仍由原生 workspace、`mas-http` 与阶段 4 队列真页覆盖；旧内部 96 组合 helper、提示绝对位置和 Stop 槽位退出。 |
| `mobile-sidebar.test.ts`                   | 新导航抽屉取消、回到原目标、草稿保留与零模型请求由阶段 4 工作台/最终安装真页承接；原 scrim class/aria 文案退出。                                         |
| `short-sidebar.test.ts`                    | 新工作台列表/插件入口/设置在短屏与大字下可达，见 WORKBENCH-INTERFACE 的 952×532、390px 与24px检查；不维持旧侧栏 12 行/100px 区域。                       |
| `typography-accessibility-browser.test.ts` | 字体 token、移动控件与真实键盘焦点/输入草稿检查继续在新页面验收；旧字号比例与 root/textarea 私有样式不再冻结。                                           |
| `typography-spacing-browser.test.ts`       | 长模型名/成员名、私密设置、协作字段、图标和大字窄屏分别接续于配置/人员/协作/最终固定制品真页；旧 Preact 公共组件和 Title Case/固定比例退出。             |

这些文件中的模型输入/预算、凭据写入/私密值与人员/协作权限均仍由所属原生和公开 HTTP 回归保护，未删除这些服务检查。对应真实 UI 的行为结果与几何证据分开，不以类型或格式检查代替。

默认 CLI 另补验 390px 的原生 Tab 焦点（实际 2px outline）、导航 Escape/关闭回焦及未发送草稿保持；Provider 计数不变。MAS 退休成员经个人隐藏、切 Agents、刷新、恢复显示后仍保持已退休，未重新激活，未新增模型请求。对应旧 `mas-board-presentation` 的 Preact sheet/同步 DOM commit 形状退出，成员寿命与原历史仍由 MAS 原生/HTTP 核对。

## 已核对的错误历史与工具正文

- `error-history` 保留为真实新服务 HTTP 回归：清空隔离凭据后的失败历史经过正常 Session 重开、`resource.history` 投影与公开 decoder，原错误、同一回执与已消耗次数保留，Provider 为零。
- `input-failure` 保留并改用 `/pakka-webui`：原失败回执不重放，显式新输入仍进入同一 Conversation，原条目 ID 保持；旧浏览器部分由默认前端真实失败/新输入/原 Session 重开核对承接。
- `input-outcomes-http` 保留策略阻止、原生 Host unknown 与排队撤回三种不同结果。它使用真实策略、注册来源及本地 Provider，核对 `blocked`、`unknown`、`aborted`，不以权限拒绝替代这些结果。
- `importmap-browser` 本身不依赖旧页面，继续保留并通过：生产 CSP 下 LF/CRLF/CR 三种 importmap 均实际执行，没有 `unsafe-inline`。
- `transcript-parts-browser` 中同源工具从流式声明到落盘的展开保持、继承结果与同 call ID 当前调用隔离、声明不在当前页、AVIF 下载提示、工具失败折叠标记，已在默认固定前端与真实 Runtime 上重新核对。隔离样例用公开 Durable commit 准备历史，真实 Provider 产生新的工具调用；两条来源各自保留原文，当前工具恰好执行一次。错误历史/显式新输入/重开样例共六次 Provider 请求，各实际动作独立计数；原 tool error 卡折叠时无正文节点。一次探针对离屏错误节点过早断言失败，随后回到原历史核对成功，未重发输入。

正文长原文、图片、下载、跨 64 KiB 搜索、停止/晚到读取与撤权的实际证据见阶段 4 content-summary；原文模式/切页位置/窄屏见 WORKBENCH-INTERFACE。它们接续 `lazy-content-browser`、`original-search`、`content-cache`、`disclosure-state` 的旧阅读器；旧 LRU 类/私有 helper 已由独立前端的按页/按可见内容生命周期替换。服务端 `pocket-content`、原生 `entry-preview`/`live-preview`、`content-download-http` 与 `stored-history` 继续保护字节、范围、来源、权限和只读语义。

## 已核对的历史分页与焦点

`history-browser`、`history-window-budget-browser`、`virtual-history-browser`、`virtual-window` 的独特浏览风险在默认 React 阅读器再次核对：真实 80 条 display-only 记录分 32/32/16 条读取，三个页面的原 Entry ID 不重复、总计完整；请求保留 limit 32 / maxBytes 131072，最大实际 JSON 响应 82156 字节。当前页搜索明确限定范围，最早记录能在其所属页找到，返回最新后重新读取最新页。浏览没有产生模型输入；旧累计页拼接/4 MiB LRU/私有几何函数由单页有界读取替代。

真实工具结果的原文搜索框获得焦点后滚到另一端：保留同一个聚焦节点，DOM 只有 6 行；转移焦点后旧节点释放，剩 5 行；返回时展开状态与原搜索词恢复。观察与查询共用真实服务，全轮仍为命令样例的 5 次显式输入，历史浏览新增 0；脚本/CSP 错误 0。证据 `history-pages-after.json`、`history-focused-row.json`。探针曾读到隐藏旧页面、在虚拟几何调整时自动滚动失败、误用原生 disabled 判断 Astryx aria-disabled，以及 exact-text selector 未匹配；原失败保留，未据此改产品行为。

## 已核对的命令分流与插件状态

`slash-input-browser` 保护的 literal slash、命令发现失败、JSON 参数拒绝与停用命令均在独立页面实测。核对时复现并修正 Composer 一律拦截 slash、按 App 目录查 Conversation 命令、缺少 Backend action 入口三处缺口。界面命令沿所属实例 dispatch，Backend action 使用公开 schema/scope/effect、完整原绑定与持久请求。

写入响应不可解码后，刷新/原 Session 重开/Backend 停用仍可按原请求只查一次；unknown 不重放，新草稿保留。App write 在另一 Conversation 恢复同一原请求一写一查；关闭页面、晚到响应与撤权清理通过。read 不产生持久 operation，失败保留草稿并可重新读取。第一版把 read 也加入恢复，真实查询被拒后按原生契约纠正，反例保留。

`extension-browser` 的 GUI-only、共享 runtime、公开实例/浮层/命令入口由阶段 2 playground/RSI 与阶段 4 facets 真页接续；本轮再次验证真实 display 卡片和私有 App 设置不成为模型输入，只有显式普通输入产生1次本地 Provider 请求。只读成员读自己的结果、不显示他人 pending，查询他人回执被拒。`extension-host/http/facets` 的持久/授权/真实内容保护继续保留。旧 Preact 单例/Commands palette/固定类名与已退出示例的 UI 形状不再约束新宿主。

`preferences-loading-browser` 仅服务退出的 Preact preferences 示例：初始读取不得覆盖已编辑/确认状态的风险由阶段 4 原生模型设置、文件/Memory/协作草稿检查及本轮命令确认期间新草稿保留接续；其 settings CAS/私有值由 extension-host 原生检查继续保护。

临时结果入口 `pakka-webui/docs/.temp/phase-5/commands-summary.md`。两轮服务正常退出：首轮0模型/5次不同卡片效果，最终轮1模型/3次不同卡片效果。完整监听的最终作用域/关闭/撤权/只读检查无脚本/CSP错误；缺监听、漏确认、留置超时和接纳/完成断言混淆的旧探针不计通过，均沿原请求继续。

## 已核对的模型、preset 与预算

| 旧检查                                                       | 保留的行为与证据                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model-picker-browser`、`model-index-browser`                | 模型目录的可搜索/键盘选择、取消回焦、长名称与移动尺寸接续于阶段 2 模型双入口和阶段 4 工作台/工具栏；`model-catalog-permissions`、`model-configuration` 保留真实目录、权限、配置独立性。旧按 profile 别名生成模型索引、循环高亮与固定位置计数退出；新目录按原生 provider/model 查询、分页，完整身份精确选择。                                             |
| `product-models-browser`                                     | 原生目录分页和无推理读取由 `webui-services` / `product-model-http` / `product-models` 保护；独立前端阶段 2 真页搜索/分页、设置新连接和实际 Provider 请求核对模型/Thinking/端点/header。新建的 model/Thinking 来自 Person 缺省或服务默认，创建后可独立修改，当前已采用的表单不再携带旧 picker 草稿。                                                      |
| `product-model-settings-browser`                             | 本文件专门验旧 Provider 登录流程；新前端 Provider `/login` 按用户决定延期。旧页面退出，原生 `product-models` 和 `product-model-http` 的凭据私密性、登录身份/撤权与实际 auth 存储检查继续保留，不能据新连接编辑宣称认证流程已迁移。                                                                                                                       |
| `product-preset-browser`                                     | 改为 `product-preset-http`，真实登录后创建独立 Session 和 read-only Conversation，显式选择另一模型/Thinking，再经过生产输入与工具执行：3次 Provider 请求、允许原生 read、工具清单无 write/edit/shell、模型伪造 write 后原文件未变。页面的 preset 选择/回执/窄屏由阶段 4 configuration 真页接续。原生 `product-runtime` 另保护伪造 shell 和实际落盘效果。 |
| `configuration-browser`、`independent-configuration-browser` | 当前模型与 preset/目录独立、实际请求、只读限制、私密配置不进入读取结果由 `model-configuration` / `model-catalog-permissions` / `webui-services` 和阶段 4 configuration 真页接续；目录变更丢响应后刷新/原 Session 重开，1写1查，实际 nested 目录保持。                                                                                                    |
| `configuration-recovery`                                     | 新配置事务回执替代仅刷新当前值的旧恢复：原模型/目录/preset 参数持久保留，unknown 不释放、换绑后只查原请求；阶段 4 configuration/mas-config 与共享宿主换绑实测覆盖。新实例/读取取消保护晚到旧结果，见配置撤权与 SDK 生命周期证据。                                                                                                                        |
| `budget-browser`                                             | `webui-services` 的真实预算写入、旧版本冲突、他人/另一 Session 原回执拒绝、分页审计及原生预算/重开检查继续保留；阶段 4 budget 原请求跨刷新重开一写一查、冲突草稿、子 Session 隔离、已耗次数和390px表单分别核对。旧设置分类/内部属性退出。                                                                                                                |

本轮已通过 `product-runtime`、`model-configuration`、`model-catalog-permissions` 三文件及 `product-preset-http`。后者首轮编译把创建 Session 的 `managed.session` 误认成登录 `session`，按真实公开结果类型修正后运行通过。

## 已核对的 Session 创建与恢复

`session-creation` 的原生身份、独立预算、输入归属、重开和同号资源权限隔离检查保留，并迁到 `/pakka-webui` 的实际登录与身份绑定。其唯一旧浏览器取消检查由当前390px创建表单的名称草稿、目录浏览、Escape取消、回焦和零创建请求接续；旧首页命名表单形状退出。

`session-recovery-http` 迁到同一公开接线，保留原 Session 来源不可得、安全错误、当前权限和恢复原存储。`session-recovery-browser` 的独特丢响应/后续目录失败已在新页面实测：复现响应丢失后成功刷新仍锁住其他 Session 的问题，分开发送状态与待读取状态后修复。读取失败保留待核对，成功读取后继续另一项，已确认重开不被随后的目录失败覆盖；两项各重开一次，原历史保留，三个 Session 预算为1/0/0，模型总计仅原输入的1次。两文件回归通过，当前页面类型/构建/主动 LSP通过。临时入口 `session-recovery-summary.md` 记录旧构建误用与采集器并发写入失败，最终计数来自服务内存退出快照。

## 已核对的人员、协作与实例生命周期

| 旧检查                                        | 保留的行为与证据                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `browser.test.ts`                             | 真实输入/工具效果及 Cookie/CSRF 继续由 `product`、`http`、`input-recovery` 与最终固定安装保护；邀请、独立 Person 可见性、只读准入和撤权清理见 `webui-services` 的 People HTTP 用例、`pocket-people`、阶段 4 people/collaboration 真页。旧登录 fragment 和旧通用侧栏 DOM 退出。 |
| `busy-browser`                                | 原生在途输入、steer/followUp 在首笔尚未完成时接纳由 `mas-http`、原生 workspace 与阶段 4 普通输入队列真页接续；实际 Provider 内容与回执仍核对，旧 Working/Ready 文案退出。                                                                                                      |
| `collaboration-browser`、`collaboration-late` | 阶段 4 collaboration 真页覆盖归属、聊天/notes 不进入模型、并发草稿、reaction/pin、presence 与 driver 的真实输入准入；关闭/换目标后的晚到读取、撤权、只读身份和390px另有记录。`collaboration-http` 与原生 `pocket-collaboration` 保留权限、原子 CAS、持久回执和版本冲突。       |
| `invitation-role-browser`                     | 角色/资源授权、单次兑换和无授权者不能提升权限继续由原生 People 与 `webui-services` 的 People HTTP 用例保护；新页面实际创建、改权、撤销和跨重开恢复见阶段 4 people。新选择器只编辑草稿，提交由独立确认入口执行；旧四行菜单、阴影、行高比例和键盘循环形状退出。                  |
| `credentials-browser`                         | 新 API key/OAuth 交互按设计第40行和用户决定延期，不能宣称已迁移。原生 `pocket-credentials`、HTTP/client 的替换/清空/查询、私密值隔离和真实 auth 检查保留；`error-history` 再次证明清空后不回退启动凭据。旧凭据表单及其刷新按钮生命周期随该表单退出。                           |
| `extension-instance`                          | 新 SDK 阶段 2 实例隔离、阶段 4 facets/files 的替换/卸载/样式释放及本轮命令关闭/晚到响应证明旧实例不能恢复界面；`mas-http` 保护停用 WebUI 后已接纳工作继续。旧 Preact 组件包和实例 DOM 退出。                                                                                   |
| `voice-browser`                               | 新听写先预览、显式插入、再发送；阶段 4 voice 受控事件样例覆盖取消、手动草稿、切页与旧实例回调隔离，实际显式发送另核对。旧直接修改输入框/旧8192字符上限/旧图标DOM不再固定；原生录音因用户无设备授权跳过，识别质量仍未验证。                                                     |
| `copy-presentation-browser`                   | 创建确认/取消零输入、目录作用域、预算、协作与停止观察的行为分别由 Session/预算/协作/facets 真页与上述服务检查接续；旧说明文字数量、菜单层级和自动进入 People Chat 的 composer 模式退出。                                                                                       |

这些文件均逐条读取后按所属契约接续。保留 test browser helper 及其真实键盘、reload、启动/回收检查；它们仍被 CSP/importmap 检查使用，属于验证基础设施，不随产品页面退出。

## 已核对的导航、创建与设置

| 旧检查                                                           | 保留的行为与证据                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation-creation-browser`                                  | 新表单分别创建 Session 和 Conversation；模型/Thinking 使用 Person 缺省或服务默认，目录/preset 明确选择。阶段 4 工作台创建及配置真页、`session-creation`、`product-preset-http` 保护原生归属/预算和真实工具效果。旧双层表单与初始模型 picker 形状退出。              |
| `creation-recovery-browser`                                      | 本轮真实页面分别丢弃已落盘 Session 与子 Conversation 响应：各一次写入、一次原查询，恢复 Session 后未自动创建子 Conversation，显式确认才创建。另一 Person 的 create 在到达服务前被切断，刷新后只查一次，空查询保留原请求并锁定新建入口，没有新增资源。               |
| `navigation-recovery-browser`                                    | 阶段 4 metadata 落盘丢响应后按原请求恢复；本轮另覆盖未到服务端的 rename：刷新与空查询后保持原请求和管理锁，没有版本变化。`navigation-http/reconcile/reopen` 保留 CAS、原回执、权限和跨重开关系。                                                                    |
| `navigation-browser`                                             | 改名/归档/恢复/搜索与真实 fork 由阶段 4 工作台和原生/HTTP 保护。新消息 header 的复制经原生粘贴逐字核对，用户可修改草稿再明确发送；旧一键 use-draft 入口由该交互替代。消息分叉指向原 Entry，后续执行由原生 fork/持久历史检查保留。外观刷新与未发送草稿另有真页记录。 |
| `personal-navigation-browser`                                    | 个人文件夹/删除后回到未分类、原资源保持见阶段 4 workspace-mutations 和 `navigation` 原生检查；本轮两个独立 Session 的相同 Conversation 10 分别读到各自实际保存内容，未串入另一份正文，浏览模型请求为零。                                                            |
| `navigation-controls-browser`、`session-creation-layout-browser` | 新工作台的表单取消、回焦、目录浏览、390px与大字控件由 Session 恢复和工作台界面真页核对；个人组织使用 Astryx 选择器，已确认选择才提交。旧 transparent pair、灰色分隔线、菜单循环与旧字号比例随实现退出。                                                             |
| `settings-navigation-browser`                                    | 本轮真实 People HTTP 读取完成后留置返回，切至外观再释放：可见页保持外观，返回原 Conversation 后未发送草稿保持；390px无横向溢出、零模型请求。新设置为独立可寻址页面，旧 Settings rail/Back/class 形状退出。                                                          |
| `observation-hub`                                                | 旧 SharedWorker hub 的内部连接合并与120秒回收形状退出。新实例按可见性/身份清理自己的观察，阶段 4 普通输入/协作及阶段 5 命令晚到清理实测接续；`observation-stream-http/scope-http` 与 client observation 的事件身份/顺序/授权检查保留。                              |
| `svg-iconography`                                                | 旧 Preact Icon 与目录字符串扫描退出；独立前端及新插件直接使用 SVG/Astryx 图标，图标命中区域与可访问名称继续按前端规范在实际页面核对。它不承担服务或持久化契约。                                                                                                     |

本轮隔离服务最终零模型请求、零服务错误并正常退出。创建成功分支共 session.create/create 各一次，纯查询各一次；未送达 create/rename 各一次运输尝试，各一次空查询，未产生写入。计数来自受权独立观察者的内存快照。最初采集器错误沿用已轮换登录身份、样例 requestId 格式、入口定位、fragment 未重建文档及一次刷新后缺错误监听均保留；该次 Session 恢复仅计结果/计数，不冒充脚本零错误。之后子 Conversation、两种空查询与设置切页完整监听通过。临时材料入口 `workspace-boundaries-summary.md`。

## 安装消费者与旧 SDK 退出

安装消费者继续从空目录中的真实 tgz、公开 imports 和 executable 执行；登录交换、身份头、版本和 closed decoder 统一由 `consumer-webui-http.mjs` 使用 `/pakka-webui`。旧浏览器 DOM 部分按上文逐项的新页面证据接续，安装结果只声明其实际 HTTP、原生效果和包边界。

- `consumer-pocket-product` 保留模型选择、真实输入、私有 preferences、只读成员拒绝、原回执/预算重开，以及清空 Provider 凭据后不回退启动凭据。
- workflows/Memory/hooks/schedules/controlled/MAS 保留真实文件/Git、批准上下文、签名投递与密钥轮换、原 job/checkpoint/delivery、审批允许/拒绝的磁盘效果、受管浏览器实际 navigate/fill/click/截图、MAS spawn/send/reply/retire；分别核对旧回执、重开、权限和 WebUI facet 停用后工作继续。普通回执查询不宣称额外制造了丢响应；该分支由上述真实页面故障注入证明。
- `consumer-pocket-notifications` 保留真实 TLS 接纳、VAPID 签名与解密、Person 偏好过滤、unknown 不重放、设备停用和撤权/注销后的正文拒绝。移除旧 CDP 自动授予权限/模拟 push 显示分支；系统显示使用阶段 4 原生订阅、远端唤醒与 Windows 真机证据。
- `consumer-pocket-voice` 退出旧页面的直接插入/取消 DOM。新听写预览、显式插入、草稿保护和生命周期由阶段 4 事件样例接续；通用显式输入/原历史/只读权限仍由安装产品检查保护，真实录音仍按用户无设备授权跳过。
- launcher 继续调用 npm 安装的 shell shim，逐项读取并核对 manifest 中713个资产的 SHA-256，以实际生成的 `#session` 登录；无宿主 JSON/已选模型可启动，切换 shell 工作目录后重开同一 Session。RSI 安装链路改用新公开版本，保留真实 Bot→工单→MAS worker→原 Session 重开。
- `consumer-browser.ts` 从独立 React SDK 消费公开类型与 context。headless consumer 显式带入 RSI 的 protocol 归档，独立安装后确认 React/Astryx/WebUI 未被带入。旧 Preact UI/SDK、已退出示例及重复构建删除；`@pakka/webui` 构建先清空自己的 dist，避免旧模块残留进包。旧 `frontend-controls.ts` 随其最后一个消费者退出；通用 browser helper 和 CSP/importmap 基础设施保留。

上述分组已在安装后的 Node 24 consumer 单独运行通过。测试准备和断言问题均保留：headless 漏归档导致 offline 安装失败、拒绝断言误比 message 而非 code、configuration.current 字段错读、MAS 配置目录与 inbox DTO 错配、launcher 仍请求旧 app.js，以及一次日志路径重合导致 EBUSY。完整 smoke/release 的最终结果另记，不以这些局部通过替代。

## 后续交付

产品旧消费者、SDK 和重复资产构建已按覆盖关系退出。最终固定归档、完整 smoke、默认安装、部署与兼容回退已经核对；release 274 文件完成后，三个失败文件经旧登录接线修正和短目录 15 项复验收口。完整结果、平台跳过和 Windows 深目录 ACL 限制见[阶段 5](INDEPENDENT-WEBUI-PHASE-5.md)，历史阶段 4 的失败状态保持原记录。
