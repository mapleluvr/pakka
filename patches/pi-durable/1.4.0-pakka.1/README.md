# Pi Durable 1.4.0-pakka.1

## 产物

基于上游 [Pi v1.4.0](https://github.com/earendil-works/pi/releases/tag/v1.4.0) 的下游源补丁，提供 generation 的明确拒绝与请求级 guard。

- [baseline.json](baseline.json)：上游 commit `4a080252f06caf63a525d7873c5d94d3c23887e0`、registry 身份、工具依赖和测试入口。
- [source.patch](source.patch)：generation 实现、公开 hook 类型、README/规范及回归。
- [build-lock.json](build-lock.json)：隔离构建的依赖锁。
- [artifact.json](artifact.json)：源补丁、构建锁与归档 SHA-256。
- [安装归档](../../../packages/agent/vendor/earendil-works-pi-durable-1.4.0-pakka.1.tgz)。

依赖 cohort 为 pi-ai、Chord、pi-codemode、pi-telemetry `1.4.0`。Pakka 当前生产依赖由根与 agent 的 package.json/lock 指定；本目录是独立补丁产物，产品接入安排见[所属任务](../../../openspec/changes/prepare-durable-1-4-0-patch/tasks.md)。

## 行为

`beforeRequest` 返回 `{ block }`，或返回 `{ messages, check? }`。首个 block 生效；checks 在所有 hooks 完成后及最终 provider payload 边界复查。既有 onPayload 回调先完成，随后进行检查。

拒绝原子地将本 run 已 placement 的输入结算为 `unanswered/blocked`，detail 保存理由，generation 完成为 `{ blocked }`。拒绝本身不追加 assistant、重试或启动模型请求，队列继续由原生 inbox/boundary 规则管理。恢复时重新取得 hooks/checks；之前已提交的 partial 仍按原生恢复协议转换。

普通 hook 异常保持 report-and-continue。check 为同步的 attempt 级回调。当前 HTTP 回归覆盖 OpenAI-completions，使用显式 loopback provider、测试密钥及隔离 HOME，不访问用户凭据或付费模型。

## 可复现构建

使用项目要求的 Node/npm，在仓库根目录运行。Windows 的隔离环境与 TEMP/TMP 规范化见[验证方法](../../../docs/development/VERIFICATION.md)。

```powershell
git clone --depth 1 --branch v1.4.0 https://github.com/earendil-works/pi.git docs/.temp/pi-v1.4.0
npm run build:durable-patch -- ./docs/.temp/pi-v1.4.0 1.4.0-pakka.1
node scripts/verify-durable-patch.mjs 1.4.0-pakka.1
```

已有源码 checkout 时直接使用其路径，HEAD 必须匹配 baseline。脚本导出该 commit 到新目录，检查并应用 patch，按构建锁执行 `npm ci --ignore-scripts`，编译、运行 baseline 所列回归，再打包。

1.4.0 的 tsconfig 为 JSONC，使用锁定的 jsonc-parser 解析；上游 source aliases 在隔离构建配置中移除，以所声明 cohort 的公开包编译。原 checkout、已有安装依赖均保持各自内容。

打包后另建独立 npm project 安装该归档，使用公开 exports、编译后的 dist 与本地 HTTP provider 运行同一 HTTP fixture；该 project 使用自己的依赖及 Vitest，不使用根 workspace、overrides 或 source alias。安装检查成功后才写入 vendor 与 artifact 清单。

省略版本参数时，构建和哈希检查入口仍选择生产补丁 `1.0.3-pakka.1`。重建新产物时显式传入版本。

## 回归入口

baseline 列明 generation、generation recovery、inbox、tools 和 `pakka-generation-http.test.ts`；后者也在独立归档消费者中运行。

HTTP fixture 检查明确拒绝的原生 receipt、idempotency、idle、后续允许输入的实际 HTTP 效果、awaited payload transform 后撤权，以及普通 hook 异常的 report-and-continue。SQLite 回归检查 blocked settlement 和中断请求重开后的重新授权。

执行结果及兼容变化见[追加式账本](../../../docs/PI-DURABLE-COMPATIBILITY.md)，当前产物关系见[补丁 state](../../../docs/state/durable-patch.md)。
