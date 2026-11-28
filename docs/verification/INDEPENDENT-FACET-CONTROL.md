# 独立 facet 控制与阶段 1 收口

## 对象与结论

2026-11-16，以 Pakka `8207aa8` 与 pakka-webui `70e3865` 为输入基线，在两仓 `pakka/independent-webui-seams` 工作分支补齐 Backend、Agent、WebUI、Client 的独立生命周期。用户要求先完成阶段 1 验收，再进入阶段 2；本记录绑定阶段 1 接缝及实际消费者，不代表完整应用、默认交付、发布或合并。

逐 facet 注册具有独立 version/generation/phase；业务调用、资产与控制各使用对应身份。Agent 使用公开 pi-durable Registry 在可信批准的 profiles 中发布；UI publication 管理自己的实例集合。停用不删除业务历史或取消已接纳工作，unknown 初始化与清理失败不报告成功。Backend 停用仍保留经权限过滤的命令声明，防止 slash 命令成为模型消息。

显式配对为 **services 3 / extensions 3 / workbench 2**。Node 资产加载器从协议包常量核对版本；UI SDK 为 `api: 1`，renderer 组合独立核对。最终共享 runtime manifest SHA-256 为 `68a20cebe750e6d58b7782d90fd0513835eb22854572933dbf025120259066a1`；最终源码重建与安装消费的 manifest 字节一致。

## 方法与实际结果

环境为 Windows x64、Node 24.18.0、npm 11.16.0、TypeScript 7.0.2。自动检查使用隔离数据与本地确定性 provider，不读取用户模型凭据或调用付费模型。主会话核对源码与实际结果，没有委派审查。

| 检查               | 实际结果及边界                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 原生 Agent         | 真实 Runtime/HTTP 模型请求和工具效果验证批准 profile、工具/指令撤回、在途结果、重开 ceiling。与原 context 权限回归合计 14 项通过。旧调用不会因重新启用而恢复资格。                                                 |
| 四类 facet 的 HTTP | 分别启停/重载与 generation、错 Person/权限/旧 generation、丢响应原控制回执、原 Backend 写入回执及在途 native 工作通过。Backend 异步初始化产生真实 HTTP 效果后超时，健康 UI 仍可用；writer 重开不重入该未知初始化。 |
| 清理故障           | Agent 撤回失败后二次 close 保留失败结果。WebUI 同 publication 多实例各清理一次，失败保持可见，旧实例重复清理不会移除同名新实例。故障注入的失败与修正后结果均保留。                                                 |
| 独立 browser 消费  | 公开 protocol/client 与纯 UI SDK 的 headless/GUI 安装、严格类型检查及浏览器 bundle 通过；未安装后端实现，没有 sibling 源码或根 overrides。                                                                         |
| 安装 Node 产品     | 固定八个 Pakka 归档安装后，从真实 startPocket 入口提供前端和受权控制；接受 3/3 配对、拒绝旧配对。新增 Agent 公共入口严格检查通过，完整 Node 依赖声明限制另列。                                                     |
| 真实浏览器         | Ego 在本轮独占 127.x.x.x origin 上完成真实登录、Cookie/CSRF 与同源控制，无需创建/切换 profile 或升级 Ego Lite。Client/Backend 停用后三个 UI 实例存活；原写入可按原请求查询。                                       |
| UI publication     | native modal Dialog 接管焦点；停用所属 UI 后两个实例、Dialog/portal/监听/计时器清理，焦点到启用入口，另一 publication 存活。重启新 generation 后最终四个实例各清理一次，旧结果拒绝；无 CSP 违规、无晚到 notice。   |
| 浏览器结束         | task space 已关闭且无保留标签；安装服务正常关闭，native Agent bindings 为 0。整个该浏览器探针模型请求为 0；Agent 功能另由真实本地 provider 检查。                                                                  |
| 类型与构建         | 两仓 npm run check/build 通过。主动 LSP 检查未报告 TypeScript error；durable-adapter 超过工具 5000 行上限，由全量 tsc 覆盖。辅助静态风格建议未批量改动，未新增类型抑制。                                           |

