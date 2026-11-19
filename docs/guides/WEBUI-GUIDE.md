# WebUI 使用与启动

Pakka WebUI 是围绕持久 Session 和 Conversation 的浏览器工作台。它提供原历史阅读、原生输入、配置、多人协作和宿主装配的插件。页面按当前人类身份显示可读资源，操作由后端核对权限与原请求。

## 1. 安装与启动

源码安装要求 Node 24+ 与 npm 11，在 Pakka 仓库根执行：

```sh
npm ci --ignore-scripts
npm run build
npm link --workspace @pakka/cli --ignore-scripts
pakka
```

`pakka` 默认提供随包固定的独立前端，并打开浏览器。无需预先选择模型或填写宿主 JSON；`--no-open` 只启动服务，Ctrl+C 正常停止。未链接 shell 命令时，可运行 `node apps/cli/dist/main.js`。这些私有 workspace 包通过源码或固定归档安装，安装渠道见[固定前端配对](../../integrations/webui/README.md)与[本机交付](LOCAL-MAINTENANCE.md)。

产品定位与数据使用 `PAKKA_HOME`，默认 `~/.pakka`。首次启动绑定当前项目目录，后续启动重开该工作区与原控制 Session。Pi 模型配置使用 `PI_CODING_AGENT_DIR`，默认 `~/.pi/agent`。

首次 owner 登录链接写入私密 `owner-link.txt`；打开链接后在页面确认登录。兑换后浏览器保存登录 Cookie 并清除地址片段，原 Session 重开保留人类身份。丢失登录时使用第 6 节的恢复入口。

## 2. 模型来源与工具预设

模型/provider 定义来自 Pi 原生 `models.json`，认证由可信宿主的 Pi 配置管理。可用外部 Pi 配置工具维护 `auth.json`、`settings.json` 和连接定义，再在 WebUI 的“提供商与模型”中读取、编辑或重新加载。页面支持参数表单与受校验的高级编辑；已存秘密保持保护状态。Provider `/login` 和私密凭据的新页面交互按当前交付范围延期，认证仍通过宿主工具管理。

“个人模型默认”按 Person 保存，影响以后创建的 Conversation；当前 Conversation 的模型与 Thinking 可独立改变。输入区 `/model` 或模型按钮打开搜索选择器；`/model provider/model` 精确选择完整身份。`/thinking` 与 Thinking 按钮使用当前模型提供的级别。

默认本地 `default` 预设装配原生 read/write/edit 及 Windows PowerShell 或 POSIX Bash；`read-only` 只注册 read。工具以宿主 OS 用户运行，访问范围取决于实际执行环境。项目/用户 instructions、skills、templates 使用 Pi 本地发现；模型获得 skills/templates 索引，可按需读取正文。

工作目录与工具预设在 Conversation 配置中设置。目录属于服务器，浏览范围由宿主 `runtime.cwdRoots` 或批准 profile 决定。模型、Thinking、目录与预设分别表达各自配置；工作或队列未结束时，服务按原生准入规则拒绝冲突变更。

## 3. 工作台、创建与阅读

工作台列出当前可读、已加载的 Conversations，可按 Session、归档状态和标题筛选。点击标题进入原对话。“新建 Session”与“新建 Conversation”分别确认：先创建的 Session 保留独立存储和预算，子 Conversation 由后续显式动作创建。表单提供名称、批准目录与预设；初始模型/Thinking 使用个人缺省或宿主默认。

已登记但不可用的 Session 可在原来源恢复后显式重新打开。创建响应丢失时，页面保留原请求并提供核对；查不到结果继续保持待核对。重开响应丢失后，通过刷新工作台确认原 Session 是否已加载；读取失败时保留核对状态。

工作台的原历史入口接受已知 Session ID 和 Conversation ID，由服务重新核对身份与访问授权。未加载 Session 的可读保存历史标明保存状态，浏览不会打开执行 Runtime。同号 Conversation 通过完整 Session 身份区分。

Conversation 页面分为阅读区和输入区。更早历史、返回最新与当前页搜索均使用有限页面；搜索范围在页面中明确显示。工具卡区分流式声明、执行与保存结果，分叉继承和当前调用各保留其来源。

消息“原文”打开单条消息的阅读模式，固定阅读导航提供“返回消息预览”。原文按块读取，可继续查找、复制当前内容或下载原文；搜索完整引用与搜索预览分别表达。图片按需加载，无法直接展示的格式保留原文下载入口。手动滚动或操作正文会暂停自动跟随，“到本页最新消息”可返回当前页末端；明确发送新消息会接续新回复。

## 4. 输入、命令与恢复

普通输入使用原生调度：

- “发送消息”提交 prompt。
- “调整当前工作”提交 steer。
- “本轮结束后执行”提交 followUp。

发送前保存完整原绑定与请求。响应不可确认时，页面显示待核对，并可展开查看原正文、模式和请求号。刷新或重开后点击核对只查询该原请求；unknown 保留原请求。等待期间新写的草稿会保留，已确认的旧回执与当前输入分别展示。“我的输入”用于检查原生接纳与结果。

命令按插件声明发现、校验与分流。普通 `/tmp/report.txt` 等字面输入可发送；命令发现失败时，疑似命令参数留在草稿。UI command 进入相应实例，Backend command 按 App/Conversation scope 调用；有持久效果的命令使用原请求恢复，读取命令失败可显式再读。插件 display 内容不会自动成为模型输入。

