# 阶段 5：默认固定前端与完整交付

本轮按用户授权推进默认入口与旧实现清理。起点为 Pakka `c3da462` / pakka-webui `639397d`，两仓继续各自的 `pakka/independent-webui-seams` 分支。阶段 4 所选功能及阶段 5 默认安装已完成核对；源码 release 与短目录复验按各自环境记录。

## 固定组合与安装

- Node `24.18.0`，Windows；模型请求来自隔离的本地确定性 Provider。
- 前端归档 `97c5bcd821a91b3a4c7ab4f80a7fffdd3b2172b84c77572c874f6f0dd71ce1ad`，1,304,838 字节；manifest `a4ea8a221f173c4ac4c3e5d0f81c8019bb42d057fc7c91f2c7ef290c02631941`，713 个资产。
- services 4 / workbench 2 / extensions 3、资产 schema 2；共享 React `19.3.1`、Astryx `0.7.15`、SDK `0.1.0`。SDK 固定归档沿用 `c1f99cd939aa0ffc88400939bf5639fe42c36929d523e45f1197eedd3901dca7`。
- `npm run smoke:package` 从实际归档安装空 consumer，完整运行通过。独立 headless 安装不带入 React、Astryx 或 WebUI；仓库外消费公开 React SDK 类型通过。维护升级/回退检查使用 Node 24 release manifest。
- 安装消费者覆盖真实 Runtime/执行、MAS/Broker、DevPack、RSI、默认 launcher、产品、协作/文件/Git、Memory、Webhook、定时输入、审批/受管浏览器和通知。全部通过；服务结果与实际 UI 结果分别保留。

默认构建先核对归档/manifest 摘要、完整成员与每项资产，再将固定字节放入 Node 包。安装和启动无需前端 checkout；启动前兼容性和字节校验继续有效。精确配对及替换方式见 [integrations/webui](../../integrations/webui/README.md)。

## 默认启动与真实页面

最终归档从仓库外安装包启动，未传 `frontend` 的首轮使用默认选择。实际生成的 `#session` 私密链接登录成功，单一原生 modal 可操作；PC 发送 `/tmp/final-installed-report.txt` 后真实 Provider 只收到一次对应消息。390px 的第二笔输入已接纳后返回不可解码响应，页面保留原正文及完整待核对请求。

正常停止后，以阶段 4 的 services 4 归档重开同一 Session，只查询一次便找回第二笔回执；查询期间另写的草稿保持。再停止并恢复默认归档，原历史与回执均可读。A → B → A 的三个不同 serverId 指向同一 Session 文件，始终只有两次提交、一次原请求查询、两次 Provider 请求。

兼容 B 的归档 SHA-256 为 `c783d4d22fd98d71394a8c611b19acad0df6c18af0f323ca13f075c92a31abfc`，manifest 为 `4134f0c6b6a1aaf0e3340d60b905093ef16501d02b3d6aac259e92cdd326dc42`。本轮核对的是前端兼容切换；数据库未回退。阶段 3 services 3 归档不能用于此组合。

安装版还通过 Files 插件读取真实文件、390px 无横向溢出和退出登录后的插件/正文清理；完整监听期间脚本/CSP 错误为零。服务正常结束、服务错误为零，浏览器任务空间已关闭。首次刷新后监听未重新装载的探针保留为不完整记录，随后沿同一原请求补验，没有重复输入。

## 交互缺口与覆盖接续

旧页面检查按实际保护的契约逐项阅读后接续，完整对应关系见[覆盖记录](WEBUI-COVERAGE-TRANSITION.md)。授权、真实效果、持久回执和未知结果保留在原生/公开 HTTP 检查，界面读取、焦点、草稿、生命周期和窄屏操作由新前端真实页面核对。旧 Preact UI/SDK、失去消费者的示例及重复资产构建已退出；构建先清空自己的 dist，避免旧模块进入归档。

本轮实测并修正了三组实际缺口：

- slash 字面输入可正常发送；命令按当前 Conversation 发现，Backend action 校验参数并沿其声明 scope/effect 调用。write/model 的原请求持久保留，read 沿本次读取语义。
- App 写入命令可在同一 Person 的另一 Conversation 找回；跨刷新、原 Session 重开、Backend 停用、unknown、关页晚到结果、撤权和只读隔离均核对，恢复没有重写或模型回退。
- Session 重开丢响应后，后续成功读取会解除待核对锁；已确认重开保留自身结果，随后的目录读取失败不会覆盖它。

