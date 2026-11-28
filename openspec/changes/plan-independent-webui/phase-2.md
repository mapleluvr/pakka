# 阶段 2：独立应用的最小真实切片

## 起点、范围与依据

用户要求先完成阶段 1 验收，再进入阶段 2。阶段 1 的配对提交为 Pakka `dfb3837` / pakka-webui `48adf83`，结果见[facet 核对](../../../docs/verification/INDEPENDENT-FACET-CONTROL.md)。本阶段落实 tasks 4.1–4.4；实现起点为已采用的独立前端、G1–G6、模型双入口与原历史浏览要求。

保持的前提来自用户已采用决定：React 19/TSX/Astryx、纯 UI host 与 Pakka 接入分离、独立安装/构建、同源认证、固定制品、原资源/权限/回执，以及旧 Preact 插件不迁移。已有公开服务复用其真实能力；旧 UI 只提供功能清单和既有边界证据，目录、组件树及整体状态机不作为模板。

相比把旧 app/extensions 页面搬入新仓，采用直接在新仓实现应用装配和通用 registry；构建成本不是保留旧界面模型的理由。现有 SDK 的实例/资源/命令和共享 runtime 已具备真实消费证据，按职责复用，不再重做另一套 renderer。

## 应用、开发与构建

- 前端通过固定 protocol/client 归档与 lock 安装；仓库内保留有身份说明的开发依赖归档，使干净 checkout 无须后端源码。纯 UI SDK 的运行依赖仍与 Pakka 接入分离。
- 应用入口装配 shared theme、导航/容器、错误反馈和身份连接。host 接收普通贡献及显式 bindings；后端 URL、assetUrl、actor/server 与 resource.resolve 属于 integrations/pakka。
- 应用构建在共享 runtime manifest 上加入实际 HTML/JS/CSS entry；external 和 import map 指向同一份 React/SDK/Astryx。Node 产品继续通过既有固定资产装配接口消费。
- 首轮开发服务器使用完整页面重载与匹配的 production JSX/runtime。修改应用可独立重建，无需后端构建；不引入 HMR 或第二份 React。需开发版 React 的调试场景再让共享 runtime 与 JSX 同时切换。
- 同源开发代理转发真实服务流量，保留浏览器 Host/Origin、Cookie/CSRF；后端显式设置前端 publicOrigin。静态服务只提供 manifest 已声明资产，不暴露源码目录或任意磁盘路径。

## 固定样式的 CSP 接缝

真实模型目录分页暴露 Astryx 0.7.15 Layer 会通过公开组件路径注入一段静态 `@position-try` CSS。预构建主题不覆盖这段样式；上游当前公开 Layer 接口没有为它提供预构建 CSS 或 nonce 参数。桌面/触控使用同一段字节，不能以禁用浮层、替换上游控件或 `unsafe-inline` 回避。

采用精确 hash 许可：前端构建保存经实际公共 runtime 核对、绑定 package/version 的固定样式摘要，制品 schema 从 1 显式升到 2，增加闭合 `inlineStyleHashes`（至多 16 个唯一 SHA-256 hex）。Node 和开发静态服务器只将固定制品声明编码为 `style-src` hash source；不接收任意 CSP、nonce、外部 origin 或浏览器提交的 hash。SDK/服务 wire 版本不因此改变，旧资产 schema 明确拒绝，消费说明与归档须同步更新。

配置声明不是自动批准运行时出现的任何样式。依赖升级需重新核对固定字节；未列入许可的 inline style 继续被浏览器拦截，不使用 `unsafe-hashes` 放开 style 属性。验收同时检查已知规则实际生效和未知样式被拒。新增的两项资产 decoder 回归保护闭合形状、版本和有界 hash 防注入，属于 core/light；不增加固定 DOM/布局的长期测试。安装版生产固定制品入口已独立核对相同正反行为；具体候选与结果见[阶段 2 核对](../../../docs/verification/INDEPENDENT-WEBUI-PHASE-2.md)。

## 通用插件与实例

registry 接纳具有固定 plugin/generation 身份的公开 UiPlugin、views、commands 和显式 bindings。打开创建独立 UiContext；页面/面板/弹窗关闭和 generation 替换由实例所有者清理。错误边界局限于实例，清理异常可见；迟到加载/读取不得进入已替换实例。

GUI-only 使用同一 SDK/registry，不要求登录或工作 Session。业务插件由 Pakka 接入层从受权 extension 发现描述加载，先核对 renderer/API/phase，再读取固定 generation 的模块和样式；模块中的 React 组件按公开 UI props 接入。Host 不直接拼 Pakka URL，也不认识 RSI/MAS/Memo 领域对象。

