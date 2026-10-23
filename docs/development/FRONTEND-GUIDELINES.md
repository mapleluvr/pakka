# pakka-webui 前端规范与参考

本页用于实现与打磨工作台及扩展界面。产物结构和行为见[前端 state](../state/frontend.md)，服务、权限与扩展能力见[开发契约](WEBUI-DEVELOPMENT.md)。

## 采用的指南

- [Atlassian Applying typography：中文采用摘要](frontend-guides/atlassian-applying-typography.md)：文字角色、层级、行高、相对字号、完整阅读和指标排版。
- [Vercel Web Interface Guidelines 原文](frontend-guides/vercel-web-interface-guidelines.md)：键盘与焦点、表单、导航、反馈、触控、动画、性能、主题和原生语义。保存上游原文，按附带 [MIT license](frontend-guides/vercel-LICENSE.txt)使用。
- [来源与校验信息](frontend-guides/sources.json)：URL、取得时间、Git revision 和 SHA-256。更新指南时重新阅读差异，记录实际采用的调整。

以上是持续采用的开发指南，不是每轮自动执行的 Verification 清单。开发检查针对实际改动与风险选用。Verification 是可选活动；跳过时在所属任务或变更记录一次，后续历史按实际进行的活动记录。

## 行为依据

Devin 已有界面的原生操作、页面关系、菜单/快捷键和切换行为，以离线抓取的**生产前端**为绝对参考。发生差异时，先追到该版本的生产 bundle、DOM 或对应运行证据，明确条件后采用原生行为。通用指南在这些行为之上完善可访问性和质量；例如通用 textarea 快捷键条目不能直接替换已核实的 Devin 操作。

参考仓库固定在 [devin-ui-comparison@ed20cec](https://github.com/mapleluvr/devin-ui-comparison/tree/ed20cec0aef82daa22aa50da19597b7ba1607e02)：

| 材料                                                | 在开发中的用途                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| reference-dump/source/assets                        | 生产 bundle 与样式，按具体分支、触发条件和资源身份确认原生行为   |
| reference-dump/capture/rendered.html、mirror/static | 抓取时的真实 DOM、布局及可访问属性；静态快照仅能说明该状态的呈现 |
| reference-dump/source/beautified                    | 生产代码的格式化视图，定位后回到同名原始 chunk 校验              |
| reference-dump/source/readable/frontend             | 人工重命名的阅读辅助；其中省略分支和展示占位需回到原 bundle      |
| clean-room/current                                  | 视觉壳层与固定 CSS 输入；推测会话形状只作为草图                  |

这些参考用于界面关系；Pakka 的模型输入、权限、操作身份、持久化、工具效果和 unknown 核对由真实服务与公开 Pi 接口提供。扩展以同套界面语言接入真实能力，提供相应的加载、空、失败与授权状态。

本机参考克隆的 reference-dump/scripts/serve.mjs 会代理真实 API；离线阅读采用静态文件，动态实验采用隔离的本地确定性服务。生产抓取、人工可读稿和重新运行的结果分别标明证据类型。

## 已直接核对的原生关系

这些是 2026-10-23 对固定版本的静态阅读结果，供定位和接续，不等于已运行线上 Devin：

| 关系                               | 原生定位                                                                                                          | 对 pakka-webui 的作用                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 侧栏设置直接导航到页面             | webapp-B9OnyKmM.js 的 sidebar-settings 控件渲染路由 Link，目标依条件为 /settings 或 /settings/local               | 一次激活进入配置；设置应具有可寻址的页面状态 |
| 设置分类对应独立 href              | app-initial-D97LNTSt.js 的 preferences、notifications 等注册；settings-DvAqVerK.js 的可见性、权限与 audience 过滤 | 分类随真实能力与权限呈现，导航与页面状态一致 |
| 页面布局依移动端/嵌入/布局模式分支 | SessionPage-DC_GJPKO.js 的 ot 入口及 workspace 分支                                                               | 按实际 viewport 采用对应结构                 |
| 发送成功后清草稿、失败保留         | useInputBox-CuK1TzIu.js 的提交链；人工 composer.jsx 只作定位辅助                                                  | 草稿清除取决于真实提交结果，保持原请求语义   |

原始定位均在上述固定仓库的 reference-dump/source/assets；手工可读代码不能用于推断原站未展示或省略的分支。

## 实施规则

### 排版

按标题、正文、说明、代码和指标的用途设置语义 token。默认紧凑层级取对应 Devin 页面；用户字体偏好和浏览器基准字号改变时按相对单位缩放。长文、窄屏和扩展页面按阅读情境安排换行与滚动。

### 输入与焦点

保留原生按钮、链接、label 和表单语义。框架相关条目按宿主 Preact 的事件与渲染语义实现，受控输入由真实输入事件保持值与焦点。键盘焦点有可见且不被固定元素遮挡的指示；输入框取消自身 outline 时，由明确的输入分组提供等价指示。触控文字输入至少达到 16px，并保留浏览器缩放；手机配置控件有至少 44px 触达高度。

### 反馈与安全

加载、错误、空数据和未知结果各有明确呈现。输入保留、操作锁和重试身份服从实际服务契约；视觉上的乐观反馈不代表持久化或工具效果完成。涉及私密值的字段保持专门的清空、替换和状态核对方式。

### 继续打磨的组织

对照具体原生入口，记录当前差距、来源位置、可观察结果和下一步。可重跑断言放入相应测试；本地探查留在 docs/.temp；采用的要求写回 state，完整形成与调整进入 OpenSpec。首批结果见[指南 tasks](../../openspec/changes/adopt-webui-frontend-guidelines/tasks.md)，后续工作与待采用方案见[设置路由与本机恢复 tasks](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)。