实际检查入口包括 `node docs/.temp/facet-control/run-final-regressions.mjs`、短目录维护 wrapper、公开安装消费者、`ego-round-08.mjs` / `ego-round-09.mjs`、`verify-lifecycle.mjs` 和 `check-final-pair.mjs`。本地包保留脚本、执行日志、候选/安装制品及原始失败；临时路径不是安装前提。

## 最终回归与保留失败

最终 release 选择的 **333 个文件、984 项：981 pass、0 fail、3 skip、0 cancelled**，没有待运行文件，workers 已关闭。另两个维护文件在短目录中 **13/13 通过**；合计覆盖 335 个 release 文件、997 项，994 pass、3 skip。三项跳过位于 `apps/server/test/pocket-browser.test.ts`（2 个 POSIX CDP fixture）和 `packages/agent/test/execution-shell.test.ts`（固定 `C:/Program Files/PowerShell/7/pwsh.exe` 路径不可用），不计作通过。原始分轮结果均保留。

原 335 文件扩大回归在等待旧样式请求时停止，保持 incomplete；原 Windows 长路径 ACL 失败和旧消费者故障保持原结果。随后修复了真实消费者接线：WebUI 资产使用 WebUI generation，Backend 调用使用 Backend generation；更新控制签名、版本配对与默认命令发现。没有恢复旧整包控制 facade，也没有把失败统一解释为 renderer 不兼容。

两个维护文件在短隔离 HOME/TEMP 中 13 项通过；未改 Windows ACL helper 或权限规则。完整安装 Node 产品仍有既有的 **43 条上游声明错误**，与上一候选输出逐字一致；仅加载上游 ModelRuntime 的原对照及问题说明见[只读历史记录](READONLY-SQLITE-HISTORY.md#扩大回归与保留失败)。新增 Agent 入口和 browser 消费严格检查均通过；完整 Node 声明检查仍记失败，未使用 skipLibCheck 掩盖。

首次浏览器回执探针错误地查询普通 read 的持久回执，实际接口按其契约拒绝；保留该探针失败，改为一次真实 settings 写入后在全新隔离数据上复验。验证没有为了让探针通过而改变普通 read 的持久化语义。

新增持久测试仅为两个原先没有的外部边界：Agent 的原生批准/撤回与在途工作，facet 的受权 HTTP/持久控制/未知初始化。两文件均归重型，affected runtime/webui 选择按实际依赖维护。其余复用原 client、资产、原请求、权限、RSI/MAS 与浏览器回归；UI 私有 DOM/布局没有新增长期测试。

## 交付与剩余范围

使用方式见[服务手册](../reference/WEBUI-SERVICES.md)，采用过程和新增场景见[facet 设计](../../openspec/changes/plan-independent-webui/facets.md)及[场景](../../openspec/changes/plan-independent-webui/specs/extension-facet-control/spec.md)。阶段状态由 [tasks](../../openspec/changes/plan-independent-webui/tasks.md)维护。

本轮完成的是阶段 1 的独立生命周期与安装消费接缝。临时浏览器宿主和 entry:null 的共享 runtime 不代替阶段 2 应用；应用壳层/registry、RSI 业务切片、模型双入口/参数编辑和跨 Session 历史界面仍需真实产品验证。Provider /login、默认入口切换、发包和合并继续各自的范围与授权。

## 本地证据保全

`pakka-independent-facet-evidence.zip`，**18464592 字节**，整体 SHA-256：

```text
e05bcd2da8d9ef8e00f9d45a452b314b7ac9318a85b2f07da340a68ef3866902
```

保全目录为工作区 `.backups/facet-control-ac47d620-0aba-4cbc-aee8-e134b89cfabd/`；仅当前用户、SYSTEM 与本机 Administrators 可访问。1348 个成员逐项核对大小和内容 hash，含固定候选/制品、实际检查脚本/日志、原始失败与修正后结果；数据库与凭据未混入证据包。15 个相关文档主动 LSP 无诊断，OpenSpec strict、格式与链接检查通过；原兼容性账本的三处历史链接保留已有迁移映射。

只提交本记录与整体 hash；原始证据、安装清单和包本体不进入 Git 或 GitHub 附件。
