# WebUI 使用与启动

pakka-webui 的原生操作参考 Devin 离线生产前端；界面接入 Pakka 的实际 API、权限、持久状态和原生调度。

pakka-webui 是可选的 Web 工作台。它提供普通 Conversation、原生输入、多人协作和宿主装配的服务／插件；模型工具与界面按各自权限启用。产品组成见[产品声明](../state/product.md)。

## 1. 从源码启动

要求 Node 24+ 与 npm 11。以下命令从仓库根目录运行：

```sh
npm ci --ignore-scripts
npm run build
npm link --workspace @pakka/cli --ignore-scripts
pakka
```

`pakka` 默认启动 WebUI 并打开浏览器，无需预先提供宿主 JSON、模型或凭据；也不增加首次使用 wizard。不链接 shell 命令时，可运行 `node apps/cli/dist/main.js`。`--no-open` 只启动服务，Ctrl+C 正常停止。以上使用本地源码 workspace；不假定这些私有包已发布到 npm。

Pakka 产品定位和数据默认保存到 `~/.pakka`（可用 `PAKKA_HOME` 指定）。首次启动绑定当前目录，之后无参数运行会重开已记录工作区与原控制 Session，而不是根据新的 shell cwd 换库。Pi 原生配置使用 `PI_CODING_AGENT_DIR` 或 `~/.pi/agent`，与产品数据分开。

模型/provider 可以随时配置：继续使用 Pi 配置工具编辑原生 `models.json`、`auth.json`、`settings.json`，然后在 **Settings → Models & Providers** 刷新或使用原生认证。无模型时可以管理 Session 和设置；明确选择模型并发送输入后才开始工作。原生默认模型/thinking 影响以后创建，不替换已有 Conversation 的选择。配置文件不等于执行扩展：外部工具写入的 Pi 原生模型配置可刷新，依赖 Coding Agent 扩展事件的自定义行为不会随文件一起执行。

本地 `default` 预设提供 read/write/edit，以及 Windows PowerShell 或 POSIX Bash；`read-only` 预设只注册 read。工具以当前 OS 用户运行，不是沙箱。命令子进程不继承模型凭据或 Node 启动钩子，但仍能访问该用户的文件及网络。项目和用户 instructions、skills、templates 通过 Pi 原生本地发现读取；只展示 skills/templates 索引，不自动安装包、执行扩展/MCP 或展开模板正文。

### 高级宿主装配

显式配置优先级为命令行参数、`PAKKA_CONFIG`、已保存来源、`PAKKA_HOME/config.json`、默认本地装配。保留下面的旧 JSON 兼容入口；它不是普通用户启动 WebUI 的必要条件，也不是登记完整 Pi 模型目录的方式：

```sh
pakka --config /absolute/private/pakka.json --owner-file /absolute/private/owner-link.txt
```

`pakka-webui --config ... --owner-file ...` 仍可直接启动高级宿主。下面示例的目录、endpoint、模型 ID 和认证字符串需要替换为实际值；不要把真实凭据提交到仓库：

```json
{
	"runtime": {
		"cwd": "/srv/projects/project-a",
		"cwdRoots": ["/srv/projects"],
		"dataDir": "/srv/pakka-data",
		"endpoint": "http://127.0.0.1:8000/v1",
		"model": "your-local-model-id",
		"apiKey": "local-provider-key",
		"limits": {
			"maxConversations": 20,
			"maxPrimaryAttempts": 2000,
			"maxAuxiliaryAttempts": 1000
		}
	},
	"owner": "Owner",
	"initial": [{ "name": "Work", "profile": "default" }],
	"profiles": ["default"],
	"transport": { "host": "127.0.0.1", "port": 45000 }
}
```

这是兼容的单-provider 宿主示例；JSON 模式不会隐式增加原生执行工具。Files、Memory 等服务与插件仍由宿主明确装配，其入口随安装贡献出现；具体示例见 [WebUI 开发规范](../development/WEBUI-DEVELOPMENT.md)。可信 ESM 启动模块可用 `--config-module /absolute/private/config.mjs` 加载，它是宿主代码，不是浏览器提交的配置。

