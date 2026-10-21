$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = 'D:/Projects/kappa/migration-worktrees/pakka-devin-ui'
$evidence = Join-Path $root 'artifacts/devin-r2/candidate-004/installed-supplement'
$consumer = 'C:/Users/mapleland/AppData/Local/Temp/pakka-packed-consumer-IU9AtF'
if (Test-Path (Join-Path $evidence 'run.json')) { throw 'Evidence already exists' }
$canonical = & node -e "process.stdout.write(require('node:fs').realpathSync.native(require('node:os').tmpdir()))"
if ($LASTEXITCODE -ne 0) { throw 'Cannot canonicalize TEMP' }
$env:TEMP = $canonical
$env:TMP = $canonical
$env:HOME = $consumer
$env:USERPROFILE = $consumer
$env:PI_CODING_AGENT_DIR = Join-Path $consumer 'isolated-agent'
$env:PI_OFFLINE = '1'
$env:DO_NOT_TRACK = '1'
$env:NO_COLOR = '1'
$meta = [ordered]@{
 installedSourceCommit = '6d359b13d1b81c29f47495d303c1ed6afe4d0bb2'
 installedConsumer = $consumer
 context = 'Five independent consumers NOT_RUN after the candidate-004 package pipeline stopped at pocket-controlled with exit=null. Original installed scripts and node_modules are unchanged; each script owns a distinct fixture. This supplements the failed pipeline and cannot make smoke:package pass.'
 startedAt = [DateTime]::UtcNow.ToString('o')
 archives = @((Get-ChildItem $consumer -Filter '*.tgz' -File) | ForEach-Object { @{file=$_.Name; sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
 results = [ordered]@{}
}
function Save-Metadata { $meta | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $evidence 'run.json') }
Save-Metadata
try {
 foreach ($name in @('pocket-notifications','pocket-schedules','pocket-memory','pocket-hooks','pocket-voice')) {
  $entry = Join-Path $consumer ($name + '.mjs')
  $meta.results[$name] = @{status='RUNNING'; scriptSha256=(Get-FileHash $entry -Algorithm SHA256).Hash.ToLowerInvariant(); log=($name + '.log')}
  Save-Metadata
  Push-Location $consumer
  try { & node $entry *> (Join-Path $evidence ($name + '.log')); $code=$LASTEXITCODE } finally { Pop-Location }
  $meta.results[$name].status = 'FINISHED'
  $meta.results[$name].exitCode = $code
  Save-Metadata
 }
} finally {
 $meta.finishedAt = [DateTime]::UtcNow.ToString('o')
 Save-Metadata
}
$meta | ConvertTo-Json -Depth 8
if (@($meta.results.Values | Where-Object { $_.status -ne 'FINISHED' -or $_.exitCode -ne 0 }).Count) { exit 1 }
