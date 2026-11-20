# 阶段 2：独立应用与真实消费验收

## 候选与范围

2026-11-16，在工作分支 `pakka/independent-webui-seams` 完成 tasks 4.1–4.4。Pakka 基线为 `dfb3837510052a4f725cbc3fa30026093ebea4ad`，独立前端基线为 `48adf839458489f91a5cf01d6744b647c4b337cd`；本记录所在提交及配对前端提交保存候选源码，证据包包含实际受验源码身份与格式整理前后的对照。检查由主会话执行，未委派。

实施边界见 [phase-2](../../openspec/changes/plan-independent-webui/phase-2.md)；公共出口见 [WEBUI-SERVICES](../reference/WEBUI-SERVICES.md)。独立前端形成应用、同源开发、registry、GUI-only、原历史、模型/Thinking 与设置；RSI 包提供 React/Astryx 工单 UI，前端只处理通用装载和服务绑定。Node 公开现有 `openProductModels` 装配函数；服务 wire 保持 services 3 / extensions 3 / workbench 2，固定资产显式采用 schema 2。

这次验收覆盖最小真实前端，不代表完整功能迁移、默认切换、发布或合并。后续状态见 [tasks](../../openspec/changes/plan-independent-webui/tasks.md)。

## 环境与实际结果

使用 Windows、Node 24.18.0、npm 11、TypeScript 7.0.2、React/ReactDOM 19.3.1、Astryx 0.7.15。安装、数据、Pi 目录和模型端点隔离；浏览器使用专属回环 origin 的真实 Cookie/CSRF，不覆盖日常登录，也未升级 Ego Lite。模型请求仅访问本地确定性端点，未使用用户凭据或付费模型。

| 边界            | 检查与结果                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 独立前端        | 新空目录执行 `npm ci --ignore-scripts`、`npm run check`、`npm run build` 通过；无 Agent、Node WebUI 或 Pi 执行依赖，应用 manifest 与生产浏览器候选一致                      |
| GUI-only        | 实际计数、独立实例、Dialog/portal、Escape 与焦点返回通过；固定生产入口的完整该轮检查为 0 次模型请求                                                                         |
| 原历史          | 两个真实 Session 的同号 Conversation 不串线，未加载来源显示保存历史；分叉原文按有界请求还原 14,132 字节，hash 与原内容一致；数据库/WAL 未变，未重开 writer、0 次模型请求    |
| 权限与资源状态  | 浏览器验证授权列表、分叉来源脱敏、拒绝直接读取无权原资源、撤权后清除旧正文；原身份不符/不可得及范围关联另由真实 HTTP/reader 回归核对，不把它们都写成浏览器场景              |
| 模型与 Thinking | 悬浮搜索/分页、完整 provider/model 精确选择、slash 与点击/触控入口通过；两次实际模型 HTTP 请求分别验证模型级 endpoint 覆盖、Thinking、输出上限及保留 header                 |
| 配置与作用域    | 设置页新增连接经公开 ModelRuntime 重载并进入实际请求；凭据、注释和未编辑字段保留；Person 默认只影响其新建缺省 Conversation，已有配置不变                                    |
| 配置丢响应      | 服务写入后代理断响应，刷新保留原请求；仅一次 write、一次 lookup，回执找回，无重复提交                                                                                       |
| RSI 领域读写    | 安装版包提供真实工单列表、详情、编辑和来源引用；UI/领域 decoder 均在 RSI，宿主无领域分支                                                                                    |
| RSI 两层恢复    | 已提交后断响应、内层已编辑而外层超时两种情况均按浏览器 requestId 找 operation，再以确认结果或 operation.id 找工单回执；网络记录无重提，Backend 停用后原 operation 仍可核对  |
| 生命周期与触控  | 390px 工单编辑器与模型页面可操作；无横向溢出，底部按钮可见，关闭返回焦点；publication 替换清理旧实例、Dialog 和样式，新实例可核对先前接纳的保存；撤权后工单/设置/旧正文清除 |
| 生产 CSP        | 安装版 `startPocket` 直接提供固定 manifest；Astryx Layer 精确许可样式实际生效，其他 inline style 被阻止；正常页面无脚本错误或 CSP 违规                                      |
| 安装闭包        | 最终 RSI headless 和 React UI 消费者严格类型检查、实际导入/浏览器打包通过；不安装 Agent、Node WebUI、MAS 或 Pi 执行依赖                                                     |

两次实际推理分别为 `/model-override/v1/chat/completions`（medium、2048）和 `/alpha/v1/chat/completions`（low、1024）。目录 configured 与在线可用性分开；未配置认证的连接先被原生运行时拒绝，后端提供隔离合成凭据后才继续实测。选择入口也已拒绝缺认证模型，Provider `/login` 没有提前实现。

## 复现、修正与保留失败

