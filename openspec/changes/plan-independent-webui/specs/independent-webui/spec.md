## Purpose

定义独立 WebUI 对使用者、插件作者和 Pakka 服务提供者的可观察契约：前端通过公开产物独立消费服务，插件拥有业务页面与管线，宿主提供通用界面和资源导航，并保持身份、权限、有限读取、操作回执及配置作用域。

## ADDED Requirements

### Requirement: Independent frontend consumption and delivery

WebUI SHALL 能够只消费声明的公开客户端、协议、UI SDK 与固定前端制品独立安装、构建和开发。Pakka 默认发行 SHALL 提供已选定版本和内容身份的前端；新 WebUI 服务位于 `/pakka-webui` 命名空间，认证、同源和请求校验继续由明确的服务契约约束。

#### Scenario: Frontend-only revision

- **WHEN** 前端界面改变且所依赖的公开服务契约未改变
- **THEN** 前端可在无后端源码的环境独立构建，并连接受支持的未修改后端制品
- **AND** 默认产品启动直接提供选定前端字节，不在启动时拉取浮动源码

### Requirement: Public and symmetric plugin capabilities

插件 SHALL 通过公开声明和 SDK 贡献界面、导航、命名空间命令、服务调用和观察；Agent、Backend、Client、WebUI facets 按实际需要组合。默认与普通业务插件 SHALL 使用相同公开入口，领域可视化、控制和管线由所属插件负责。

#### Scenario: GUI-only and headless consumers

- **WHEN** 标准安装的纯 UI 插件打开或关闭，或另一个消费者只导入 Agent/headless 入口
- **THEN** 纯 UI 操作新增模型请求为 0，且无需工作 Session
- **AND** Agent/headless import 不加载浏览器 runtime、WebUI 或产品服务启动

#### Scenario: Ordinary business plugins

- **WHEN** 两种不同业务插件注册页面并调用自己的受权 Backend 服务
- **THEN** 它们使用相同公开机制，无需修改宿主核心或深导私有 store/router/源码

### Requirement: Stable resource navigation across Sessions

插件 SHALL 能持有稳定资源引用、注册所属资源视图并请求通用导航。已知、宿主可解析且获准访问的另一 Session 的原 Conversation SHALL 可进入并浏览真实过程。引用本身不是 authority，原资源身份与当前运行绑定由所属服务确认。

#### Scenario: Original Conversation in another Session

- **WHEN** 插件提交指向另一已知 Session 原 Conversation 的稳定引用
- **THEN** 宿主按受控解析结果进入该原对象并读取其历史
- **AND** 浏览不启动模型、重派任务、清锁或恢复执行，不改变 storage writer/Runtime 所有权

#### Scenario: Unloaded or unavailable source

- **WHEN** 引用目标未加载、不可得、无权或身份不符
- **THEN** 界面分别表达对应状态，并只按公开服务支持的方式继续解析或读取
- **AND** 不以同名对象、另一个 Session 或任意 SQLite 路径代替目标

### Requirement: Bounded typed data and observation

业务读取与命令 SHALL 经声明 schema/scope 的服务和 typed client；actor 与权限由受信任服务绑定。分页、搜索、固定版本及大正文按引用读取 SHALL 保持所属服务的合法内容范围，订阅重连核对身份、资源和版本。

#### Scenario: Long history and content

- **WHEN** 插件读取长历史或超过预览预算的正文
- **THEN** 使用有限分页或按引用读取，而非全量装载后裁切
- **AND** 预览限制不静默缩小完整内容契约，业务索引和数据模型仍由所属服务管理

### Requirement: Explicit commands and durable operation observation

按钮、快捷入口和 client SHALL 使用同一命名空间命令身份及服务契约。外层调用、内层 operation/job/receipt 和业务完成分别表达；读取、写入、等待、取消和恢复执行具有显式语义，持久账本归所属服务。

#### Scenario: Lost response and closed interface

- **WHEN** 写入响应丢失、连接中断或界面关闭
- **THEN** 按原请求核对所属操作，不自动换请求身份重放效果
- **AND** unknown 不解释为未发生；界面关闭或取消等待不宣称已接纳工作被取消或回滚

### Requirement: Custom content with shared UI environment

公开 UI 接缝 SHALL 支持导航、页面、panel/sheet、设置和完整自定义交互内容。插件 SHALL 消费宿主共享的公开组件、主题、浮层与可访问性/focus 约定；上游设计系统的公开能力可直接消费，不受宿主便利封装清单限制。

#### Scenario: Complex plugin view

- **WHEN** 普通插件提供表格、关系图、报告列表、控制表单或管线视图
- **THEN** 它可在通用容器内组合自定义内容，无需 schema-only 页面模型、第二个壳层或 DOM monkey patch
- **AND** 使用与宿主同一共享 UI runtime，局部样式不接管全局或其他插件

### Requirement: Facet and instance lifecycle with explicit compatibility

插件的身份、版本/generation、资源与 open-instance SHALL 明确绑定；UI、Backend、Agent 能力的启停分别表达。SDK/服务/renderer 兼容与资产身份 SHALL 在安装、加载或功能启用前核对，不兼容具有明确处理结果。

#### Scenario: UI unload and replacement

- **WHEN** 界面卸载或插件产生新实例/generation
- **THEN** 旧实例的订阅、监听、计时器和可中止读取被清理，旧回调不更新新实例
- **AND** 已接纳工作与业务历史仍由所属服务保留，UI 卸载不隐式停掉其他 facet 或伪造效果回滚

### Requirement: Model access and configuration ownership

当前模型/Thinking SHALL 按当前 Conversation 的配置权限变更；显式保存的人类默认归 Person 并在后端跨设备保存，用于其新建 Conversation 的缺省选择；提供商、端点和模型定义归 Pakka 实例，由具备配置权限者管理。模型使用权限与连接配置权限分别处理。

#### Scenario: Keyboard and touch access

- **WHEN** 用户输入 `/model`、完整 provider/model 命令，或使用模型/Thinking 的点击触控入口
- **THEN** `/model` 打开搜索选择器，完整身份准确直接选择；`/thinking` 与触控/点击共用可用级别和设置操作
- **AND** 这些命令不作为模型输入，不近似替换指定模型或自动 fallback，普通选择不自动保存默认

#### Scenario: Person default and instance configuration

- **WHEN** 用户显式保存个人默认，或有配置权限者编辑提供商/模型参数
- **THEN** 个人默认可跨设备使用，不修改已有 Conversation 或覆盖 MAS/工作流的显式选择；实例配置编辑使用有校验、冲突和回执的公开服务
- **AND** 常用参数通过可视化页面编辑，高级能力保留适用的原生继承/覆盖语义，已存秘密不回填普通表单
