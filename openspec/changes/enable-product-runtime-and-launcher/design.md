# 设计

## 模型与可信装配

可信 bootstrap 可向 Runtime 提供 Pi AI Models 或 getter，与 Durable 原生接口一致。原生 provider/modelId 是持久身份，配置中使用 provider/modelId 选择它；模型能力与请求参数来自该目录。legacy endpoint/model/apiKey 输入保留作兼容装配，不是新产品默认路径。调用者仍只获得冻结 DTO 与身份绑定命令；Models 属于可信 bootstrap 输入，不是 Agent/浏览器可获得的运行句柄。

WebUI 产品使用 Coding Agent 公开 ModelRuntime 作为配置加载器，继承其 models.json、auth.json、provider 解析与环境变量机制；不创建 AgentSession、不复用测试 oracle、不复制窄 schema。该依赖属于 WebUI 产品，@pakka/agent SDK 不依赖 Coding Agent。配置刷新必须复用公开方法，不修改已安装依赖，不丢弃原生 callback 链。

模型未选择或配置不可用时，工作台及设置仍可打开；调用在实际选择/认证满足时才可发出。模型错误不是存储损坏，重试或修正不创建替代 Session。持久历史仍保存原生模型引用，不用虚拟占位模型伪造已配置状态。

### 原生配置与人类管理

- 使用显式选定或 Pi 默认的 agent directory；模型、认证及默认模型/thinking 分别沿用 `models.json`、`auth.json` 和 `settings.json`。不从未经信任的项目设置执行扩展，不生成 Pakka 自有的 provider 文件。
- 本地刷新重新读取原生文件、凭据状态及模型目录，不发送生成请求；目录网络更新需明确动作并独立计数。默认模型只影响以后创建，不覆盖已有 Conversation 的原生选择。
- 模型目录与 profile 目录分离。目录查询分页并在服务端搜索，当前选择独立显示；不能用原来 65 个 profile 的传输上限裁掉其余 provider/model。旧配置响应只作为兼容投影，不是目录完整性证明。
- 全局 provider 配置/认证由当前全局管理权限控制。认证调用公开的 `ModelRuntime.login/logout`，API key、OAuth、环境变量和兼容 endpoint 保持各自原生优先级；logout 仅移除所管理的凭据，不承诺删除外部环境或撤销 provider 端授权。
- 原生登录交互绑定 actor、provider 和有限时效的请求身份；提示/确认在私密会话中交付，密钥或授权码不进入通用 operation、广播、Session、导出或浏览器持久存储。只返回状态，不返回 native credential；未知完成状态通过读取核对，不自动重发。
- 登录/登出使用当前浏览器登录绑定的有限授权 scope；角色变更、撤销、退出、轮换、到期和权限存储未知主动取消原生 `AuthInteraction.signal`。复用 Pi 的文件认证锁和写前取消检查，不私有导入 `AuthStorage`、不复制凭据文件实现。准备登录本身不访问 provider，只有已知准备身份上的显式开始才执行；丢失/过期身份不能重新创建并重放认证。
- 用户继续使用外部 Pi 配置工具，WebUI 提供明确的配置来源、刷新与认证入口。原生文件错误只显示去敏诊断；不能把含配置片段或凭据对象的上游异常直接序列化。

### Windows 浏览器生命周期调整

首次完整回归在未修改基线和候选上均停在浏览器 profile 清理，真实 Chrome 导航、截图和进程退出已完成。根因是 Windows 其他组件占用隔离 AppData 中的文件，递归目录逐层重试会把停机拖住。采用进程终止与文件清理分离：只在确认 owned 进程停止后清理；明确的占用/权限错误留下私密记录，不声称清完，不终止其他进程。浏览器缓存具有独立临时生命周期，不进入 Session 备份树。非已知错误或记录无法保存仍显式失败。

### HTTP 端口选择

Windows 动态端口范围可能包含 WHATWG Fetch 禁用端口。宿主的 `@pakka/server/http-listener` 公共装配工具在发布地址前关闭并有限重选这类自动端口，显式禁用端口则直接拒绝；普通监听错误不换端口掩盖。WebUI、headless HTTP 与本地确定性模型夹具使用同一实现。测试只控制 OS 的首次分配值，监听、关闭、HTTP 页面和模型交换均为真实操作。

## 配置与预算演进

增加未使用的批准 profile 不应拒绝现有 Session。已经使用的执行/工具权限发生变化时必须显式迁移；默认不以新定义恢复未确认工作。持久记录需区分 Session 身份、配置版本和预算政策。增加预算保留累计预留与消费；降低额度不能抹去历史消费或释放未知调用。提供受信管理入口与可核对的变更记录。

