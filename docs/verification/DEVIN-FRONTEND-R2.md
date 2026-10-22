# Devin 原型前端接入 R2：固定候选 004

## 当前结论

**可评审候选，不是完整验收通过；未推送、未合并 main。** 产品源码固定在 `6d359b13d1b81c29f47495d303c1ed6afe4d0bb2`。随后的文档／证据提交不改变产品、测试或构建脚本。

这轮采用 `devin-ui-comparison@ed20cec0aef82daa22aa50da19597b7ba1607e02/clean-room/current` 的真实前端结构、原始 CSS 与交互，再绑定 Pakka API，不延续 R1 的“旧界面换皮”。参考 CSS 的 UTF-8 LF Git blob SHA-256 为 `084adce8bc6e1feab314b301f57ddac0bab5081cfa08d1c911addece9bdb9974`；由回归、`.gitattributes` 和格式化忽略保护。生产页面不加载 pocket.css / workbench.css / devin.css 旧布局链。

- 已接入真实创建、显式 Send、原生 Steer / Follow up、会话搜索与归档恢复、权限、模型／目录、私有凭据、通知和扩展。创建不自动启动模型；unknown 不重发，权限不由 UI 放大。
- Commands 使用参考 palette；Appearance 和 Extensions 使用独立 Settings 页面。
- Team 是同语言的新设计：单层页头、Graph / Activity / Agents、上下文 inspector 与手机底部面板；不是旧 Board 插件头部的嵌入。
- 完整结果与剩余边界以本记录为准。R1、候选 002/003 和早先补测的通过数不能替代本轮。

## 1. 固定快照与结果

[原始 run.json](evidence/devin-r2/candidate-004/run.json)记录运行前后同一提交、两端工作区干净、Node v24.15.0、`fixedSnapshot: true`。运行时间为 2026-10-21 07:24:16–07:56:57 UTC。每轮规范化 TEMP/TMP，并隔离 HOME / USERPROFILE / PI_CODING_AGENT_DIR；本地确定性 HTTP provider，`PI_OFFLINE=1`，不读取用户凭据、不调用付费模型。

| 门禁                           | 实际结果                                               | 原始记录                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 类型／durable patch 检查       | PASS                                                   | [check.log](evidence/devin-r2/candidate-004/check.log)                                                                                     |
| JS 语法                        | PASS                                                   | [syntax.log](evidence/devin-r2/candidate-004/syntax.log)                                                                                   |
| workspace + MAS 浏览器构建     | PASS                                                   | [build.log](evidence/devin-r2/candidate-004/build.log)                                                                                     |
| WebUI／MAS 扩大回归（82 文件） | **FAIL：125 项，121 通过、3 失败、1 超时取消、零跳过** | [wide/test.log](evidence/devin-r2/candidate-004/wide/test.log)                                                                             |
| 全量                           | **FAIL：555 项，542 通过、5 失败、6 超时取消、2 跳过** | [full.log](evidence/devin-r2/candidate-004/full.log)                                                                                       |
| 安装消费者串行检查             | **FAIL：pocket-controlled 的 exit=null**               | [package.log](evidence/devin-r2/candidate-004/package.log)、[停点日志](evidence/devin-r2/candidate-004/package-logs/pocket-controlled.log) |
| 同一安装副本的后续五项补测     | 5/5 PASS，**不改变整套失败结果**                       | [补测身份与结果](evidence/devin-r2/candidate-004/installed-supplement/run.json)                                                            |
| 本机视觉直接检查／无排除框差图 | 已执行；自动差图仍为 feedback-required，非独立验收     | [本机判读](../visual-primitives/runs/devin-frontend-r2-candidate-004/verdict/inline-verdict-003.md)                                        |
| 指定独立 GUI／双边审查         | **BLOCKED**                                            | 见第 5 节                                                                                                                                  |

## 2. 失败、取消与基线对照

不以“环境问题”豁免失败。全量明细：

- 5 项 owned browser 测试和 1 项 Browser contribution 测试超时取消。干净 main 对照复现这六项停点，但这只支持“不是候选独有”，不证明 Browser 可用，也不说明更深根因已解决。
- 4 项符号链接 `EPERM`：Pocket directories、两项 Browser discovery、runtime configuration。前三项在本次 main 对照复现；runtime configuration 没有在这次局部对照中运行，不能假装拥有同项对照结论。
- 1 项原生 Enter 测试在退出时清理 Chrome 临时 `lockfile` 返回 `EBUSY`。本轮不把清理失败写成按键失效，也不声称已查明锁持有者；不为测试杀宿主进程。
- 两项跳过是日志明确声明的 POSIX CDP 场景；不能以它们替代 Windows 的真实隔离检查。

[main 对照 run.json](evidence/devin-r2/candidate-004/main-r2-control/run.json)对应独立 LF worktree 的 `df76ea439e98d58c27d4c680863db3beedbf24f3`，无源补丁、前后干净。只运行其中列出的 5 个文件，结果为 5 通过、3 失败、6 超时取消、2 跳过；**不是完整 main 验收**。原始[对照日志](evidence/devin-r2/candidate-004/main-r2-control/test.log)可直接核对。