初次启动把 owner 登录链接写入指定的新私有文件；默认位置为数据目录的 `owner-link.txt`，终端不打印登录 token。配置、owner 文件及数据目录应放在受保护的位置，并核对平台 ACL。打开 owner 链接兑换后，浏览器保存人员会话并清除地址片段；请保护 Cookie 和邀请链接。原 Session 重开不重新签发初始 owner。

## 2. Conversation、模型与工作目录

从侧栏 **Sessions** 选择 Conversation；首页的 **New Session / New Conversation** 打开独立配置向导。填写名称，选择父 Session、工具预设、模型/thinking 和服务器目录，明确确认后创建并打开。没有可用父项时可先创建 Session，再创建 Conversation；部分成功保留已创建父项，unknown 保留原请求核对。创建不提交模型输入，进入会话后明确 **Send** 才开始工作。

输入模式按目的选择：

- **Prompt**：启动普通模型工作。
- **Steer**：工作进行中提交原生 steering。
- **Follow up**：使用原生 follow-up 队列。
- **People Chat**：人类旁聊，不自动成为模型输入。

模型按钮位于输入区，查询完整原生目录，支持跨 provider 搜索和分页。方向键移动高亮，Enter 确认，Escape 取消；当前选择及真实模型能力单独显示，thinking level 使用该模型支持的级别。模型选择不要求新增 profile，也不改变工具预设。账号认证与配置刷新在 **Settings → Models & Providers**，不是模型选择菜单的副作用。

工作目录入口位于 **Conversation 标题下方的服务器路径**。打开后可浏览批准位置、面包屑、最近目录、收藏或输入路径，点击 **Use this directory** 才应用。模型和目录分别保存，变更任意一个都保留另一个、指令和工具。新会话以及同基础 profile 的分叉继承当前选择。

会话右上角 **Conversation options → Settings** 提供用量和凭据；同一菜单的 **Conversation** 提供重命名、归档、fork 和有限导出。cwd 从会话页头的目录路径进入。工作或队列尚未结束时，配置变更被拒绝，已有任务继续按原规则运行。Viewer 可查看当前模型与路径，配置和目录浏览按服务端权限开放。

`runtime.cwdRoots` 是宿主批准的目录树；未显式设置时从批准 profile 的目录推导位置。路径属于运行服务器，不是手机文件系统。选择 cwd 不授予额外 Files 权限，也不构成执行沙箱。

## 3. 手机导航与外观

手机默认最短测试比例为宽∶高 **3∶5**，例如 360×600 或 390×650。左上角侧栏图标开关抽屉；从 **Sessions** 选择会话，从 **Commands & extensions** 进入命令与扩展页。点击抽屉右侧暗区或按 Escape 返回会话。

页面由侧栏、首页、Conversation、palette 和独立 Settings 组成，入口随已安装服务与当前授权呈现。桌面侧栏可通过侧栏顶部面板图标或 Ctrl/⌘ B 收起；手机该快捷键开关抽屉。搜索图标或 Ctrl/⌘ K 打开当前身份可见的 Conversation 搜索；在搜索 palette 中选择 **Include archived**，归档项可显式 **Restore**。会话页头搜索只筛选已加载的历史，不发送模型工作。

侧栏底部 **Settings** 单击进入独立配置页，默认显示 **Appearance**。页内分类导航提供外观、Conversation settings（用量与凭据）、Notifications，以及按权限显示的 Models & Providers、预算、Session 管理、People & invitations 和 Extensions。Conversation 专属分类在选中会话后可用；手机上可横向滚动分类栏。**Back to app** 返回原页面并保留当前会话与未发送草稿。可选择 Dark / Light、默认 Inter、JetBrains Mono、系统无衬线或衬线字体，以及 14–24px 字号；合法的已保存字体／字号偏好继续生效。选择即时应用并保存到当前浏览器，代码块维持等宽显示。模型按钮在输入卡片内，Input mode 与 Send 同行；窄屏模型入口为带可访问名称的图标。

## 4. 人员、服务和插件

管理员在 **Settings → People & Invitations** 按批准资源创建邀请，第二身份可在独立浏览器窗口兑换。角色、资源范围、审批和撤权以服务端当前判断为准；显示一个卡片或菜单不会授予执行权限。

当宿主安装了相应贡献时：

