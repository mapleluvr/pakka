# 只读 SQLite 历史接缝核对

## 对象与结论

2026-11-15 在 `pakka/independent-webui-seams` 上，以 Pakka `b357276` 和 pakka-webui `12b282b` 为输入基线。用户授权的是独立 SQLite reader 及 Pakka 原资源读取接缝；完整 UI、独立 facet 控制、Provider 登录、默认入口切换、合并和发布不属于本次交付。

本候选已接通 **Chord 只读连接生命周期 → Durable 原生 reader → Pakka 已知来源/权限 → 真实 HTTP/安装版客户端**。未加载来源返回保存状态和稳定地址，没有可执行 `AgentRef`，没有重开 Runtime；已加载来源继续由现有 owner 提供读取。

- 下游 SDK 为 [`1.4.0-pakka.4`](../../patches/pi-durable/1.4.0-pakka.4/README.md)，固定 Pi `1.4.0` / `4a080252f06caf63a525d7873c5d94d3c23887e0`，保留 `.3` 的 generation/EntryArchive 契约及 writer 迁移/恢复语义。
- vendor 归档 SHA-256：`40aabe654b9531d9d98328dcc9c94687f723471bf3f57b967977841031308dec`。源差异、构建锁、SQLite companion 的独立身份见 [artifact](../../patches/pi-durable/1.4.0-pakka.4/artifact.json)；这是产品依赖身份，不是证据包身份。
- 只随 Durable 交付 Context 无关的 Chord SQLite 模块；主 Chord runtime 仍为 `1.4.0`。公开 API 对照已复现完整 Chord 双副本的取消信号丢失，最终安装版核对 adapter 与 reader 解析到同一 Context 模块。
- WebUI **services API 升至 2**，workbench/extension wire 仍各为 2，UI SDK/renderer 各保留自己的版本。共享 runtime manifest digest 为 `e72cd6542daf11ab15f943ad31540c35596031131059647f76bfbf2a3d80f33a`；相对原 manifest 仅改变服务要求，634 个声明文件与 210 个共享入口不变。

## 方法与实际结果

环境为 Windows x64、Node `24.18.0`、npm `11.16.0`、TypeScript `7.0.2`、`@types/node 26.6.4`。安装与运行使用隔离目录；自动回归只用本地确定性 provider，不读取用户模型凭据或调用付费模型。

| 检查                 | 结果及覆盖边界                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 固定源码重建         | `npm run build:durable-patch -- <固定上游 checkout> 1.4.0-pakka.4` 通过；Chord 3 项、Durable 11 文件/197 项、安装版 SDK 3 文件/10 项通过。安装版 reader 的类型检查未开启 `skipLibCheck`。                                   |
| 实际 SQLite 生命周期 | 缺文件不创建；旧/新 schema 不迁移；运行时 reader/view 没有写方法；保存的 Task 状态/restarts 保持；真实 WAL writer 并存、短快照一致性、分叉原文、有界范围、取消、关闭及失效 view 通过。                                      |
| Pakka 源码与 HTTP    | 已登记但未加载的原 Session 可读取；同号 Conversation 隔离；授权的 fork 可读继承正文但不会取得原来源权限；撤权拒绝；保存状态不变；浏览额外模型请求为 0、发送仍拒绝。                                                         |
| 客户端边界           | 错 Session、错正文版本、越界范围和服务版本不匹配均拒绝。版本不兼容不能证明写入无效果，仍返回 unknown，不自动重提。                                                                                                          |
| 仓库外浏览器消费     | headless 与 GUI 两个独立安装闭包，分别 50/62 个安装包；两组严格类型检查、浏览器打包与共享 external 检查通过，不带入后端实现。                                                                                               |
| 仓库外 Node 产品     | 固定八个 Pakka 归档安装后，真实历史 HTTP、API 2 manifest 配对、拒绝 API 1 manifest，以及真实 `startPocket` 提供声明 HTML/JS/CSS 的检查通过。HTML 是明确的制品测试入口，不是完整 WebUI。                                     |
| 新 Agent 公共入口    | 安装版 `@pakka/agent` 的 `readStoredConversation` 消费以 NodeNext、`skipLibCheck: false` 检查，0 错误。完整 Node 产品依赖声明的另项失败见下文。                                                                             |
| 类型、构建与 LSP     | Pakka `npm run check`、全 workspace 构建及前端 check/build 通过。主动 lens 检查遇到大文件上限与两个无法确认的结果，另用全新原生 TypeScript LSP 检查 22 个 TypeScript 文件，0 错误、未过滤诊断；没有修改配置或添加类型抑制。 |

