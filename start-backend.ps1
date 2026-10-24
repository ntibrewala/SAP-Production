# Run this script in PowerShell to install and start the SAP-Production Backend on port 5055
$ErrorActionPreference = "Stop"

$BackendDir = Join-Path $PSScriptRoot "backend"
Set-Location $BackendDir

Write-Host "1. Installing backend dependencies..." -ForegroundColor Cyan
npm install

if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Write-Host "2. Starting backend with PM2 on Port 5055..." -ForegroundColor Cyan
    pm2 delete sap-production 2>$null
    pm2 start server.js --name "sap-production"
    pm2 save
    Write-Host "Backend is running in background via PM2 on http://127.0.0.1:5055" -ForegroundColor Green
} else {
    Write-Host "2. Starting backend with Node.js on Port 5055..." -ForegroundColor Cyan
    node server.js
}
