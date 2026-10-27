## Why

用户实查创建方案后指出，sidebar 分组选择器展开为白底系统菜单，首页 New Conversation 图文错位，且 New Session 单独带圆角色块造成不必要的视觉主次。创建能力已独立提交并以 `440e9cc` 验证；本变更只统一这些控件的呈现与交互。

## What Changes

- 分组选择复用工作台已有 `Menu` / `.menu-row`，显示当前选择，支持鼠标、触屏和键盘确认、取消与焦点返回。
- 首页 New Conversation 与 New Session 为平级透明底入口，使用相同图标/文字对齐；中间为灰色短竖线，不用单独圆角色块。
- 保留原生 Session/Conversation 创建向导、个人导航持久化、完整资源身份及 unknown 核对，不新增服务字段、权限、依赖或创建兼容路径。
- 图文错位已由上一候选真实 RED/GREEN 修正；本次保留其回归，不将已完成部分重复记作新实现。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `devin-frontend`：补充分组选择的共享菜单与首页平级创建入口场景。该能力当前由 `adopt-devin-frontend` 等活动 lineage 持有，尚未形成同名主 spec；本变更在该谱系之后归档，不提前创建不完整主 spec。

## Impact

- 主要代码：`apps/webui/web/conversation-groups.js`、`frontend.js`、`elements.css`，必要的静态缓存版本与真实 browser 回归。
- 当前期望：`docs/state/frontend.md`；变更摘要：`docs/changes/webui-grouping-and-creation-controls.md`。
- 以用户三张截图、实际 DOM/几何、现有 Menu 及固定 `reference.css` 为依据。仅 UI，不改变 HTTP/RPC、模型输入、预算或持久化模型。
- 按操作者本会话 note48 不安排独立复核；指定独立桌面工具缺失时记录 BLOCKED，普通 browser 不替代。
