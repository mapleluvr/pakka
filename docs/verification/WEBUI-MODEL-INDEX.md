# Model Selection 检索索引

2026-10-25 按用户指定的 Pi coding agent TUI `/model` 交互，给已有批准模型选择器加入检索与键盘候选索引。基线为 `9d8a92d58215b2782a0c24d6f2f20f7524a3fe7f`；产品候选为 `4b17434f37df1833a5d115f665e2f62b17966148`，最终全量候选为 test-only `89117e4124a7b4115b7f6cce9efc58e41c42a70a`（产品零 diff），源文件 Git blob 身份见[证据清单](evidence/webui-model-index/manifest.json)。后续记录提交不改变产品或测试。

## 采用与实现

直接阅读本机 Pi 1.4.0 的 `ModelSelectorComponent`、`getModelSelectorSearchText` 和 `fuzzyFilter`，来源路径与 SHA-256 见[来源记录](evidence/webui-model-index/pi-reference.json)。借用交互关系，不导入 Pi 私有代码；模糊排序是本地的紧密匹配优先适配，不宣称与 Pi 的全部评分、scope、默认模型设置或目录发现功能相同。

- 所有大小的批准列表都有搜索框，打开即可输入。查询覆盖真实模型 ID 与批准 profile 标识；忽略大小写，空格或 `/` 分词，词内允许有序非连续字符。
- 上下键循环高亮，搜索输入保留焦点；输入查询回到首个匹配，Enter 明确选择，Escape 关闭并返回原入口。已应用模型的勾选独立于正在浏览的候选。
- 显示当前候选位置与匹配总数，空结果为 `0 / 0`，此时 Enter 无效果。列表独立滚动，搜索、位置和提示不跟着滚走；长模型名换行。
- Tab/Shift+Tab 在关闭、输入和活动候选之间闭环，排除 `tabindex=-1` 的非活动项；触屏/鼠标仍可直接选择。关闭 SVG 的实际点击区至少为 44×44px。
- 保持 `configure.agent`、权限、busy/queue 与 unknown 的原边界。检索、移动、当前项确认与取消不产生 provider 请求；选择只改模型，不改目录、指令、工具或既有额度。

## 实际检查

真实 `startPocket` → 登录 → 批准 catalog → HTTP/浏览器 pointer/keyboard → 配置持久化 → 后续本地确定性 provider 请求。没有替换模型 DTO、注入选项 DOM、访问用户凭据或调用外部模型。

- 受影响检查：**33 tests / 33 pass / 0 fail / 0 skip**，含模型、目录独立配置、Viewer、lost-response unknown 恢复、公共 Sheet/扩展、原排版与组合按钮焦点，见[日志](evidence/webui-model-index/affected-passed.txt)。
- 首次完整候选 `4b17434` 为 **645 tests / 642 pass / 1 fail / 2 skip**，见[原失败全量](evidence/webui-model-index/full-failed-4b17434.txt)。失败为既有 fork 用例未等待 transcript SSE；`89117e4` 仅增 4 行等待/注释，原断言和产品不变。最终 `89117e4` 执行 `npm test -- --test-reporter=tap` 为 **645 tests / 643 pass / 0 fail / 2 skip / exit 0**，见[通过全量](evidence/webui-model-index/full-passed.txt)；两项跳过仍为 Windows 上既有的受控 POSIX CDP executable 用例。
- 桌面 1440×900 dark/light；手机 360×600 dark、390×650 light 且 20px 阅读偏好。PNG 已直接查看，几何 JSON 核对完整活动行、可见搜索/位置、无横向溢出及手机输入字号。主次文字保留层级，大字号提示按 token 缩放。
- 原索引候选的两个新增用例连续 4 轮通过；前移 Viewer 就绪条件后该路径连续 8 轮通过，见[重复摘要](evidence/webui-model-index/repeat-summary.json)。关闭按钮修正重新运行上述 33 项；SSE 等待补正后 fork 连续 6 轮通过，完整 transcript 用例 9/9 通过，见[日志](evidence/webui-model-index/transcript-passed.txt)。重复轮次不冒充新版本的像素结论。
- 构建、类型、局部 Prettier、OpenSpec strict 与 whitespace 检查通过；日志同目录。主动 LSP 检查曾确认四个新改文件 clean，五文件探测 4 clean/1 silent-on-clean 未确认；关闭补正的两个文件另探测为 2 clean，fork 测试补正的主动探测亦为 silent-on-clean 未确认；完整 `tsc` 另外通过，不将无缓存诊断等同全部 clean。