听写从输入工具栏启动。识别文本先进入预览，结束后由用户插入草稿，再显式发送；听写期间的手动修改保持。浏览器权限由用户选择。本轮真实识别因本机无录音设备获授权跳过，识别质量仍未验证。

停止观察、关闭页面或取消等待只结束相应界面活动。停止工作需显式请求服务操作，是否已停止、是否产生效果和预算消耗以原生回执判断。

## 5. 导航、外观与插件

桌面侧栏提供功能、设置和已打开页面；手机通过导航按钮打开抽屉，选择入口后返回内容。关闭页面会释放所属观察，切换保留的页面维持各自草稿与阅读位置。返回和 Escape 按当前弹窗/抽屉处理焦点。

“外观”提供跟随系统、明暗模式、字体与字号，保存到当前浏览器，并应用于正文、共享部件与弹窗。设置中的人员、预算、模型、通知和 facets 入口按权限与当前资源开放。

人员管理员可创建带角色和资源范围的邀请，第二个人在独立登录中兑换。只读成员可参与获准的人类聊天和 reactions；模型输入、共享笔记、pin 与 driver 控制各按其权限处理。聊天/笔记通过“协作”入口操作，输入控制权影响真实模型输入准入。

宿主装配相应贡献后提供以下入口：

| 功能             | 操作                                                                |
| ---------------- | ------------------------------------------------------------------- |
| Files / Git      | 读取、编辑、上传与导出；核对文件冲突、分支及受控 worktree           |
| Memory           | 条目、提议、批准内容与版本                                          |
| Scheduled inputs | 创建、取消定时计划，检查原 job 与逐次投递                           |
| Webhooks         | 登记、签名密钥轮换、移除和投递记录                                  |
| 审批             | 决定当前受管工具的允许/拒绝，并核对实际结果                         |
| 受管浏览器       | 访问批准 origin、查看画面和执行获准操作                             |
| Team / MAS       | Graph、Agents、Activity，成员输入、回复、原 Conversation 与退休管理 |
| RSI              | 工单详情、分派、执行与结果核对                                      |

“扩展与 facets”分别管理 Backend、Agent、WebUI、Client。WebUI 停用释放页面实例，已接纳工作和持久记录由所属服务继续维护。命令、插件操作、外层 operation 与内层 native receipt 使用同一套服务权限与原请求关系。

通知设置按 Person 保存偏好，设备可登记到当前 Conversation。浏览器原生权限由用户确认；系统显示检查与实际工作完成推送分别操作。推送包含有限事件定位，worker 读取正文时重新授权。设备停用覆盖其关联资源，撤权/注销使后续正文读取失效。不同部署设备的原生权限、推送渠道和系统显示需按实际环境核对。

## 6. 正常停止、重开与维护

正常停止后再次运行 `pakka`，启动器使用保存的来源、工作区、端口和原 sessionFile。资源、回执、当前模型/目录/Thinking 与累计消费保留，启动本身不发送输入。

`PAKKA_STARTUP_UNCONFIRMED` 表示启动结果未确认。核对原数据后可显式 `pakka --recover`；它按已记录身份重开。数据库、WAL、writer claim 和缺失定位分别核对，不能通过创建替代库恢复原请求。

Cookie 丢失、注销或过期时，`pakka recover login` 预览原身份，再用 `--confirm <原 Session ID>` 私密签发一次性凭据；`pakka --login-file <凭据文件>` 为实际地址准备链接。writer 异常占用使用单独的 `pakka recover writer` 流程。

停服后的 `pakka backup`、`pakka restore`、`pakka upgrade` 核对原身份、固定归档与恢复状态。数据恢复后旧登录失效，任务保持停机，先核对外部效果再显式恢复。完整参数见[本机维护](LOCAL-MAINTENANCE.md)。

归档/恢复整理当前人的 Conversation 列表；MAS retire 管理成员准入与 tombstone。两者保留原历史。预算按原生累计消费和有审计的上限管理，原请求核对不重放输入或退还已消费额度。

## 7. 高级装配与部署

配置优先级为命令行、`PAKKA_CONFIG`、已保存来源、`PAKKA_HOME/config.json`、默认本地装配。显式 JSON 与可信 ESM 可配置 Runtime、批准资源和服务/插件：

```sh
pakka --config /absolute/private/pakka.json --owner-file /absolute/private/owner-link.txt
pakka --config-module /absolute/private/config.mjs --owner-file /absolute/private/owner-link.txt
```

`pakka-webui` executable 也接受同样的显式装配选项。JSON 单-provider 配置与原生本地产品装配各有自己的工具来源，具体形状见[开发契约](../development/WEBUI-DEVELOPMENT.md)。可信 ESM 可传入公开 `modelConfiguration` 和固定 `frontend`，前端摘要、兼容性与完整资产在打开 Session 前核对。

默认监听 loopback HTTP。远程入口明确配置 `transport.publicOrigin`、受信代理 peer、TLS 终止和 SSE 转发；请求继续受 Host、Origin、Cookie、CSRF 与身份绑定约束。开发前端使用保持这些关系的同源代理。代理的 SSE 支持与连接期限须按实际部署检查；Cloudflare Quick Tunnel 不作为 SSE 正向验收环境。

前端替换使用获准归档与 manifest pin，正常停止并重开原 Session。兼容回退只选择前端字节，数据库与未知效果继续保留。操作和支持组合见[固定制品](../../integrations/webui/README.md)。