80 条历史分 32/32/16 读取，原 Entry 不重复；聚焦原文搜索框保留，离焦后释放离屏正文。分叉继承与当前相同 call ID 的工具结果分别呈现。新建/重命名未到服务端时的空查询继续保留原请求并阻止重复写入；同号跨 Session 浏览与设置晚到结果未串线。这些检查的反例、错误探针与修正过程在本地材料保留。

## 部署、worker 与授权

真实 TLS 代理下使用 `/pakka-webui` 登录、执行一次输入并查询同一回执；错误 Person/Server 身份、CSRF、Origin 和绕过可信代理的直连均被拒绝。支持的入口仍是同源 Cookie/CSRF 与明确代理来源；没有放宽为浏览器跨域访问。

最终安装的 worker 与固定资产字节一致，SHA-256 为 `c527bc532746a931830586f9f90b6aa7b91e6f6115ab06fb9e88644af38c856e`。本轮 A/B 应用使用相同 worker 字节；实际 worker 字节替换、旧实例 redundant、Pakka 通知清除、非 Pakka 项保留和旧读取被取消，沿用阶段 4 编译变体的 A → B → A 证据。原生远端推送唤醒、Windows 显示/点击与撤权清理见[阶段 4](INDEPENDENT-WEBUI-PHASE-4.md)，本轮 TLS 接纳检查不代替系统显示。

## 回归与限制

完整 release 选择 274 文件，全部完成：首轮 271 文件通过，三文件失败；881 项中 868 通过、10 失败、3 跳过，无取消或未完成。维护测试按旧 fragment 长度提取 token、executable-bin 读取 `signin` 两处接线已改为实际 `session` 字段。三文件在短隔离目录复验 15 项全通过，涵盖原登录撤销、私密恢复、备份/恢复、升级、未完成工作确认和 executable 入口。两轮合并覆盖为 878 项通过、3 项平台跳过，首轮失败结果原样保留。

Windows 深目录的私密 ACL 校验限制未修复；短目录复验的 TEMP 长度为 59，权限检查保持原样。两项受控 POSIX CDP 样例在 Windows 跳过，一项原生 PowerShell 测试因固定路径 `C:/Program Files/PowerShell/7/pwsh.exe` 不存在而跳过；安装消费者的真实 Chromium 与当前 PowerShell 操作分别通过。这是分环境收口，不声称单轮无条件全绿。

两仓最终类型检查通过；前端重建 manifest 与安装候选完全相同，前端全量格式、本轮后端改动文件格式和 OpenSpec strict 通过。后端全仓格式检查另报 16 个未改动的基线文件问题，未扩大本轮修改。主动 LSP 六文件无已报告错误，其中四文件确认 clean、两文件因语言服务静默而未确认；后续完整编译检查通过。

Provider `/login` 与新的 API key/OAuth 交互继续延期；已有服务凭据隔离/清空/恢复检查仍保留。真实录音因用户说明本机无设备而获授权跳过，原生识别质量未验证。worker 换版后正文仍送达旧实例的分支未覆盖；已覆盖的是浏览器取消原读取的实际路径。

阶段 4/5 的所选产品范围已验收，默认前端切换与旧实现清理完成。工作分支提交和 PR 更新按实际远端结果登记；集成、registry 发布与 OpenSpec 归档各自独立。原始证据只在本地封存。

本地证据包 `phase5-delivery-20261120-e4ba5c7a.zip`，1,074,141 字节，SHA-256 `1004ade3e91be04b6c2de0d2b12465652743ea342eae42bc5939da10132a9e34`；820 个文件逐项核对大小和摘要。位置为工作区 `.backups/webui-phase5-20261120`，不上 GitHub。包内保留失败探针、首轮 release 和后续复验；早期探针 URL 中一处隔离登录凭据明确脱敏，原件另在本地保留，数据库与凭据文件未纳入。归档首次计数把目录条目也计作文件而拒绝，按实际文件条目复核后全部通过，包字节未改。
