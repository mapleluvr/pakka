# Pi Durable 1.4.0-pakka.2

## 产物

固定于上游 Pi v1.4.0 / `4a080252f06caf63a525d7873c5d94d3c23887e0` 的下游 SDK 归档，供 Pakka 的 generation 门禁和执行环境接入使用。依赖 cohort 为 Pi AI、Chord、pi-codemode、pi-telemetry 1.4.0。

- [baseline](baseline.json)：上游与下游身份、构建依赖及 source/consumer 回归入口。
- [source.patch](source.patch)：显式 block、请求级 check、原子 blocked settlement 及回归。
- [build-lock](build-lock.json)：隔离构建的精确依赖图。
- [artifact](artifact.json)：构建锁、源补丁和安装归档的 SHA-256。
- [安装归档](../../../packages/agent/vendor/earendil-works-pi-durable-1.4.0-pakka.2.tgz)。

## 执行环境关系

Durable 的公开 HarnessOptions.env、ExecutionEnv、NodeExecutionEnv 和 /tools 提供环境接缝。Pakka 在 durable-adapter 内完成宿主配置、原生工具及 invocation 能力的适配；环境取得失败通过显式 block 结算。执行环境接口及资源寿命见[指南](../../../docs/guides/EXECUTION-ENVIRONMENT.md)。

SDK 包与构建锁中的 workspace 身份均为 `1.4.0-pakka.2`。源补丁负责 generation block/check/settlement，执行环境接入位于 Pakka adapter。形成和版本化验证见[接入变更](../../../docs/changes/execution-environment.md)及[兼容性账本](../../../docs/PI-DURABLE-COMPATIBILITY.md)。

## 构建与校验

在仓库根目录运行，Node/npm 和 Windows 私有 profile/TEMP 条件见[验证方法](../../../docs/development/VERIFICATION.md)。源码 checkout 的 HEAD 必须等于 baseline commit。Windows 的 source 回归需要可用的 Bash；将 Git Bash 的 bin 放在 PATH 前端可避免解析到缺少 Linux Bash 的 WSL shim。本版本的 [Windows 包装器](../../../docs/verification/evidence/execution-environment-pakka-2/run-npm.mjs)设置私有 profile、环境白名单和显式 Git Bash PATH，具体复跑见[交付检查](../../../docs/verification/EXECUTION-ENVIRONMENT-PAKKA-2.md)。

```powershell
git clone --depth 1 --branch v1.4.0 https://github.com/earendil-works/pi.git docs/.temp/pi-v1.4.0
npm run build:durable-patch -- ./docs/.temp/pi-v1.4.0 1.4.0-pakka.2
node scripts/verify-durable-patch.mjs 1.4.0-pakka.2
```

脚本从该 commit 导出隔离源码，检查并应用 patch，以 build-lock 执行 npm ci，解析 JSONC、编译并运行 baseline 的五份回归。再安装实际 tgz 到独立 project，以公开 exports/compiled dist 运行 HTTP fixture，成功后才写入 vendor 和 artifact。原 checkout 与安装依赖不手改。

生产依赖由根及 agent package.json/lock 选择。省略版本参数时 build/verify 从 agent 的固定 vendor 依赖选择版本。旧版本目录及归档保留各自身份，不能相互覆盖。
