param([string]$EvidencePath = 'artifacts/devin-r2/candidate-002')
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-Location (Split-Path $PSScriptRoot -Parent)
$root = (Get-Location).Path
$dirty = @(& git status --porcelain)
if ($dirty.Count) { throw 'Commit the candidate before verification; working tree is not clean' }
$evidence = [IO.Path]::GetFullPath((Join-Path $root $EvidencePath))
if (Test-Path (Join-Path $evidence 'run.json')) { throw 'Evidence already exists; choose a new EvidencePath' }
New-Item -ItemType Directory -Force $evidence | Out-Null
$canonical = & node -e "process.stdout.write(require('node:fs').realpathSync.native(require('node:os').tmpdir()))"
if ($LASTEXITCODE -ne 0) { throw 'Cannot canonicalize TEMP' }
$env:TEMP = $canonical
$env:TMP = $canonical
$homeRoot = Join-Path $canonical ('pakka-devin-r2-gates-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $homeRoot | Out-Null
$env:HOME = $homeRoot
$env:USERPROFILE = $homeRoot
$env:PI_CODING_AGENT_DIR = Join-Path $homeRoot '.pi/agent'
$env:PI_OFFLINE = '1'
$meta = [ordered]@{
 sourceCommit = (& git rev-parse HEAD).Trim()
 dirtyBefore = $dirty
 node = (& node --version)
 startedAt = [DateTime]::UtcNow.ToString('o')
 environment = 'Canonical TEMP/TMP; isolated parent HOME/USERPROFILE/PI_CODING_AGENT_DIR; PI_OFFLINE=1; deterministic local providers. Test/package runners additionally own their child environments.'
 results = [ordered]@{check='NOT_RUN'; syntax='NOT_RUN'; build='NOT_RUN'; wide='NOT_RUN'; full='NOT_RUN'; package='NOT_RUN'}
}
function Save-Metadata { $meta | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $evidence 'run.json') }
function Start-Phase([string]$Name) { $meta.results[$Name] = 'RUNNING'; Save-Metadata }
function Finish-Phase([string]$Name, [int]$Code) { $meta.results[$Name] = @{exitCode=$Code; log=($Name + '.log')}; Save-Metadata }
Save-Metadata
try {
 Start-Phase check
 & npm run check *> (Join-Path $evidence 'check.log')
 Finish-Phase check $LASTEXITCODE
 Start-Phase syntax
 $syntaxCode = 0
 foreach ($file in @((Get-ChildItem apps/webui/web -Filter '*.js')) + @((Get-ChildItem scripts -Filter 'consumer-*.mjs')) + @((Get-Item scripts/pack-smoke.mjs))) {
  & node --check $file.FullName *>> (Join-Path $evidence 'syntax.log')
  if ($LASTEXITCODE -ne 0) { $syntaxCode = $LASTEXITCODE }
 }
 Finish-Phase syntax $syntaxCode
 # No concurrent build/test: removing dist during import would contaminate results.
 Start-Phase build
 & npm run build *> (Join-Path $evidence 'build.log')
 Finish-Phase build $LASTEXITCODE
 Start-Phase wide
 $tests = @(Get-ChildItem apps/webui/test -Filter '*.test.ts' | Sort-Object Name | ForEach-Object {$_.FullName})
 $widePath = Join-Path $EvidencePath 'wide'
 & ./scripts/test-devin-r2.ps1 -TestFiles $tests -EvidencePath $widePath *> (Join-Path $evidence 'wide.log')
 Finish-Phase wide $LASTEXITCODE
 $meta.results.wide.files = $tests.Count
 $meta.results.wide.rawLog = 'wide/test.log'
 Save-Metadata
 Start-Phase full
 & npm test *> (Join-Path $evidence 'full.log')
 Finish-Phase full $LASTEXITCODE
 Start-Phase package
 & npm run smoke:package *> (Join-Path $evidence 'package.log')
 Finish-Phase package $LASTEXITCODE
} finally {
 $meta.finishedAt = [DateTime]::UtcNow.ToString('o')
 $meta.sourceCommitAfter = (& git rev-parse HEAD).Trim()
 $meta.dirtyAfter = @(& git status --porcelain)
 $meta.fixedSnapshot = $meta.sourceCommitAfter -eq $meta.sourceCommit -and $meta.dirtyAfter.Count -eq 0
 Save-Metadata
}
$meta | ConvertTo-Json -Depth 8
if (!$meta.fixedSnapshot -or @($meta.results.Values | Where-Object {$_ -is [string] -or $_.exitCode -ne 0}).Count) { exit 1 }
