# WebUI 组合发送按钮的 Tab 焦点

用户提供的两个截图保存在[证据目录](evidence/webui-split-button-focus/)。发送和模式按钮获得了真实键盘焦点，但通用 `outline-offset: 2px` 将描边画在按钮外侧，被 `.send-group` 的 `overflow: hidden` 裁切，仅留下内部接缝竖线。此前编辑器外层圆角卡片的修正没有覆盖此处。

修复仅在 `apps/webui/web/elements.css` 增加 14 行：2px 描边内移到按钮内，首尾按钮继承对应胶囊圆角，中间按钮保留直边。`reference.css`、按钮尺寸、裁切和原生调度保持原值。

## 固定范围与结果

产品/测试候选：`08924574ad4ccc8f6cb94a612185329be8c88bac`（父版本 `d12640e12085410bd850000c2d0f1fd5543bd786`）；后续记录提交不改产品或测试。构建及类型检查通过，受影响测试 **20 tests / 20 pass / 0 fail / 0 skip**，OpenSpec strict 通过。

- 真实 `startPocket` → 登录 → 原生 pointer/Tab/Shift+Tab → PNG；不注入页面结构或替换按钮。像素断言分别采样当前按钮四侧，防止只有 computed outline 而实际被裁掉仍算通过。
- 首页与 Conversation：1440×900、390×900，dark/light；启用的 Send、模式与空输入时模式按钮均有完整四侧描边。
- 一个真实本地 provider 请求被 gate 暂停，验证 busy/Steer 状态下 Stop、Send、模式的独立焦点；原生 Enter 停止，Enter/Escape 打开/退出模式菜单并返回原按钮。此前纯导航阶段模型请求数为 0。
- 最终回归反向移除且仅移除 14 行修复，**10 tests / 4 pass / 6 fail**（含失败父测试）；五个新增场景均因上侧描边 0 像素而失败，见 [RED](evidence/webui-split-button-focus/red.txt)。恢复修复后的 [20/20](evidence/webui-split-button-focus/tests-passed.txt) 包含焦点、发送拒绝/停止、排版可访问性、原生前端布局和全部语音回归。
- 另保留一次[测试导航失败](evidence/webui-split-button-focus/test-navigation-failed.txt)：从模式按钮正向遍历整个页面，16 跳内无法返回 Stop；改用真实 Shift+Tab 两步精确返回，保留原焦点断言，未把该测试问题归因给产品。
- 直接检查的前后 PNG、四侧采样 JSON 和 build/check/strict 日志在同一证据目录。两个修改代码文件的主动 LSP 检查均 clean。

## 验收边界

本轮未重跑全仓套件；旧候选 75e0c97 的 638/636 pass/0 fail/2 skip 不外推为本候选结果。操作者于 2026-10-25 明确取消本会话后续独立复核，已记入 session note #48；本轮指定工作流 `f8eaff70-5bc6-437a-99de-2747b8d1ea43` 已停止，见[原始停止回执](evidence/webui-split-button-focus/review-stopped.json)。没有完成的评审意见，也未将取消记为通过。旧候选的 B 启动失败与独立桌面工具缺失仍保留原事实，本轮未执行独立桌面 GUI 验收。

修复预览为 **http://127.0.0.1:45003**，使用独立数据、浏览器 profile 和本地确定性 responder；旧预览数据保持原目录。HTTP 与实际 CSS 字节核对见[预览记录](evidence/webui-split-button-focus/preview.json)，文件哈希见[证据清单](evidence/webui-split-button-focus/manifest.json)。

实施归属及全部关联规范在[变更摘要](../changes/webui-navigation-and-local-recovery.md)、[design §6.2](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#62-2026-10-24-主次文字表单与-svg-图标整检)、[前端 delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md#scenario-tab-between-split-send-actions) 和 [tasks §4.2](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#42-主次文字表单与-svg-图标整检2026-10-24)。Session/Conversation 创建改造仍由独立任务承接。