此前候选的 hooks busy／恢复和 Team 退休停点未从历史中抹去；当前候选的对应路径通过，不由一次单项补测倒写为早先也通过。

## 3. Team 样式边界：测试先行修复

原生点击探针曾测到 tab 在 CSS 生效前后的坐标跳变，不能仅靠动画等待归因。新增 `apps/webui/test/mas-stylesheet-browser.test.ts` 使用真实 HTTP 代理受控挂起 `board.css`，分别释放真实 CSS 或返回 503。

- 加强后的旧实现回归 **2/2 失败**：通过 Team 自身状态／节点确认已进入页面，而不是误读侧栏同名成员；挂起时暴露了可操作按钮，503 后也没有 alert。早先“挂起时已安全”的结论来自过早的等待条件，已纠正。
- 产品修复：根组件保留同一个 stylesheet link；只有 load 后挂载可操作 GraphView，error 时显示 alert 并保持闭锁。未改原生 admission、队列、权限或 unknown 语义。
- 2 项样式实验 + 原失败的 Team／手机创建路径为 **4/4**；连续三轮复跑均 4/4；MAS／恢复／hooks 影响面回归 **20/20**。它们与候选 004 大套结果分开记录，不累加为“独立用例数”。

原始 [RED](evidence/devin-r2/styles-boundary/styles-red-002/test.log)、[GREEN](evidence/devin-r2/styles-boundary/styles-green-001/test.log)、[影响面](evidence/devin-r2/styles-boundary/styles-impact-001/test.log)和三轮 repeat 均在 [styles-boundary](evidence/devin-r2/styles-boundary/files.json)中归档。JSON 快照保留 link readiness、可操作控件和模型请求计数。

## 4. 安装副本与补测

本轮真实安装已通过：headless DevPack 公共导入、声明检查、durable/runtime/MAS/broker/DevPack/server-client-CLI/product/services、Pocket 产品、MAS Team 和 workflows。其中 Team 真正执行了子成员创建、通信／回复、退休与正常重开，未用直接 API 调用绕过退休按钮。

随后 `pocket-controlled` 仅留下 `exit=null`，未保存结构化进程错误；**不能把它沿用写成旧一轮的 unknown 或 Send 不可交互，也不能从缺失日志推定精确原因**。原串行流程之后的 Notifications、Schedules、Memory、Webhooks、Voice 均为 NOT_RUN。

在同一个 `pakka-packed-consumer-IU9AtF` 安装副本上，保持 node_modules 和原始消费者脚本不变，独立补跑这五项，全部退出 0。[补测 manifest](evidence/devin-r2/candidate-004/installed-supplement/run.json)保留实际脚本哈希、8 个 tgz 的 SHA-256 与逐项日志。补测不是整套 smoke:package 通过。

## 5. 视觉与独立验收

[候选专用视觉工作区](../visual-primitives/runs/devin-frontend-r2-candidate-004/final/delivery-review.md)保留当前截图、卡片裁剪、注释图、差图和直接检查笔记。首页 oracle/rendered 均为 1440×900、DPR 1，未缩放；全部 1296000 像素计分，排除 0，mean 0.007233。自动状态仍为 `feedback-required`，不换算“还原率”，不改自动结论。

逐点检查面积前五的 highlight 以及全图热图：真实账号、Sessions／Commands 导航、命名 Conversation 提示、真实 Sessions 入口与移除无后端推广控件解释了主要差异。主侧栏 300px、卡片 688×154 和 toolbar 几何由本轮 DOM 测量核对。此判断不等于所有差异已获用户确认；Team 没有上游 oracle，不做伪像素等价比较。

按 `WEBUI-DEVELOPMENT.md` 第 9／10 节，本机确定性回归与指定独立 GUI 是两个门禁。当前工具发现仍无 `agent-workspace-linux`，指定 `D:/Pi/extensions/pi-adversarial-review/workflows/adversarial-review.js` 也不存在，故两者保持 BLOCKED。**本机 vp／差图 CLI 实际可用且已执行**；早先将它一并记为不可用的文档只作历史记录，由本轮纠正，不以本机工具补位独立 GUI。

## 6. 复跑与归档身份

在独立 worktree 切到产品提交 `6d359b1`，执行：

```powershell
npm ci --offline --ignore-scripts
./scripts/verify-devin-r2.ps1 -EvidencePath artifacts/devin-r2/review-001
```

runner 串行执行 check、syntax、build、扩大回归、全量与安装检查；即使中间失败也继续保存后续退出状态，并核对前后源码身份。不要复用已有 evidence 目录。离线依赖缓存缺失时 npm install 失败应单独记录，不冒充测试结果。

原始文件索引为 [candidate-004/files.json](evidence/devin-r2/candidate-004/files.json)，保留字节数与 SHA-256；它是身份清单，不是独立审查。`source-summary.json` 记录源码、统计和安装包哈希；per-package／消费者日志已归档，冗长的重复 pack.log 与本地 tgz 实体未入分支。用本地归档文件复算哈希即可核对；原始日志中的临时绝对路径不保证跨机存在。

后续优先工作：保留 Browser 与进程停点的失败状态，补足该层诊断；在具备指定 Linux desktop／审查环境后运行独立验收。没有这些结果前不宣布迁移完整验收或合并 main。
