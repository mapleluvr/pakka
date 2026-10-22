$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = 'D:/Projects/kappa/migration-worktrees/pakka-devin-r2-control'
$evidence = 'D:/Projects/kappa/migration-worktrees/pakka-devin-ui/artifacts/devin-r2/main-r2-control'
New-Item -ItemType Directory -Force $evidence | Out-Null
Set-Location $root
$canonical = & node -e "process.stdout.write(require('node:fs').realpathSync.native(require('node:os').tmpdir()))"
if ($LASTEXITCODE -ne 0) { throw 'Cannot canonicalize TEMP' }
$isolated = Join-Path $canonical ('pakka-main-r2-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $isolated | Out-Null
$env:TEMP = $canonical
$env:TMP = $canonical
$env:HOME = $isolated
$env:USERPROFILE = $isolated
$env:PI_CODING_AGENT_DIR = Join-Path $isolated '.pi/agent'
$env:PI_OFFLINE = '1'
$env:DO_NOT_TRACK = '1'
$env:PAKKA_TEST_ARTIFACTS = $evidence
$tests = @('apps/server/test/pocket-browser.test.ts','apps/server/test/pocket-directories.test.ts','apps/webui/test/browser-launch.test.ts','apps/webui/test/browser-contribution.test.ts','apps/webui/test/hooks-recovery.test.ts')
$meta = [ordered]@{sourceCommit=(& git rev-parse HEAD).Trim(); dirtyBefore=@(& git status --porcelain); node=(& node --version); startedAt=[DateTime]::UtcNow.ToString('o'); checkout='git -c core.autocrlf=false worktree add --detach: LF Git blobs, no source patch'; htmlBlob=(& git rev-parse HEAD:apps/webui/web/index.html).Trim(); htmlWorktreeHash=(& git hash-object --no-filters apps/webui/web/index.html).Trim(); tests=$tests; results=[ordered]@{install='NOT_RUN';build='NOT_RUN';tests='NOT_RUN'}}
function Save-Metadata { $meta | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $evidence 'run.json') }
Save-Metadata
if ($meta.dirtyBefore.Count -or $meta.htmlBlob -ne $meta.htmlWorktreeHash) { throw 'Control source is not the intended pristine LF snapshot' }
try {
 $meta.results.install='RUNNING'; Save-Metadata
 & npm ci --offline --ignore-scripts --no-audit --no-fund *> (Join-Path $evidence 'install.log')
 $meta.results.install=@{exitCode=$LASTEXITCODE;log='install.log'}; Save-Metadata
 if ($LASTEXITCODE -ne 0) { throw 'Offline control installation failed' }
 $meta.results.build='RUNNING'; Save-Metadata
 & npm run build *> (Join-Path $evidence 'build.log')
 $meta.results.build=@{exitCode=$LASTEXITCODE;log='build.log'}; Save-Metadata
 if ($LASTEXITCODE -ne 0) { throw 'Control build failed' }
 $meta.results.tests='RUNNING'; Save-Metadata
 & node --test --test-timeout=60000 --test-concurrency=1 @tests *> (Join-Path $evidence 'test.log')
 $meta.results.tests=@{exitCode=$LASTEXITCODE;log='test.log'}; Save-Metadata
} finally {
 $meta.finishedAt=[DateTime]::UtcNow.ToString('o')
 $meta.sourceCommitAfter=(& git rev-parse HEAD).Trim()
 $meta.dirtyAfter=@(& git status --porcelain)
 $meta.fixedSnapshot=$meta.sourceCommitAfter -eq $meta.sourceCommit -and $meta.dirtyAfter.Count -eq 0
 Save-Metadata
}
$meta | ConvertTo-Json -Depth 8
