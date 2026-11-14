# 独立 WebUI 阶段 0：静态消费盘点

2026-11-14，用户授权执行阶段 0。结果与归属见 [inventory](../../openspec/changes/plan-independent-webui/inventory.md)，进度见 [tasks](../../openspec/changes/plan-independent-webui/tasks.md)。**完成的是消费盘点，不是新 WebUI、公开 SDK 或跨 Session 浏览的产品验收。**

## 对象、环境与方法

- 成功 fetch 后的源码基线：`cc1cdd8aead42cd0afe018c75973f09fd369184d`；本轮从文档分支 `pakka/webui-design-principles@bb3f7c7a8ae9badad94dc1ea28d767b08f43e3d3` 开始，产品源码/依赖与 dev 相同。
- 需求/候选参考：`pakka/history-book@170aa153e7dad0cda8f6172665d709407dfa703a`；已知 Dynamite/EI checkout 与参考 revision 单列在 inventory。参考能力未被算入 dev，也没有修改其他工作树。
- Windows PowerShell 7、Node `24.18.0`、TypeScript `7.0.2`、OpenSpec `1.9.0`；使用实际安装的 ast-grep NAPI、生产源码及 package/manifest。临时探针位于忽略的 `docs/.temp/investigations/webui-repo-split/phase-0/`。
- 结构化枚举覆盖 587 个源码文件、十个 workspace、37 个 exports、32 个浏览器 JS 模块、44 个静态文件；JSON manifest 与生成 manifest/build 分开核对。阅读实际 HTTP 分发、客户端校验、资产装配、权限/operation、资源来源/Session 路由、facets、默认 contributions 和所选业务插件入口。
- 源码 import 枚举与编译后 JS/声明图分别检查。后者通过声明的 workspace-entry 映射和 `tsc --noCheck` 投影：**未做语义类型检查、真实 package resolution、外部依赖声明遍历、安装或执行**，不能称为通过了独立安装闭包。

## 实际结果与限制

- 当前源码解析没有未分类错误，37 个出口都有源入口；JS/声明图投影没有未解析的本仓相对边。初轮 grammar 把七处 `export type *` 标为 ERROR，已识别并单列该语法，结合 TypeScript 的真实输出核对；没有把 parser 限制写成产品错误或忽略未解释项。
- 当前服务面有九类 HTTP 入口加固定静态 Map；主 RPC 48 个命令、extension RPC 7 个、待退役私有 models RPC 13 个。主协议、旧认证、预算、外部 ingress、SharedWorker/ServiceWorker、下载及动态插件资产都已分配归属。
- 导入图与 package 声明证明模块职责已部分分开，但 `@pakka/webui` 的安装声明仍包含 Node 产品/服务依赖，protocol/client 仍为 private 制品；不能从 browser 子入口推导可独立安装。
- 源码核对发现资产 query 丢失完整 Session 身份、public reconnect 的单 Session 限制、未加载原历史缺少公开读取接缝、控制接口未区分 facet、默认启动未注入独立前端产物。详情及后续责任见 inventory；**本轮未运行故障复现或修复它们**。
- 已固定普通 GUI-only、RSI 读取/编辑、两个独立 Session 内同号 Conversation、模型/Thinking/参数编辑的后续真实切片。现有真实 fixture 是样例生成依据，不是本轮已经创建新数据库或跑过新 UI 的证据。
- 已核对相关旧任务，把仍需功能、旧实现清理、后端/性能待办和 Memo/RSI/MAS 领域演进分开。没有因为旧测试已通过或旧候选受阻而倒写新产品结论。

## 文档与产物检查

- 完整候选范围为 29 个 Markdown/YAML 文档（包含本轮新增文件）；源码、依赖、测试和二进制不在 diff 中。大文件是人工整理的职责/消费清单，不是原始依赖树、控制台输出或逐文件证据清单。
- 27 份候选 Markdown 加 3 份本地规划，共 30 份文档的 354 处本地链接、37 处锚点和 Prettier 检查通过。此链接检查不访问外部 URL；固定来源另行读取/核对。
- 主动 LSP 覆盖 27 份候选 Markdown，无 error/warning，unsupported/unavailable/failed/inconclusive 均为 0；归档后的摘要与尾改文件另行复检。
- `openspec validate plan-independent-webui --strict --no-interactive --json` 通过。`instructions apply` 为 8/28 完成：3 项规划与 5 项阶段 0；剩余 20 项阶段 1–5 仍未完成，不归档为产品已实现。
- `git diff --check` 通过；交付前再次 fetch，`origin/dev` 仍为上述固定基线。提交与 PR 检查覆盖完整 dev-base 范围，不只检查最后一笔文档提交。

本轮仅交付文档/规范及本地调查证据；没有修改产品代码、package/lock、vendor 或测试，没有构建/启动产品、运行模型/浏览器/安装验收或新增永久测试，也未委派调查/review。动态能力验证留给阶段 1–2，少测试政策不降低既有权限、持久化、原请求和 unknown 边界。

## 本地证据保全

- 包：`independent-webui-phase-0.tar.gz`；字节：`1196102`。
- SHA-256：`a2df12d19cc3f376fe777556d8a9027115611124e53d77c616f211f765d89959`。
- 目录：`D:/Projects/pakka-works/.backups/2026-11-14T07-45-26-123Z-independent-webui-phase-0`；该新目录仅授予 Administrators/SYSTEM，提供恢复 README，不改动旧备份。
- 已列出归档、实际解压并逐项核对 330 个文件的大小/SHA-256，随后再次从最终归档字节计算整体 hash；没有借用上一轮包身份。

原始枚举、源码/声明图、命令/日志与完整逐文件 hash 留在本地，不提交 Git、不上传 GitHub。最终摘要不作为独立 repo 输入放入引用自己的证据包；审阅 diff 保留归档前的摘要草稿。补入包身份后另行检查格式、链接和 LSP。
