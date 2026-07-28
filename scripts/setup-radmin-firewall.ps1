#Requires -RunAsAdministrator

param(
    [ValidateRange(1, 65535)]
    [int]$Port = 5000
)

$ErrorActionPreference = 'Stop'
$ruleName = "Perimetr Radmin VPN (TCP $Port)"
$adapter = Get-NetAdapter -ErrorAction Stop |
    Where-Object {
        $_.Name -eq 'Radmin VPN' -or
        $_.InterfaceDescription -like '*Radmin VPN*'
    } |
    Select-Object -First 1

if (-not $adapter) {
    throw 'Radmin VPN adapter was not found. Start or reinstall Radmin VPN and try again.'
}

$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
    Enable-NetFirewallRule -DisplayName $ruleName | Out-Null
    Write-Host "Firewall rule already exists and is enabled: $ruleName" -ForegroundColor Green
    exit 0
}

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Description 'Allows Perimetr only through the Radmin VPN adapter.' `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Any `
    -InterfaceAlias $adapter.Name `
    -RemoteAddress '26.0.0.0/8' `
    -Protocol TCP `
    -LocalPort $Port | Out-Null

Write-Host "Firewall rule created: $ruleName" -ForegroundColor Green
Write-Host "Adapter: $($adapter.Name); remote range: 26.0.0.0/8; local TCP port: $Port"
