# WebUI 使用与启动

本分支的前端以 Devin 原型为页面与交互基座，接入 Pakka 的真实 API，不使用原型演示数据。当前候选的通过、失败及独立验收阻塞见 [R2 验证记录](../verification/DEVIN-FRONTEND-R2.md)。

Pakka-Pocket 是可选的 Web 工作台。它提供普通 Conversation、原生输入、多人协作和宿主装配的服务／插件；模型工具与界面按各自权限启用。[当前产品状态](../PAKKA-POCKET-STATUS.md)区分已有能力、用户确认及远程、跨平台和最终交付工作。

## 1. 从源码启动

要求 Node 24+ 与 npm 11。以下命令从仓库根目录运行：

```sh
npm ci --ignore-scripts
npm run build
node apps/webui/dist/main.js --config /absolute/private/pakka.json --owner-file /absolute/private/owner-link.txt
```

安装归档后的入口为 `node_modules/.bin/pakka-pocket`，使用同样的 `--config` 和 `--owner-file` 参数。下面是结构完整的启动配置示例，**目录、endpoint、模型 ID 和认证字符串是示例值**，需要替换为现有服务器目录及实际本地 provider 的配置：

```json
{
	"runtime": {
		"cwd": "/srv/projects/project-a",
		"cwdRoots": ["/srv/projects"],
		"dataDir": "/srv/pakka-data",
		"endpoint": "http://127.0.0.1:8000/v1",
		"model": "your-local-model-id",
		"apiKey": "local-provider-key",
		"profiles": [
			{
				"id": "alternate-model",
				"model": "another-approved-model-id"
			}
		],
		"limits": {
			"maxConversations": 20,
			"maxPrimaryAttempts": 2000,
			"maxAuxiliaryAttempts": 1000
		}
	},
	"owner": "Owner",
	"initial": [{ "name": "Work", "profile": "default" }],
	"profiles": ["default", "alternate-model"],
	"transport": { "host": "127.0.0.1", "port": 45000 }
}
```

这是基本 Conversation 工作台配置。Files、Memory 等服务和外部插件由宿主另行装配，其入口随安装的贡献出现；具体示例见 [WebUI 开发规范](../development/WEBUI-DEVELOPMENT.md)。可信 ESM 启动模块可用 `--config-module /absolute/private/config.mjs` 加载，它是宿主代码，不是浏览器提交的配置。

初次启动把 owner 登录链接写入指定的**新私有文件**，stdout 只输出 origin、serverId 和 sessionFile。配置、owner 文件及数据目录应放在受保护的位置。打开 owner 链接完成一次兑换后，浏览器保存人员会话并清除地址片段；请保护 Cookie 和邀请链接。

## 2. Conversation、模型与工作目录

从侧栏 **Sessions** 选择 Conversation，或点击 **New session** 返回首页。首页输入 Conversation 名称后点向上箭头，只创建并打开会话；**不会调用模型**，工作需在进入会话后显式 Send。已选会话的模型／cwd 作为新建的继承来源；首次进入时使用 default profile。原版侧栏底部的新建表单已移除，不要按旧入口查找。

输入模式按目的选择：

- **Prompt**：启动普通模型工作。
- **Steer**：工作进行中提交原生 steering。
- **Follow up**：使用原生 follow-up 队列。
- **Team chat**：人类旁聊，不自动成为模型输入。

模型按钮位于输入区，列出当前人员可配置的批准模型。当前模型置顶，模型多于 8 个时提供搜索。当前集成使用宿主显式配置的同一 OpenAI-completions provider；菜单不承担供应商账号登录或发现服务。

工作目录入口位于 **Conversation 标题下方的服务器路径**。打开后可浏览批准位置、面包屑、最近目录、收藏或输入路径，点击 **Use this directory** 才应用。模型和目录分别保存，变更任意一个都保留另一个、指令和工具。新会话以及同基础 profile 的分叉继承当前选择。

会话右上角 **Conversation options → Settings** 提供用量和凭据；同一菜单的 **Conversation** 提供重命名、归档、fork 和有限导出。cwd 从会话页头的目录路径进入。工作或队列尚未结束时，配置变更被拒绝，已有任务继续按原规则运行。Viewer 可查看当前模型与路径，配置和目录浏览按服务端权限开放。

