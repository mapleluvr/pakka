# WebUI 文案精简验证

## 采用与范围

用户在[全仓静态调查](WEBUI-COPY-AUDIT.md)后授权 D1–D13/Q1–Q8 推荐，纠正回答中引入项目不存在的产品实体。当前界面人类协作统一为 People Chat / Shared Notes，保留原 chat 模式、授权及 API；MAS DevPack 页面没有被改造成新产品概念。调查原文、原源码 manifest 和当时未采用的时态保留，后续采用单独注明。

当前产品/测试待固定。构建/类型与受影响 41/41 通过，手机/20px 帮助区补充 3/3；全量及新预览尚未执行。

## 已实施

- D1–D13：首页、独立创建、模型/目录草稿、个人文件夹、Files、审批、Settings/People、通知、定时输入的重复教学删除；已确认的复制/核对结果缩写。保留无可创建权限时必要空状态与当前输入索引键盘提示。
- Q1/Q2：Server Directory / Server Browser 明确服务器对象；收藏/最近项只显示一处 In This Browser，偏好以短保存状态表达。People Chat、Messages、Shared Notes 明确人类通道；human 模式输入提示改为 Message People，不再误写 Reply to Pakka。后者由真实浏览器另外取得 RED，再只改 placeholder；发送/归属/driver 规则不变。
- Q3/Q4：Session 密钥保留未来请求的短范围；Attempt Accounting 默认收起、真实 summary 可点击/Enter 展开。Dictate 在 title 中事先披露来源，Listening 时显示浏览器语音服务短状态，停止后移除帮助及 aria-describedby；语音只改草稿。
- Q5/Q6：归档仍以实际成功反馈说明工作继续，禁用 UI 仅确认后提示，worktree 完成后说明当前目录未改。定时 `done` 显示 Inputs Submitted，保留原 data state/回执；计数用 submitted，取消成功提示已提交输入继续。不把这些状态冒充模型回答完成。
- Q7/Q8：Memory 沿用作用域和 Awaiting approval；Webhooks 的 Connection & Limits 默认收起，接纳记录改为 Input Receipts。保留秘密 URL、外部作者开关的实际后果、轮换/移除确认与限额。

## 实际测试与处置

真实 RED：常驻 Home 文案、Settings 副标题、闲置语音脚注、未收起 Webhook 信息、Memory 重复说明、模糊的定时完成名均失败。禁用 UI 的旧反馈另经反向 RED：真实请求已在等待本地 provider，UI 确认禁用但没有反馈；恢复实现后同一原请求继续完成，模型计数不增加。

首轮 11 项 10 pass/1 fail，目录测试误把索引/键盘提示 div 当教学 p；仅收窄到 p。手机新增检查一度把左侧模式文本误当作右侧下拉按钮的子节点；实际 DOM/独立 bounds 及截图证明二者本来分开，改测真实 toolbar 文本容器和视口边界。第二轮 24 项 22 pass/2 fail：目录浏览结果尚未载入，以及创建恢复等旧句子等待；改等真实目录容器/Session Ready 与可确认状态，保留请求/资源/重放计数。后续 6/6、禁用组 3/3、受影响 41/41、最终帮助几何组 3/3 均通过。原始失败待封存，不改写为通过。

覆盖真实本地 provider、当前 Cookie/CSRF、public runtime、HTTP/SSE 与 DOM：取消草稿不建资源，People Chat/共享笔记不触发模型；禁用 UI 不取消已接纳输入；Webhook 签名/轮换/秘密、定时取消、Memory 批准/冲突、Files 的真实写入/worktree，以及创建/导航/浏览器 unknown/撤权仍保留原精确断言。语音测试控制浏览器 SpeechRecognition 事件，仅验证草稿和生命周期，不声称语音识别准确性或远端服务能力。

## 证据与门禁

原始日志与 PNG/JSON 待在固定版本封存。主动 LSP：37 个改动路径，21 confirmed clean、16 inconclusive、无已报告 error；不能写成 37 文件全部清洁。npm check 是独立完整类型门禁。全仓 format:check 报告 7 个既有文件：durable-adapter、3 个 compresser 测试和 3 个 Dynamite pairing JSON；与基线 0758992 的 diff 为空。本轮改动文件的独立 prettier check 已通过，不为格式门禁扩散修改这些文件。

无后端协议、权限、持久化、额度和原生调度变更。按用户本会话决定不安排独立复核；指定隔离桌面不可用，GUI 保持 BLOCKED，不以 browser 自检替代。原预览及数据保持。

归属：[summary](../changes/webui-explanatory-copy.md)、[proposal](../../openspec/changes/simplify-webui-explanatory-copy/proposal.md)、[design](../../openspec/changes/simplify-webui-explanatory-copy/design.md)、[tasks](../../openspec/changes/simplify-webui-explanatory-copy/tasks.md)、[全部 delta](../../openspec/changes/simplify-webui-explanatory-copy/specs/devin-frontend/spec.md)、[frontend state](../state/frontend.md#文案与操作信息)。菜单/入口另见[独立验证](WEBUI-NAVIGATION-CONTROLS.md)。
