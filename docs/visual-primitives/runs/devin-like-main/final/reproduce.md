# 固定候选的复跑方式

## 前提

Windows PowerShell 7、项目支持的 Node/npm、可用的 Chrome。先按仓库根 README 安装依赖；默认测试采用本地确定性 HTTP provider，不读取个人凭据，不请求付费模型。Linux 的路径与进程退出行为可能不同，不能把 Windows 结果直接写成跨平台结论。

本目录的 `candidate-identity.json` 记录产品源码提交与证据 SHA-256；文档提交可以晚于产品源码提交。复跑前检查没有未记录的产品差异：

```powershell
$identity = [System.IO.File]::ReadAllText('docs/visual-primitives/runs/devin-like-main/final/candidate-identity.json') | ConvertFrom-Json
git diff --exit-code $identity.sourceCommit -- apps packages scripts patches package.json package-lock.json
npm run check
npm run build
```

## Windows 隔离环境

每次新开的工具／PowerShell 进程均需重新设置；上一条命令中的环境变量不会自动传到另一条工具命令。必须先在原临时目录基础上求真实路径，再创建测试隔离 HOME。

```powershell
$canonical = node -e "process.stdout.write(require('node:fs').realpathSync.native(require('node:os').tmpdir()))"
$env:TEMP = $canonical
$env:TMP = $canonical
$isolated = Join-Path $canonical ('pakka-devin-verify-' + [guid]::NewGuid())
New-Item -ItemType Directory $isolated | Out-Null
$env:HOME = $isolated
$env:USERPROFILE = $isolated
$env:PI_CODING_AGENT_DIR = $isolated
$env:PI_OFFLINE = '1'
$env:DO_NOT_TRACK = '1'
$env:PAKKA_TEST_ARTIFACTS = Join-Path (Get-Location) 'artifacts/devin-rerun'
New-Item -ItemType Directory -Force artifacts | Out-Null
```

这里记录的是已验证运行条件：同一浏览器测试在未规范化环境下卡在创建 500／unknown，规范化后进入并通过后续布局路径。没有据此断言所有 500 的深层原因相同，也没有放宽产品对 unknown 的封闭恢复行为。

这些是测试进程的环境变量；不要在设置了隔离 HOME 的终端登录个人服务。需要恢复个人终端时关闭该 PowerShell 窗口，或事先保存并恢复原环境变量。隔离目录和测试产物可在核验完后按明确路径清理，不做通配删除。

## 三类检查分别运行

```powershell
# 项目全量：scripts/test.mjs 自建隔离 HOME、enumerate *test.ts。
npm test -- --test-timeout=60000 *> artifacts/devin-rerun-full.log
$fullExit = $LASTEXITCODE

# 43 项 WebUI／MAS 专项；具体测试文件列表随证据保存。
$tests = [System.IO.File]::ReadAllText('docs/visual-primitives/runs/devin-like-main/final/test-files.json') | ConvertFrom-Json
node --test --test-concurrency=1 @tests *> artifacts/devin-rerun-webui.log
$webuiExit = $LASTEXITCODE

# 仓库外打包安装消费者；会自行 build、生成并安装新的确切 tgz。
npm run smoke:package *> artifacts/devin-rerun-package.log
$packageExit = $LASTEXITCODE
[ordered]@{ full = $fullExit; webui = $webuiExit; package = $packageExit }
```

不要因第一项失败而丢掉后两项，也不要把后两项通过写成全量通过。查看全部失败名称与最终 counts，核对零跳过要求。

只复跑窄屏问题可在相同隔离环境执行：

```powershell
node --test --test-concurrency=1 apps/webui/test/devin-shell-browser.test.ts
```

`PAKKA_TEST_ARTIFACTS/devin-shell/` 保存桌面、浅色、搜索、390×844 和 360×600 截图及 DOM 测量。360px 测试核对完整文字矩形在可见区域内，不要求文字填满整行。

## 不能由上述命令替代的验收

独立 `agent-workspace-linux` GUI 操作与指定模型的两方对抗审查仍需在工具／模型可用时，按 [WebUI 开发规范第 10 节](../../../../development/WEBUI-DEVELOPMENT.md#10-分阶段-computer-use-实操验收)重新建立固定快照执行。程序化 Chrome、截图或本地主代理自查都不是它们的替代品。
