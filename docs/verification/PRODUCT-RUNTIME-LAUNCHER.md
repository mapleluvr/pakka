# Pi 原生配置与 pakka → WebUI 交付核对

日期：2026-11-07。范围：[变更](../changes/product-runtime-and-launcher.md)及[任务](../../openspec/changes/enable-product-runtime-and-launcher/tasks.md)。本记录只证明下面的固定候选与实际执行，不表示全部历史限制已解除。

## 1. 候选身份

- 工作树：`pakka-webui-launcher`；分支：`feat/webui-launcher`；基线 HEAD：`90fdf9594fef084c5be4011ff662814204b13de5`。
- 运行时是未提交修改后的候选，**不是单凭上述 HEAD 可重建的原提交**。未提交、推送或合入 main；主仓及 ExecutionEnv 工作树未被本次修改。
- [源码清单](evidence/product-runtime-launcher/source-manifest.json)覆盖 559 个 Git 可见的产品、测试、脚本、集成、补丁及根 JSON 文件，含未跟踪源码，不含 docs/ 目录、根级 Markdown、node_modules 与生成输出。汇总 SHA-256：`804c7ff7e3a03a72b9244d51246e2afe8b50a69597b9a64e1cba5f07c2026d95`。
- Windows x64、Node `24.15.0`、npm `11.12.1`、PowerShell `7.6.9`；测试 Chrome 的版本观察值为 `157.0.8103.38`。Pi AI/Coding Agent `1.4.0`，Durable `1.4.0-pakka.2`。详细信息见[环境](evidence/product-runtime-launcher/environment.json)。
- 八个实际安装归档的路径、长度与 SHA-256，以及各消费步骤，见[包清单](evidence/product-runtime-launcher/package-manifest.json)。不能把包版本号当成这批开发归档的唯一身份。

## 2. 已覆盖的产品路径

