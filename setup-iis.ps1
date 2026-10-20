# Run this script as Administrator in PowerShell on 10.10.0.15
$ErrorActionPreference = "Stop"

$SiteName = "SAP-Production"
$AppPoolName = "SAP-Production-Pool"
$Port = 8085
$SourceFrontend = Join-Path $PSScriptRoot "frontendbuilt"
$IisTargetFolder = "C:\inetpub\wwwroot\SAP-Production"

Write-Host "1. Copying frontendbuilt to $IisTargetFolder for IIS..." -ForegroundColor Cyan
if (!(Test-Path $IisTargetFolder)) {
    New-Item -ItemType Directory -Path $IisTargetFolder -Force | Out-Null
}
Copy-Item -Path "$SourceFrontend\*" -Destination $IisTargetFolder -Recurse -Force

Write-Host "2. Setting IIS folder permissions on $IisTargetFolder..." -ForegroundColor Cyan
icacls $IisTargetFolder /grant "IIS_IUSRS:(OI)(CI)RX" /grant "IUSR:(OI)(CI)RX" /T /Q | Out-Null

Import-Module WebAdministration

Write-Host "3. Configuring IIS Application Pool ($AppPoolName)..." -ForegroundColor Cyan
if (!(Test-Path "IIS:\AppPools\$AppPoolName")) {
    New-WebAppPool -Name $AppPoolName | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name "managedRuntimeVersion" -Value ""

Write-Host "4. Creating IIS Website ($SiteName) on Port $Port..." -ForegroundColor Cyan
if (Test-Path "IIS:\Sites\$SiteName") {
    Remove-Website -Name $SiteName
}
New-Website -Name $SiteName -Port $Port -PhysicalPath $IisTargetFolder -ApplicationPool $AppPoolName -Force | Out-Null
Start-Website -Name $SiteName

Write-Host "5. Opening Windows Firewall for TCP Port $Port..." -ForegroundColor Cyan
if (!(Get-NetFirewallRule -DisplayName "SAP-Production-IIS-$Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "SAP-Production-IIS-$Port" -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow | Out-Null
}

Write-Host ""
Write-Host "SUCCESS! IIS Frontend is live at: http://10.10.0.15:$Port" -ForegroundColor Green