`runtime.cwdRoots` 是宿主批准的目录树；未显式设置时从批准 profile 的目录推导位置。路径属于运行服务器，不是手机文件系统。选择 cwd 不授予额外 Files 权限，也不构成执行沙箱。

## 3. 手机导航与外观

手机默认最短测试比例为宽∶高 **3∶5**，例如 360×600 或 390×650。左上角侧栏图标开关抽屉；从 **Sessions** 选择会话，从 **Commands & extensions** 进入命令与扩展页。点击抽屉右侧暗区或按 Escape 返回会话。没有旧版工具栏或顶部资源下拉框。

生产页面直接采用参考的平整侧栏、首页卡片、palette 和独立 Settings 页面，不包括没有后端的 Ask、PR、额度或仓库连接演示。桌面侧栏可通过侧栏顶部面板图标或 Ctrl/⌘ B 收起；手机该快捷键开关抽屉。搜索图标或 Ctrl/⌘ K 打开当前身份可见的 Conversation 搜索；在搜索 palette 中选择 **Include archived**，归档项可显式 **Restore**。会话页头搜索只筛选已加载的历史，不发送模型工作。

侧栏底部 **Settings** 齿轮菜单中的 **Appearance** 打开独立 Settings 页。可选择 Dark / Light、默认 Inter、JetBrains Mono、系统无衬线或衬线字体，以及 14–24px 字号；合法的已保存字体／字号偏好继续生效。选择即时应用并保存到当前浏览器，代码块维持等宽显示。模型按钮在输入卡片内，Input mode 与 Send 同行；窄屏模型入口为带可访问名称的图标。

## 4. 人员、服务和插件

侧栏账号菜单（管理员）中的 **People & invitations** 按批准资源创建邀请，第二身份可在独立浏览器窗口兑换。角色、资源范围、审批和撤权以服务端当前判断为准；显示一个卡片或菜单不会授予执行权限。

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

Team 使用单层页头与 **Graph / Activity / Agents** 三视图。选择成员显示右侧 inspector；手机改为底部面板。**Open Conversation** 进入真实成员会话并可返回原选择；**More → Member controls…** 提供输入及获准回复，控制界面的 **Management** 提供 Stop work 与退休确认，不是创建表单。个人视图切换不启动模型工作。操作见[Team 指南](MAS-BOARD.md)，目标见[前端声明](../state/frontend.md#team)，验证边界见 [R2 记录](../verification/DEVIN-FRONTEND-R2.md)。

## 5. 正常关闭与重开

正常停止 CLI 后，在原启动配置的 `runtime.reopenSessionFile` 填入 stdout 曾输出的确切 sessionFile，并保留原 dataDir、profile、limits 和批准根声明，再用同一入口启动。已有身份、资源、回执、实际模型／cwd 和已花额度按持久记录恢复，不重新签发 owner。

归档／恢复用于当前界面的 Conversation 整理。MAS 退役具有另外的成员语义；实际删除契约仍在[工程待办](../PAKKA-POCKET-STATUS.md#4-仍有的工程与环境工作)中。

未知结果先通过原请求与当前状态只读核对；刷新、关闭面板或退出浏览器都不自动重放输入，也不退还已消费额度。强制终止后的 claim 或未知存储需要另行恢复判断，正常重开说明不承诺 crash recovery。

## 6. 远程连接

默认 loopback HTTP。远程部署需明确 `transport.publicOrigin`、受信反向代理 peer、TLS 终止及 SSE 传输；未经配置的新域名会被拒绝。Cloudflare Quick Tunnel 声明不支持 SSE，不能用作这套实时界面的正向验收环境。

真实 OS 通知、本地 TLS、真实设备公网推送、LAN、tailnet 和不同平台分别验证，范围见[当前状态](../PAKKA-POCKET-STATUS.md)。传输与扩展装配契约见[开发规范](../development/WEBUI-DEVELOPMENT.md)，验证方式见[验证入口](../verification/README.md)。
