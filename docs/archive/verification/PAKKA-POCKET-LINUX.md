# Pakka-Pocket — Linux closeout（进行中）

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前产品状态](../../PAKKA-POCKET-STATUS.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

本页保存 Linux 各轮候选、诊断和验收记录，包含当时仍待完成而后来已补齐的项目。用户已确认本机五项验收；当前产品、远程／跨平台和 P6 交付范围统一见 [状态入口](../../PAKKA-POCKET-STATUS.md)。后台 GUI 验收仍暂停。历史通过／失败与相应版本保留，Windows、真实设备公网 FCM 等测量独立记录。计划和操作协议见 [迁移计划（外置备份）](../../verification/DOCUMENTATION-CLEANUP.md#备份与恢复)、[P0 action ledger](../webui/PAKKA-POCKET-P0.md#3-页面与-action-ledger) 及 [分阶段协议](../../development/WEBUI-DEVELOPMENT.md#10-分阶段-computer-use-实操验收)。

## 用户授权的 main 同步

用户明确要求将当前变更推送到 `main`。远端 `main` 基线为 `d554d10`，是 PR #1 分支 `9ce7c96` 的祖先；本次保留原29个提交，再提交 Linux/恢复修复和界面调整，以快进方式同步主分支。该发布指令允许推送当前代码，不代表 P5/P6 清单验收完成，不恢复自动 GUI 验收，也不提前归档 OpenSpec。最新全量513/514、相关浏览器6/6和独立浏览器隔离复测6/6的结果均按实际保留。

## 用户手动快速验证与当前暂停

用户要求暂停自动 GUI 验收，改在 `http://127.0.0.1:45000/` 的 r5 预览上快速操作。公网与文件补充两个子代理均已 interrupt 并确认 paused，原现场和报告保留；未经用户明确恢复，不自动 resume。

用户反馈：Webhook 删除终态、干净分支切换、Sender Memory 提议及 Owner 审批三项成立；面板关闭/刷新重开、手机宽度及键盘两项通过。第4项同时报告手机侧栏右侧区域无法收起，以及 Example preferences 的通用拒绝。前三项用**用户手动实操证据**补齐，不改写原子代理的 BLOCKED，也不推广到尚未实操的新安装候选；示例插件异常单独保留。

手机侧栏的原实现只有 CSS 阴影，没有点击目标。新增真实关闭按钮，覆盖侧栏右侧区域；支持 Escape 并把焦点交回菜单按钮，不切换会话、不清空或发送草稿。真实浏览器回归先因缺少关闭目标失败，修复后验证点击、侧栏内部操作、Escape、焦点恢复及零模型调用。Example preferences 在同一 r5 安装包的全新隔离环境可打开/保存；另复现 Commands 中直接运行缺 `text` 参数的 `preferences-card` 得到同样通用拒绝，且未发出后端 RPC。该路径已改为显示命令、JSON 用法和必填字段，回归先失败后通过。用户随后明确确认这就是原先遇到的拒绝路径：必填参数由插件声明，宿主负责校验和清楚解释缺参原因。

本批构建、类型、格式及 Linux 全量 **513/513，零跳过/取消/TODO** 通过，证据在 `pakka-evidence/user-feedback/r1/`。本机预览更新为 `manual-feedback-r1`：沿用 r10 的七个归档及本批新 WebUI 归档，安装后12,638文件逐字节匹配；正常关闭、备份后复用同一个 Session 和数据。该预览更新不替代新候选的完整安装门禁或 P6 审查；自动 GUI 验收继续暂停。

### 输入模式与本机字体设置

用户要求将 Prompt/Steer/Follow up/Team chat 选择框与 Send 同行，并提供字体/字号设置。模式选择框改为内容宽度、限制最大宽度；语音与用量移至下一行。侧栏底部 Appearance 现在打开普通 Sheet，提供 Theme、Font、Text size、实时预览和重置；字体为 Pocket Mono/系统无衬线/衬线，字号14–24px，浏览器本地保存，非法旧值回落到默认值。代码预览保持等宽，触屏输入保留至少16px并随大字号增长。

新增真实浏览器回归先验证旧版缺少设置入口；实现后字号/字体应用、刷新持久化、重置、无效存储、草稿保留和手机同行行为通过。相关浏览器 **6/6**、构建/类型/格式通过；新安装包在320、390、1440px及24px字号下四种输入模式均无横向溢出，零模型调用。`typography-r3` 八归档、锁及12,639安装文件核对一致，正常关闭/备份后更新45000；原Session与数据/项目保持，仅正常追加且重启零模型调用，实时JS/CSS与新包一致。

本轮全量为 **513/514**，唯一失败为既有 `Pocket owned browser: disallowed direct navigation redirects subresources and popup never reach another origin` 的 `Pocket browser closed or unavailable`。随后该浏览器隔离文件单独 **6/6** 通过，原失败保留，不能据复测声称全量通过；未修改其产品实现或测试。证据在 `pakka-evidence/user-feedback/typography-r3/`。用户暂停自动验收的指令保持有效，P5/P6未放行。

### SVG 图标与重启后的本机预览

用户要求图标使用 SVG，并增大常用图标。公共 `Icon` 使用固定 SVG 路径，菜单、关闭、新建、会话、文件/文件夹、点赞和 MAS Board 均复用同一组件；图形为24px，独立图标按钮至少44×44px且保留可访问名称。协议中的reaction emoji数据不变。该约定已写入 `AGENTS.md` 和 `WEBUI-DEVELOPMENT.md`。

构建、类型、格式、受影响浏览器路径4/4和 Linux 全量 **513/513，零跳过/取消/TODO** 通过。第一次全量为512/513，唯一失败是旧测试仍查找字符点赞；改为核对真实反应计数后全量通过，原失败日志保留。新安装包分别在390×844、1440×1000验证实际SVG尺寸、关闭/新建按钮、文件图标和零模型调用；桌面测量等待现有入场动画完成，避免把缩放中的尺寸误当布局终态。

本机重启后已恢复45000，并更新到 `svg-icons-r2`：六个原归档，加上重建的 WebUI 与 MAS DevPack，八归档/锁及12,638安装文件核对一致。正常关闭并备份后复用原Session，数据只有正常追加、项目无改写，重启未新增模型调用，实际HTTP返回的组件/JS/CSS与新安装包一致。证据在 `pakka-evidence/user-feedback/icons-r2/`，旧安装和数据备份在 `pakka-preview/backups/svg-icons-r2/`。本轮是预览更新和回归检查；自动GUI验收继续暂停，P5/P6未放行。

## 1. 候选、隔离和状态

- PR 基线：`9ce7c9694f0a7a5bd0095b3835a2b31721513948`。
- 集成工作树：`/home/mapleluvr/Projects/pakka-worktrees/pr1-gui-acceptance`，分支 `feat/pr1-linux-closeout`。已保留并接入先前的 GUI 验收规则；开发期间与用户原 `main` 隔离，本次按用户明确指令快进同步 `main`。
- 本机原始门禁日志：集成工作树的 `artifacts/pakka-pocket/linux-closeout/bootstrap/`。其中 red、诊断和失败日志保留，不作为成功证据。
- 独立 GUI 证据根：`/home/mapleluvr/Projects/pakka-evidence/`。每轮通过 manifest、候选 diff、操作记录、截图和报告关联具体字节；诊断状态的成功不能清除原快照的失败。
- 6.4–6.7 和 P6 checklist 仍保持未完成。没有放宽 Plan mode、Goals/Done when 非目标，定时输入仍在范围内。

### 第一轮 P5 GUI

| 项目       | 固定值/状态                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 原快照     | `44800db352cedb62e38fb23feadd01dc5caedbda6f1dc148b6b78b781baca14b`，467 个 tracked/必要未提交及未跟踪候选文件 |
| worktree   | `/home/mapleluvr/Projects/pakka-worktrees/p5-linux-ui-r1`                                                     |
| workspace  | `pakka-p5-linux-ui-r1`；每次工具调用显式传入此 id                                                             |
| 模型       | `Mapleluv-ChatCompletions/deepseek-flash:max`                                                                 |
| run id     | `d4895d21-1668-469a-b2cc-2241decfcb56`                                                                        |
| 合同和输出 | `p5-linux-ui/r1/acceptance.md`、该轮 `report.md`、操作记录与截图；完整原合同先于子代理启动写入                |
| 状态       | 已返回部分实操证据；未覆盖项及未闭环项目保留，整轮不判定通过                                                  |

本轮真实 CLI、浏览器、provider、profile 和数据都独立。报告只取得登录/刷新、原生发送、普通插件及模型切换的部分证据；provider key 替换/清除未闭环，多人、手机、文件、定时输入和正常重开等未覆盖，不能称为整体通过。无参数命令建议点击后的通用拒绝暂列非阻塞可用性问题，后续需核实提示与 GUI 复验。原始报告中的“180 秒”是 runner 的收尾预警；实际运行约 90 分钟，原报告保留并在此更正。外部部署、OS 通知点击、MAS/审批/受控浏览器和最终仓库外 tarball 也不属于该轮通过证据。集成树之后的变更不属于本轮原快照。

### 第二轮 P5 GUI

共同快照为 `97e7b100b530bda9fc0a5ded3d207b6abd7363922c8337e9ce76d034ae85b803`，481 个实际候选文件。workflow run id 为 `b2d7cbb6-2d92-44cb-930d-6b5bb28ea4b3`，四条任务均为 `Mapleluv-ChatCompletions/deepseek-flash:max`；各有独立 worktree、唯一 workspace、端口、profile、数据和逐项合同。报告及证据保存在对应 `p5-{lane}/r2/`。

| lane   | 逐项实操范围                                                                     | workspace / worktree 后缀             | 状态       |
| ------ | -------------------------------------------------------------------------------- | ------------------------------------- | ---------- |
| nav    | 重命名、归档/恢复、会话搜索、历史分页/查找、草稿复用、fork、原生队列和正常重开   | `pakka-p5-nav-r2` / `p5-nav-r2`       | 实操验收中 |
| people | 多人邀请、当前角色/资源范围、撤权与持久化、协作及人类内容不隐式派发              | `pakka-p5-people-r2` / `p5-people-r2` | 实操验收中 |
| files  | 实际文件/变更/分支/导出、原生定时输入、Memory 和签名 Webhook 的人类面板          | `pakka-p5-files-r2` / `p5-files-r2`   | 实操验收中 |
| config | 设置、模型/私密 key/预算、普通插件、appearance、实际 390×844 viewport、键盘/焦点 | `pakka-p5-config-r2` / `p5-config-r2` | 实操验收中 |

导航环境经受控公共服务预置 270 条展示卡片，作为历史分页初态；设置过程未触发模型，实际分页和查找仍须 GUI 实操。并发输入的本地 provider 使用显式释放开关，避免短时固定延迟使 GUI 操作失去验证窗口。各轮有效报告返回前不勾选阶段；只有相关路径的新候选实操才能推广到集成版本。

原四条子任务随后均因模型 `Connection error.` 结束，没有产出约定的完整报告；已保存的截图和操作状态仍是部分证据，不能据此判整轮通过。主代理在 `p5-wave2/connection-failure/` 保存原 workflow 回执，在各 lane 的 `connection-failure/` 保存状态、日志和部分工作树差异，并重新逐文件确认原 481 文件快照未改变。当前没有待回复监督请求；相关配置未发现 blacklist 条目。

用户确认连接已恢复并明确授权 resume 后，按同协议、同模型、同快照继续未完成项，不重复已生效操作。恢复 workflow 为 `d8fcdbf3-58fa-44bf-853c-ec4750f35aad`，新报告为各 lane 的 `report-resumed-1.md`，新增证据为 `evidence/resume1/`；有效报告返回前仍为“实操验收中”。

| lane   | 原 run id                              | 最新恢复 run id                        |
| ------ | -------------------------------------- | -------------------------------------- |
| nav    | `bfdc12e9-d44b-4060-85b7-dbf3612beb31` | `7d566665-05fd-440a-b9b6-c7803f2682bc` |
| people | `9558ba51-2667-4e39-b693-f3a837a79aac` | `82512e33-b0aa-4175-962b-5b2577af1000` |
| files  | `94de6a8b-670f-4467-94d6-e9ab981ed546` | `e72558b8-1be7-4c8a-9736-90706026be1c` |
| config | `05e85f35-2ec0-4c02-bcb8-ca6bf927f16f` | `021de27d-9cca-4a1c-91b4-f610569ac7f9` |

### 总时限后的证据收尾

恢复 workflow `d8fcdbf3…` 在 5,700,000ms 总时限处失败。文件子代理已正常完成并返回 `p5-files/r2/report-resumed-1.md`；另三条由框架终止为 `stopped`，`children.list` 明确为 not resumable。没有将超时视为产品失败，也没有绕过框架继续旧 run。各 lane 的 `workflow-timeout/` 保留原差异、状态与 481 文件再次一致的核对；原 checkpoint 和截图不覆盖。

同模型、同协议、同快照的后续 workflow 为 `c1d9fc87-8534-4ca5-8302-f3b50543910d`。导航/多人/设置使用明确标识的 fresh fallback 接续未完成项，分别输出 `report-continuation-2.md`；文件 resume 原已完成子代理，按 `supplement-2.md` 只补审批、干净分支切换和 Hook 删除终态，输出 `report-supplement-2.md`。不重放已完成的邀请、发送、文件写入和计划，逐项即时保存报告草稿。

| lane   | 本次接续 run id                        | 方式                             |
| ------ | -------------------------------------- | -------------------------------- |
| nav    | `66443241-f83c-4516-bb6e-1df3be5bc2d2` | 原 stopped run 的同协议 fallback |
| people | `995a1727-e60e-481f-9bb0-10fa86351963` | 原 stopped run 的同协议 fallback |
| config | `4d9f7841-ebaa-4cd6-810d-7934722e9d93` | 原 stopped run 的同协议 fallback |
| files  | `0ce55993-ceb6-4698-93d4-cb92498b8797` | resume 完成的原子代理，仅补缺口  |

文件首份报告已有真实编辑/导出、隔离 worktree、一次性计划和取消、Memory 编辑/暂停及后续 provider 上下文、Hook rotation 和重启持久化证据。补充 run `0ce55993-ceb6-4698-93d4-cb92498b8797` 已在40分钟总时限处失败，报告仅为草稿；最后工具均是快速返回的 GUI 操作，没有据此认定 bash 长阻塞。现场、16张补充截图及 checkpoint 保留，审批、Switch 和 Remove 仍未完成。主代理独立核对导出件是 13 字节 `FILES-QA-EDIT`，sha256 `a1a9d75644bf932d3e5d8ceef85e8c5eab0794a1148132260c3c9cbb4bc74425`。但人类提议/owner 审批、干净分支 Switch 和 Hook Remove 最终确认未完成，**这些子项仍 BLOCKED**，不采纳报告中带缺口的整项 PASS。普通 sender 提议能进入 pending 的源码条件已核对，补充验收须通过独立身份真实 GUI 完成。

### 新候选的原生通知与公网 tunnel

两个新增验收任务共同固定候选 `f7e78b1e35374fcbf815d86824dd0ccc085e95d7b564cba1a3e46190d60da188`，482 个实际文件，包含 npm bin 和手机状态宽度修复。分别从独立 worktree cwd 启动仓库外实际安装的 `.bin/pakka-pocket`，安装字节、数据、端口、profile 和桌面均独立。模型仍为指定的 `Mapleluv-ChatCompletions/deepseek-flash:max`。

| 任务                                      | workspace / worktree 后缀                         | run id                                 | 合同、报告和证据                                             | 状态                      |
| ----------------------------------------- | ------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ | ------------------------- |
| 原生 OS 通知点击及手机工具栏/焦点复验     | `pakka-p6-notification-r3` / `p6-notification-r3` | `57b584d2-aef7-4283-b395-74eb8b0c74dc` | `p6-notification/r3/acceptance.md`、`report.md`、`evidence/` | 通知导航 FAIL，已返回报告 |
| 真公网 HTTPS tunnel 的登录/发送/刷新/退出 | `pakka-p5-tunnel-r1` / `p5-tunnel-r1`             | `e12b2d7d-a85c-49d5-84a1-595af7735b50` | `p5-deployment/r1/acceptance.md`、`report.md`、`evidence/`   | SSE 首帧时效 FAIL         |

首次通知任务提交在派发前因不支持的 `options.tools` 字段被拒绝；没有产生子任务或产品操作。按当前 schema 使用已明确声明逐个工具的 `pakka-gui-acceptance` profile 后启动了上表 run，没有切换模型或执行协议。

### 已返回报告的逐项核对

- 多人与协作：`p5-people/r2/report-continuation-2.md` 取得 scoped viewer、stranger 无访问、human-only canary 不入模型、撤权和重启持久化证据。viewer 设置缺口由补测 `362857fb-5c3c-4b51-b719-47129b766ecf` 的 `report-viewer-config.md` 补齐；进程虽达到25分钟时限，已保存完整报告。主代理复核截图和原始 people doc，确认下拉禁用，无配置保存/预算/key写控件，新旧两个测试viewer最终均revoked；provider仍2条，本轮无模型调用。报告邀请计数有误，以原始记录2 pending/2 redeemed为准。桌面viewport为1440×901，CSP inline-style告警仍仅有现象未归因。
- 设置：`p5-config/r2/report-continuation-2.md` 取得 clear key → 明确 Send → 无 provider HTTP/不回退 → 重启/刷新仍 cleared、额度不退的闭环；手机 Hello 操作和完整关闭/返回仍未覆盖。无参命令通用拒绝复现为非阻塞可用性残余项。
- 导航：`p5-nav/r2/report-continuation-2.md` 的 rename/archive/history/draft/fork 有证据，steer/followUp/withdraw 与重开仍 **BLOCKED**。原子代理的 `a85aa41b-fbe7-4da2-ab3d-31b8df471fd5` 已返回 `report-target-ab.md`：首次 Send 和原 Retry 结论的坐标证据作废；正确中心与元素定位仍复现分叉会话新提交被拒绝，而新会话正常。主代理以真实 Pi/本地400响应独立确认原生 `unanswered/model_error` 后该 Conversation 为 `failed`，新请求在准入前被拒绝；这是既有会话失败隔离，不能通过清空回执或重置状态解锁。报告关于“未决回执锁住会话”的根因假设不采纳；HTTP/UI 将明确拒绝误映为 unknown、保留无效 Retry 才是需修复的界面缺陷，见下节。
- 通知修复后的新快照：`2ba18aa7c929e835dbb28609a9575939b87dc83263f20fd46fb806654dc1b219`，483文件；原子代理 `4423ab91-b507-4f1f-bcc2-333145ef27d5` 已返回 `p6-notification/r4/report.md`。主代理核对实际点击后截图、provider/push/native-delivery和D-Bus：目标会话及本轮历史在**同文档**显示，模型HTTP保持1次、wake1条、同一wake两次原生投递、`ActionInvoked`1次。旧r3失败保留。报告误把session UUID写成run id，NotificationClosed计数应为4；父记录以此处run id和原始日志为准。真实设备工具栏390×844、实测CSS391×844无横向溢出，drawer、Settings/Notifications、双向焦点回绕和Escape均有证据；空白→Ready中间帧未观察到，不可见目标/logout仍是浏览器回归范围。结论限于该已安装候选和本地TLS/原生投递，不覆盖后续产品修复。

## 2. Linux 门禁修复

会话拒绝/生命周期候选已通过 build、type/check、format/check 和真实本地 provider 全量 **512/512**，没有 skip/todo/cancel（`full-linux-8.log`、`.exit`）。此前 505/505、507/507 基线及手机误点击的 506/507 失败分别保留；修复证据见下节，不以重跑通过清除原失败。与早前 code snapshot 对应的 original-result 回归为 4/4（`navigation-recovery-green.log`）；这些结果均不替代 Computer Use。

### 浏览器选择与隔离

旧测试默认路径为 Windows Chrome；Linux 初次浏览器门禁在启动前失败。测试 helper 现先尊重显式 `PAKKA_TEST_CHROME`，再按平台选择浏览器；显式无效路径直接失败，不静默换浏览器。新增实际 owned browser 启动、关闭和错误路径回归，浏览器 profile 保持临时隔离。门禁与仓库外 consumer 只转发这个测试配置，不引入用户浏览器数据或模型凭据。

本轮明确使用 `/home/mapleluvr/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`；路径是环境记录，不是 Linux 产品的唯一支持位置。原 `browser-baseline-red.log`、发现规则和启动回归日志均保留。

### TLS 测试资产

仓库原先引用但未交付 `apps/webui/test/tls/{cert,key}.pem`，被通用 PEM ignore 规则隐藏。现明确纳入故意公开的 localhost-only 测试证书和私钥，并使用模块位置定位 consumer 的 TLS 夹具。不读取真实部署证书或用户凭据；这些公开测试资产不能用作生产凭据。

### DOM click 与异步实际效果

Linux 全量基线的 `493/494` 失败来自已完成 DOM click 后立即检查异步 fetch 计数，不能单凭 click 返回推断远端效果已完成。A 在 fixture 中固定增加 50ms 效果延迟，两个原用例均稳定失败；B 保持延迟和产品不变，只等待真实页面的 `REAL-ACTION` acknowledgement，两个用例均通过，再核对效果恰好一次及重开后未重复。

证据：`browser-click-async-A-red.log`、`browser-click-async-B-green.log`。这是观测条件修正，不是放宽产品的 unknown、click 或重放语义；等待有明确上界，未通过则失败。

### npm bin 的真实入口

从八个实际 tarball 的独立安装启动 `.bin/pakka-pocket` 时，原入口因符号链接路径与模块真实路径不同而直接退出 0，没有启动 listener。该问题此前被 consumer 直接调用 `dist/main.js` 的路径掩盖。新真实回归先复现同样的静默退出，再将入口判断改为公开 `realpath` 的规范路径比较，保留导入不自启动的行为。

链接启动、导入无副作用和真实 MAS CLI 组装的 focused 检查为 3/3；原失败及修复日志是 `executable-bin-red.log`、`executable-bin-green.log`。安装消费者现直接覆盖 Linux npm bin 入口。此变更在第二轮 GUI 冻结之后，旧报告不验证新安装入口；新候选和 tarball 需重新通过全量及安装门禁，并由后续原生通知任务实操启动路径。

### 手机状态变化移动点击目标

`full-linux-4.log` 中的手机 viewer 点击 Settings 打开了 Conversation；新入口候选的仓库外安装门禁也在手机 Notifications 点击后打开了 Settings。没有把这两处失败简单归为测试竞态。独立诊断在真实浏览器、真实 Pi/SSE 上记录取坐标与 pointerdown 的命中目标：状态空白时 Settings 中点为 `(251.8828, 30)`，首个原生快照使状态变为 `Ready` 后，同一点已命中 Conversation；字体两侧均已 loaded。

`p5-config-click-ab/` 保留 A/B/A：A 只让原生首快照到达于取点后、按下前，稳定失败；B 保持相同原生状态变化，但先等 Ready 再取点，通过；恢复 A 再失败。此前未加调度控制的独立 A 和安装通知 consumer 曾通过，故保留为间歇失败证据，不用一次成功清除原失败。

实际修复仅为 `.pocket-status` 预留 `7ch` 最小宽度，使空白/Ready/Working 不再推动相邻按钮。现有实际设置 browser consumer 新增测试调度 seam，在取点后、按下前等待真实 SSE Ready；原产品先失败（`status-target-red.log`），修复后它与导航回归 2/2（`status-target-green.log`）。没有增加产品测试开关或更换成程序化 DOM click。旧 GUI 子代理仍验原快照；最新集成候选必须另做手机工具栏及通知路径的真实 GUI 复验。

### 已打开页面的系统通知导航

`p6-notification/r3/report.md` 已取得真实 Dunst 通知、鼠标左键点击与 D-Bus `ActionInvoked`。原快照 `f7e78b1e…` 点击后浏览器聚焦且 URL 成为目标 `#conversation=11`，但界面仍为 Other conversation；同 URL 手动 reload 后显示正确会话与历史。主代理独立核对该轮只有一次模型 HTTP、一个实际 push wake、两次同 index 原生投递（首次通知过期后重投），没有额外模型工作。原快照该项判 **FAIL**，不能因 OS 气泡或 URL 正确而判通过。

根因是页面仅在模块初始化读取 conversation hash，Service Worker 对已打开 client 的 fragment 导航没有重执行模块。浏览器回归先复现同文档导航不切换（`notification-route-red.log`），修复后监听真实 `hashchange`、重新读取当前 person 的服务器过滤列表，再选择可见目标并离开旧 extension surface；不自动登录或发送输入。冷启动、已有历史切换、面板清理、不可见目标和退出状态同一回归覆盖。它与原通知、导航回归为 3/3（`notification-route-green.log`），新全量 **508/508、零 skip/todo/cancel**（`full-linux-6.log`、`.exit`）。真实 OS 点击仍须新快照、干净状态和实际新安装包复验；r3 原报告和 A/B 证据保留。新路由会清除已消费的 hash，因此复验依据是目标会话/历史与实际点击，而非强求地址栏永久保留 fragment。

### 会话失败后的明确拒绝

导航 r2 原快照中，测试 `QA-HOLD` 夹具在释放前尚未发送响应头，长时间 GUI 操作触发真实 provider headers timeout；原请求成为 `unanswered/model_error`。既有 `task_failed` 路径封闭该 Conversation，其他成员仍可工作。主代理的公共 runtime 诊断确认 `readiness=failed`、新输入 `Recipient not ready`、新会话 ready，以及恰好一次模型 HTTP/已花 attempt；不将这种失败误判成未决回执可以被清除。

实际修复只把 catalog 事务在新输入产生前的“收件会话不可用”拒绝发布为 `ConversationUnavailableError`；HTTP 通过严格实例检查映射为 `CONVERSATION_UNAVAILABLE/denied`，不公开原 provider 错误。旧请求的幂等查找先于这个判断，仍返回原终态；未知存储/提交错误保持 unknown。界面说明需要新会话、保留原请求和已花额度，对已确认拒绝移除 Retry，并保留未发送草稿。没有改变原生失败隔离、重放或配额语义。

`input-failure-public-A-red.log` 在同一套实际公共组装链路上恢复旧错误分类后复现两个回归失败，修复后的 `input-failure-final-green.log` 为 **6/6**，覆盖 HTTP 分类/原请求不重放、真实浏览器新会话继续、原生 busy 队列和已有恢复路径。新的全量、实际安装包和受影响 GUI 复验仍待本轮完成；不将定向检查提升为新候选已验收。

### reload 与投影准备交错

Linux新全量7为 **509/510**，失败为`M2: background ownership`的`Host is transitioning`。第一次旧快照对比因缺少`chord`未实际执行，不能用于归因；随后在逐文件验证的r4诊断副本中补齐依赖，真实复现同一时序失败。一个等待中的真实投影回调建立了确定回归：reload已撤销回调的权限，正常生命周期拒绝却被通用catch升级成会话失败。

内部`LifecycleTransitionRevoked`只表示`Host.ready`对明确transitioning状态的拒绝；投影和发模型前的catch仍阻止请求，但不会把这种已知撤销再标为故障。原生abort、未知效果、持久化失败和已花额度语义不变。新回归先复现失败，再验证正常撤销恢复ready/零模型HTTP/零attempt，另一个普通异常回归仍须failed；与后台所有权、现有队列、策略和存储故障的28项定向检查共同通过。原所有权用例连续5轮通过；新全量 **512/512**，零skip/todo/cancel，记录在`full-linux-8.log`。

受影响GUI新轮为`p5-nav/r3/acceptance.md`，485文件候选`8e0a2747d8d07ccec5dd9626c520f4c777a58464912087fa2e588208a6bd2056`；八归档实际安装/干净npm ci、源及12,638资产核对通过，真实bin返回HTTP200且初始模型HTTP为0。原导航子代理已恢复为`69d59745-1346-4a4b-a46f-aaac52d95998`，唯一workspace/worktree为`pakka-p5-nav-r3`/`p5-nav-r3`；从干净状态复验明确拒绝、原生steer/followUp/撤回和正常重开，不借旧failed会话重试。新QA-HOLD先发SSE响应头和每5秒注释心跳，释放仅控制测试provider，不更改产品；本轮仍为实操验收中。

## 3. action ledger 的集成补齐

以下变更已接入候选并有真实 Pi/本地确定性 provider 回归，**尚须新快照的 Computer Use 复验和最终安装产物验证**：

- 会话名称、归档/恢复和可见会话搜索：元数据由现有 catalog 单 writer 提交，当前 `manage` 权限与精确引用重复检查，按 actor/原请求/完整输入去重，CAS 版本冲突明确。归档只隐藏默认导航，不删除历史、撤权、取消已准入工作或退还额度；可显式显示归档项并恢复。每会话最多 256 次元数据变更，原回执不剪枝，容量到达时明示拒绝。
- 历史：显式 `Show earlier history` 使用真实、当前资源的分页 cursor；`Find loaded history` 清楚限定为已加载内容，不把有限 tail 称为完整搜索。分页内容在 live 更新后保留；浏览和查找不成为模型输入。
- 输入编辑/复用：`Use as draft` 只复制为可审阅草稿，必须由人再次 Send 才创建新原生输入；不重写原历史或把旧 admission 当作可退款重试。queued receipt 提供原请求 withdrawal，终态仍由原生服务决定。
- 真实 fork：Conversation sheet 选择已提交 entry，创建实际原生分叉并显示继承历史，之后的真实 provider 请求使用该历史。不恢复旧 Pi session picker/import 或另一个 runtime。
- 键盘/appearance：Conversation 与 People sheet 使用受控 Escape、focus trap、关闭后焦点恢复和 browser back；appearance 在当前 origin 的本地偏好中保留。捕获 opener 和清理在 layout lifecycle 完成，避免 effect 延迟读到已卸载 sheet 的输入。其他既有 surface 的可达性仍以 GUI 报告逐项判断。

### 原生分叉读取的作用域修正

独立真实 HTTP 反例先证明：新 fork 在任何后续推理前读取继承历史返回 500。原 native entry 的 Conversation id 是来源归属，而 DTO decoder 要求所有 entry 属于当前授权 view；二者被混用。

adapter 现把 `conversationId` 绑定当前受控 view，并用可选 `sourceConversationId` 表示继承来源；后者不是引用或读权限。人类 workspace 发布前去掉当前 person 无权读取的来源 id。真实 scoped viewer 仍能读被明确分叉的历史，但不能借此获得源资源元数据或权限；旧/外域 view 仍被 decoder 拒绝。

原始失败、正向读与作用域隐私反例分别在 `fork-transcript-red.log`、`fork-origin-filter-red.log` 和后续 focused 日志。原修复前候选 A 的完整文件 hash/diff/必要未跟踪文件保存在 `p5-navigation-ab/pre-fix-A/`，身份为 `60fb950a6dfd6a626af22f92eb33366b1cbccee24dbf9a8f6848471af339b655`。这份源码/HTTP 证据不替代后续 GUI A/B。

### 只读原请求核对

`conversation.lookup` 只查询同一 actor、当前权限及精确原始 metadata/create/fork 的保存结果；没有结果就返回缺失，不再次进入 mutation admission。未确认的 sheet 关闭后重开仍保留原请求，`Check original request` 仅用该 read port；缺失结果不解锁一个替代提交。

回归覆盖真实 committed/absent lookup、原创建/分叉、元数据 CAS 竞争、有限回执容量和正常 reopen。两种浏览器传输故障分别在发送前和服务端提交后丢失响应；重开 sheet 后仅查询一次，前者 catalog 不变，后者只写一次，均无模型 HTTP。浏览器测试中的故障注入仅模拟传输，不修改产品或持久化实现。

## 4. OpenSpec 文档门禁

13 个 `>500 characters` requirement 警告已按行为拆为命名要求；原所有规范句子保持原文，原 scenario 也保留。新增 scenario 说明各自边界，没有删除权限、unknown、效果或恢复约束。`openspec-split-verification.json` 保存逐句保留校验，`openspec validate pakka-pocket-webui --strict --no-interactive --json` 当前退出 0，输出在 `openspec-green.json`。这是文档门禁，不代表 task 通过，不归档 active change。

## 5. 仓库外交付身份和反例

第二轮 GUI 的 481 文件候选已经通过两次完整的实际安装消费者门禁。`p5-linux-package/r2/` 与带前置检查的 `r3/` 保留八个 tarball、实际安装 lock、各消费者日志和原始回执；两轮八个归档逐字节相同。独立检查枚举所有候选文件、八个产品归档、12,638 个交付文件和额外验收 helper，核对 SHA-256、lock SHA-512 integrity、构建/源资产以及实际安装文件。

`p6-identity/` 保留独立 guard、5/5 反例/正向检查及执行记录。漏掉必要未跟踪源码、漏包、损坏归档和篡改源码身份均在后续 build/install 命令前被拒绝。前置 guard 通过后才执行的完整安装门禁退出 0；这仍不能把旧候选入口问题或未完成的 GUI、OS 点击、部署与对抗审查判为通过。后续代码和 helper 改动必须有新的身份，不覆盖这些历史记录。

新 npm bin 候选 `5eaa4e0d9e2eb5616ac6c0f9994d0c12fe6d51437bca5c92bde6c95c0aa1d983` 的 482 文件/八归档前置检查和 5/5 反例通过，`p5-linux-package/r4/` 保留该轮输入和失败日志。完整安装门禁的入口、公共声明及前面消费者已通过，但在手机通知按钮移动时失败，整轮退出 1（`p6-identity/guarded-package-r4.log`）；单独重跑通知 consumer 曾通过，不将其代替全门禁或根因修复。后续布局修复属于新候选，须生成新的快照和 tarball 身份。

最新候选 `f7e78b1e3537…` 的 482 文件、八归档前置身份检查及 5/5 反例/正向检查均通过，随后完整安装门禁退出 **0**（`p6-identity/guarded-package-r5.log`、`.exit`）。`p5-linux-package/r5/` 保存实际八归档、实际 consumer 的 package/lock、全部消费者日志和 `complete-gate-identity.json`；独立核对重新打包后真正运行的归档与保存归档逐字节一致，并逐个核对安装后的 **12,638** 个文件。无 workspace root override 或第二 Pi cohort；公共类型反例、Linux npm bin、legacy/runtime/MAS/broker/DevPack、受控工作流、通知、定时输入、Memory、Webhook 和 dictation consumer 均实际通过。GUI 实操仍按各自版本另行判断。

原生通知环境使用单独 D-Bus、真实 Dunst 和受控浏览器；测试 fixture 的订阅接收端是本地真实 TLS，保留 VAPID/AES128GCM 验证后，通过 Chrome 原生 Service Worker push delivery 触发生命周期。实际系统通知和鼠标点击必须由子代理取得截图及 OS `ActionInvoked` 记录；不构造 `NotificationEvent`，不将这项局部验证称为公网 FCM 可用。第一轮准备因上述 npm bin 问题退出，尚未开始 GUI，失败证据保留；当前 `r3` 使用新候选、新数据和经过身份核对的实际八归档。

### 定时输入卸载后的安装消费者观察顺序

通知新候选的 r6 完整安装门禁退出1，失败在 `consumer-pocket-schedules.mjs`：服务重开并移除 WebUI facet 后，驱动使用 fragment navigation，随即读取尚未刷新的原 document 并断言入口立即不存在。`p5-linux-package/r6/failed-gate-records/` 保存31份日志和实际 consumer package/lock；该轮通知和受控消费者已通过，但不把局部成功当全门禁通过。

对相同八个确切安装归档完成 A/B/A：原驱动失败；B 只等待真实界面入口消失，实测旧入口仍在且约457ms后由正常 registry refresh 移除，完整定时输入消费者通过；恢复原驱动再次以同一断言失败。原生已准入计划、两次模型 HTTP、receipt 和去重检查未改变。修正只将立即断言改为有界等待实际 UI 状态，不改变产品字节、权限或 effect 语义。`schedules-observe-B.log` 和 `schedules-observe-A-restored.log` 保留在该轮；新的完整安装门禁须按更新后的 source/helper 身份运行，旧失败保持失败。

### Memory/Hook 重开驱动与已消费片段

r7 完整安装门禁中定时输入已通过，之后 Memory 驱动等待 `location.hash === #conversation=…` 到期失败；同包的原 Hook 驱动也以同一条件失败。该条件与通知路由修复成功后消费片段的行为冲突，页面当时已显示正确历史，不能把地址栏没有保留片段视为模型或持久化失败。

B 仅修改重开观测顺序：先 reload 并用 `performance.timeOrigin` 确认新文档及实际会话导航加载，再请求目标片段，等待对应 `data-conversation` 的 selected 状态、Ready 和 composer。相同八个归档下 Memory 完整消费者通过（5 model HTTP、5 spent attempts、1 tool result、只批准的记忆入模、原请求不重放），Hook 完整消费者通过（3 model HTTP、签名/rotation/入口卸载保留/受限者拒绝）。恢复 Memory 原驱动再次在片段条件失败。`p5-linux-package/r7/` 保留原全门禁日志、实际 consumer package/lock 和各 A/B 日志；产品字节未改。修正只接入这两个重开 helper，新的完整门禁仍须按新 source/helper 身份运行。

修正后的 r8 完整仓库外安装门禁已退出 **0**，前置反例 **5/5**。冻结源码/helper 身份为 `39d622cb2e6bd8bcc374e10e2d1ca55798971986acb03ec64015f607f3d07bbc`；相对通知 GUI r4 的产品源码未变，差异仅为 Linux 收尾文档与三个消费者驱动。`p5-linux-package/r8/complete-gate-identity.json` 关联原始日志、实际 consumer package/lock、八个实际运行归档及 **12,638** 个逐字节匹配的安装文件。此前失败与 A/B 记录均保留；之后的会话拒绝提示修复属于新候选，不能借用本轮安装通过结论。

### 定时输入原请求核对与晚到的样式表

新产品候选的r9安装门禁在`pocket-schedules`失败：原计划已实际done，但`Check original operation`未消失；通知等前序消费者通过不等于整轮通过。`p5-linux-package/r9/failed-gate-identity.json`保留失败轮实际consumer、八归档/lock、12,638安装文件匹配和全部原始日志，不误用仅成功时更新的consumer-path指针。

在相同确切归档上为扩展样式表施加600ms网络延迟，A于样式未到时量坐标、样式到后按下；pointerdown实际命中提示段落，未命中button。B只把等待真实`schedules.css`就绪放在量坐标之前，完整消费者通过；恢复A再次同样失败。未改变产品、超时或原生计划语义。驱动及同路径浏览器回归现等待样式就绪再真实点击，2项定向通过；新的完整安装门禁须使用新source/helper身份，r9仍保留FAIL。

## 6. 部署测量与范围

`p5-deployment/r1/` 保留真实 Cloudflare `2026.10.0` quick tunnel 的工具版本、命令、固定 public origin、loopback 反代和真实 CLI 启动配置。已实际注册 LAX 边缘连接，公网 HTTPS 根页面返回 **200**，证书校验结果为 **0**，raw headers 包含 `server: cloudflare` 和 `CF-Ray`（`public-root.headers`）。后端直接请求、错误 Origin 的公网请求和错误 forwarded proto 均被拒绝为 **403**（`bootstrap-probes.json` 与三组 raw headers/body），未交换 owner token 或触发模型。这些是主代理的必要 HTTP 环境检查，实际 GUI 操作由上表的独立子代理完成。

GUI 报告 `p5-deployment/r1/report.md` 已返回：真实公网登录、一次明确发送/原生答复和恰好一次模型 HTTP 成立，但 **SSE 首帧严重延迟，项1/2 FAIL**。首登从连接建立到 Ready 约52分钟，刷新后约13分钟才显示已保留历史；期间浏览器 EventStream 为0，后端有持续写入计数。缓冲/代理方向仅是尚未单变量证实的假设，没有以最终收到数据放宽通过条件。新tab和退出仍 BLOCKED。主代理已要求终止长sleep、保存现象并交报告，原环境保留供有界 A/B 定位。

该任务经真实公网边缘与 tunnel 回到固定 loopback listener，但请求浏览器仍运行在本机独立桌面；不能推广为第二台物理设备、LAN 远端或 tailnet 已验证。公网 FCM 的真实设备订阅、tailnet 及 Windows 测量仍缺少相应可用环境。原初“未发现 tunnel 工具”的环境记录已由本轮公开工具安装和实际连接补充；不将临时服务的单次测量称为生产可用性保证。

2026-10-17另核对到[Cloudflare官方Quick Tunnels限制](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)明确写明`Quick Tunnels do not support Server-Sent Events (SSE)`；原文/URL/时间/SHA-256存于`p5-deployment/quick-tunnel-diagnosis/official-document.{txt,json}`。因此trycloudflare不能作为依赖SSE的Pakka正向验收环境；保留r1原FAIL，不仅凭这次失败修改产品写流或归因为产品缺陷。需要另一个实测能透传SSE的tunnel或具备配置的named tunnel，不读取用户账号凭据来临时满足环境；新tab/退出仍待真正复验。

## 7. Linux 初始轮次收尾时的待办

以下保留当时的待办，后续报告、r10 安装门禁与用户手测已有补充。当前尚待项目以 [状态入口第 4 节](../../PAKKA-POCKET-STATUS.md#4-仍有的工程与环境工作) 为准。

1. 审核第二轮各条 GUI 的真实报告与证据；普通问题待该轮完成后处置，严重问题按 interrupt/确认暂停/新快照/resume/完整重验处理，保存最新 run id。
2. 新产品候选Linux **512/512**及构建、类型、格式通过；新导航GUI正在实际安装后干净环境复验。r9完整安装在定时输入样式加载期间的点击观测失败；相同归档A/B/A已确认并修正驱动，须新source/helper身份重跑完整安装。r8通过仍只属于旧产品候选，不推广到之后修复。
3. 对相同确切 tarballs 完成仓库外实际 CLI/browser/public declarations、原生通知点击、MAS/审批/browser 和恢复验证；保留 archive/lock/source/helper/assets 身份与反例。
4. 真实公网 tunnel 已取得启动/拒绝和部分真实GUI证据，但 SSE 首帧时效 FAIL；新tab/退出仍缺测。LAN 远端、tailnet、公网 FCM 和 Windows 仍待环境，不缩减目标或用同机模拟连通代替。
5. 按指定原工作流执行 P6 双方对抗审查，保留完整意见、争议、closing 和残余项；只有真实产品接受后才归档、提交，不隐式发布。