- 预算管理使用政策版本、actor/request 原身份和 CAS；重复相同请求返回原回执，内容不同或旧版本新请求拒绝。政策写入和审计共享同一个原生事务；未知写入仍封闭 Session。
- 提交前的预算参数/版本冲突通过公开 `BudgetChangeRefusedError` 分类；私密 HTTP 映射为明确的 INVALID_REQUEST 或 CONFLICT/denied。该类型只在提交前的校验分支产生，不把通用权限异常或写后失效变成无效果保证。浏览器保留未确认请求及政策版本，读取原请求回执；冲突后由用户显式读取现行政策再提交，不自动改写版本或重放。
- 保存最近一次 bootstrap limits。原配置重开时保留运行期间由管理入口调整的上限；明确改变 bootstrap 配置时才形成新的配置变更记录，不以重开覆盖管理动作。降低到累计消费以下只阻止新的预留，不退款、不清零。
- 已登记的 profile 指纹及显式 cwdRoots 保持核对；允许追加新的批准 profile，不能通过同名替换旧定义恢复未确认工作。追加定义与预算变化作为同一启动配置事务登记。
- 审计按政策版本写入原生 DocFamily 并分页读取，不把所有历史堆进固定长度数组。历史行保存时间、来源、原请求、前后上限和当时的累计消费；不包含凭据或工具实现。

## 普通失败、输入与隔离

生成错误保留原生失败轨迹与回执，同时允许以后明确的新输入及配置修正；存储和未知工具效果仍 fail closed。普通 slash 文本不经过全局拒绝；明确的已注册命令由对应 dispatcher 处理。

WebUI 登记 Session 的个别打开失败不阻止健康 Session 使用。unknown 注册不自动创建或解锁；目录状态显示 unavailable，并保留原登记、原创建请求和原存储身份。全局 Session 创建权限可显式重开已确认登记；每项串行打开，已经 ready 的原实例直接返回。只开放启动时未成功取得 Runtime 的登记；已持有但封闭或清理未确认的实例不能被第二次打开。打开前和发布前检查实时授权；撤权后不发布新实例，已取得的资源由宿主负责关闭，清理未知不能伪称成功。公开诊断为有限状态，不包含 SQLite/provider 异常正文。

工作区设置展示所有可管理的登记状态。打开响应丢失时，页面保留原请求供识别，并通过只读目录核对当前状态；它不是持久的原打开请求回执，不证明完成者。已知打开结果与后续目录读取结果分开保存；目录读取失败先重读，不依据旧 availability 再次打开。被关闭或封闭的 Runtime 自动停止被动通知轮询，宿主按 Session ID 保存单一 monitor 引用，避免恢复尝试累积定时器与旧实例。

## 默认执行与本地资源

产品 bootstrap 显式使用 SDK 的本地 ExecutionEnv 工厂：default 注册 read/write/edit 和当前平台命令工具，read-only 仅注册 read；SDK 未配置 execution 的语义不变。命令环境使用正向变量列表并关闭 inheritEnv，排除模型凭据和进程启动钩子，但不将其宣称为 OS 沙箱。原生引用、cwd、incarnation 与 cleanup 继续绑定环境寿命。

资源通过公开 DefaultResourceLoader 与 SettingsManager 接入。noExtensions 本身不足以阻止 package 解析，因此使用只读 SettingsManager.fromStorage/withLock，仅暴露原生 global/project settings 的 skills/prompts，再关闭扩展及主题装载。instructions 进入当前上下文，skills/templates 仅提供索引与路径；模板不会自动展开。RuntimeContextSource 接收当前批准 cwd，派发前连同引用和 authority 复核；每次 generation 重新读取资源，固定本次数据快照。此来源不创建 Coding Agent Session、不执行 MCP、不自动安装包或修改用户设置。

## 默认入口

pakka 无参数启动 WebUI，保留现有 --connection 协议客户端。PAKKA_HOME 保存产品定位和数据，Pi agent directory 保存原生模型配置；用户可显式选路径。默认本地执行预设与当前目录建立绑定；无模型时也能进入设置。前台 Ctrl+C 正常停止；关闭网页不停止宿主；--no-open 供远程/自动化。启动和重开本身不发送模型请求。

端口、owner 登录和原控制 Session 的定位可持久重用。首次本地启动绑定当前目录，后续使用已保存的工作区，不因 shell cwd 改变而替换原存储。损坏或未知定位不自动替换为新 Session；初始 owner 凭据只进入私密文件/登录 fragment，不进入日志或通用设置。

`--recover` 是显式重开已记录原身份，不是清锁、数据修复或重放命令。没有定位记录且未显式提供原 reopenSessionFile 时拒绝；缺失/损坏数据库、活跃 writer 与身份冲突继续拒绝，原记录及 owner 凭据不变。正常重开不要求用户手工编辑 JSON。

## 验证

按消费者行为写先失败测试：跨 provider/真实 metadata、未选模型、配置刷新、同身份重开、额度演进、401 后新输入、slash 字面文本、子 Session 隔离、标准工具实际文件效果、无参数进程启动/停止和原 Session 重开。验证旧身份、重复请求、过期权限和 unknown 的负向回归；分批 check/build/完整回归并做仓库外安装消费。GUI 交互按仓库规范和实际工具条件验证，不能将接口测试称为 GUI 验收。
