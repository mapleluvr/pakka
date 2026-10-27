## Why

用户实查 People & Invitations 的 Invite Role 仍使用系统下拉，要求与刚完成的主题菜单同理变更。此前分组/首页变更并未覆盖该控件，不回写成当时已经完成。

## What Changes

- Invite Role 移除系统 select，复用现有 Menu、菜单行和 SVG 选中标记；保持四个角色及默认 Viewer。
- 支持当前项定位、上下循环/Home/End、明确确认、Escape/外点取消、Tab 离开，以及深浅色、手机和字号偏好。
- 角色选择仍只是邀请草稿；只有 Create Invitation 创建原有一次性邀请。不改变 role/resource/ttl 和服务器权限。

## Capabilities

### New Capabilities

无新的产品实体或服务。

### Modified Capabilities

- `devin-frontend`：补充 Invite Role 与工作台菜单的一致呈现/交互。主 spec 仍在活动采用谱系，由本 delta 在前置变更之后合并，不新建残缺主 spec。

## Impact

范围为 `apps/webui/web/app.js`、附加 CSS、实际浏览器测试与文档。无协议、依赖、People 服务或权限模型变更；其他页面的 select 不在本轮声明已完成。
