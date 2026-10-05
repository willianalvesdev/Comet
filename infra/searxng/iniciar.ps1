$ErrorActionPreference = 'Stop'
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$dockerExecutable = if ($dockerCommand) { $dockerCommand.Source } else { $null }
if (-not $dockerExecutable) {
    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe')
    )) {
        if (Test-Path -LiteralPath $candidate) { $dockerExecutable = $candidate; break }
    }
}
if (-not $dockerExecutable) {
    throw 'Instale e abra o Docker Desktop antes de iniciar o SearXNG.'
}
& $dockerExecutable info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'O mecanismo do Docker não está pronto. Abra Docker Desktop e verifique os requisitos de WSL/virtualização.' }

$configDir = Join-Path $PSScriptRoot 'config'
$configFile = Join-Path $configDir 'settings.yml'
if (-not (Test-Path -LiteralPath $configFile)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    $randomBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
    $secret = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    $template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'settings.example.yml') -Raw
    [IO.File]::WriteAllText($configFile, $template.Replace('REPLACE_WITH_RANDOM_SECRET', $secret), (New-Object Text.UTF8Encoding $false))
}
& $dockerExecutable compose -f (Join-Path $PSScriptRoot 'compose.yaml') up -d
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível iniciar o SearXNG.' }
Write-Host 'SearXNG iniciado. Configure SEARXNG_URL=http://127.0.0.1:8888 no .env do Comet e reinicie o site.'
