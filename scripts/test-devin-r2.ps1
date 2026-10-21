param(
    [Alias('Tests')]
    [string[]]$TestFiles = @(
        'apps/webui/test/devin-adoption-browser.test.ts',
        'apps/webui/test/mas-devin-adoption.test.ts',
        'apps/webui/test/mas-board-recovery.test.ts',
        'apps/webui/test/creation-recovery-browser.test.ts'
    ),
    [string]$EvidencePath = ('artifacts/devin-r2/' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$names = @('TEMP', 'TMP', 'HOME', 'USERPROFILE', 'PI_CODING_AGENT_DIR', 'PI_OFFLINE', 'DO_NOT_TRACK', 'PAKKA_TEST_ARTIFACTS')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$isolated = $null
$code = 1
Push-Location $repository
try {
    # Resolve Windows' short/long temp aliases before changing HOME. Every run
    # uses disposable Pi state; no user credentials or paid provider are read.
    $canonical = & node -e "process.stdout.write(require('node:fs').realpathSync.native(require('node:os').tmpdir()))"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot canonicalize temporary directory' }
    $isolated = Join-Path $canonical ('pakka-devin-r2-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $isolated | Out-Null
    $evidence = [IO.Path]::GetFullPath($EvidencePath, $repository)
    New-Item -ItemType Directory -Path $evidence -Force | Out-Null
    $env:TEMP = $canonical
    $env:TMP = $canonical
    $env:HOME = $isolated
    $env:USERPROFILE = $isolated
    $env:PI_CODING_AGENT_DIR = $isolated
    $env:PI_OFFLINE = '1'
    $env:DO_NOT_TRACK = '1'
    $env:PAKKA_TEST_ARTIFACTS = $evidence
    $head = (& git rev-parse HEAD).Trim()
    $dirty = @(& git status --porcelain)
    @{ head = $head; dirty = $dirty; tests = $TestFiles; node = (& node --version); startedAt = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $evidence 'run.json')
    & node --test --test-timeout=60000 --test-concurrency=1 @TestFiles *> (Join-Path $evidence 'test.log')
    $code = $LASTEXITCODE
    Get-Content (Join-Path $evidence 'test.log')
    Write-Output ('Evidence: ' + $evidence)
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    Pop-Location
    if ($isolated -and (Test-Path -LiteralPath $isolated)) {
        try { Remove-Item -LiteralPath $isolated -Recurse -Force } catch { Write-Warning ('Temporary test state retained: ' + $isolated) }
    }
}
exit $code
