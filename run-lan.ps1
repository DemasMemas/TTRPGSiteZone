param(
    [ValidateRange(1, 65535)]
    [int]$Port = 5000,
    [switch]$SkipMigrations
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (Test-Path -LiteralPath $venvPython) {
    $python = $venvPython
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw 'Python was not found. Create .venv or add Python to PATH.'
    }
    $python = $pythonCommand.Source
}

Set-Location -LiteralPath $projectRoot

if (-not $SkipMigrations) {
    Write-Host 'Applying database migrations...' -ForegroundColor DarkGray
    & $python -m flask --app run.py db upgrade
    if ($LASTEXITCODE -ne 0) {
        throw 'Database migration failed. The server was not started.'
    }
}

$radminIp = $null
$insideRadminAdapter = $false
foreach ($line in (ipconfig)) {
    if ($line -match 'adapter\s+Radmin VPN\s*:') {
        $insideRadminAdapter = $true
        continue
    }
    if ($insideRadminAdapter -and $line -match '^\S.*adapter\s+') {
        break
    }
    if ($insideRadminAdapter -and $line -match 'IPv4.*?:\s*((?:\d{1,3}\.){3}\d{1,3})') {
        $radminIp = $Matches[1]
        break
    }
}

$env:FLASK_HOST = '0.0.0.0'
$env:FLASK_PORT = [string]$Port
$env:FLASK_DEBUG = '0'

Write-Host ''
Write-Host 'Perimetr LAN server is starting.' -ForegroundColor Green
Write-Host "Local address:  http://127.0.0.1:$Port"
if ($radminIp) {
    Write-Host "Radmin address: http://${radminIp}:$Port" -ForegroundColor Cyan
} else {
    Write-Warning 'Radmin VPN adapter was not found. Start Radmin VPN before inviting players.'
}
Write-Host 'Press Ctrl+C to stop the server.' -ForegroundColor DarkGray
Write-Host ''

& $python run.py
exit $LASTEXITCODE
