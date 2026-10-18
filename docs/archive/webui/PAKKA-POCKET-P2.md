# Pakka-Pocket P2 — 实际工作台与多人传输

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前产品状态](../../PAKKA-POCKET-STATUS.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

本页记录 P2 建立的可启动 Web 产品及当时的传输／浏览器门禁。产品在 [P1 受控服务](PAKKA-POCKET-P1.md) 上运行，主题、字体和交互来源固定于 [P0](PAKKA-POCKET-P0.md)。公共扩展随后在 [P3](PAKKA-POCKET-P3.md) 接入，完整本机工作台已沿 P5 演进。当前能力、用户确认和远程测量范围见 [产品状态](../../PAKKA-POCKET-STATUS.md)；下文保留 P2 版本条件。

## 启动与使用

单一产品包 `@pakka/webui` 的源码为 `apps/webui`。产品入口为 `pakka-pocket`，可信程序组合入口为 `startPocket`，低层产品监听器为 `@pakka/webui/http`。编译后可运行：

```powershell
node apps/webui/dist/main.js --config <host-authored-config.json> --owner-file <new-private-file>
```

配置的顶层字段为 `runtime`、`owner`、`initial`、`profiles`、`transport`，未知字段拒绝。`runtime` 使用现有 Pakka endpoint/model、显式 dataDir/cwd、调用限额与已批准 profiles；这些配置不传给浏览器。`initial` 指定初始 Conversation 的人类名称和批准 profile；`profiles` 是本产品允许人类选择的 profile ceiling。

第一次启动只向指定的新私有文件写 owner 登录链接，进程标准输出只给 origin、serverId 与 sessionFile。登录链接在浏览器 hash 中兑换，页面立即清除 hash；有效会话保存在 HttpOnly Cookie，CSRF 使用独立随机 token。提供 `runtime.reopenSessionFile` 正常重开后保留原用户、邀请、撤权、Conversation、回执与预算，不重新签发 owner。初始化中断或配置冲突需要显式核对，不能自动重建身份或补建第二份资源。

## 当前实际界面

- 已授权 Conversation 的持久名称、导航与新建入口；手机视口折叠导航。
- 原生 committed transcript、Markdown、工具调用/结果、当前 generation/tool 活动与 token 用量。
- 明确区分 prompt、native steer、followUp 和人类 team chat；斜线输入不自动变成模型输入。
- 提交返回真实准入回执后立即恢复输入，后台等待原轮次，忙碌时仍可 steer/followUp。
- People 与邀请界面、有限角色与资源域、一次链接及可独立解码的 QR、撤销用户与退出登录。
- viewer 可查看同一份结果，但不能靠浏览器控件或直连 RPC 提交工作。
- 安全渲染、固定依赖的 Preact/htm、主题与字体；上游 MIT 与字体 OFL 随产物保留。

这不是 P5 全部页面的完成声明；文件/协作/审批等清单和 MAS Board 均由后续阶段按实际服务接入。没有 MAS 的基本工作台已经可运行。

## 网络与实时语义

P2 独立监听器使用 `/pocket/exchange`、`/pocket/rpc` 和 `/pocket/events`，显式 `version: 2`。原 headless v1 的 loopback、dedicated-token、schema 与 profile-changing guard 不变。

本地默认为 loopback。远程终止使用显式 `transport.publicOrigin` 和 `trustedProxyPeers`；每次请求检查精确 Host、Origin、转发协议与真实 peer。代理模式不因 publicOrigin 恰好是本机而免检。HTTPS 会话使用 Secure Cookie；普通 HTTP 远程只在显式 `allowInsecureRemote` 下运行，不能据此承诺传输保密。实际公网 tunnel/tailnet launcher 的测量仍在 P5，不以本地 TLS 代理代替外部部署证明。

RPC 有有限 body、fatal UTF-8、有限 schema 和并发数。合法请求即使被认证/CSRF 拒绝仍保留 requestId。明确的效果前拒绝与执行后的不确定状态分开；`unknown` 不重放操作。公开读取与写入始终绑定当前服务端身份。

SSE 发布当前获准 Conversation 的完整有限快照，具有 serverId/streamId/sequence 与精确资源引用；这是观察顺序，不是跨 Session 全局 revision。重新连接建立新范围快照，带旧 Last-Event-ID 时明确先发 resnapshot，不回放 mutation。撤权使现有连接结束，浏览器清除过期数据；不能撤回已发送的字节。正常大帧等待有限 drain，超过一秒的缓冲阻塞或连接关闭才结束该流；慢读者重连取得新快照。

## 实际验证

- `apps/webui/test/` 从真实 HTTP、原生 Durable 与本地确定性 provider 贯通基本工作区、回执、一次邀请、QR 兑换、角色/资源、有限 schema、CSRF/Origin、实际 TLS 代理与正常 reopen。
- owned Chrome 使用隔离的 profile/AppData。桌面 `1440×900` 与手机 `390×844` 两个用户通过真正 DOM 输入、按钮、Cookie、RPC 和 SSE 查看同一个原生工具结果；第三个浏览器无法得到内容。撤权后现有 viewer 页面清除缓存。首轮 provider 故意阻塞时仍可取得 steer/followUp 的真实 queued 回执。
- 大帧 SSE 回归以八条真实持久 display 记录填满 write buffer，再追加实际提交，证明连接继续收到更新。
- `scripts/consumer-pocket-product.mjs` 通过 `npm run smoke:package` 在仓库外安装实际 tarballs，从可执行入口加载实际资产、隔离 Chrome 完成登录/邀请/模型输入/正常重开/撤权，不使用 workspace 源码或 root overrides。截图、HTTP payload、依赖树与原始存储保留在消费者目录。

P2 全量回归 **310/310**（无 skip/todo/cancel），build/check/format 与真实隔离安装门禁通过。产品消费者 **1 次本地模型 HTTP**，既有 legacy/runtime/MAS/broker/DevPack/apps/product/services 消费者同时通过。首次安装消费者遗漏 People Sheet 的异步等待而失败，原日志保留；修正交互驱动后对新隔离安装重跑通过，没有修改产品行为。8 个关键改动路径主动 LSP 检查无错误。阶段结果与调查日志在 `artifacts/pakka-pocket/p2/`，安装证据在 `artifacts/package-smoke/`。这轮是实现阶段门禁；指定双方独立复审、完整界面/插件/MAS/远程产品验收及严格归档均属于 P6。