RSI 的 `@pakka/rsi/client` 声明只消费 protocol/client；Agent、Backend、React/Astryx 和 UI SDK 均按 facet 作为可选 peer，由使用相应入口者安装。Node 产品读取预构建 UI 字节，普通服务/Agent 消费不执行浏览器代码。UI 构建通过固定 SDK 归档和共享 external 入口完成，不从独立仓库源码深导。

Pakka 接入层将 app-scoped extension 界面映射到 `extension:<id>`，按独立 WebUI generation 加载模块与样式；Backend 绑定每次新调用核对当前 Backend publication，原操作查询不依赖其当前 phase/generation。当前可见页面每 10 秒有限刷新发现，并提供手动刷新；隐蔽页面不发周期发现请求，连接关闭清理定时器、绑定和实例。Conversation-scoped 插件装载及 action-backed slash 参数编排由后续消费补齐，不把 app-scoped RSI 的通过当作这些路径通过。

## 真实消费切片

1. GUI-only：实际计数/自定义内容、Dialog/portal、键盘/焦点和打开关闭；请求统计证明没有模型工作。无需先创建 Conversation。
2. RSI：所属包提供新 React browser facet，通过现有公开 Backend 服务读取有限工单和详情并受控编辑。记录原请求后核对外层 operation 与内层回执；丢响应不换身份重提，关闭不取消原工作。领域 UI 仍在 RSI 所有者内，不放进宿主核心。
3. Conversation：稳定 Session/Conversation 引用可深链进入原历史。已加载与保存状态分别显示；原文按公开有界内容引用读取。未加载/无权/不可得/错身份各自可辨，导航不重开 Runtime，晚到结果按原引用隔离。
4. 模型：Conversation 输入框 `/model` 悬浮搜索/选择，完整 provider/model 精确直接选择；`/thinking` 与触控切换共用配置操作。提供商与模型参数设置用常用可视化控件和经校验的高级编辑，保留未编辑/受保护值。当前选择、Person 默认、实例连接三层分别操作；通过真实 Pakka/pi-durable/pi-ai 向本地确定性 endpoint 发出协议请求验证。

## 原请求记录的收口修正

真实原 Session 重开复现了输入记录依赖 HTTP serverId 时失去保护的问题；存储改为浏览器来源、Person 与稳定 Conversation 引用。输入未知结果仍保留原 requestId 并阻止重发；公共输入回执查询列在 tasks 6.2，不将这项保护算作完整恢复。

设置并发实验让两次真实 validate 同时成功，再让第一笔 write 已提交但丢响应、第二笔版本冲突；原实现的第二笔收尾会清除第一笔记录。发送前同步保留原请求、禁止覆盖，并仅按相同 requestId 清理后，相同响应顺序只发出一次 write，另一实例通过一次 lookup 找回结果。对应失败与复验保留在本地证据包，不增加固定私有 hook/DOM 的长期测试。

## 验证与退出

按切片运行类型/构建和真实浏览器/服务检查；只为既有回归不能覆盖的明确公开兼容、安全或持久效果风险增加长期测试，不固定私有 props、DOM 或临时布局。GUI-only、RSI 编辑/丢响应、双 Session 同号历史、模型配置到实际请求分别保留证据。主会话核对，不委派。

桌面键盘与窄屏触控验证实际可达性、读写反馈、Dialog 退出、旧回调隔离和原请求状态；业务结论使用生产客户端与真实后端，不用静态演示代替。阶段 1 已验证的边界只在改动或新失败影响时复测。

RSI 现有 `webui.test.ts` 的第一条 Preact 浏览器场景下沉到真实 HTTP/公开 binding：代理切断已提交响应、Backend 在实际 edit 提交后超时，再依外层/内层原回执核对；同时保留 report、有限历史和 Backend 停用后回执语义。另两条原生运行/当前角色回归保留。该文件仍为 affected rsi/webui 与 release 的 heavy（实际 Runtime/SQLite/HTTP），不加入 light，也不新增私有 DOM 测试；新 React 布局、Dialog、关闭/替换、撤权与触控由真实安装版浏览器另验。

本阶段不切换默认产品、不发布包或合并 PR。Provider /login 继续延期；自动发现全部 Session、全局搜索及完整功能补齐由原阶段范围管理。任务 4.1–4.4 仅在各自真实路径成立时勾选。
