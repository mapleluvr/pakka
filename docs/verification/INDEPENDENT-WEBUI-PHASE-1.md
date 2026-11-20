# 独立 WebUI 阶段 1：接缝验证

## 候选与范围

- 后端实施基线：`dev@cc1cdd8aead42cd0afe018c75973f09fd369184d` 加阶段 0 文档 `29cb207`；工作分支 `pakka/independent-webui-seams`，含 PR #13 尚未合并的规划文档。
- 前端实施基线：`pakka-webui@0ee6bdc`，同名工作分支。两仓代码、锁与本地检查对象的具体清单保存在证据包中。
- Windows / Node 24.18.0 / npm 11.16.0 / TypeScript 7.0.2 / OpenSpec 1.9.0；React/ReactDOM 19.3.1，Astryx Core/Neutral 0.7.15，StyleX 0.19.2。后端继续使用固定公开 Pi SDK；未构造 Coding Agent `AgentSession`。
- 验证由主会话执行：源码检查、隔离真实 HTTP、仓库外安装及 Ego 浏览器。没有委派调查或 review，没有用户凭据访问或付费推理。

本文验证的是可独立消费的开发接缝；不是整个阶段 1、完整应用、真实业务插件或默认发行验收。阶段任务见 [tasks](../../openspec/changes/plan-independent-webui/tasks.md)，接口见 [WEBUI-SERVICES](../reference/WEBUI-SERVICES.md)，前端用法见 [UI SDK](https://github.com/mapleluvr/pakka-webui/blob/pakka/independent-webui-seams/docs/development/UI-SDK.md)。

## 固定开发制品

三个包均为 private、尚未发布；相同版本号不能代替以下开发归档身份：

| 开发包                      | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `pakka-protocol-0.1.0.tgz`  | `5a5e86a7163245db3608fc68a890a01fc0c52dac8801f4ca52bed515dae2bf8a` |
| `pakka-client-0.1.0.tgz`    | `567d043d1282539d03d0e53e87f63c0027c6250b4e2b41888e9bc5000fbdcf7a` |
| `pakka-webui-sdk-0.1.0.tgz` | `4a5225161223c5c2bbecee719988b3b03882210becc724f8dba07b9e0cedb03c` |

共享 runtime manifest SHA-256 为 `17e8762dfcbe48439a53c190d05b3f710e9e33ecdb7555e706986bb18c8feb11`：210 个模块映射、634 个内容核对文件、3 份静态 CSS，`entry:null`、`workers:[]`。真实浏览器候选另外加入 HTML 与探针宿主；这不把 runtime 自身变成完整应用。

## 实际检查与结果

| 边界             | 方法与结果                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 生产源码         | 后端 `npm run check`、`npm run build` 通过；前端独立 `check/build` 通过。                                                                                                                                                                                                                                                                                    |
| 选定回归         | 核心集合加 protocol/client、extension HTTP/host、模型/装配/恢复、RSI transport 与 MAS DevPack 接缝，共 68 文件、169 测试全部通过，无 skipped/cancelled。最终 run-zLKbtR 用时 121.43 秒；worker Node 最大 RSS 327,815,168 字节，不是整个进程树总峰值。未宣称全 release 或全部旧浏览器回归通过。                                                               |
| 干净安装         | 两个仓库外消费者仅安装声明的 tgz/依赖，以 `skipLibCheck:false` 核对公开类型并运行浏览器构建。GUI-only 不安装 Pakka 服务/后端；headless client 不安装 renderer、Agent、Server、Coding Agent。插件共享依赖全部 external，没有把第二份 React/SDK/Astryx 复制进插件。结论限定于这两个消费者。                                                                    |
| 独立前端         | 从无 node_modules 的源码副本运行 `npm ci --ignore-scripts`、`npm run check`、`npm run build`；没有 sibling import、根 overrides、借用 node_modules 或后端编译，生成相同 manifest 字节。源码副本包含当时文档，后续仅文档示例/记录修订单独检查。                                                                                                               |
| 真实服务 client  | 安装版客户端经真实 `/pakka-webui` HTTP 面访问两个已加载 Session，解析实际 Conversation；`reconnect()` 保留各条目的 Session，资产地址包含完整稳定引用，错误 Person 被拒绝。未知/未加载历史仍报告 unsupported。                                                                                                                                                |
| 实例配置与默认值 | 真实 HTTP 写入原生 models.json、校验身份/CSRF/版本、保留注释和隐藏值、保存后独立报告重载。Person 默认只影响本人后续缺省创建，不改已有 Conversation、其他 Person 或原生全局默认；原意图 lookup 不因默认变化而生成新工作。                                                                                                                                     |
| 脱敏与原生数据   | 先以公开 ModelRuntime 重现：配置快照隐藏的 compat header 曾从目录泄露。真实 HTTP 回归修正前失败、修正后通过。原生文件使用公开 JSONC AST evaluator 保留 null-prototype 数据与私有 header 键；脱敏后才执行原有有界公开 decoder。目录仍 ready、非秘密 compat 保留，参数写入不删隐藏值；没有放宽 wire 校验。Native validation 接受字段不证明该字段实际参与请求。 |
| 丢响应恢复       | 安装版 client 接到真实反向代理：两次上游写入已完成并返回 200 后，代理切断下游 socket。client 报 unknown；仅用原 request/intent lookup 找回配置及 Person 默认回执，产品重开后仍可核对。只转发两次写入，未重提。                                                                                                                                               |
| 固定 Node 资产   | 通过真实 `startPocket({frontend})` 提供已核对字节；manifest digest/服务组合在打开 Session 前检查，内容篡改、路径逃逸、服务遮蔽等被拒绝，加载后的磁盘变化不替换内存快照。                                                                                                                                                                                     |
| 浏览器共享 UI    | 同一 React、SDK context、Astryx context 下实际点击把按钮更新为 Count 1；portal 使用 neutral 主题。Dialog 成为原生 modal 并接管焦点，Escape 关闭后焦点回到触发按钮。实例关闭后 portal/Dialog 移除、清理一次、signal aborted，旧 UI context 调用被拒绝。                                                                                                       |
| CSP 与网络       | 初次未构建 Theme 被现有 CSP 拦截。改用上游 Neutral built + 静态 theme.css 后，观察到零 CSP 违规、零外部资源请求；没有 unsafe-inline 或伪造 built 标记。浏览器空间消失后获用户批准建立新空间；未升级 Ego Lite。                                                                                                                                               |
| 文档示例         | 在隔离 GUI 安装中实际编译 UI-SDK 的 TSX。发现并修正 Astryx Button 必填 label，最终类型检查通过；没有为文档造组件兼容包装。                                                                                                                                                                                                                                   |

各模型配置、代理与浏览器探针的模型推理请求均为 0。零请求只支持这些场景没有触发推理，不替代交互结果、权限或回执证明；本轮没有验证云端 provider 兼容性、模型质量或实际 tool calling。

## 测试选择与诊断

新增一个 `webui-services.test.ts`，保留两个实服务场景：配置身份/秘密/原回执，以及 Person 默认与创建原意图。新增目录断言归并到前者，捕获泄露和私有原生数据被公共编码过早拒绝两类实际缺陷；没有 DOM/CSS/私有 props 测试。该文件启动真实 Runtime、SQLite 和 ModelRuntime，维持 heavy 分类；选定 protocol/client 轻型池可有限并行，其余按现有 runner 隔离/串行执行。

主动 LSP/源分析与两仓 tsc 分别检查。已有 LSP 项目缓存异常经独立进程复核，不使用 ts-ignore 或私有导入。字典字符串排序、短读 cursor、复制后 reverse 等经源码核对为规则误报；局部脱敏 traversal 的 unknown 输出在返回前立即被 decoder 解析，也是规则误报。标记仅在会话中生效。最终主动检查覆盖 47 个改动源码文件，无 LSP 类型诊断；辅助规则仍有 141 条既有/风格发现，包括 MAS 三处已有安全注释缺失，完整 diff 核对确认本轮只换其 import。另有 10 条已处置发现被过滤，不把过滤后结果或类型通过称为所有静态规则 clean；不扩成既有 lint 重构。

## 尚未完成

- 3.2：未加载原 Session 缺公开只读历史来源，独立 Backend/Agent/WebUI/Client facet 控制未形成。固定 Durable SQLite 初始化会写入；不私读 schema、不自动 reopen writer、不返回假成功。
- 完整 UI host/registry、Pakka 应用接入、真实新 SDK RSI 读取/编辑插件、跨 Session 原历史浏览以及模型/Thinking 双入口和触控参数页，继续由后续任务推进。
- runtime 元数据拒绝仅证明前置兼容检查原语；没有宣称标准插件发现/加载流程已验收。
- Provider `/login`、完整 worker/缓存更新、默认切换、npm 发布、分支合并均未执行。

## 本地证据保全

本地完整证据包：`pakka-webui-phase-1-evidence.zip`，1881349 字节，SHA-256 `c2d710edde0bd38de65811163e009f96d23d64b0b9fb0719f5dec2fa75e35fa3`。原始日志、截图、依赖树、逐文件清单和包本体均不提交或上传 GitHub。身份 hash 只证明归档字节；结果仍以包内实际命令、退出状态与原始记录为依据。
