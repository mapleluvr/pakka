# Devin-like 前端迁移：首轮实现与验证

## 结论与版本边界

本轮交付是 **可继续评审的真实产品迁移候选**，不是静态演示，也不是已经通过全部发布／人工验收的版本。未合并或推送到 main。

- 基线：`origin/main@df76ea439e98d58c27d4c680863db3beedbf24f3`。
- 分支：`feat/devin-like-frontend`。
- worktree：`D:\Projects\kappa\migration-worktrees\pakka-devin-ui`。
- 最终产品源码候选：`fe02dd23d6a0af4989ccb8e793cfc81730ae8ea2`。后续只有本记录和图像资料变化，不将其当作新的产品源码版本。
- 本轮环境：Windows、Node `24.15.0`、npm `11.12.1`。不把本机结果外推成 Linux、远程或真实手机验收。

[实施范围](../plans/DEVIN-LIKE-FRONTEND.md)与[使用指南](../guides/WEBUI-GUIDE.md)分别保留设计映射和当前操作方式。

## 1. 参考结果究竟验证了什么

参考仓库为 [mapleluvr/devin-ui-comparison](https://github.com/mapleluvr/devin-ui-comparison)，固定提交 `ed20cec0aef82daa22aa50da19597b7ba1607e02`，主要参考 `clean-room/current`。

本机实际运行其静态页面，用新 Chrome profile 重跑内置自测，结果 **12/12**。1440×900 下侧栏总宽 300px、内容列 700px、输入卡片 688×154px；390×844 与 360×600 下卡片宽为 346px 与 316px，没有横向溢出。[运行报告](../visual-primitives/runs/devin-like-main/final/reference-runtime-check.json)保存逐项自测和实际 DOM 测量，而不只是 README 数字。[参考归档校验](../visual-primitives/runs/devin-like-main/final/reference-archive-check.json)核对了 2090 个文件，1646 个逐字节一致、444 个仅需 LF 归一化，无不匹配；这不是来源隔离或安全审计。

这些证据支持“参考原型能运行，所列壳层交互和几何确实存在”，**不支持**“已接入 Devin/Pakka 后端”或“所有 Devin 页面都已观察并复刻”。原型自己说明没有后端连接，会话布局部分也是推测。作者已参考过 dump，本轮不声称其具有严格隔离审计的 clean-room 来源。

本轮没有导入 Devin 生产 bundle、可读化应用代码、账号资料或演示组织信息。只使用视觉／布局参考，并按 OFL 携带 Inter 字体及许可。

## 2. 已实现的产品迁移

- 新增独立 `apps/webui/web/devin.css`，保留原 Preact/htm、DTO、RPC 和公开扩展边界；使用平整双栏、300px 侧栏、中性深浅主题、Inter、圆角卡片与窄内容列。
- Workspace 首页输入的是 **Conversation 名称**。向上箭头只调用原有 create API，成功后进入真实会话，工作仍须显式 Send。不是“看起来发送了”的静态交互，也不会在首页／搜索时暗中调用模型。
- 新建继承最后选择的会话配置；首次没有继承来源时使用 default profile。普通 Prompt、原生 Steer／Follow up、Team chat、实际历史、tool／receipt、模型与 cwd 的独立入口继续保留。
- 全局可见域内搜索、Ctrl/⌘ K、搜索输入初始焦点、侧栏收起与 Ctrl/⌘ B；手机抽屉、Escape 和焦点返回继续工作。手机首页保留真实 Commands & extensions／People & invites 入口，不为了贴近参考图而隐藏产品能力。
- 原有字体／字号偏好仍有效，Pocket Mono、系统无衬线和衬线仍可选；代码维持等宽字体。图标来自共享 SVG primitive，独立图标按钮保留至少 44px 点击区。
- 已提交但结果未知的新建操作在页面内保留原 requestId；导航、重开和只读核对不换号重建。before-send 与 after-commit 两种丢响应测试均检查没有第二次创建或隐式模型请求。

刻意不实现参考原型的假 Ask、PR／仓库连接、额度、Security 或 Review 服务，也不恢复已明确排除的 Plan／Goals 功能。

## 3. 本轮发现与修正

### Windows import map 启动阻塞

原服务端直接对源码中的 import map 文本计算 CSP 哈希；HTML 解析会把 CRLF／CR 归一化为 LF。Windows 检出的换行导致浏览器拒绝执行。修正只在计算哈希前按 HTML 规则规范化换行；`importmap-browser.test.ts` 通过真实浏览器分别验证 LF、CRLF 和 CR，不降低 CSP。

### 短屏会话区被挤小

新增首页入口后，360×600 的 Conversations 区一度只剩 88px。原有短屏测试失败，修正为保留 120px 最小区域，工具／扩展区仍独立滚动；没有调低测试断言。

### 从首页进入扩展页仍带首页样式

新的首页不再默认选择 Conversation。最初仅根据 `!selected` 添加 `workspace-home`，从首页进入 app-scoped 全页扩展后仍套用首页样式，手机上的 Commands 入口被隐藏。两个新增断言在修正前均为红，修正后仅在 `!selected && !extensions.page` 时使用首页样式。手机首页的全局入口也改为真实可操作的紧凑排列。

### 测试驱动的已观测时序

MAS busy 测试有一次在选择成员后立刻找 Agent details，但该节点尚未渲染。临时只增强失败上下文的探针，固定跑 10 次，得到 9 次通过、1 次失败；失败时返回的是节点不存在的 `null`，不是已证实的遮挡。最终驱动等待实际节点出现再执行原生点击，未给产品加延时，临时探针已撤掉。

新增手机首页测试也等待公开扩展 modal 完成焦点移入、以及 history-backed 弹层关闭后再进行下一次原生点击；没有用脚本点击替代真实指针。独立目录浏览器测试的期望路径改用 JSON 字符串编码，避免 Windows 反斜杠变成 JavaScript 转义，产品目录权限逻辑未改。

### 360px 首页提示语被省略

原样式有意设置了单行 ellipsis；在 360×600 下实际文字超出提示栏可见区域。先用 Range 的真实文字矩形建立失败断言，再删除 `white-space: nowrap`、隐藏溢出与省略规则；完整文字现在换为两行。390px 下允许自然单行，不要求文字宽度恰好填满提示栏。失败与通过日志分别保存为 `final/home-hint-red.log`、`final/home-hint-green.log`，不是只改测试期望。

复现过程中另观察到未规范化 Windows TEMP／TMP 时创建返回 500／unknown。统一隔离 HOME 并使用 `fs.realpathSync.native(os.tmpdir())` 后同一测试进入布局路径；这只支持已验证运行条件，不证明全部 500 的深层根因。未改写服务端 create 或 unknown 安全语义。

## 4. 分开报告的验证结果

以下是 **同一个 `fe02dd2` 产品源码候选的 r5 结果**，不是各轮最好数字的拼接。全部原始日志位于 [final 证据目录](../visual-primitives/runs/devin-like-main/final/)，[身份清单](../visual-primitives/runs/devin-like-main/final/candidate-identity.json)记录文件和安装归档 SHA-256。结论为 **NOT_FULLY_ACCEPTED**。

| 检查               | 实际结果与范围                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`    | **PASS**：durable patch 校验和 TypeScript；`final/check-r5.log`                                                                           |
| `npm run build`    | **PASS**：全 workspace 和 MAS WebUI 资产；`final/build-r5.log`                                                                            |
| JS 语法            | **PASS**：`web/app.js`、`web/sheet.js` 的 `node --check`                                                                                  |
| WebUI／MAS 专项 r5 | **43 tests：42 pass、1 fail、0 skipped**；`final/webui-r5.log`，文件清单 `final/test-files.json`。不是全仓全量                            |
| 最终候选全量 r5    | **549 tests：541 pass、6 fail、2 skipped**；`final/full-test-r5.log`；`npm test -- --test-timeout=60000`                                  |
| 原 main 全量对照   | **545 tests：536 pass、7 fail、2 skipped**；`final/main-baseline.log`。仅将基线 HTML 工作区换行规范为 LF 以便浏览器启动，没有放入迁移代码 |
| 安装消费者 r5      | **FAIL** 于 Project browser；前置真实产品／MAS 等消费者通过，后续场景 NOT_RUN，见下一节和 `final/package-r5.log`                          |
| 指定 GUI 子代理    | **BLOCKED**：没有可用 agent-workspace-linux 工具，未用程序化 Chrome 代替第 10 节独立 GUI 实操                                             |
| 指定两方对抗审查   | **NOT_RUN / BLOCKED**：指定 `D:/Pi/extensions/pi-adversarial-review/workflows/adversarial-review.js` 不存在；未自行替换工作流／模型       |

旧候选全量 r3 为 548 tests／538 pass／8 fail／2 skipped；r4 停在 server workspace-recovery 进程后中止。它们留在本机 `artifacts/full-test-devin-r3.log`、`artifacts/full-test-devin-r4.log`，不作为最终候选通过证据。上一轮出现过专项 43/43，但当前 r5 是 42/43，不能继续沿用旧通过结论。

### 全量与专项失败如何区分

1. r5 的四个 `symlink EPERM` 发生在 `pocket-directories.test.ts`、`browser-launch.test.ts` 两项、`runtime-configuration.test.ts`。原 main 全量也有同名、同系统调用失败；这是明确的本机基线失败，没有改权限、跳过或降低断言。
2. r5 全量及专项的 `input-failure.test.ts:114` 都报 `[data-action=send]` 不可交互；原 main 同名测试在同一行有相同失败。该测试在 receipt 显示后尝试再次 Send，本轮没有为了得到绿色而改驱动或放宽产品状态。这仍是当前候选的 **FAIL**，不能凭旧轮次曾通过核销。
3. r5 的 `product.test.ts:23` 单次报 `fetch failed / cause: bad port`。该路径未改，但当前没有保存出等价的 main 失败，故保留为 **未解决失败**，不直接归为基线或环境问题。
4. 两项跳过是 POSIX CDP executable 的 interception 测试；原测试明确在 Windows 跳过并要求真实 Chromium 隔离。它们不是本轮主动新增的 skip，也不能算通过。

main 的旧对照另有 Chrome profile 清理 `EBUSY` 与目录期望中的 Windows 转义失败。路径期望现已正确 JSON 编码；清理错误不等于已经证明 Enter 键失效。另一次独立 native 诊断在两侧都触发 Node/libuv `UV_HANDLE_CLOSING` 退出，日志标为历史诊断保存，**不把它算成当前 r5 的失败名称或根因**。

### 安装门禁 Project browser 的对照

r3 安装消费者在真实浏览器导航后得到 `Browser operation unknown`，一直没有 `[data-browser-frame].naturalWidth > 0`。在原 main 的独立构建、打包和安装消费者中只执行同一 `pocket-controlled` 场景，同样在同一等待条件失败，保留原 requestId 的 unknown 界面。

本候选 r5 的安装／类型声明／headless DevPack、Agent、runtime、MAS、broker、DevPack、server/client/CLI、真实 product、Pocket services、Pocket product、MAS Board 和 workflows 消费者通过。当前归档安装位置与八个 tgz 的 SHA-256 在 `final/candidate-identity.json`；`final/package-product-r5.log`、`final/package-mas-board-r5.log`保留实际浏览器／原生计数。

随后 `pocket-controlled` 再次在同一 frame 条件失败，完整状态为 Browser operation unknown，见 `final/package-controlled-r5.log`。对照原 main 的 `final/main-package-controlled.log` 也有相同等待失败。证据支持“该阻塞在原 main 也存在”，尚未证明更深根因；没有清除 unknown、重放原操作或削弱 admission 门禁。其后 notifications、schedules、memory、hooks、voice 安装消费者在本轮 **NOT_RUN**，不能拿共享产物目录中较早轮次的同名日志充数。

## 5. 视觉材料与判断边界

最新真实产品截图与测量来自 `artifacts/hint-repro/devin-shell/`，已复制到可随分支阅读的 [final 证据目录](../visual-primitives/runs/devin-like-main/final/delivery-review.md)：桌面深／浅主题、原生会话、搜索、390×844 和 360×600 首页。来源、尺寸、文件 SHA-256 与安装归档身份在 `final/candidate-identity.json`；`.gitattributes` 禁止对证据 JSON／日志换行转换，避免跨平台检出改变已记录字节。

已直接查看参考图、产品实际图、相同坐标系的首页卡片裁剪和产品布局标注。`vp colors` 在两张深色桌面图的 `(400,100)` 和 `(800,460)`、3px patch 分别采得 canvas `#141414`、card `#1f1f1f`；产品 DOM 报告侧栏 300px 且无横向溢出。卡片裁剪统一使用像素、左上原点、LTRB `520,320,1220,540`。标注框是人为给定的检查坐标，不冒称自动检测出的精确边界。

这支持“主要视觉语言已经迁移”的判断，不是整体像素一致率。真实人员／会话导航、菜单、权限、首页只创建的语义和较大的点击区有意与静态原型不同。没有把大面积功能区排除后宣称像素级复刻通过，也没有用原型的历史 GUI 报告替代本轮产品验收。

## 6. 后续正式验收交接

具备指定环境后，以以上固定产品源码候选重新准备独立验收 worktree 和唯一 Linux desktop；不要默认测试旧 main 或拿旧安装包替代本候选。GUI 默认模型及职责遵循 [开发规范第 10 节](../development/WEBUI-DEVELOPMENT.md#10-分阶段-computer-use-实操验收)。

必须覆盖：

1. 深浅主题与已保存的字体／字号；桌面侧栏收起、全局搜索和键盘焦点。
2. 从首页创建真实 Conversation，检查模型／cwd 继承；只有进入后显式 Send 才产生一次真实本地 provider 请求。
3. before-send／after-commit 丢响应后的离开、返回与原操作核对，不出现替代创建或隐式重发。
4. 360×600、390×650、390×844 的抽屉、扩展分组滚动、大字号、首页全局入口和输入区。
5. 从未选择 Conversation 的首页直接进入普通全页扩展及 MAS Board，再返回；实际控制、原生 steer／follow-up／abort 和 unknown 恢复路径保持原契约。
6. viewer、资源撤权、审批、通知、文件、Memory、hooks、定时输入及公开扩展回归；不用静态演示数据替代实际效果。

由父代理保留修复和最终验收决定。具备指定入口后再运行两方 adversarial review，并保留两份意见和争议。最终完整门禁、独立 GUI、人工确认与推送／合并是不同事项，本页不提前核销。
