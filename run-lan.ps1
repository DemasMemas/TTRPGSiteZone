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
foreach ($adapter in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($adapter.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) {
        continue
    }
    if ($adapter.Name -notmatch 'Radmin' -and $adapter.Description -notmatch 'Radmin') {
        continue
    }
    $address = $adapter.GetIPProperties().UnicastAddresses | Where-Object {
        $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
    } | Select-Object -First 1
    if ($address) {
        $radminIp = $address.Address.IPAddressToString
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
    Write-Warning 'No active Radmin VPN adapter with an IPv4 address was found. Check the Radmin connection before inviting players.'
}
Write-Host 'Press Ctrl+C to stop the server.' -ForegroundColor DarkGray
Write-Host ''

& $python run.py
exit $LASTEXITCODE
