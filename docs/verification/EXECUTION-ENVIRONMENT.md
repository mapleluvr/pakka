# ExecutionEnv：Durable 1.4.0 接入验证

## 固定对象

2026-11-05，Windows x64 / Node **24.15.0**，从 Pakka `547c4968b9414ecff774edb7071687539895e8e8` 建立 `feat/execution-env-1.4.0`。实现和检查在独立工作树 `pakka-execution-env-1.4.0` 完成，对照使用另一个未修改的 `pakka-execution-env-control-1.4.0`。

- 上游：Durable `1.4.0` / `4a080252f06caf63a525d7873c5d94d3c23887e0`。
- 沿用 SDK：`1.4.0-pakka.1`，SHA-256 `7fd9f3310dfa003a9077139a25faf93567922a065461fa3767dd5a1066efa891`。
- `source.patch` SHA-256 `128df5c9618c3f92cb8dcb43c1eb71d069b7927d32e1688067e1ccb5cf2a1f66`；补丁、构建锁和 vendor 归档均未修改。
- 已安装验证的 `@pakka/agent@0.7.0` 候选归档 SHA-256：`54c6a25ac4ab4488b6a06eba2f54e06a99459dd3feba9d3a29581772a5a968e3`。这是工作树候选，不是一次新版本发布。
- 实际源文件哈希、归档本机位置、输出哈希和逐文件对照在 [summary.json](evidence/execution-environment/summary.json)。归档中安装后的 `durable-adapter.js` 与被测试构建逐字节相同。

本轮修订的是 **Pakka 的公开接入与适配层**。原有 SDK 已有 `HarnessOptions.env`；原有补丁已有显式 block/check/settlement，因此本切片没有增加 Durable 源补丁，也没有重新构建一份不同的 SDK。

## 取得的证据

| 检查             | 结果与范围                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 新增执行环境回归 | **24 passed / 0 failed / 0 skipped**，8 个测试文件                                                                                     |
| 相邻回归         | **31 passed / 0 failed / 0 skipped**，Durable 集成、补丁工具、生命周期队列、SourceWork 与切换/Conversation                             |
| 独立安装消费者   | 离线安装实际 tgz，5 次 loopback HTTP；write → edit → read 得到 `NEW`，argv 命令写入 `ARGV`；cleanup 计数 1，重开 ready 且没有新增 HTTP |
| 构建与类型       | 工作区 build、`npm run check` 通过；check 同时校验补丁身份并编译测试                                                                   |
| 格式             | 本次改动的 TS/MJS 检查通过；全仓候选仍有 17 个未改动文件警告，基线有这 17 项以及原 index.ts，共 18 项                                  |
| 主动 LSP         | 4 个生产文件中 3 个确认 clean；adapter 为 5397 行，超过 LSP 的 5000 行上限；该文件由上述编译检查覆盖，不声称 LSP 全部 clean            |
| 广泛回归         | **没有取得全量通过结论**；见下节的固定构建对照                                                                                         |

实际效果覆盖：原生 read/write/edit/bash/powershell；合作工具 argv、stdout/stderr；两个 Conversation 的独立 cwd；cwd/profile 切换与重开指纹；路径替换后 reader 继续指向原文件；保留/复制 scope 失效；漏写 await 时排空已开始操作；真实命令取消；不配合 abort 的在途操作；未知 cleanup 保留 writer；普通方法及 reader 未知/非法错误封套失败关闭；原生 edit 跨 reload 后禁止写回。

所有模型请求均指向本地确定性 OpenAI-compatible provider，测试进程使用私有 profile 和环境白名单。没有付费模型调用或用户凭据读取。MXC、恶意插件运行器、辅助 Compresser 环境装配和 WebUI 配置入口未在本轮实现或验证；本地驱动拥有宿主权限，不是安全沙箱。

## 失败先行与修正

1. [第一组 RED](evidence/execution-environment/execution-red.txt)：原生文件没有产生目标内容、环境不可用仍有 HTTP、合作工具没有执行能力。接出配置、原生工具与 invocation 能力后通过。
2. [目标/恢复 RED](evidence/execution-environment/execution-runtime-red.txt)：形成了 profile/cwd 绑定及重开配置指纹。
3. [生命周期 RED](evidence/execution-environment/execution-lifecycle-red.txt)：工具漏写 await 时过早失效回调。收尾改为停止准入、等待已开始操作、失效能力、关闭句柄。
4. [未知错误码 RED](evidence/execution-environment/execution-invalid-error-red.txt) 与 [reader RED](evidence/execution-environment/execution-reader-red.txt)：驱动已经产生效果或返回异常，工具捕获错误后 Host 仍 ready。统一检查结果封套并在 invocation 收尾失败关闭。
5. [原生 edit/reload RED](evidence/execution-environment/execution-native-revocation.txt)：阻止写回有效，但有效撤销被误判为未知效果，导致 reload 失败。adapter 自身的作用域撤销与驱动未知效果分开分类；取消不清除真正的未知状态。

