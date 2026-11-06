[string[]]$ComposeArgs = @(if ($args.Count) { $args } else { 'ps' })
$ErrorActionPreference = 'Stop'
$dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
$dockerPath = if ($dockerCommand) { $dockerCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath $dockerPath)) {
    $dockerPath = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
}
if (-not (Test-Path -LiteralPath $dockerPath)) {
    throw 'Docker CLI was not found. Install Docker Desktop and add docker to PATH.'
}
$repoRoot = Split-Path -Parent $PSScriptRoot
& $dockerPath compose --project-directory $repoRoot -f (Join-Path $repoRoot 'compose.yaml') @ComposeArgs
exit $LASTEXITCODE