## 失败、修正与反证

1. [基线 RED](evidence/webui-model-index/red-baseline.txt)：三模型列表无搜索框；大列表默认焦点为关闭按钮，不是检索输入。
2. [字号 RED](evidence/webui-model-index/red-larger-text.txt)：20px 偏好下，新标签/位置/快捷键仍使用固定小字号，修正为现有相对排版 token。
3. [旧 trap 反证](evidence/webui-model-index/red-tab-trap.txt)：仅恢复旧 Sheet 的可聚焦节点过滤，Tab 从候选离开了应有闭环。恢复修复后通过；[反证回执](evidence/webui-model-index/reverse-check.json)确认产品字节已还原。
4. [关闭按钮 RED](evidence/webui-model-index/red-close-target.txt)：初版 `129b47b` 沿用旧 36×36px 点击区，局部样式补到 44×44px。该候选全量中途停止并被替代，保留[部分输出](evidence/webui-model-index/superseded-full-129b47b.txt)，不记录为通过。
5. 新持久化用例先错误假设普通 reload 自动选回 Conversation；补正常重新打开，并在手机通过真实 sidebar 入口操作。两次[测试前提失败](evidence/webui-model-index/test-reload-premise-failed.txt)、[隐藏 sidebar 失败](evidence/webui-model-index/test-hidden-sidebar-failed.txt)保留。
6. 首轮 33 项中一次 Viewer Settings 不可点击，独立探针第 7 轮也复现；[失败快照](evidence/webui-model-index/viewer-failure.json)显示菜单尚未打开。[原失败](evidence/webui-model-index/affected-viewer-failed.txt)与[探针输出](evidence/webui-model-index/viewer-probe-failed.txt)保留。基线对照 12 轮未复现，不能据此认定为已证实的旧版本产品缺陷。测试原先在按钮坐标取得之后才等 Ready；现在在打开菜单之前等真实 Ready 与目录配置，未放宽权限断言。
7. 第二轮 [resize 取样失败](evidence/webui-model-index/test-resize-sample-failed.txt)：CDP 已确认 360px 视口，但弹层仍为 1440px 时的 x≈1045 坐标。改为先等待弹层实际进入视口，再保留原活动行/搜索/位置几何断言；不加固定 sleep，不改产品定位代码。

8. 首轮全量中 fork 的终态断言先失败。独立[实际通道探针](evidence/webui-model-index/fork-output-order.json)确认 receipt 已为 done 时工具输出为 false，等待真实 DOM 后为 true，没有注入 DTO。原测试立即将 receipt.done 当作 SSE 渲染完成，违反两通道独立的既有边界；仅增加同一个具体输出条件的等待，原来源、双卡、旧结果及新结果断言全部保留，产品零 diff。

## 边界与预览

IME 仅检查 `isComposing` 事件不得确认选择的 DOM guard，不等同操作系统中文输入法验收。保留宿主批准 catalog，不增加多 provider 认证、自动发现、数字行号快捷键或模型默认值写入。

按操作者本会话指令不再安排独立复核，未把取消记为通过。指定 `agent-workspace-linux` 工具仍未检索到，本轮浏览器检查不替代独立桌面 GUI。Session/Conversation 创建层级仍由原独立任务承接。

最终预览为 **http://127.0.0.1:45005**；地址及资源字节核对见[预览记录](evidence/webui-model-index/preview.json)。使用隔离数据、独立浏览器 profile 和本地 responder，旧预览数据不变；私有 owner-link 不进入证据或版本库。

形成记录及相关规范：[变更摘要](../changes/webui-navigation-and-local-recovery.md)、[design §6.4](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#64-2026-10-25-model-selection-检索索引)、[tasks §4.4](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#44-model-selection-检索索引2026-10-25)、[模型索引 delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md#requirement-approved-model-selection-has-a-searchable-keyboard-index)、[当前预期](../state/frontend.md)与[配置契约](../development/WEBUI-DEVELOPMENT.md#独立选择模型和-conversation-工作目录)。
