# Pi Durable 下游源补丁

## 产物与组成

Pakka 维护 Pi Durable `1.0.3-pakka.1` 的源补丁与可安装归档。补丁为 generation 提供明确的策略拒绝及请求级检查，作为 `@pakka/agent` 的生产依赖参与交付。

| 组成     | 当前身份与职责                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游基线 | Pi `v1.0.3`，commit `d78dc83d633229d12f8b79631384c4c2717c399f`；机器可读身份在 [baseline.json](../../patches/pi-durable/1.0.3-pakka.1/baseline.json) |
| 源补丁   | [source.patch](../../patches/pi-durable/1.0.3-pakka.1/source.patch)，修改 generation 实现、公开 hook 类型与说明，并携带 generation/recovery 回归     |
| 构建输入 | [build-lock.json](../../patches/pi-durable/1.0.3-pakka.1/build-lock.json)，固定隔离构建所用依赖                                                      |
| 安装归档 | [earendil-works-pi-durable-1.0.3-pakka.1.tgz](../../packages/agent/vendor/earendil-works-pi-durable-1.0.3-pakka.1.tgz)                               |
| 身份清单 | [artifact.json](../../patches/pi-durable/1.0.3-pakka.1/artifact.json)，记录上游/下游版本、基线 commit，以及源补丁、构建锁和归档的 SHA-256            |

## 生成拒绝与请求检查

`GenerationHooks.beforeRequest` 为当前请求返回以下两种结果之一，也可返回 `undefined`：

- `{ block: string }` 明确拒绝当前 generation。首个 block 生效，空字符串也是有效理由，后续 beforeRequest hooks 跳过执行。
- `{ messages, check? }` 提供请求消息及可选的同步检查。请求获准继续时，所收集的 checks 在 hooks 完成后执行，并在 provider 的 `onPayload` 边界再次执行；既有 onPayload 回调链先完成，再执行检查。

block 或 check 拒绝通过同一个事务结算本 run 已 placement 的输入：submission 为 `unanswered`、`reason: "blocked"`、`detail` 为拒绝理由，generation 以 `{ blocked: reason }` 完成。已接纳输入的提交保留，Conversation 可继续接收下一次获准工作；拒绝结果由上述输入结算与 generation 终态表达。

checks 具有请求/attempt 作用域，保存在执行中的回调链。恢复执行重新解析并运行 hooks，取得当时有效的检查。已经落盘的 blocked settlement 与终结 generation 在 SQLite 重开后仍可读取。

普通扩展异常沿 Durable 的 report-and-skip 路径处理；策略拒绝由 block 或 check 表达。取消及独立的模型/存储异常沿各自的任务与失败契约处理。[Runtime](runtime.md) 维护 Host、authority 与 unknown 的跨模块关系。

Pakka 的该接入配置采用 OpenAI-completions 路径，重试与自动压缩处于关闭状态。辅助 inference 使用各自的 allowlist、预算及 pre-payload source guard。

## 构建与使用

构建入口为 `npm run build:durable-patch -- <upstream-checkout>`，由 [构建脚本](../../scripts/build-durable-patch.mjs)执行：

1. 核对提供的 checkout HEAD 与基线 commit。
2. 从该 commit 导出已提交源码，在隔离 Git 根应用经 `git apply --check` 校验的补丁。
3. 使用构建锁执行 `npm ci --ignore-scripts`，编译 Durable，运行 generation、generation recovery、inbox 与 tools 回归。
4. 打包下游版本，写入 vendor 归档与身份清单。构建输入来自源码导出；提供的上游 checkout 与现有安装目录保持各自内容。

仓库依赖与 lock 使用本地 `file:` 归档。`pack:agent` 在独立 staging 安装并捆绑相同的 Durable 实现，向仓库外消费者发布精确的下游依赖版本。正常检查通过 [verify-durable-patch.mjs](../../scripts/verify-durable-patch.mjs)核对归档、源补丁和构建锁的哈希。

## 验证与记录

- 源补丁携带首个拒绝、后置撤权、payload 检查及 SQLite 恢复的回归。
- Pakka 的 [Durable 集成回归](../../packages/agent/test/durable-integration.test.ts)使用真实 Pi 与本地确定性 HTTP provider，观察接纳回执、generation、provider 请求和持久化结果。
- 安装消费者验证真实归档与公开入口；执行方法见[补丁构建说明](../../patches/pi-durable/1.0.3-pakka.1/README.md)和[验证方法](../development/VERIFICATION.md)。

本页维护当前补丁产物、行为和输入输出关系，声明形成见[文档变更摘要](../changes/verification-and-patch-state.md)。兼容性变化、构建/回归所得及采用经过追加到[兼容性账本](../PI-DURABLE-COMPATIBILITY.md)；基线、hook/checkpoint、恢复、provider payload 或依赖身份变化时，按相应影响重建并形成新记录。
