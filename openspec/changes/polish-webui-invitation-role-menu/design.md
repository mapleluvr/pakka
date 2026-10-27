## Context

基线 `2dbccff`。已读取 app.js 的原 select 与 invite 提交：四角色、Viewer 默认、选中 Conversation 或工作区 scope、ttl 一小时。现有 Menu 已负责定位、外点、Escape、初始焦点和 Tab 回返；分组菜单已验证同类交互。

## Goals / Non-Goals

目标：补齐被用户指出的 Invite Role；保留真实邀请语义。
非目标：全仓替换 select、新角色、新 ACL、改变邀请范围或恢复机制、添加权限教学。

## Decisions

使用现有 Menu/菜单行/共享 Icon，在局部字段封装选择状态，App 保留原 inviteRole 草稿及提交。局部上下/Home/End 只移动焦点，点击/Enter 才改草稿，取消不改。沿已有 type-ui token 与 44px 规则，原生 select 不作为隐藏或备用路径保留。没有理由为一个字段引入另一套 popup 或依赖。

本轮不抽象整个表单选择库；现有 Menu 已有生命周期所有权，避免无关扩展接口。按钮 type=button，菜单不得意外提交邀请；离开人员页卸载字段，不能遗留弹层。

## Risks / Trade-offs

Settings 容器可能裁剪/覆盖浮层，必须检查真实位置和直接截图；Escape 不应连带关闭人员页，Tab 不应困在菜单。用真实浏览器产生邀请并 redeem，验证角色/范围/一次性及权限，不能只看 UI 的选中标记。只用隔离测试身份、本地 provider；截图不得含邀请秘密。按本会话指令不独立复核；指定 desktop 缺失仍 BLOCKED。

前置 devin-frontend 活动谱系未归档，本 change 排在其后归档，不提前创建主 spec。
