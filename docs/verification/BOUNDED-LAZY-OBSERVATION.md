# 有界观察与懒加载交付检查

## 对象与固定身份

本记录覆盖普通 `pakka` / WebUI 的冷打开、333 ms 增量观察、按需原文、正文与历史虚拟窗口、字节缓存、取消和权限边界。采用与契约分别见[形成记录](../changes/bounded-lazy-observation.md)、[观察 state](../state/conversation-observation.md)、[Runtime API](../reference/RUNTIME-API.md)和[使用指南](../guides/WEBUI-GUIDE.md)。

2026-11-09 的交付候选位于 `pakka/lazy-webui-observation`，基线 `aa83eedecc92ec3d7b0f46010814344da721b0c6` 承接未合 PR #4。检查在 Windows x64 / Node `v24.15.0` 执行。当前 C8 冻结源码共 600 个文件，SHA-256 为 `9d4a86314df2238a7d63421293b89d98654179f249549847dceb246720481bbc`；浏览器 vendor 为 `d12efbe6149601db2b6d44451ddd1358d42a864e030f4123918bf07501b81576`。C6→C7 仅 `apps/webui/test/schedules-recovery.test.ts` 的测试输入操作及其字面核对不同；C7→C8 仅 server/WebUI 的 `http-listener.test.ts` 改为控制首次报告地址，产品源码和浏览器资产均不变。C8 的 build/check、完整回归与独立安装检查均通过，检查前后源码身份不变。固定归档身份与 34 步结果见[最终交付身份](evidence/bounded-lazy-observation/2026-11-09/delivery-identity-c8.json)，新增 67 份证据的字节摘要见[最终证据清单](evidence/bounded-lazy-observation/2026-11-09/final-evidence-manifest.json)；不把此前测量倒写为 C8。

已保全的 C4 为 599 文件、源码 SHA-256 `2ee0336462a2eea41fd1a708fa26db2723baa5da7f41aa81704bc3ea6c243b91`；其固定文件和八个归档身份在 [C4 delivery-identity.json](evidence/bounded-lazy-observation/2026-11-09/delivery-identity.json)。文档/提交身份与各次检查的源码身份分别保存。

生产 cohort 为 Pi AI / Chord / Telemetry `1.4.0`、Pi Durable `1.4.0-pakka.3`。新增原生接缝的源码、构建锁、固定归档与回归依据见 [.3 补丁说明](../../patches/pi-durable/1.4.0-pakka.3/README.md)，不是修改已安装依赖。

## 当前 C8 检查

C6 的实时投影和预览范围回归已通过：11 项有界参数/错误/源遗漏、正文阅读和搜索检查，另有 11 项原文流式交付、历史分页、真实工具交接、原图和回执对照。C6 完整回归 893 项为 890 pass、1 fail、2 skip；八个固定归档的 34 步仓库外安装消费通过，检查前后源码 hash 不变。唯一失败是 schedule 浏览器测试输入约 302 秒而非 2 秒，修正测试输入并连续八轮通过后进入 C7；没有改变 scheduler 或放宽消费/预算断言。

C7 完整回归 893 项为 889 pass、2 fail、2 skip，源码前后 hash 相同，安装检查未启动。两项失败均在强制绑定本机 `4045` 时得到 EACCES；未进入被测端口重绑逻辑。原测试单独重跑复现。C8 改为只控制首次已监听地址的报告值，真实 `listen(0)`、关闭再绑定、Fetch、WebUI 和本机 provider 请求保持；7 项端口回归通过，固定端口的安全拒绝断言不变。

C8 的 `npm run build`、`npm run check` 通过。完整回归为 **893 项：891 pass、0 fail、2 项既有平台 skip**，耗时约 2,272 s；[完整日志](evidence/bounded-lazy-observation/2026-11-09/lazy-c8-final-full.log)与[完整 TAP](evidence/bounded-lazy-observation/2026-11-09/lazy-c8-final-full.tap)保留。八个固定归档的 **34 步仓库外消费全部 exit 0 / signal null**，包含真实 PowerShell `pakka`、原 Session 重开和定时任务；[安装日志](evidence/bounded-lazy-observation/2026-11-09/lazy-c8-final-package.log)与逐步记录均固定。

完整回归和安装完成后分别[核对源码身份](evidence/bounded-lazy-observation/2026-11-09/lazy-c8-identity-after-full.log)、[再次核对身份](evidence/bounded-lazy-observation/2026-11-09/lazy-c8-identity-after-package.log)，均为上述 600 文件的相同 SHA-256。C6/C7 的失败与 C8 的通过分别保留，没有用新结果覆盖旧日志。