| 入口             | 常用操作                                                |
| ---------------- | ------------------------------------------------------- |
| Files & changes  | 编辑、导出及 Changes & Git 分支操作；文件根目录独立批准 |
| Memory           | 记忆条目、Sender 提议、Owner 审批及版本查看             |
| Scheduled inputs | 显式创建、取消定时输入并核对原操作                      |
| Webhooks         | 创建、轮换凭据和确认 Remove webhook 删除                |
| Notifications    | 设备授权、订阅及点击进入目标 Conversation               |
| Team（MAS）      | Graph / Activity / Agents、成员会话、通信和管理         |

**Commands & extensions** 打开可筛选 palette，Commands 区列出命令，Pages 区列出当前身份可见的页面。方向键导航、Enter 执行、Escape 关闭；命令参数由插件声明，缺少必填参数时显示具体用法。**Manage extensions…** 进入独立 Settings 页，执行 Disable / Reload / Enable；停用 UI 不会自动取消已提交工作或删除历史。

Team 使用单层页头与 **Graph / Activity / Agents** 三视图。选择成员显示右侧 inspector；手机改为底部面板。**Open Conversation** 进入真实成员会话并可返回原选择；**More → Member controls…** 提供输入及获准回复，控制界面的 **Management** 提供 Stop work 与退休确认，不是创建表单。个人视图切换不启动模型工作。操作见[Team 指南](MAS-BOARD.md)，目标见[前端声明](../state/frontend.md#team)。

## 5. 正常关闭与重开

正常停止后再次运行 `pakka`，启动器使用已保存的来源、工作区、端口和原 sessionFile 重开，无需手工编辑配置。已有身份、资源、回执、实际模型／cwd／thinking 和累计消费保持；重开不重新发送输入或签发 owner 凭据。

未确认的启动会给出 `PAKKA_STARTUP_UNCONFIRMED`。确认原数据后可运行 `pakka --recover`；该动作只重开已记录的原身份，不清理 writer 锁、不补建丢失数据库、不猜测缺失定位，也不重放工作。损坏定位记录需依据原路径处理；高级宿主可显式提供同一个 `runtime.reopenSessionFile`。不要删除数据库、WAL 或 claim 来绕过故障。

Session 管理设置显示不可用的已登记子 Session。健康 Session 可以继续使用；恢复原库之后，具有全局管理权限的用户可显式重开。原登记未知、仍持有但已封闭的 Runtime 或清理未确认的实例不能靠再次打开修复。

预算设置展示累计消费和现行上限，并支持有审计的调整。相同启动配置不会覆盖管理修改；响应丢失时先查原请求，版本冲突后显式重读。调整不退款、不清零，也不改变未确认工作的结果。

归档／恢复整理当前人的 Conversation 列表，保留原会话数据。MAS retire 另行停止成员准入并保存 tombstone；这两类操作均保留持久历史。

未知结果先通过原请求与当前状态只读核对；刷新、关闭面板或退出浏览器都不自动重放输入，也不退还已消费额度。强制终止后的 claim 或未知存储需要另行恢复判断，受信宿主的 writer 维护命令见 [Strategy API](../reference/STRATEGY-API.md#trusted-writer-maintenance)。

### 本机维护入口

Cookie 丢失、注销或过期可用 `pakka recover login` 预览原身份，再以 `--confirm <原 Session ID>` 私密发行一次性凭据；`pakka --login-file <凭据文件>` 为实际地址准备链接。崩溃占用使用 `pakka recover writer`，不与 `--recover` 混用。

停服后的 `pakka backup`、`pakka restore` 和 `pakka upgrade` 统一核对原身份。恢复后旧登录失效，任务保持停机，先核对外部效果再显式恢复。参数、范围、故障续完和保全规则见[本机维护指南](LOCAL-MAINTENANCE.md)。

## 6. 远程连接

默认 loopback HTTP。远程部署需明确 `transport.publicOrigin`、受信反向代理 peer、TLS 终止及 SSE 传输；未经配置的新域名会被拒绝。Cloudflare Quick Tunnel 声明不支持 SSE，不能用作这套实时界面的正向验收环境。

真实 OS 通知、本地 TLS、真实设备公网推送、LAN、tailnet 和不同平台分别验证，部署时应选择与实际传输和设备匹配的检查。传输与扩展装配契约见[开发规范](../development/WEBUI-DEVELOPMENT.md)，验证方式见[验证入口](../verification/README.md)。