| 路径             | 实际核对                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pakka → WebUI`  | 仓库外安装生成的 shell shim 经 pwsh 启动；无宿主 JSON、无已选模型可打开资产和管理入口。登录后正常停止，在不同 cwd 再启动仍重开原工作区/Session；owner token 不打印、不重新签发。原 `--connection` 协议 CLI 继续通过。        |
| 原生模型与认证   | 公开 `ModelRuntime`/`Models` 接入，跨 provider、真实 metadata、分页检索及实际本地请求中的 high thinking；未选模型可管理。API key/受控 OAuth 回调按 Pi 原格式保存，当前登录及撤权约束有效；密钥不进入页面持久存储或 Session。 |
| 配置、预算及恢复 | 新增未使用 profile 可重开；预算调整保留消费、CAS 与审计，旧 bootstrap 不覆盖管理修改。普通 401/503 后明确新输入可继续；真实 SQLite 未确认写入仍封闭。v1/v2 升级保留原身份与消费。                                            |
| Session 隔离     | 缺失、损坏或身份不符的已登记子 Session 不阻塞健康项；只允许显式重开原身份。不抢活跃 writer、不清锁、不补建替代库；打开期间撤权会关闭新取得的 writer，客户端拒绝异属 Session 响应。                                           |
| 本地执行与资源   | 默认 read/write/edit/平台 shell 产生实际文件效果；只读预设拒绝写入和命令。正向环境列表不继承测试模型密钥。Pi 本地 instructions 和 skills/templates 索引随 cwd 更新；不自动安装包、执行扩展/MCP 或展开模板正文。              |
| GUI              | 模型设置/分页选择、thinking、预算/冲突/原请求核对、Session 恢复、工具预设和窄屏实际浏览器回归。普通斜杠文本发送；已注册命令的参数错误、停用或执行拒绝保留草稿，不回退为模型输入。                                            |

模型/provider 配置与 Agent 工具预设分开；旧单-provider JSON 只保留为显式兼容入口。Pakka 没有引入另一个首次使用 wizard，也没有借用 Coding Agent 的 `AgentSession` 执行引擎。

## 3. 执行结果

| 检查             | 结果/证据                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 标准构建         | `npm run smoke:package` 先执行完整 build，退出成功；见[包总日志](evidence/product-runtime-launcher/package.log)。                                                                                                                                                                                                                                |
| 标准类型检查     | `npm run check` 通过；见[check](evidence/product-runtime-launcher/check.log)。独立安装的严格 Node/browser 声明检查通过，没有用 `skipLibCheck` 掩盖依赖缺失。                                                                                                                                                                                     |
| 完整自动回归     | 805 项，803 通过、0 失败、2 项原有平台跳过；见[摘要](evidence/product-runtime-launcher/full-summary.json)、[原始日志](evidence/product-runtime-launcher/full.log)、[详细 TAP](evidence/product-runtime-launcher/full.tap)。执行前后源码汇总均相同。                                                                                              |
| 格式检查         | 全仓检查报告 16 个未改动的基线文件；与 HEAD 的逐文件 diff 为空，Prettier 仍为 3.6.2。本次 97 个改动源码文件检查通过；见 [完整输出](evidence/product-runtime-launcher/format-all.log)、[基线核对](evidence/product-runtime-launcher/format-baseline.json)和[改动范围](evidence/product-runtime-launcher/format-changed.log)。未改写历史配对文件。 |
| 完整安装消费     | 8 个归档、33 个打包/安装/检查步骤均成功。独立 headless 消费没有 WebUI/Preact/Coding Agent；完整 WebUI 消费允许公开配置加载器，但 agent SDK 不引入 Coding Agent。实际 shell、执行、MAS/Broker、扩展、通知、定时任务、Memory、Webhook、voice 与重开均有各自回执/效果断言。                                                                         |
| 浏览器辅助器复验 | 受控流式文档先失败，修正后相关 14 项通过；分组菜单连续 8 轮、每轮 2 项通过。记录在 [RED](evidence/product-runtime-launcher/browser-reload-red.log)、[GREEN](evidence/product-runtime-launcher/browser-infrastructure-green.log)及 `evidence/product-runtime-launcher/repeats/`。                                                                 |
| 配置损坏补充探针 | 保留旧默认模型而损坏 models.json，新启动及原 Session 重开均能管理，2/2，模型请求为 0。见[日志](evidence/product-runtime-launcher/model-loss-probe.log)和[探针原字节](evidence/product-runtime-launcher/model-loss-probe.source.txt)；原运行路径为 `docs/.temp/model-loss-probe.test.ts`。                                                        |

最后的辅助器主动 LSP 检查有 2 个文件确认无诊断、5 个检查超时，不能将其称为 7 个 clean；标准类型检查及上述实际回归另行通过。文档中与仓库 `useTabs: true` 冲突的旧 fenced-code 提示不作为类型错误处理。

## 4. 失败没有改写成通过

- 早期完整回归暴露过旧固定配置断言、SQLite 测试对 JSONL 的错误假设和 Windows 数据库占用；相应测试改用公开 Storage API/真实写锁，并保留原 unknown/原子性/禁止重放边界。
- Windows 动态端口曾命中 Fetch 禁用端口；HTTP listener 和测试 CDP 分配改为有限安全选择。浏览器进程停止与系统占用的 profile 清理分别记录，没有全局杀进程或强删占用文件。
- 较早候选全量 801 项通过 799、失败 0、跳过 2，不能替代最终候选；后续一次全量记录为 796/792 pass/2 fail/2 skip，其中历史面板文件进程失败，报告没有列出其全部子测试。两份[历史日志](evidence/product-runtime-launcher/history/)保留原结果，不套用最终源码摘要。
- 分组菜单失败已确认是测试辅助器在 reload 命令确认后继续读取旧文档；受控分块 HTML 可稳定复现。现在等待同一主 frame 的新 loaderId 发出 DOMContentLoaded，并等待实际侧栏元素。历史面板异常退出单独复验 9 项通过，未据此宣称已找到其根因；最终全量另行给出结果。
- 安装消费曾发现旧异步回执类型用法、Google SDK 声明缺 MCP 类型依赖、旧断言一概禁止 Coding Agent、定时任务消费者把内部状态当成显示文案。各自修正后重跑完整安装消费，未修改已安装依赖。一次冷安装达到旧 180 秒上限不是业务成功；当前安装有独立 600 秒上限，本轮两次安装分别实际用时 118567/106093 ms，均正常退出。

## 5. 保留边界与未覆盖事项

单 writer、原 Session/Conversation 身份、实时授权、已消费预算、原请求幂等及 unknown 不自动重放继续生效。本地工具具有当前 OS 用户的文件/网络能力，环境变量清理不是沙箱。`--recover` 只处理原 Session 打开，不是清锁或本机管理员重新签发登录凭据。

长上下文/受控重试、附件、长期容量治理仍在所属 tasks；独立本机管理员重新登录恢复由[既有设计任务](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)承接。这些不因入口交付而算作完成。

本轮选择构建、类型、自动/本地浏览器回归和仓库外安装消费。没有调用付费模型或读取用户真实模型凭据；没有选用新的独立对抗评审、独立桌面 GUI 验收、真实 OAuth 服务全流程或全平台检查。Windows/pwsh 的执行结果不能外推为 bash/macOS 已实际验证。

## 6. 保全与复查

- [证据清单](evidence/product-runtime-launcher/manifest.json)列出保留文件的原始字节哈希。日志/源码清单不替代实际断言，也不是签名证明。
- 原消费者路径保留为执行身份；八个归档另已按原 hash 复制到本机忽略目录 `artifacts/product-runtime-launcher/archives/`，附消费者 package/lock；见[保全清单](evidence/product-runtime-launcher/archive-retention.json)。没有把依赖树、数据库、owner 链接或模型凭据放入 Git 证据目录。
- 工作树内可执行下面的只读核对；它会拒绝范围内新增、缺失或改变的源码。后续提交号不能倒写为此次构建身份。

```sh
node docs/verification/evidence/product-runtime-launcher/check-source.mjs
npm run check
npm test
npm run smoke:package
```

日常安装、入口与安全说明见[WebUI 使用指南](../guides/WEBUI-GUIDE.md)。