最终 [24 项输出](evidence/execution-environment/execution-final.txt)、[31 项相邻输出](evidence/execution-environment/execution-adjacent-final.txt) 和[安装消费者输出](evidence/execution-environment/execution-consumer-final.txt)对应同一生产源码。

## 广泛回归的对照范围

最初全量尝试被 owned-browser 超时阻断；排除该组的较广运行也出现失败。其中一轮与打包重建 dist 重叠，发生模块缺失，不能用该轮归因。随后先完成构建，再对候选和重新构建的未修改基线执行相同的 12 文件、指定名称模式矩阵。

两边按文件的退出状态、超时类型及已报告通过/失败数量 **完全一致**。它仅说明这组受控对照没有候选独有的失败，不说明所有测试都通过，也不为各项既有失败提供根因诊断。

| 文件/选择                                                    | 两边观察                              |
| ------------------------------------------------------------ | ------------------------------------- |
| pocket-directories / authorized browsing                     | 失败                                  |
| pocket-hooks-boundaries / unknown、finite rate、finite bytes | 3 项通过                              |
| pocket-people-boundaries / uncertain native storage          | 失败                                  |
| transcript-parts-browser / valid image、inherited tool       | 2 项失败                              |
| strategy-omission / explicit null range                      | 通过                                  |
| mas / readiness barrier                                      | 1 通过、1 失败                        |
| mas unknown                                                  | 已报告 2 失败，进程达到 45 秒外部上限 |
| extension-client                                             | 2 项通过                              |
| browser-input / Browser input driver                         | 失败                                  |
| browser-launch / Browser discovery                           | 2 项失败                              |
| browser-contribution / actual UI                             | 已报告失败，进程达到 45 秒外部上限    |
| pocket-browser / real isolated page controls                 | 已报告失败，进程达到 45 秒外部上限    |

原始 [baseline](evidence/execution-environment/execution-baseline-matrix.txt)、[candidate](evidence/execution-environment/execution-candidate-matrix.txt)，精确模式与有界运行器见 [compare-built.mjs](evidence/execution-environment/compare-built.mjs)。三个外部超时不当作正常退出。格式检查的 [baseline](evidence/execution-environment/baseline-format.txt) 与 [candidate](evidence/execution-environment/execution-format-final.txt)也分别保留；未顺手格式化无关文件。

## 复跑

以下为本次 Windows 环境中的命令，在目标工作树执行。先构建，完成后再运行测试/消费者；不要同时重建被消费的 dist。测试包装器使用环境白名单、私有 HOME/USERPROFILE/PI_CODING_AGENT_DIR、`PI_OFFLINE=1` 和规范长路径 TEMP/TMP。

```powershell
npm run build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
npm run check
if ($LASTEXITCODE -ne 0) { throw 'check failed' }

$evidence = 'docs/verification/evidence/execution-environment'
$tests = (Get-ChildItem packages/agent/test/execution-*.test.ts).FullName
node "$evidence/run-tests.mjs" @tests

node "$evidence/run-tests.mjs" `
  packages/agent/test/durable-integration.test.ts `
  packages/agent/test/durable-patch-tooling.test.ts `
  packages/agent/test/lifecycle-queue.test.ts `
  packages/agent/test/source-work.test.ts `
  packages/agent/test/source-work-transition.test.ts `
  packages/agent/test/source-work-conversation.test.ts

New-Item -ItemType Directory -Force docs/.temp | Out-Null
node "$evidence/pack-consumer.mjs"
```

[安装包装器](evidence/execution-environment/pack-consumer.mjs)按本次机器的 `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js` 调用 npm，在独立临时目录离线安装打包产物，执行版本化的 [consumer-execution.mjs](../../scripts/consumer-execution.mjs)。机器 npm 路径不同或离线依赖缓存缺失时需先准备对应条件；测试本身始终只用 loopback provider。

完整采用与任务见 [change](../changes/execution-environment.md)，API 用法见[指南](../guides/EXECUTION-ENVIRONMENT.md)。修改 driver 协议、工具装配、授权/撤销时序、恢复指纹或 Pi cohort 后，应重新选择并运行受影响检查，本记录不会自动覆盖新产物。