## 已保全的 C4 结果

| 范围                    | 实际结果                                                                                               | 固定证据                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量源码回归            | 887 项：885 pass、0 fail、0 cancelled、2 既有平台 skip                                                 | [spec](evidence/bounded-lazy-observation/2026-11-09/lazy-final-full-04.log)、[TAP](evidence/bounded-lazy-observation/2026-11-09/lazy-final-full-04.tap)                   |
| 严格类型检查            | `npm run check` 通过                                                                                   | [check](evidence/bounded-lazy-observation/2026-11-09/lazy-final-check-06.log)                                                                                             |
| 源码构建                | `npm run build` 通过                                                                                   | [build](evidence/bounded-lazy-observation/2026-11-09/lazy-final-build-05.log)                                                                                             |
| 仓库外消费              | 八个固定归档，34 个打包/安装/声明/功能步骤均 exit 0、signal null                                       | [总体输出](evidence/bounded-lazy-observation/2026-11-09/lazy-final-package-smoke-04.log)、[逐步清单](evidence/bounded-lazy-observation/2026-11-09/delivery-identity.json) |
| 原生读取与缓存          | SDK 183 项与独立安装消费者 6 项通过                                                                    | [SDK 与独立消费者](evidence/bounded-lazy-observation/2026-11-09/durable-byte-cache-green.log)                                                                             |
| 当前后端/浏览器关键路径 | 全量包含根/子默认冷打开、预览/范围/分叉/权限、增量/共享观察、原文/图片、字节窗口/滚动/焦点和运行中工具 | 上述完整 TAP 按测试名称定位                                                                                                                                               |

C4 全量和安装消费完成后，各自复核源码清单一致。以下长历史 ego 使用 C3/C4 的相同产品源码；C3 → C4 清单只改变 `apps/webui/test/browser.ts`、`apps/webui/test/lazy-content-browser.test.ts` 和 `scripts/consumer-pocket-schedules.mjs`，没有改变被测产品。该差异由 delivery identity 明确枚举。

独立安装覆盖公开声明（含严格声明检查）、headless 不解析 Coding Agent / WebUI、真实 worker、MAS、ExecutionEnv、协议、WebUI 功能、PowerShell `pakka` 无配置启动及原 Session 重开。定时任务保留实际延迟、两个模型请求/两次消费、原生 Job、丢失响应核对与扩展移除后继续存在的断言；没有扩大等待来掩盖错误输入。

## 原长历史的 ego 复测（C4 产品基线）

原样本只读，历史正文、图片、Magic Context 元数据不进入提交报告；插件元数据未执行，本次导入不是 Magic Context 的运行实现。全部模型操作仅指向拒绝意外输入的本机假服务，记录的模型 HTTP 为 0。

- 原文件 345,625,465 B、7,375 行，SHA-256 `50a54e4a7fb3bf9b820bfe29a1ebe440271710966045fd5458126f5a4b534f17`。
- 同一分支历史导入 7,276 条记录、4,650 个模型条目；原图正文 draft 329,529,914 B。另保留图片占位对照和一份独立原图 Session。
- 浏览器使用 ego lite `0.6.2.8`。先前的 `0.6.2.7` / `aa83eed` 历史负载结果保留其原身份，不倒写为新版本结果。
- 空间 11、12 在运行间消失后，按操作者“ego 可以自建空间”的授权创建空间 13，继续同一数据副本；各空间的原输出分别保留。没有把消失空间的截图冒充新空间。

| 操作/样本                              | C4 实测                                                                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 两份独立原图 Session 的普通根/子冷打开 | 约 131 ms；强制 GC 后 heap 27.59 MB、RSS 137.83 MB。旧同规模全历史装配约 2.25 GB heap；两者不是执行上下文容量认证                                                                                   |
| 原图连续读 14 页                       | 此前第六页的大记录上限不再阻断；最多 24 条虚拟行、733 个 DOM 元素；折叠正文/图片节点为 0                                                                                                            |
| 14 页结束                              | 浏览器 V8 used heap 7.96 MB；服务端 heap 27.41 MB、RSS 170.25 MB；模型 HTTP 0                                                                                                                       |
| 实际工具原文                           | 展开后范围读取，Find/Enter 找到所选原文，真实下载得到 1,593 B JSON；SHA-256 `fff50240dfef73e7f49ce3dcdfd4bb3d874ecd0c4a1425b02ab697d7319c5b7f`，成功解析；收起后 3 个 reader / 16 个正文行回收到 0  |
| 原图按需展开/收起                      | 原始 1536×1024 图片约 1.53 s 完成；下载 1,958,156 B，SHA-256 `7c345cb7f9428d1afd2199b63ca2a3d45bf6016956ad4d848a359d1b79aa7b7d` 与 source JSONL 二进制完全一致；收起后图片/正文 reader 节点回收到 0 |
| 四个真实页面、三个获准历史目标         | 同身份共用 1 条 SSE；30 秒空闲仅 13 B SSE 心跳；单核 CPU 加权约 2.02%；管理 list 实际约 3.7 ms；服务端 heap 27.58 MB、RSS 171.89 MB                                                                 |
| 五次被动展示提交 → 可见                | 263–363 ms、平均 308.4 ms；包含 ego 等待/采样延迟，不能当作纯前端排版耗时；模型 HTTP 0                                                                                                              |

