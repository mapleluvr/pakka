# Invite Role 主题菜单补齐

## 版本与范围

基线 `2dbccff`；产品/测试候选 `ba2b2f089baa0259132900c6ab9d1ed415c55df5`。只将 People & Invitations 的 Invite Role 从原生 select 改为现有 Menu；原 Viewer/Sender/Driver/Admin、Viewer 默认、邀请 scope/一小时 ttl/一次性及服务器授权不变。无协议、依赖或服务变更，不声明其他页面 select 已统一。

形成记录：[change 摘要](../changes/webui-invitation-role-menu.md)、[proposal](../../openspec/changes/polish-webui-invitation-role-menu/proposal.md)、[design](../../openspec/changes/polish-webui-invitation-role-menu/design.md)、[tasks](../../openspec/changes/polish-webui-invitation-role-menu/tasks.md)、[全部 delta](../../openspec/changes/polish-webui-invitation-role-menu/specs/devin-frontend/spec.md)。预期由 [frontend state](../state/frontend.md#创建与导航) 维护。

## 实际证据

- 原实现真实 RED：两项均为 `SELECT !== BUTTON`，不是字符串/源文件探针。最初测试构造有引号与权限 API 使用错误，保留为 setup failure，不算产品 RED。
- 第一版菜单暴露设置页原生按钮兜底覆盖：触发器 38px、行字体 12px。仅将共用菜单/触发器排除该兜底，44px 与 UI 字号恢复；原失败与几何 JSON 保留。
- 固定候选的受影响 9/9：实际菜单背景/圆角/阴影与同主题组织菜单一致；桌面 dark/14px 与手机 360×600 light/20px 偏好，菜单完整在视口内；触发器和四行各至少 44px，字号与字段 Body token 一致。
- 当前项定位、上下循环/Home/End、Enter 确认、Escape 保持人员页且回返焦点、Tab 到 Create Invitation、外点取消均走真实输入。浏览/取消与仅选择草稿不创建邀请、不触发模型。
- UI 创建四种 workspace-scope 邀请，实际公开 People API redeem 后验证角色及 read/send/steer/manage；第二次兑换拒绝，非管理员不能另发 admin 邀请。只观察原 HTTP 请求，不伪造响应；测试只使用隔离身份/本地 HTTP provider，不读取用户凭据。原 Conversation-scope 分支与权限实现零 diff，本轮不冒称实测了所有 scope 组合。
- 两个旧人员页测试只同步 `Invite Role` 可访问名称，原断言未删减。旧分组菜单、首页入口、设置导航及 HTTP 人员授权一起通过。
- 局部 Prettier、OpenSpec strict、build/check 通过。主动 LSP 覆盖五路径：1 confirmed clean、4 inconclusive（静默/超时），0 已发布诊断；不将其称为五文件全 clean，类型门禁依据独立 check。

## 完整门禁与预览

固定候选全量 `npm test` 退出 0：**666 tests / 664 pass / 0 fail / 2 skip**；两项为既有 Windows 上 POSIX CDP 跳过。两项 Invitation role 在完整运行中均实际执行并通过。原始完整日志、29 份来源身份及证据 SHA-256 manifest 已封存。

新隔离预览 `http://127.0.0.1:45010` 使用独立 data/profile 与本地 responder。20 项静态资产按冻结 checkout 的原始字节核对，canonical Git blob 单独记录；不能用行尾归一化替代 HTTP 字节核对。自动登录且跨浏览器重开保留身份，启动时模型请求为 0；完整测试后再次核对 20 项 HTTP 资产均精确匹配冻结原始 bytes。记录见 preview-login-status、preview-served-assets 和 http-after-full。旧 `45009` 的 15 项资产已核对仍为原始 bytes，未操作其数据/profile。

截图只包含测试 Owner 和角色菜单，不含邀请秘密；直接读取深浅/手机截图后确认没有菜单裁剪。普通浏览器自检不充当指定独立 GUI 验收，本轮 desktop 入口仍未检索到，保留 **BLOCKED**。按本会话指令不安排独立复核。

## 重现

仓库根目录，使用已安装的固定依赖：

```powershell
npm run build
npm run check
node scripts/test.mjs '--test-name-pattern=Invitation role:'
# 全量
npm test
```

`scripts/test.mjs` 自建隔离 HOME/USERPROFILE/PI 配置且禁用遥测；证据截图写入 ignored `docs/.temp/invite-role/captures`。永久原始结果与 manifest 位于 [evidence/webui-invitation-role-menu](evidence/webui-invitation-role-menu/)。

## 后续：Appearance 式紧凑同行布局

用户在基线 `c7a9bf3` 上指出全宽字段与短角色值/菜单失衡，授权改成 Appearance 的左标签/右小控件。新产品/测试候选 **`e447e829f6a1f8d5fc2f090c713367ab6afaaefe`**，上一节及父目录的旧版本证据不覆盖。

复用实际 `appearance.js` 使用的 `settings-card-row`：同行左标签、右侧适宽按钮。现有 Menu 只为该调用提供可选 `end` 锚定，其他调用保留原 `start` 默认。菜单按内容适宽且至少与小按钮等宽；不更改邀请角色、scope、ttl、授权或命令，也不把 Appearance 自身的原生 select 改进范围。

- 三次实际 RED 分别拦住原字段上下错行、弹层仍左锚导致右缘偏移、手机放大字后菜单窄于按钮；不是源文件检查或人为假响应。
- 新几何断言与原角色/焦点/44px/主题断言全部保留。默认桌面按钮 104px、菜单约 110px，字段可用宽度 688px；手机 360×600/20px 偏好下按钮与菜单约 149px，字段宽 302px。两者均左标签与按钮中心同轴、控件及菜单右缘一致，弹层完整在视口内。截图已直接读取。
- 同一候选受影响 6/6（真实邀请兑换、分组与设置导航），全量退出 0：**666 tests / 664 pass / 0 fail / 2 既有 Windows skip**。两个角色用例在全量中实际执行；浏览/取消/选择不发邀请，四角色的真实一次性邀请兑换结果及权限断言未削弱。
- build/check、局部格式、OpenSpec strict 通过。主动 LSP 四路径：1 confirmed clean、1 findings、2 inconclusive；唯一报告是未改动位置的既有 CSS `-webkit-line-clamp` 标准属性兼容性警告，不宣称四文件静态全 clean。
- 新隔离预览 **http://127.0.0.1:45011**，本地 responder、独立 data/profile，登录跨浏览器重开保留，初始化模型请求为 0。全量后 20 项 HTTP 资产精确匹配冻结 checkout 的原始 bytes；另存 canonical Git blob hash。旧 45010 的 20 项 HTTP 资产仍为原始版本，未操作旧数据和 profile。

原始 RED/GREEN/完整日志、截图、30 份来源身份、原始字节 manifest 与预览复验保存在独立 [compact 子目录](evidence/webui-invitation-role-menu/compact/)。重现命令与上节相同。指定独立桌面工具仍不可用，普通浏览器验证不替代独立 GUI 验收，保持 **BLOCKED**；按会话指令不安排独立复核。
