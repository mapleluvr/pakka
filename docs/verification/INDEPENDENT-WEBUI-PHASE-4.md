# 独立 WebUI 阶段 4：工作分支候选

## 结论与范围

2026-11-19，独立前端与配套 Pakka 完成分批实际服务/浏览器核对，以及 Node 24 仓库外固定安装。最终安装轮从 8 个 Backend 包和固定前端启动，生产装载器验证 713 个资产，真实页面完成登录、普通输入、确认期间的草稿保留、刷新回执与撤权清理。

阶段退出仍受阻：扩大回归选取 334 个文件，取得 333 个完成记录；短目录维护复验后仍有 13 个失败文件、1 个未完成文件。该候选保存在独立工作分支，阶段 4 tasks 继续保持未整体勾选，默认切换属于阶段 5。

形成过程、各批范围与失败更正在[阶段 4](../../openspec/changes/plan-independent-webui/phase-4.md)，两端共享宿主与固定材料试验在[接续记录](../../openspec/changes/plan-independent-webui/shared-host.md)。独立前端的界面及固定结果见 [pakka-webui PHASE-4](https://github.com/mapleluvr/pakka-webui/blob/pakka/independent-webui-seams/docs/verification/PHASE-4.md)。

## 交付中的接缝

- services API 4 提供普通输入、Conversation 配置、工作台/人员、预算、协作和通知的公开操作与原请求查询。workbench 2、extensions 3、资产 schema 2 各自闭合声明，客户端与前端按固定归档配对。
- 输入查询定位原 Session / Conversation，匹配原发起人、正文、mode、requestId 与完整旧绑定；查询当前读取权限，新提交仍要求有效执行绑定。
- Conversation 配置效果、绑定轮换和回执同次原生事务提交；人员、协作及通知的效果与回执同次所属存储 CAS（Compare-and-Swap，比较并交换）提交。未知结果继续保留原请求。
- extension operation 使用宿主 operation ID。文件、服务器浏览器、Memory、定时输入和 Webhook 的内层恢复先查外层 operation，再按 operation ID 查服务回执。
- 历史与正文沿已登记来源、原身份、内容版本和权限读取；已加载来源沿原 owner，未加载历史保持原生只读 Reader 生命周期。
- React / Astryx 插件由各自所有者提供。目标级 publication、直接地址恢复、独立关闭与替换分别清理观察、正文、modal 和样式；持久工作仍由原服务持有。
- 定时计划的读取/取消按稳定身份定位；逐次投递仍检查登记时的运行绑定。Webhook 同样保留旧记录管理，换绑后原 ingress 拒绝投递。

## 分批实际运行

| 使用路径              | 已核对的结果                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Conversation 与工作台 | 导航、创建/fork、个人组织、输入/队列/停止、关闭后继续、原请求跨重开/换模型恢复、旧绑定拒绝新提交                  |
| 模型与预算            | 当前模型/Thinking/目录/preset 与 Person 默认/实例源分层；配置及预算回执、冲突草稿、已消耗账目与实际 Provider 请求 |
| RSI / MAS             | 公开通用宿主与资源入口；MAS 原 Conversation、成员输入/回复/管理/配置，跨 Session 身份和派生发起人边界             |
| 正文与工具            | 原生存档分段、中文/emoji/转义跨段搜索、精确下载、工具合卡/虚拟化/阅读位置、晚到取消和撤权                         |
| 文件与 Git            | 受控根、hash 冲突、上传/导出、真实 diff/分支/worktree、原请求两层恢复、只读边界与页面清理                         |
| 工具审批              | 真实允许/拒绝/到期、只释放原等待调用；决定回执与工具执行结果独立，重开后的 unknown 保持边界                       |
| 服务器浏览器          | 实际导航/填入/点击与网页效果、两层恢复、原 profile 生命周期、只读/撤权；动作确认与网页业务结果独立                |
| Memory                | 成员与 Agent 建议、owner 批准、实际模型上下文、暂停与冲突、原请求恢复及只读权限                                   |
| 定时输入与 Webhook    | 有限计划真实投递、取消标记/终态/已投递输入分层；签名事件、外部作者过滤、密钥轮换、去重和旧绑定管理                |
| 人类协作              | side chat/提及/引用、notes、pins/reactions、presence、driver；普通输入准入与聊天权限分别核对                      |
| 通知                  | 个人偏好、目标登记、设备停用与恢复；真实 HTTPS 接纳、原生唤醒、Windows 显示/点击和撤权清理分层取证                |

各批使用生产 client / HTTP / Runtime 路径与隔离数据。最终安装只重跑代表性登录/普通输入/清理路径，所有资产由生产 loader 校验；分批效果证据继续保留自身范围。

## 固定安装组合

- Node：24.18.0。
- Backend：`@pakka/agent`、`@pakka/mas`、`@pakka/mas-devpack`、`@pakka/protocol`、`@pakka/client`、`@pakka/cli`、`@pakka/server`、`@pakka/webui` 的 8 个固定归档。
- 前端：`pakka-webui-app-0.1.0-c783d4d22fd98d71.tgz`，1,303,388 字节；SHA-256 `c783d4d22fd98d71394a8c611b19acad0df6c18af0f323ca13f075c92a31abfc`。
- manifest：`4134f0c6b6a1aaf0e3340d60b905093ef16501d02b3d6aac259e92cdd326dc42`。
- 消费目录：仓库外 `verification/phase-4/final-candidate-20261119/consumer`；公开入口解析自该目录的安装包。
- 运行：HTML / worker 原字节一致；草稿保护最终轮三笔独立输入各一次 Provider 请求，刷新总计保持三次，服务 errors 0，正常关闭。前两轮固定登录/工具栏验证各自为一次。
- 界面：桌面登录单一可见 modal；390px 较长模型名与其余三个入口同处 44px 工具栏。配置窗打开期间撤权后正文/输入/modal 清除，手机登录取消正确回焦。

正常发送在等待已接纳响应时允许继续写稿。最终差异核对以真实页面复现确认后新草稿被清空，前端改为仅清空仍与该次提交相同的正文。新固定制品两次留住确认响应后均保留新草稿，实际 Provider 请求只含原消息；第三笔 390px 正常发送后原稿清空。刷新与配置窗撤权清理通过。首个修正轮缺少错误监听，仅保留草稿/计数证据，完整监听的独立补验 error / CSP 为 0；前端临时探针与既有服务契约回归分别承接。

两仓类型/构建通过。局部主动 LSP 未报诊断，但仍有 push-only 未确认项，按覆盖范围记录。Backend 格式整理经编译与文本/JSON 等价核对；原错误基线与修正轮分别保全。

## 退出受阻与已知限制

扩大回归尚有 13 个失败文件：`composition-main`、文件边界/浏览器、六个 MAS 旧页面检查、Memory 恢复、通知、SVG 排版和 transcript parts。它们继续消费旧默认页面；新 React 插件在该路径被拒绝。另一个 `mas-stylesheet-browser` 等待未发出的样式请求，原轮已停止并清理。须继续核对独特契约覆盖、检查与默认入口的接续，当前结果保持 failed/incomplete。

维护 `maintenance` 与 `maintenance-service` 在短隔离目录共 13 项通过，沿生产 ACL 检查；原 Windows 长路径失败保留。

真实录音因用户说明本机无设备获授权跳过，识别连通性与质量仍未验证。事件草稿与取消/晚到隔离有独立证据。

原生通知的服务发送回执可以为 unknown，Windows 实际显示有独立证据。隔离环境只许可实际 Chromium 推送 origin，产品默认白名单保持原值。固定编译变体 A → B → A 覆盖旧 worker redundant、通知清除和旧读取取消；正文仍送达旧 worker 的分支未覆盖。

默认发行切换、合并与发布继续按各自授权；Provider `/login` 沿既有 roadmap 延期。

## 本地证据包

`phase4-candidate-20261119-e2d905e6.zip`，446,264 字节，SHA-256：

`2f0d70d5dca2c173197e17fa1e5934d401f0b223f8dfe6ec55be5e645aabdff9`。

仓库外位置：`.backups/webui-phase4-20261119/`。434 个实际证据文件逐项校验，另含 manifest；安装归档、私密凭据、Cookie 和数据库分别保全。原始证据仅在本地保存，Git 记录关键结果和整体 hash。
