# MAS Board 两轮试写与 P1–P6 复核

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [MAS Board 当前设计草案](../../MAS-BOARD-DESIGN.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

## 1. 这次工作的经过和范围

我们先完成了一份能从开头读到结尾的 [v1](../design/MAS-BOARD-DESIGN.v1.md)，然后才开展下列第二轮复核。[v2](../../MAS-BOARD-DESIGN.md)在这次追踪中形成：具体字段、动作和旧材料改变了第一稿里一些看似自然的安排。

alphaworld-swe 在这里既用于阅读已有成果，也作用于作者组织草案的方式。A／B／C 的使用例子与实际 source、owner、reply、readiness 等契约互相检验，使对象对应、阅读顺序、实现接点和状态记录得到重新组织。具体反馈和材料参与了这次设计的形成。

本轮覆盖 P1–P6 各阶段的产品文档，以及与身份、人员权限、传输、扩展、MAS、配置、历史和交付有关的实现接点。下面逐项列出检查材料、判断和改动；这是一轮作者复核，范围不是全仓每一行代码的独立安全审计，也不替代原先指定的 P6 双方对抗审查。

工作树是 `pr1-gui-acceptance`，基线提交 `aa1589a`，分支 `feat/mobile-navigation-projects`。原有未提交的手机导航、独立模型／cwd 等变更在本轮开始时已保存 diff，原数据与预览继续保留。

## 2. 第二遍怎样改变了第一遍

### 2.1 先辨认实际对象，再组织画面

v1 已区分 Agent、Conversation、Member 和示例别名，但对“创建关系”的解释仍容易顺着图形想象走。沿 `createMasWorkbench` 的成员投影、`MasClient.spawn` 和内部 source 校验读下去，发现：

- parent 是 owner 匹配出的管理来源；
- spawn 的 source 属于被绑定的 MAS 名册；
- 普通工作区和 MAS 的 key／名称可能相近，资源和权能仍分别绑定；
- incarnation 更新影响调用引用，不能顺带把图上的同一资源当作新 Agent。

v2 因此把图的初始来源、稳定身份、创建／管理／历史三种关系写在元素之前。通用导航的工作也更具体：服务端注册受控资源提供者，在完整 Conversation 链路保留其原授权。仅把成员加到 refs 列表，解决不了管理权和输入权的对应。

### 2.2 从画双向箭头，进入交流的形成方式

第一稿的 B 问 C、C 回答 B，容易让人以为现有 reply 回执已经保存了问答关系。实际 `MasClient.reply(id)` 只是先验证原回执，再选定回投目标；当前投递 DTO 没有 replyTo、正文和时间。

同时，人类成员面板可以通过 `memberClient(ref)` 使用该 Agent 的 source 代发。source 不能单独证明模型自主发言。

第二稿据此分开发送／接收资源、实际发起方式、授权 principal 和已持久的回复关联；旧记录按可证明的信息展示。通信线的计数也限定为不同投递身份，并说明当前加载与授权范围。图和日志要用同一份受控记录，分别承担读图与阅读对话的工作。

### 2.3 活动卡片由观测构成

“有 live message 就能显示当下活动”的概括还不够。当前快照有 busy、assistant 内容块和工具状态，但缺明确的请求阶段、完整事件序列和结构化错误；数组中有 thinking，也可能已经转到回复或工具执行。

v2 写明当前阶段／活动块、callId 关联、并行工具、空闲后的上一条回复，以及观测过期的含义。卡片片段与错误详情均沿原资源权限和脱敏规则发布。完整错误不能仅因点击详情就取得更大可见范围。

### 2.4 把既有反馈接续到当前工作

阶段文档各自保存了真实历史，但页首的“当前未验收”与后来用户反馈、通知 r4 等记录并列时，读者会误以为旧缺口仍在。我们新增 [当前状态入口](../../PAKKA-POCKET-STATUS.md)，核销已由用户确认的五项，再让阶段页承担它们各自的实现与历史证据作用。

第一次试写在使用普通 Conversation 时提到“用后删除”。复核实际 navigation 后，发现产品提供的是归档／恢复，而 MAS 提供退役。v2 明确了当前效果和后续删除契约，避免把同一个动词写到不同对象上。

## 3. 按阶段复核与第二次试写

### P1：受控服务、身份与原生输入

**材料：**`PAKKA-POCKET-P1.md`；`packages/agent/src/types.ts` 的 Runtime／Catalog／Ref／Snapshot／Receipt；`apps/server/src/pocket-workspace.ts` 的绑定、创建、读取、提交、配置和 receipt 路径。

核对重点是“图上的身份能做什么”。当前 ref 用于定位，冻结 DTO 不授予能力，闭包和服务端检查才承载权限；模型、cwd、profile 与 incarnation 各有作用。fork 继承的 entry 来源也不能替代当前 transcript view 的授权。

这些对应在原受控实现中保持成立，本轮未替换 Runtime 或改变原生准入。文档页首改为已实现阶段记录；v2 对节点身份、旧引用解析和独立配置的描述接到现有类型。未知结果、已花额度和原请求读取继续沿原机制表达。

### P2：当前人类、远程传输与连接

**材料：**`PAKKA-POCKET-P2.md`、`PAKKA-POCKET-LINUX.md`；`pocket-people.ts` 的角色／资源和绑定；`http.ts` 的 Cookie、Origin、可信 proxy 和传输范围；普通工作区的可见列表。

人员角色、MAS principal、native task owner 不能共用一个“owner”概念。服务器仍按当前人类和资源检查，传输数据中的 ID 是描述，图层不能借此授予读取。断连是一种观测条件，不能直接写成模型失败。

v2 增补连接新鲜度、权限后过滤／计数、发布前重验，以及丢连接时保留原请求。P2 页首改为该阶段产品记录；Linux 旧“尚待闭合”改为当时待办并指向当前状态。远端、FCM、Windows 的缺测继续独立保留。

### P3：公共扩展、命令与操作

**材料：**`PAKKA-POCKET-P3.md`、`WEBUI-DEVELOPMENT.md`；`apps/webui/src/ui.ts`；`web/extensions.js` 的 dispatcher、pending identity、界面实例、read subscription、operationByRequest 和 navigate。

公共界面已有 navigate，但宿主普通 refs 检查不能打开 MAS catalog 成员；这是一项尚待实现的通用资源解析。关闭实例清理观察、撤销旧回调，与已接纳工作的生命周期分别处理。相同 payload 的 pending request 由宿主保留；MemberPanel 自身尚缺完整的原操作核对交互，后续图改造需要补齐，不能只改一条提示文案来宣称恢复闭环。

v2 因而把导航链路、读权限、控制端口和未决操作分开写。现有公共函数名／已发布契约保留，新增图数据只是需求表；README 的“slash 输入拒绝”也收窄到原生 Pi slash，不再与已有 WebUI 扩展命令冲突。

### P4：MAS 成员、权限与真实活动

**材料：**`PAKKA-POCKET-P4.md`、`MAS-DEVPack-API.md`；`packages/mas/src/{types,index}.ts`；DevPack `workbench.ts`、`backend.ts`、browser DTO／contract、`index.ts` 与 `board.css`；真实 Board、busy、facet removal 和 workbench 测试。

这轮形成了四个直接修订：parent 按管理来源说明；reply 路由与持久回复关联分开；source 与人工代发分开；membership 与实时 activity 分开。

其中成员格子已有的 `active/ready → working` 样式映射会延续错误对象对应，本轮做了小范围实现修订：active 显示 Available 并使用 availability 样式，ready 显示 Ready to activate，unknown 保持 Unknown，详情标明 Membership phase。读写权限、投递和 native ownership 均未改动。

新增断言放在真实插件浏览器测试中：MAS 已 activate 但 provider 请求为 0 时，应展示可用性，而不是把激活当作开始工作。先在原实现失败，再构建修订并验证实际模型创建、人类 reply、原生队列、停止和移除路径。没有添加关系图的测试专用假数据入口。

API 页同时标明旧 M4 固定配对的历史性质，避免把“当时尚无 M5”和旧 deferred 状态读成当前产品情况。当前工具 `mas_configure` 仍是整组 profile；独立 model/cwd 的 MAS 管理端口属于导航接续工作，不能从普通工作区已实现而推定已开放。

### P5：使用入口、界面反馈与已确认验收

**材料：**`PAKKA-POCKET-P5.md`、迁移计划、开发规范、OpenSpec tasks；`web/app.js`、`navigation.js`、`conversation-configuration.js`、扩展界面容器及现有本机反馈记录。

用户确认的 Webhook 删除、分支切换、Memory 审批、关闭重开、手机／键盘五项从旧子代理缺口中正式核销。后续字体／SVG／短屏和独立配置按各自实现、测试版本记录。Settings 无 cwd 变更入口，模型与 cwd 的两个入口各自更新，不切换指令和工具。

P5 模型章节仍写“profile 不能替换 cwd”和“设置面板选择 profile”，是旧端口阶段的叙述；第二次试写在章节前说明当前交互，把旧组合行为和数字明确放回当时条件。普通 Conversation 的归档与 MAS 退役保持准确动词，实际删除另列工程项。

P5 的总清单还含远端测量和完整屏幕矩阵，因此保留汇总未完成状态，同时在其前说明用户已完成范围。没有新建重复的人类检查任务。

### P6：候选、验证与交付

**材料：**Linux 收尾、OpenSpec tasks、`scripts/test.mjs` 的环境与全量入口，独立模型／目录候选的 HANDOFF、archive／lock／安装文件身份及完整消费者回执。

旧候选的 526/527 与安装通过各自成立；当前源码修订不能复用它的归档身份。历史 FAIL 保留；一次当前全量通过也不能证明旧的隔离关闭时序已定位修复。指定双边审查与作者这次自我复核分别记录。

本轮新增状态页集中当前能力／人工确认／工程与环境工作；README 和阶段页按各自读者用途组织。OpenSpec 只同步核销说明，不提前归档或把图草案记成实现完成。测试与格式结果列在下一节。

## 4. 第一稿与第二稿的具体差别

| 项目       | 第一稿的起点                        | 第二稿的具体化                                                     |
| ---------- | ----------------------------------- | ------------------------------------------------------------------ |
| 观察范围   | Session 与名册的泛称                | 一个绑定 Runtime／Session／MAS 名册，namespace 与 Session 分别说明 |
| 稳定身份   | Session＋Conversation               | 还需绑定来源作用域，操作另用当前 incarnation                       |
| 创建线     | 创建来源与管理字段已提醒区分        | 追到 parent 的实际 owner 推导及 spawn source 名册约束              |
| 根节点     | 容易自然扩展到任意普通 Conversation | 当前 MAS source 的真实限制，通用打开保留原能力边界                 |
| 回复       | 例子中的关联像是现成数据            | 标明 reply 当前只校验路由，replyTo 尚待持久化                      |
| 发起者     | source／target 为交流两端           | 加入人工代发、原生调用与 principal 的区别                          |
| 数量／时间 | 聚合消息与时间                      | 唯一投递、已加载范围、具体时间含义和旧资料缺失                     |
| 活动       | 快照片段与阶段                      | 当前活动块、并行工具、busy 信息不足、Idle 上次回复、stale          |
| 错误详情   | 完整错误                            | 当前资源有权读取且脱敏的原因，运维诊断另有渠道                     |
| 普通删除   | 目标使用方式                        | 现有归档／退役与待明确的删除契约各自说明                           |
| 持久记录   | 新增观测字段                        | 记录与原生效果可能分开提交，缺资料不能重进执行                     |
| 阶段状态   | 用各阶段文字叙述当前                | 当前状态集中；历史数字和当时条件继续保留                           |

## 5. 本轮实际文件修订

- 新增第一稿、第二稿、本复核记录及 `PAKKA-POCKET-STATUS.md`；仓库内三份 SVG 明标构造示例并校正计数范围，随文档一起保存。
- 重写 README 的阅读入口，明确普通界面、可选 MAS、既有验收及当前设计。
- 调整 P1／P2／P3／P4 阶段页首，P4 的关系与状态对应，P5 当前配置入口与旧门禁分层。
- 同步迁移计划、开发规范、DevPack API、Linux 历史待办说明与 OpenSpec 人工核销说明。
- DevPack 成员列表修订 availability 文案／样式及描述 scope 的注释，增加真实浏览器中的空闲激活回归。

第一稿在完成后冻结原文，本轮格式化不改其字节。它与第二稿的差别可以直接阅读，不用依赖口头概括。

## 6. 本轮验证

证据目录：`pakka-evidence/design/mas-board/two-pass/`，位于开发机外置证据区。

- `first-draft.sha256`：完成第一稿时保存；交付前再次核对。
- `status-before.txt`、`preexisting-worktree.diff`：开始复核时的原有改动。
- `membership-red.log`：原实现的真实浏览器回归失败，实际 accessible label 为 active。
- `membership-green.log`：修订后定向 **7/7**，零跳过／取消／TODO；真实本地 provider 与原生 MAS。
- `full-first-pass.log`、`full.log`：本轮两次全量均 **527/527**，零跳过／取消／TODO；后者包含新增断言的类型修订。旧隔离关闭时序的历史失败继续保留，尚未作为已定位修复。
- `type-check-initial.log`：新增测试直接读取 `evaluate()` 的 unknown 返回值导致类型失败。改为结构相等断言，保留同样的行为检查；没有用 any 绕过返回边界。
- `build.log`、`type-check.log`、`source-format.log`、`document-format-check.log`：构建、类型、源码格式与第二稿／已修订文档格式均通过。
- `document-links.json`：检查 15 份 Markdown，115 个本地链接及锚点有效；3 份 SVG 的 XML、静态内容和可访问描述检查通过。
- `openspec.json`：严格验证 1 项通过，零 issues；`diff-check.log` 与首稿冻结哈希复核均通过。

本轮没有生成新安装包或更新预览，也没有新增／恢复 GUI 子代理、执行指定双方审查、归档 OpenSpec、提交或推送。关系图仍是设计稿。

## 7. 接下来使用这份稿件

继续讨论时可直接从第二稿的完整使用路径和实体对应入手。实现时先贯通受控观测与资源解析，再把真实节点、线和记录组合起来。对目前尚缺的创建／回复／发起记录、MAS 独立配置管理端口、原操作核对和普通删除，应以对应代码与真实消费者继续试写，而不是把本稿中的名称当作已经存在的接口。
