# Pi Durable 下游源补丁

## 产物与组成

Pakka 维护版本固定的 Pi Durable 源补丁与可安装归档。补丁为 generation 提供明确的策略拒绝及请求级检查。

| 版本与角色                    | 固定输入                                                                                                                                                                                                | 归档与身份                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生产依赖 `1.0.3-pakka.1`      | [baseline](../../patches/pi-durable/1.0.3-pakka.1/baseline.json)、[source patch](../../patches/pi-durable/1.0.3-pakka.1/source.patch)、[构建锁](../../patches/pi-durable/1.0.3-pakka.1/build-lock.json) | [安装包](../../packages/agent/vendor/earendil-works-pi-durable-1.0.3-pakka.1.tgz)、[artifact](../../patches/pi-durable/1.0.3-pakka.1/artifact.json) |
| 独立 SDK 补丁 `1.4.0-pakka.1` | [baseline](../../patches/pi-durable/1.4.0-pakka.1/baseline.json)、[source patch](../../patches/pi-durable/1.4.0-pakka.1/source.patch)、[构建锁](../../patches/pi-durable/1.4.0-pakka.1/build-lock.json) | [安装包](../../packages/agent/vendor/earendil-works-pi-durable-1.4.0-pakka.1.tgz)、[artifact](../../patches/pi-durable/1.4.0-pakka.1/artifact.json) |

各 baseline 固定上游 release、commit 与下游版本；artifact 记录源补丁、构建锁和归档的 SHA-256。1.4.0 补丁的公开依赖 cohort 为 pi-ai、Chord、pi-codemode、pi-telemetry `1.4.0`。

生产选择由根及 agent 的 package.json/lock 绑定；`pack:agent` 在独立 staging 安装并捆绑所选实现，向仓库外消费者发布精确的下游依赖。产品接入的当前工作由[所属任务](../../openspec/changes/prepare-durable-1-4-0-patch/tasks.md#4-后续产品接入)承接。

## 生成拒绝与请求检查

`GenerationHooks.beforeRequest` 为当前请求返回以下两种结果之一，也可返回 `undefined`：

- `{ block: string }` 明确拒绝当前 generation。首个 block 生效，空字符串也是有效理由，后续 beforeRequest hooks 跳过执行。
- `{ messages, check? }` 提供请求消息及可选同步检查。所收集的 checks 在 hooks 完成后执行，并在 provider 的 `onPayload` 边界再次执行；既有 onPayload 回调链先完成，再执行检查。

block 或 check 拒绝通过同一事务结算本 run 已 placement 的输入：submission 为 `unanswered`、`reason: "blocked"`、`detail` 为拒绝理由，generation 以 `{ blocked: reason }` 完成。已接纳输入的提交保留，Conversation 可继续接收下一次获准工作，队列继续按原生 inbox/boundary 工作；拒绝由输入结算与 generation 终态表达。

checks 具有请求/attempt 作用域，保存在执行中的回调链。恢复执行重新解析并运行 hooks，取得当时有效的检查；之前已提交的 partial 按原生恢复协议转换。落盘的 blocked settlement 与终结 generation 在 SQLite 重开后仍可读取。

普通扩展异常沿 Durable 的 report-and-skip 路径处理；策略拒绝由 block 或 check 表达。取消及独立的模型/存储异常沿各自契约处理。[Runtime](runtime.md)维护 Host、authority 与 unknown 的跨模块关系。

Pakka 生产接入采用 OpenAI-completions，重试与自动压缩处于关闭状态。辅助 inference 使用各自的 allowlist、预算及 pre-payload source guard。

## 构建与使用

构建入口为 `npm run build:durable-patch -- <upstream-checkout> [patched-version]`，由[构建脚本](../../scripts/build-durable-patch.mjs)执行。默认选择生产补丁；独立版本使用显式参数：

```powershell
npm run build:durable-patch -- ./docs/.temp/pi-v1.4.0 1.4.0-pakka.1
node scripts/verify-durable-patch.mjs 1.4.0-pakka.1
```

1. 核对 checkout HEAD 与 baseline commit。
2. 从该 commit 导出源码，在隔离 Git 根检查并应用 source.patch。
3. 按构建锁执行 `npm ci --ignore-scripts`，使用同 cohort 的公开依赖编译并运行 baseline 所列回归。1.4.0 的 JSONC 配置由锁定 parser 解析。
4. 1.4.0 归档在独立 npm project 中以公开 exports/compiled dist 运行本地 HTTP 消费者。
5. 将归档与身份清单写入所属版本目录。原 checkout 和已安装依赖保持各自内容。

[完整性脚本](../../scripts/verify-durable-patch.mjs)按所选版本核对归档、源补丁和构建锁。详细命令见 [1.0.3 说明](../../patches/pi-durable/1.0.3-pakka.1/README.md)与 [1.4.0 说明](../../patches/pi-durable/1.4.0-pakka.1/README.md)。

## 回归与记录

源补丁携带首个拒绝、hook 后撤权、payload 检查及 SQLite 恢复回归。1.4.0 的 HTTP fixture 同时作为 source 与独立归档消费者，检查 receipt、idempotency、idle、后续允许请求的实际效果及普通 hook 异常。

Pakka 的[Durable 集成回归](../../packages/agent/test/durable-integration.test.ts)使用真实 Pi 与本地确定性 HTTP provider，观察生产接入的接纳回执、generation、请求和持久化结果。[工具回归](../../packages/agent/test/durable-patch-tooling.test.ts)检查版本选择与身份拒绝。

检查的选用和结论范围见[验证方法](../development/VERIFICATION.md)。本页维护当前产物、行为和输入输出；形成与调整见[补丁变更](../changes/durable-1-4-0-and-verification.md)，兼容性变化及构建/回归所得追加到[兼容性账本](../PI-DURABLE-COMPATIBILITY.md)。