- 原 Session 重开前必须显式配置 `reopenSessionFile`。首个探针仅复用数据目录，实际新建 Session；其登录失败保留为探针错误，不算产品恢复结果。正确重开后复现输入 pending 以 serverId 定位失效；改用稳定来源/Person/Conversation，原 requestId 在重开后可见，Enter 不能产生第二次提交。
- 两个设置实例同时完成真实 validate 后，第一笔 write 已提交但丢响应，第二笔冲突收尾会清除第一笔记录。修正为发送前同步占用、禁止覆盖且按 requestId 清理；同序复验只有一次 write，另一个实例通过一次 lookup 恢复。生产 helper 另验证旧收尾不清新记录、损坏记录 fail closed。
- 实际截图暴露模型 Dialog 尺寸、滚动裁切与登录错误按钮不可达，分别采用 Astryx 公开尺寸/Layout 和有界错误区域修正。桌面与 390px 复验通过。
- 先前浏览器空间/服务结束、定位器未触发、错误期待编辑器自动关闭、撤权探针复用已退出的管理员身份等未完成轮次保留，不计作通过；后续在独立控制会话、明确服务生命周期和重新取得定位后完成真实复验。
- 第一轮干净前端 `check` 依赖旧 dist，已将 SDK 声明构建纳入命令。第二轮验证拷贝漏掉已跟踪的 licenses，修正探针后重新在空目录安装/构建；没有删减许可或跳过校验。

普通输入的公共原请求回执查询尚缺接缝，保留在 tasks 6.2；当前已验证的是跨重开保留原请求和阻止重发。sessionStorage 只属于当前标签页，不是跨设备账本。

## 静态、回归与分类

两仓最终 `npm run check` 和 `npm run build` 通过。前端主动 LSP 检查 25 文件，0 诊断。后端常驻 LSP 对 13 文件只能给出 silent/inconclusive；新 LSP 进程对 14 文件完整检查 0 错误、无过滤。初次直接 LSP 探针把 TSX 错报为 TypeScript，产生 JSX 解析错误；修正探针 languageId 后复验，未改产品代码或添加 suppression。

`npm run test:affected -- --scope webui --scope rsi --scope protocol --workers 2` 实际选择 336 文件、999 项：989 通过、7 失败、3 跳过，无取消或未运行文件。7 项失败全部为两个 maintenance 文件的既有 Windows 长路径 ACL 核验。相同隔离策略在 59 字符临时根目录复跑这两个文件，13/13 通过。前一轮保持 failed，不改写成全绿；私密文件检查与权限策略未放宽。

新增长期回归仅为资产 schema/闭合字段/有限 hash 的两项 decoder 检查，core/light。RSI 现有 UI 测试的第一项下沉到真实 HTTP 与公开 binding，覆盖断响应、内层成功/外层 unknown 和停用后回执；另两项原生运行/角色边界保留，仍属 affected rsi/webui、release/heavy。实际 React UI、焦点、布局和撤权使用隔离浏览器检查，没有新增私有 props/DOM 快照测试。

最终格式整理前后，13 个源码文件的归一化编译代码相同；131 个相关构建文件中 121 个字节完全一致，10 个仅格式变化并与已安装受验产物逐文件 canonical 对照，包含声明和 RSI CSS。RSI public JS 字节未变。整理后的公开包重新打包，严格隔离消费通过；未把旧包 hash 冒充最终包。

OpenSpec strict、改动文件格式、内部文档链接与 `git diff --check` 的最终结果随证据封存。完整 Node 产品上游 43 条声明错误、原 6 项依赖审计告警仍引用[阶段 1 记录](INDEPENDENT-FACET-CONTROL.md)及本轮安装记录；本轮没有升级固定 Pi 依赖、执行 audit fix 或宣称这些已修复。独立前端审计为 0。

## 固定制品与本地保全

最终前端应用 manifest SHA-256：`418033338b02ad0f6dec8ab24dcbbf3278b9d71b8f8454197418f9669d396e15`；637 个文件。共享 runtime manifest：`800a54b6a1dca25b2288c79a77b8192885c158eba2f8bd894f9a5811c46c9137`；634 个文件。空目录重建与实际生产浏览器验收字节一致。

| 最终开发归档        | SHA-256                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `@pakka/protocol`   | `c57ec7c43f2d8156648e285bd79acadb52563c5806ae4a163eea49dc094e3033` |
| `@pakka/client`     | `96236109a3fb92a39d609c6a1caf6c7b528e18524fb2194a73cc514a92b24994` |
| `@pakka/rsi`        | `93161a4e8470176b012efb3b0cbf485e4732420e50284a88b3fb969ab5837ea8` |
| Node `@pakka/webui` | `7a5f45f28ababfcd040f1cbba235d48dba0c145242bb915a1c0cd58dfc8a35ed` |

前端固定前两项归档；RSI 构建固定纯 UI SDK 的身份见 [integrations/webui](../../integrations/webui/README.md)。格式整理前的完整安装版证据与最终归档对照都在本地包中；SDK/服务协议/资产格式和 hash 分别核对。

本地证据包：`pakka-webui-phase-2-evidence.zip`，18,401,331 字节，整体 SHA-256 为 `69fed4b9144ebe6f8d3b12e3367e341ab94e3ecd194f07860a260a37d8e85b67`。保全目录为工作区 `.backups/webui-phase-2-469f2ebb-2b96-4318-a438-bda676392421/`，762 个归档成员已逐项读取并核对 hash。原始证据及归档不提交 Git、不上传 GitHub；数据和凭据另保留在隔离目录，云端存储由用户管理。