四页面空闲窗口不是所有 HTTP 的总流量：通知扩展仍有独立小 RPC 轮询，30 秒含这部分和管理 list 的响应 body 合计 22,176 B，上述 13 B 专指工作台 SSE。CPU 来自该窗口 30 个间隔样本，包含实验定时采样/控制文件检查及通知扩展工作；不以其直接计算旧版本优化比例。SharedWorker 共享观察可缓解 HTTP/1.1 多页面占满连接池；不支持 SharedWorker 的直连回退仍受浏览器池限制。

原图哈希从只读 source JSONL 提取，不以产品自身返回的元数据充当原文 oracle。所有模型 HTTP 为 0，历史中的工具文字与命令不执行。最终 TaskSpace 13 已 finish，实验 server 正常退出且原 writer claim 已释放；关闭后 GC heap 25.04 MB，实验数据原样保全。

脱敏计数、原图哈希、执行 frame 与内存样本汇总保存于[ego-summary.json](evidence/bounded-lazy-observation/2026-11-09/ego-summary.json)，关键文件摘要见[证据清单](evidence/bounded-lazy-observation/2026-11-09/evidence-summary-manifest.json)。完整正文快照、原图、恢复凭据和隔离数据库只保留在已忽略且权限受控的本机实验目录，不提交。

## 实时预览的 ego 补核（C6/C7/C8 相同产品）

最后使用同一原 Session、Conversation 和已提交 LiveDoc 重开，没有新建替代数据库或重新注入原生内容。HTTP 资产在服务启动时固定；先核对实际服务与浏览器读取的 reader SHA-256 `30cbb5d805872bd83f06e3629c11e5fb184750700e92f8563359f19fc8054f0e`，避免把旧进程重载误作新候选验证。空间 14 已不存在，按既有自建空间授权使用空间 15。

约 768 KiB 的实时参数形成 1,043 B 观察快照。展开后正文区域 595 B、4 个正文行节点、352 个 DOM 元素；参数首尾、源遗漏的 1,234 B / 7 行提示保留。两个 reader 都标明 Preview only / Copy preview，无原文下载入口。只读 SQLite 核对连续 300 个 `x` 仍存在于原生 source；搜索该字面量显示“Not found in this preview; the complete original was not searched.”，正向字面搜索显示“Found in this preview.”。收起后正文/reader/图片节点均为 0，总 DOM 回到 324。

空间 15 已 finish，服务正常 exit 0，原 writer claim 为 0，模型请求为 0。[实时补核摘要](evidence/bounded-lazy-observation/2026-11-09/late-live-ego-summary.json)记录服务资产、原生只读 oracle、负向搜索与收起回收；C6→C8 的三个测试文件差异由最终交付身份枚举。此次为固定实时摘要的功能补核，不替代上述长历史负载样本或容量测量。

## 失败到修正的证据

原失败保留，不把重跑覆盖成首次通过：

1. 手写变高列表的测量/锚点反馈在长历史中失败，因此换成固定版本的成熟虚拟化内核。正文权限、内容引用和缓存仍由原上层实现负责；同样的滚动、焦点、展开和 1,600 条字节窗口断言重复六轮后进入全量。
2. 首轮默认入口遗漏 lazy 装配，定向测试显式传入参数掩盖问题。新增不传 lazy 的普通根/子启动回归后修正默认入口；最终 full suite 含这两条。
3. Sheet 将 disabled 模型项加入焦点循环，Board 画面已变而保存尚未完成。保持真实键盘/刷新路径，分别以红绿回归修正；最终全量包含新增断言。
4. 搜索探针查询正确、按钮 enabled，却没有收到 native click；Enter 连续八轮通过。测试 helper 居中滚动后再次居中在取点/按下之间移动变高列表；明确等待控件几何稳定，并保留可见视口进行真实点击后连续八轮通过。[最后一轮](evidence/bounded-lazy-observation/2026-11-09/lazy-reader-no-second-scroll-8.log)与[Enter 对照](evidence/bounded-lazy-observation/2026-11-09/lazy-reader-enter-8.log)均保留，未修改搜索算法或放宽匹配断言。
5. 安装 schedule 脚本直接清空受控 `.value` 后插入 `2`，异步渲染恢复默认 `30`，实际输入变成 `302`，不是 scheduler 不推进。改为真实键盘 replace 并核对 `2`，原等待/消费/幂等断言保留；[连续六轮末轮](evidence/bounded-lazy-observation/2026-11-09/lazy-schedule-keyboard-6.log)及最终固定安装步骤通过。
6. 前轮 Node 子进程以 `0xC0000409` 退出，独立 strategy 回归和八轮复跑通过；最终完整候选中同一文件也通过。失败不解释为产品功能已通过，也未改变生产 Node 或吞掉退出码。