新增持久测试仅围绕三个未覆盖边界：Agent 的真实存储/身份/撤权、HTTP 的真实已登记来源/权限/无执行、客户端的身份/版本/范围关联。Chord/Durable 原生测试属于新增只读 SDK 契约。客户端关联检查归轻型，实际 SQLite/HTTP 检查归重型；WebUI affected 选择包含 protocol/client 与 Agent stored-history 接缝。沿用既有 writer、generation、队列、恢复、工具、模型配置和回执测试；没有新增组件/DOM/CSS 规格测试。

## 扩大回归与保留失败

一次扩大选择覆盖 240 个文件、612 项：初轮 **601 pass、9 fail、2 原有平台 skip**，原运行保持 failed，不用后续结果覆盖。

1. 两个浏览器安全回归仍在动态导入已删除的 `@pakka/webui/client`。仅将四处 `createExtensionClient` 导入改成实际公共入口 `@pakka/client/extensions`；两文件复测通过，原权限/丢响应/效果计数断言未改，不恢复兼容 facade 或迁移旧 UI。
2. 其余七项维护失败来自未变的 `private-files.ts`：Windows PowerShell 5 的 `Get-Item` 拒绝 272 字符路径，ACL 初始化尚未执行。独立诊断副本、长/短路径及 PowerShell 7 对照保留相同 ACL 规则；失败残留文件仍被正确拒绝。两份原维护测试仅改用短隔离 HOME/TEMP 后 **13/13 通过**。产品 ACL helper 和安全门禁没有改动；Windows 长路径支持另行跟进。
3. 完整 Node 产品的 NodeNext / `skipLibCheck: false` 检查有 **43 条依赖声明错误**。仅导出上游 `ModelRuntime`、不加载 Pakka，也出现完全相同的诊断：42 个 pi-ai provider JSON import 缺属性，以及 Coding Agent 的 `path.PlatformPath` 声明。新 reader 公共消费严格检查通过，但完整依赖检查仍记失败；未手改安装包或降低检查选项。

两仓相关 17 个文档的主动 LSP 检查无 error/warning，OpenSpec strict 通过。完整 PR 文档范围的链接检查保留账本原有三处旧相对链接；已核对其 `DOCS-2026-10-22` 迁移映射与实际目标，原账本字节未改，其余本地链接/锚点无新增失败。远端链接不由此本地检查认证。

辅助静态建议涉及既有及抽取代码的风格，未借本次批量整理。Semgrep 对固定本地命令的 `spawnSync` 构建 wrapper 报告，核对独立 argv、默认 `shell: false` 与全部调用点后标为误报，没有添加源码 suppress。

## 使用与剩余边界

公开入口、权限与状态见 [WebUI 服务](../reference/WEBUI-SERVICES.md)，原生接口见 [.4 README](../../patches/pi-durable/1.4.0-pakka.4/README.md)，采用过程见[只读接缝](../../openspec/changes/plan-independent-webui/readonly-history.md)及[追加式账本](../PI-DURABLE-COMPATIBILITY.md)。

- reader 只支持已存在且兼容的 SQLite schema；JSONL、损坏/不兼容来源和未登记来源不会由浏览动作修复或接管。
- 一次 snapshot 是短事务；翻页不保留数据库租约，也不宣称能重建任意 sequence 的全部 mutable 状态。64 KiB 是 Entry 返回分段上限，不是全进程内存上限。
- WAL 协调可能涉及辅助文件 I/O；只读业务行为不等于文件系统绝对零 I/O。
- 动态 writer 的实际执行状态仍由 owner 决定，`saved` 不是实时任务状态。
- 本次验证没有新历史浏览界面或业务插件；阶段 1 的独立 facet 控制和阶段 2 的产品验收仍未完成。外部 Dynamite 固定组合没有在本次重新认定。

## 本地证据保全

完整本地证据包：`pakka-readonly-sqlite-evidence.zip`，**17538851 字节**，整体 SHA-256：

```text
f60ae3b9ffdcc2efd1f0a713eaa64764b6ea8149deaf37f8a42622810ce4fb93
```

包内包含固定源码/制品、重建/安装记录、原生及 Pakka 原始回归、原始失败与对照、客户端/制品/LSP 检查。已逐项核对 ZIP 成员大小与 hash；数据库、凭据、node_modules、上游 checkout 和截图未混入普通证据包。

保全目录为工作区 `.backups/readonly-sqlite-ee1b3b95-587a-4966-838c-bdf9594573c2/`，访问限当前用户、SYSTEM 和本机 Administrators；同目录 README/清单说明恢复与校验。原始材料及包本体不上传 GitHub。hash 用于定位和校验包字节，不替代上述方法、失败和能力边界。
