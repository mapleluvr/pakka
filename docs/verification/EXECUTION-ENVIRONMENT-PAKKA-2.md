# ExecutionEnv：1.4.0-pakka.2 交付检查

## 对象与版本关系

2026-11-05，`feat/execution-env-1.4.0` 工作树，Pakka 基线 `547c4968b9414ecff774edb7071687539895e8e8`；Windows x64、Node 24.15.0、npm 11.12.1。用户要求将已实现的 ExecutionEnv 接入以 `1.4.0-pakka.2` 命名并提交。

| 对象 | 固定身份 |
| --- | --- |
| 上游 SDK | 1.4.0 / `4a080252f06caf63a525d7873c5d94d3c23887e0` |
| 下游 SDK | `1.4.0-pakka.2` |
| SDK tgz SHA-256 | `12d21b230d40706618db4ac83747b9189b7d9070f023c2705bc5c8b521d90ecd` |
| source.patch SHA-256 | `128df5c9618c3f92cb8dcb43c1eb71d069b7927d32e1688067e1ccb5cf2a1f66` |
| build-lock SHA-256 | `7feebbad7d4d6a1e241be4dd0bd3d0a41e48d6d4236161f9f62d6d245bfa9029` |
| `@pakka/agent@0.7.0` 安装消费 tgz SHA-256 | `f169cb32f9e2b7a5bf4c7596083c0ab2a89e816d3ecbb72ec271c2abbefe46f7` |

`.2` 的 SDK source.patch 与 `.1` 逐字节一致，构建锁只改变 Durable workspace 版本，归档内包版本为 `.2`。ExecutionEnv 接入代码位于 Pakka adapter；这是新的固定交付身份，不是 SDK scheduler 增加了环境实现。旧 `.1` 目录、归档及[初轮记录](EXECUTION-ENVIRONMENT.md)保留。

本轮重新查询公开 release，最新仍为 [v1.5.0](evidence/execution-environment-pakka-2/upstream-release.json)；复核其已保存的 providerPayload hook 链。此前调查的显式拒绝差异继续保留，未升级基线或缩减补丁。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| 第二次隔离源码构建 | SDK **113/113**、独立 SDK 安装 HTTP **3/3** |
| 第三次隔离源码构建 | SDK **113/113**、独立 SDK 安装 HTTP **3/3**；与第二次归档和 artifact 元数据完全一致 |
| Pakka ExecutionEnv | **24/24** |
| 相邻与版本选择 | **36/36**：原相邻 31 项及 CLI 版本选择 5 项 |
| build/check | 工作区构建、测试类型编译及生产归档校验通过 |
| 实际安装的 ExecutionEnv 消费者 | 5 次 loopback HTTP；原生文件内容 `NEW`，argv 写入 `ARGV`，cleanup 一次，重开 ready |
| 实际安装的核心消费者 | 7 次 loopback HTTP；实际 cohort 含 `.2`，撤权阻止 HTTP、blocked settlement、reload projector、辅助 cap 64/128、私有子路径和 oracle 隔离通过 |
| 旧产物 | `.1` 哈希校验通过，旧补丁目录和归档没有 diff |

[机器摘要](evidence/execution-environment-pakka-2/summary.json)记录源文件、归档、实际安装对象与输出哈希。构建输出：[第二次](evidence/execution-environment-pakka-2/build-2.txt)、[第三次](evidence/execution-environment-pakka-2/build-3.txt)。运行输出：[24 项](evidence/execution-environment-pakka-2/execution-tests.txt)、[36 项](evidence/execution-environment-pakka-2/adjacent-tests.txt)、[执行消费](evidence/execution-environment-pakka-2/consumer.txt)、[核心消费](evidence/execution-environment-pakka-2/consumer-core.txt)、[类型检查](evidence/execution-environment-pakka-2/check.txt)、[构建](evidence/execution-environment-pakka-2/workspace-build.txt)。

只执行上述受影响检查；全仓广泛回归的原观察保留在初轮记录，没有将局部复跑写成全仓通过。模型调用全部为确定性 loopback provider，私有 profile 和环境白名单用于隔离用户凭据。本轮未运行 MXC、外部 Dynamite 配对或 WebUI 环境装配。

## 运行条件修正

1. [首次源码构建](evidence/execution-environment-pakka-2/build-1.txt)为 111 通过、2 失败，两项 Shell 输出出现 WSL `/bin/bash` 不存在。只改变 PATH 的[对照](evidence/execution-environment-pakka-2/shell-control.txt)中，原 PATH 调用 WSL 失败，Git Bash 优先时成功。完整构建随后两次通过；未删除或跳过测试、未修改 source.patch。
2. 新的核心消费包装器首次遗漏 `--experimental-import-meta-resolve`，导致已有 storage helper 无法从嵌套的 agent cohort 解析 Durable。[原错误](evidence/execution-environment-pakka-2/consumer-core-fixture-error.txt)保留。按现有 pack-smoke 的调用条件补上 Node flag 后，同一安装对象通过；没有修改安装依赖或生产代码。

## 复跑

以下命令在目标工作树根执行。源码 checkout HEAD 必须匹配 baseline。Windows 包装器固定本机 npm/Git Bash 路径，设置私有 HOME/USERPROFILE/PI_CODING_AGENT_DIR、环境白名单、`PI_OFFLINE=1` 和规范 TEMP；换机器时先核对这两个程序路径。首次获取公开构建依赖需网络，模型测试仅用 loopback。

```powershell
$evidence = 'docs/verification/evidence/execution-environment-pakka-2'
$upstream = 'docs/.temp/pi-v1.4.0' # 事先准备指定 commit 的 checkout
node "$evidence/run-npm.mjs" run build:durable-patch -- $upstream 1.4.0-pakka.2
if ($LASTEXITCODE -ne 0) { throw 'SDK build failed' }
node "$evidence/run-npm.mjs" install --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'install failed' }
node "$evidence/run-npm.mjs" run build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
node "$evidence/run-npm.mjs" run check
if ($LASTEXITCODE -ne 0) { throw 'check failed' }

$env:PATH = 'C:\Program Files\Git\bin;' + $env:PATH
node docs/verification/evidence/execution-environment/pack-consumer.mjs
if ($LASTEXITCODE -ne 0) { throw 'execution consumer failed' }
node "$evidence/consume-core.mjs"
if ($LASTEXITCODE -ne 0) { throw 'core consumer failed' }

$tests = (Get-ChildItem packages/agent/test/execution-*.test.ts).FullName
node docs/verification/evidence/execution-environment/run-tests.mjs @tests
node docs/verification/evidence/execution-environment/run-tests.mjs `
  packages/agent/test/durable-integration.test.ts `
  packages/agent/test/durable-patch-tooling.test.ts `
  packages/agent/test/lifecycle-queue.test.ts `
  packages/agent/test/source-work.test.ts `
  packages/agent/test/source-work-transition.test.ts `
  packages/agent/test/source-work-conversation.test.ts `
  scripts/durable-patch-selection.test.mjs
```

各构建/打包完成后再运行依赖其 dist 的测试。重复 SDK 构建可比较 artifact.json 和 tgz SHA-256；完整采用关系见[变更摘要](../changes/execution-environment.md)及其 OpenSpec artifacts。
