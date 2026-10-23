# MAS Board 实施与候选验证（r1–r8）

本轮按 [设计第二稿（OpenSpec）](../../openspec/changes/mas-board-relationship-workbench/design.md) 实现，操作见 [MAS Board 使用](../guides/MAS-BOARD.md)。实现位于 `feat/mas-board` 独立工作树，基线为 `b5c302f4ec1535d9aadb6b4135366298d8f27035`。旧设计稿和已完成的用户验收保留其原范围。

## 实施范围

- MAS catalog 原事务保存真实创建来源、fork 历史来源和通信观测；旧记录缺失字段保持未知。
- Board 分开显示创建、管理及历史来源；`Available` 与实时活动分区。预览直接截取公开 thinking、按 callId 匹配的工具参数、回复和真实错误。
- 图提供创建／通信图层、方向计数、平移、缩放、节点拖动与方向键移动、成员列表及个人视图恢复。个人隐藏关系不影响投递和日志。
- 交流记录有界分页，支持两端、成员、模式、发起方式、状态和正文筛选。先过滤双端 read 权限，再搜索与分页，并在异步返回前复核。
- 通用宿主 Conversation 来源接口让插件成员使用完整对话界面；输入、独立模型／cwd、读取和管理继续执行既有权限，返回 Board 保留个人选择。
- 未决成员操作可在关闭、重开面板后按原请求核对；进一步输入维持锁定，核对不重发工作。
- 原生 assistant 错误以有界 `errorMessage` 穿过 WebUI 协议，并在完整 Conversation 中显示。读取或重开错误历史不会重发工作、重置额度或退回已清除的启动凭据。

## 回归及修订证据

本地确定性 HTTP provider 驱动真实 Pi、CLI、存储重开和浏览器。失败记录与各候选的结果分别保存在外置证据目录 `pakka-evidence/mas-board/r1/` 至 `r8/`。