7. 交付复核发现实时路径遗漏归档已具备的大参数/错误摘要和源遗漏计数。原生 LiveDoc 回归首次四项失败、小参数对照通过；修正字节/深度/节点预算和源遗漏传递后，定向检查通过。模型/工具收到的内容和持久档案不由显示预算裁剪。
8. C5 的 ego 展开实操显示未发布摘要仍叫 Copy original，实际存在于完整 native source 的 300 字面字符在预览中未匹配后被误称为完整原文缺失。明确停止 C5 全量/安装运行，保留负向证据；修正为 Preview only / Copy preview 与预览范围的搜索结果，不据此开放原文能力。C6 定向与原文交接对照通过后重新冻结。
9. C6 全量再次暴露源码 schedule 测试的同类受控输入竞态：只读数据库表明 job 的 `nextDueAt - startedAt` 为 301,969 ms，远超原断言等待时间。孤立重跑曾通过，不称为稳定复现；改用真实键盘 replace 并核对值为 `2` 后连续八轮通过。C7 仅改变该测试，产品代码、原请求/预算/重复调度断言均保留。
10. C7 两项端口测试强制绑定本机 `4045` 遇 EACCES。只读 netsh 排除范围不包含该端口，因此没有推测具体 Windows 拒绝策略或修改网络设置。C8 只控制首次 OS-reported address，继续用真实监听、关闭、重绑、Fetch 和 provider 证明分支；不跳过 `4045`、`4190`、`6679`，也不放宽产品的 Fetch 安全限制。

## 诊断与格式

各候选以严格编译、完整回归和固定安装消费共同检查，不混用结果。C4 最后四个路径的主动 LSP 探查没有类型/语法错误；附属 AST 仍报告五条风格/规则提醒：本机测试 URL、已有 `throw Error` 以及内容类型/状态的嵌套条件表达式。这些没有通过类型强转、关闭安全规则或改依赖绕过。适配器超过 LSP 行数上限，以完整 TypeScript 检查覆盖，不声称全仓 LSP 零诊断。

C6 曾有两条 reader/browser 路径的 20 秒 LSP 探查超时，保留为未确认。C7 对当前 reader 和 schedule recovery 测试的主动 LSP 检查完成，两路径无诊断；C8 两个端口测试的主动 LSP 检查也无诊断。严格编译和本次改动源码格式检查通过。文档链接检查为 22 文件、278 个本地链接、17 个锚点，OpenSpec strict 通过；22 个 Markdown 范围（含新增账本片段）lint 为 0 问题，Prettier 检查通过。C4 的固定检查保持原身份。过期语言服务声明与无关工作树缓存在核对实际声明/定义位置后区分，不把缓存总数当作当前错误数。

## 使用边界与后续

本次证明被动浏览、传输与 DOM 可有界，而不是所有执行 Runtime 的内存已经有界。显式 execution frame / generation 仍有完整上下文语义：同一冷 Runtime 主动为一条原图 Conversation 准备完整 frame，约 3.31 s，GC 后 heap 从 28.48 MB 升至 717.55 MB、RSS 943.85 MB，没有模型或工具执行。这不是泄漏认证，也不是将完整 frame 改为摘要的授权。单个原生大 JSON 的临时处理仍受记录大小影响。32 MiB 原生编码缓存、正文/历史字节 LRU 和虚拟化不能代替全局活跃 Runtime 预算、闲置卸载、worker 进程隔离或局部 OOM 恢复。

继续工作入口为[资源压力 tasks](../../openspec/changes/add-local-maintenance-and-delivery/tasks.md#near-term-resource-pressure)。完整历史、原请求身份、回执与未完成工作的保护保持原契约，不通过累计输入次数限制工作区寿命。
