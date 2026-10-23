# 形成条件与采用设计

## 用户要求与已有约定

用户要求：先发布已有 main 改动，在新 worktree 制作最新 Pi Durable 的 patch；verification 在开发中可选，跳过只记录一次。

AGENTS 要求下游源补丁具备精确基线、可复现构建、回归与追加式兼容记录。生产代码继续通过公开 Pi SDK 接入；installed dependency 不手改。

## 发布来源

2026-10-22T16:24:44Z 查询 npm registry latest 为 1.4.0；npm 发布时间为 2026-10-21T22:44:09.320Z。GitHub 对应 [v1.4.0 release](https://github.com/earendil-works/pi/releases/tag/v1.4.0)，源码 tag commit 为 `4a080252f06caf63a525d7873c5d94d3c23887e0`。registry integrity 与完整构建选择保存在 [baseline](../../../patches/pi-durable/1.4.0-pakka.1/baseline.json)。

1.4.0 的公开 beforeRequest 仍是 messages replacement。旧 source.patch 原样移植因 request context 和 recovery import 变化失败；需要重建对应源码差异，而不是改 installed dist。

## 补丁范围与选择

采用原有明确 block 与 attempt 级同步 checks 的契约。普通 hook throw 仍按上游 report-and-continue；权限拒绝通过结构化 block/check 表达。检查发生在 hooks 链结束以及原有 onPayload 完成后，适配 1.4.0 的 request context 与 telemetry 参数。

block 的结算调用原生 endRun/transaction，输入记录、inbox、idle 与下一次工作继续由 Durable 管理。generation 终态增加 `{ blocked }`，checkpoint 结构保持上游版本。恢复重新解析 hooks/checks；既有 partial 的原生恢复转换仍适用。

新 patch 同步公开类型、README 与上游规范摘述，并携带回归。编译使用公开的同版本依赖；JSONC 配置由锁定 parser 解析。多版本入口默认仍选择现有生产补丁，新版本显式选择。

## 实际实验与依据强度

- 未打补丁 1.4.0：六项目标 source 回归失败。恢复 fixture 始终关闭自有 Harness，排除了红测后 SQLite 未关闭导致的清理噪声。
- 未打补丁的真实 loopback HTTP 对照：block 被当成错误形状，结算为 faulted；payload 撤权后仍完成请求；普通 hook 异常正常 report/continue。
- 新补丁：5 个测试文件、113 项 source 回归通过；独立 npm 安装归档后，3 项真实 HTTP 回归通过。此结果支持所列请求拒绝、恢复与消费入口，不等于 Pakka 全产品已切换 cohort。
- 构建/完整性脚本的版本选择、独立篡改拒绝、默认生产版本及非法路径由 4 项工具回归检查。
- 当前生产 cohort 下，Pakka Durable 集成与工具回归共 13 项通过，workspace build/check 通过。
- 同一输入的重复构建与旧版本重建身份记入[兼容账本](../../../docs/PI-DURABLE-COMPATIBILITY.md)，具体归档身份由 artifact.json 维护。

## Pakka 接入影响

先前复用旧安装/lock 的探针混有 1.0.3 与 1.4.0，其 context/model 类型噪声不作为纯新 cohort 的结论。随后更新全部 workspace 声明，从新 lock 进行 npm ci，并以 npm ls 确认依赖树有效。

干净 1.4.0 cohort 的 protocol 编译通过，agent 初次编译有 10 个错误。在诊断副本的五处 document 定义中仅补入 checkpointWhen 后，错误减少为 4 个：StorageRejected 已移除、两处 runtime.sleep 已移除、tool result 的 content/新 output 契约不同。document-family 的调用报错随定义修正消失，是派生错误，不另判为 API 调用差异。诊断中的 () => false 只用于辨认编译原因，生产 checkpoint 策略由后续接入设计确定。SQLite 上游已引入 schema 2，升级/回退处置也属于该设计。

因此本轮采用“先制备独立补丁，接入单独迁移”，而非仅替换版本号。生产依赖保持 1.0.3-pakka.1；Dynamite 精确配对维持已记录版本。后续工作见 tasks 的接入段。

## Verification 的文档调整

此前 delivery 和 WebUI 方法将整套流程表述为所有任务的必需门禁，与本次用户决定不同。当前 state 明确选用关系；方法页描述被选流程的执行条件，任务记录本轮范围。已存在的具体测试结果仍归属于其原版本。

verification 历史目录的删除方案仍由[文档整理任务](../streamline-verification-and-patch-state/tasks.md#4-待决定的后续方案)承接，本轮不把这个决定扩展成批量历史清理。