| 路径                                                  | 检查内容                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/mas/test/observations.test.ts`              | 创建来源、人工发起、回复关联、重复核对及正常重开                               |
| `packages/mas-devpack/test/observations.test.ts`      | 活动类型、受限读者、双端过滤、分页、撤权及读取零模型调用                       |
| `packages/mas-devpack/test/activity-provider.test.ts` | 真实流式 thinking→正文阶段切换、provider 401 原因及单次调用                    |
| `apps/webui/test/mas-resource-navigation.test.ts`     | 通用导航、完整读取、原生输入、配置权限及撤权                                   |
| `apps/webui/test/mas-board.test.ts`                   | 真实模型创建子成员、图层、通信、隐藏／恢复、人工回复、导航往返及大字号手机布局 |
| `apps/webui/test/mas-board-recovery.test.ts`          | 实际接纳后丢响应，关面板再核对，只有一次输入                                   |
| `apps/webui/test/error-history.test.ts`               | 清除凭据后产生错误、正常重开、首条快照和原文原因恢复，零 provider 调用         |
| `packages/protocol/test/pocket.test.ts`               | RPC／SSE 接受有界 assistant 错误原因，拒绝越界、错误类型及错误消息角色         |
| `scripts/consumer-mas-board.mjs`                      | 仓库外实际归档安装、图和日志资源、受限读者、回复关联与 Conversation 往返       |

手机检查采用 360×600、390×650 及 24px 字号；验证文档无横向溢出、主要操作可达、画布有可用高度和成员列表可切换。早期浮层遮挡点击的原图及命中边界同样保留。

### r1：保留的失败与修订

首轮全量 `r1/full.log` 为 512/534，22 个失败、零跳过。发现并修订了旧有限 HTTP 成员投影兼容、合法 catalog 外创建来源、观测发起字段影响原请求核对，以及旧 Board 入口驱动。原始日志与 `full-first-artifacts/` 保留。修订后 `r1/full-final.log` 为 **534/534**，零失败／跳过／取消／TODO。

r1 安装候选的源码身份为 `d71dc328836b864d550a439560f76a0b0fe5f9342b4ea9056c4b22a6575052d8`，含 533 个源码文件、八个归档；12,649 个安装文件与包内容匹配。身份前置检查及反例通过，但完整安装消费者 **FAIL**：清除私密 provider 凭据后产生的错误历史在第二次正常重开时让 Conversation 停在 Connecting。

原生 Runtime 能读取历史；新投影的 `errorMessage` 却未被 WebUI assistant 消息的有限解码器接受，SSE 在首条快照编码时结束。原安装包在两个干净数据目录中复现，保留请求／SSE 元数据、原生读取及编码失败证据。诊断详见 `r1/reopen-diagnosis/REPORT.md`。原失败目录为 `/tmp/pakka-packed-consumer-hOV3C3`；未沿用可能指向旧成功运行的 `consumer-path.txt`。

协议及浏览器红测试分别复现后，修复有限 DTO 并显示原文原因。`r1/reopen-diagnosis/targeted-green.log` 记录 **12/12** 定向通过；这不替代 r2 的全量和完整安装门禁。

### r2：错误历史修复后的候选

r2 修复后的全量 `full.log` 为 **536/536**，零失败／跳过／取消／TODO。类型、构建、代码及文档格式、链接和本次 OpenSpec 严格校验通过。完整仓库外安装门禁 **PASS**，包括此前失败的错误历史重开路径。

`r2/complete-gate-identity.json` 记录源码身份 `1b52f45056c59ed6e2db43aed3c731a8abf2fefe40b98b603434049faf06838d`、534 个源码文件、八个实际运行归档及 12,649 个安装文件的逐字节核对。归档、实际 lock、逐文件清单和各消费者原日志均单独保留。

交付身份前置检查比较实际源码清单、八个归档、lock 与安装内容，并验证遗漏源码、遗漏包、损坏包和篡改身份会阻止后续命令。完整消费者使用安装后的 `.bin/pakka-webui` 与公开资源；固定源码、实际使用归档、lock 和逐文件比对随该候选保存。

### r3：实时活动与拦截生命周期修订

收尾时通过真实本地流式 provider 确认：Pi 的 live message 在正文开始流出后保留先前的 thinking 内容块。r2 的活动投影优先检查 thinking，造成正文输出期间仍显示旧思考片段。原生内容和失败断言保存在 `r3/activity-stream-red-native.log`；仓库内回归先复现了同一失败，日志为 `activity-provider-red.log`。

r3 按最后一个非空原生 thinking／text 内容块投影当前阶段；保留实际终态错误的优先级，工具继续按 callId 匹配。实际流式回归和投影权限回归 **4/4** 通过，类型检查通过。

首次全量 `r3/full.log` 为 **536/537**；唯一失败为之前保留的 owned-browser 隔离路径。可逆的诊断日志在 20 次真实 Chromium 操作中捕获 4 次失败：新导航撤销旧请求后，`Fetch.failRequest` 收到 `-32602 / Invalid InterceptionId.`，被误判为未知故障而封锁整个浏览器服务。原源码已恢复后再修订；诊断日志不进入产物。

`apps/server/test/cdp-fixture.ts` 用受控 CDP 子进程固定这一已观察到的响应顺序，红测试稳定重现相同故障。修复仅将 `Fetch.failRequest`／`Fetch.continueRequest` 的上述精确原生响应识别为已撤销请求；不同状态码或原因仍封锁服务，origin 代理与资源权限均保持检查。该边界的 **8/8** 测试及原真实 Chromium 隔离路径 **20 次连续复测**通过；对照与原始结果见 `r3/isolation-diagnosis/`。受控 CDP 子进程夹具依赖 POSIX 可执行脚本，仅这两条夹具测试在 Windows 上显式跳过；实际 Chromium 隔离测试继续执行，Windows 本轮尚无验收结论。

修复后的 `r3/full-final.log` 和最终 `r3/full-delivery.log` 均为 **539/539**，零失败／跳过／取消／TODO。类型、格式、文档链接和本次 OpenSpec 严格校验通过。

r3 完整消费者及干净 `npm ci` 各自通过，但最终交付身份为 **FAIL**。冻结 helper 只重建了 agent，将未更新的 `dist/activity.js`、`dist/pocket-browser.js` 放进冻结归档；消费者的全仓构建生成了修复后的实际包，故 `mas-devpack`／`server` 两个归档与冻结物不同。八份实际归档、实际 lock 及原日志保存在 `r3/actual-unmatched-run/`，文件级差异见 `r3/archive-mismatch.json`。安装流程通过并未核销这次身份失败。

### r4：全仓构建与通知读取失败

冻结流程在源码清单固定后先运行全仓 `npm run build`，复核源码清单未改变，再生成八个归档并独立安装。r4 的产品及测试源码与 r3 的 539/539 候选保持一致，轮次间只补记三份状态文档；映射单独保存。门禁随后从同一源码重新构建、打包和实际消费，并逐字节核对实际运行归档与冻结物、实际 lock 和安装文件。

r4 的身份核对 **PASS**，完整安装门禁 **FAIL**。`r4/failed-gate-identity.json` 保留源码身份 `4026fb1aed197b8d48716d4fa5688491da10a4fa2be7fffa547cef74b3620b8b`、535 个源码文件、八个实际使用归档、实际 lock 及 12,649 个安装文件的匹配结果。失败目录 `/tmp/pakka-packed-consumer-wzbfiC` 单独保存，未使用旧成功路径替代。

新 Board 安装消费者已通过；后续通知消费者在设备检查的原生通知列表读取处失败。原包在干净数据目录复现。观测确认 worker 已收到消息、权限 granted、原生显示调用成功，且没有清空通知消息；驱动却在显示完成前启动了列表查询。隔离副本仅加观测后，等待原生显示完成再读取连续 85 次通过，恢复原读取顺序在第 14 次再次失败。最小对照各轮零模型调用，原失败、观测顺序和对照日志见 `r4/notification-diagnosis/`。

### r5：原生通知的读取顺序

产品和 worker 源码保持 r4 版本；本轮修改浏览器测试基础设施及两个通知驱动。驱动通过 Chromium 公开 CDP 的 `BackgroundService` 观察同一页面、origin 和 tag 的 `Notification displayed`，再读取实际通知列表；原生显示、通知正文／权限、TLS 推送和退出后的拒绝断言仍保留。该屏障不生成通知、不重发请求、不扩大原有断言超时。实际安装包上仅采用公开事件屏障的最小回归 **40 次连续通过**，对应 `public-event-B-*.log`。

r5 最终候选的工程及交付门禁 **PASS**，结果记录在 `pakka-evidence/mas-board/r5/`：

- `full.log`／`full.exit`：**539/539**，零失败、跳过、取消或 TODO；类型、全仓构建、代码及文档格式、链接和本次 OpenSpec 严格校验通过。
- `package-gate.log`／`package-gate.exit`：完整仓库外安装门禁通过，包括实际 `.bin/pakka-webui`、Board 关系与日志、受限手机读者、Conversation 往返、错误历史重开、通知、定时输入、Memory、Hook 和原生输入核对。
- `complete-gate-identity.json`／`verify-complete-gate.exit`：535 个源码文件、八个实际运行归档、两份实际 lock 与 **12,649** 个安装文件逐字节匹配。实际消费者为 `/tmp/pakka-packed-consumer-UaddlV`，其归档、lock、逐文件清单和原始消费者日志均已保留。
- `clean-ci.json`／`clean-ci.exit`：独立干净 `npm ci` 通过，lock 未改变，12,649 个文件再次与冻结归档匹配。
- `driver-only-continuity.json`：r4→r5 只变更三份测试驱动及两份状态文档；产品源码与八个冻结归档相同。

上述回执对应冻结源码身份 `70e38eb66377f19f3ba51524287496a213f4237ae7eb21ba0a7956a5f7c6f20e`。收尾仅更新三份状态文档，其与测试候选的差异在 `metadata-amendment.json` 单列，最终源码清单另存 `snapshot-final.json`；工程代码、测试、驱动和实际归档保持冻结版本。

第一次安装尝试的执行进程中断，未生成退出码。该次 **INCOMPLETE** 的目录身份、八个实际归档和日志保存在 `attempt-1-interrupted/`，不记作产品失败或门禁通过；后续仅重新执行未完成的安装门禁，未重复已通过的全量。

`evidence-collections.json` 给出两份压缩证据及逐文件 SHA-256 索引：全量运行窗口内的 602 个原生夹具，以及完整安装消费者的运行数据、操作记录和页面证据。依赖缓存和 `node_modules` 不重复归档，可由单独保留的八个归档、lock 与安装文件清单复原；源码快照另行封存。r1–r4 的原失败及各自身份仍保留。

### r6：用户实操反馈与独立控制界面

用户在本地确定性 provider 实例中确认 MAS Board 的功能性正常，并提交桌面、手机截图：Agent controls 作为 `panel` 插进了原 Conversation，出现两套发送区；退役节点缺少收起显示的入口。原截图及失败页面保存在 `pakka-evidence/mas-board/r6/user-feedback/`，停机后的原 Session 与辅助脚本备份在 `manual-before-update/`。

`apps/webui/test/mas-board-presentation.test.ts` 的四个红测试分别复现桌面／两种 3:5 手机的内嵌控制区和退役节点缺少隐藏入口。修订通过普通 WebUI 的 `sheet` 插槽独立承载 Agent controls，保留 Board 和原 Conversation 草稿；面板正文独立滚动、顶部关闭按钮可达，关闭和 Escape 后焦点返回入口。退役节点提供个人 **Hide from Board** 和 **Show hidden Agents**，仅收起画布／列表及关联线；交流日志、历史、原生成员状态与已花额度保留。

刷新回归另外发现旧偏好键依赖宿主是否选中了 Conversation。Board 的有限只读 `WorkbenchView` 现在提供真实绑定的 `sessionId`，浏览器据此恢复个人视图。权限投影及刷新回归验证隐藏可持久保存，日志仍能进入原 Conversation；隐藏、恢复和往返均不产生 provider 调用。

r6 的 `build.log`／`build.exit`、`full.log`／`full.exit` 已通过：**543/543**，零失败／跳过／取消／TODO。完整安装门禁在首次 Agent controls 入口失败；实际包、lock、数据与原日志保存在 `attempt-1-controls-click/`。原点击时仍有有限入场动画，节点没有被选中；仅等待样式、字体与有限动画后，首次入口连续 15 次通过，恢复原顺序首次再次失败。该对照仅覆盖首次节点选择和控制入口，不覆盖退役后的重开，见 `controls-diagnosis/REPORT.md`。

### r7：布局就绪屏障与退役后重开

r7 只修改安装驱动；产品源码与八个冻结包和 r6 逐字节相同。完整安装通过首次控制入口、退役节点隐藏与恢复，随后在移除 MAS facet 的正常重开时失败。公开 `startPocket` 在相同保存状态上返回 `MAS readiness barrier incomplete`：激活屏障把保留历史的 `retired` 成员当作尚未就绪。该失败与原归档身份保存在 `r7/attempt-1-retired-reopen/`，不以 r6 的全量结果核销。

### r8：保留退役历史的重开

`packages/mas/test/mas.test.ts` 的真实 Pi 回归先复现相同激活失败。修订只让已确认的 `retired` 成员保持历史状态，激活时不重写、复活或向其投递；所有非退役成员继续经过原生就绪核对，准备中、停止中、失败和未知状态继续阻止激活。原子更新使用本次读取的版本，避免在异步就绪核对期间覆盖新的成员变更。

定向 MAS／未知持久化回归 **10/10** 通过，覆盖正常重开、历史回执、全员退役和零重放。首次全量为 **544/545**，失败于旧恢复驱动尚未等到节点详情入口；原结果保留。该失败独立重跑 10 次未再现，故不直接归因于某个动画。浏览器同一任务内的对照确认节点选择后的详情是异步渲染；修订驱动在节点坐标测量前等待布局就绪，并在点击后等待详情入口出现，完整恢复场景和新全量均通过，后者 **545/545**，零失败／跳过／取消／TODO，见 `full-final.log` 和 `recovery-layout-diagnosis/REPORT.md`。

完整仓库外安装、事后身份核对和独立干净 `npm ci` 均通过，回执在 `pakka-evidence/mas-board/r8/`：

- `package-gate.log`／`package-gate.exit`：实际安装入口、Board 独立控制、退役隐藏／恢复、正常重开和其他完整消费者通过。
- `complete-gate-identity.json`／`verify-complete-gate.exit`：536 个源文件、八个实际运行归档、两份 lock 及 **12,649** 个安装文件匹配。实际消费者为 `/tmp/pakka-packed-consumer-15QGEH`；实际归档、lock 和逐文件清单分别保留。
- `clean-ci.json`／`clean-ci.exit`：独立干净 `npm ci` 通过；lock 保持原字节，12,649 个文件再次与冻结归档匹配。

测试与安装对应冻结源码身份 `fad83db170b84b7c5336626262a99f92be1bbeff994f8b8a9c4ac9363636ee1f`。收尾只同步本页及当前状态页，差异在 `metadata-amendment.json` 单列，最终源码另存 `snapshot-final.json`；实现、测试、驱动和八个产品归档保持冻结版本。最终回执见 `FINAL.json`。

用户的原实例已从这套安装包恢复至 `http://127.0.0.1:40429`，沿用原 Session 与 provider 地址。原有 B 保持退役，C 保持可用，已有成员身份和状态逐项一致，恢复过程零模型调用；操作指引和启动记录见 `manual-restored/HANDOFF.md`、`ready.json`。

## 实操范围与交付边界

2026-10-18，用户在恢复的 r8 实例上确认独立 Agent Control 弹层、退役节点隐藏／恢复两项补验通过；此前已确认的 MAS Board 功能结果及五项 Pakka 本机验收继续保留。用户确认和本轮交付记录追加在 `pakka-evidence/mas-board/r8/user-acceptance-delivery/`，r8 的工程 `FINAL.json` 保持原封存内容。后台 GUI 子任务仍按要求暂停；远程部署与跨平台待办保持各自状态。

指定的 `pi-adversarial-review` 已按授权尝试，工作流 `9ac2004b-bd32-4637-986e-6706f979e06f` 的首个 reviewer 因 AnyRouter 对 `gpt-6-astra` 返回 HTTP 500／负载上限而失败，未产生意见或双方争议记录；没有换模型或自动重试，审查结果仍为 `NOT_RUN`。

用户已授权将本轮实现提交、推送至 main，实际提交与远程身份见上述交付记录。P5／P6 的远程部署、跨平台和指定对抗审查继续分别按其验证结果记录。
