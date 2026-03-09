# Script para iniciar el POS en modo desarrollo desde PowerShell
# Uso: .\start-dev.ps1

$ErrorActionPreference = "Stop"
$env:NODE_PATH = "C:\Program Files\nodejs"
$env:PATH = "$env:NODE_PATH;$env:PATH"
$env:NODE_ENV = "development"

Set-Location $PSScriptRoot

Write-Host "[StockFlow POS] Iniciando modo desarrollo..." -ForegroundColor Cyan

# Verificar Node
try { node --version | Out-Null } catch {
    Write-Host "ERROR: Node.js no encontrado." -ForegroundColor Red
    exit 1
}

# Verificar dependencias
if (-not (Test-Path "node_modules\electron\dist\electron.exe")) {
    Write-Host "[StockFlow POS] Instalando dependencias..." -ForegroundColor Yellow
    npm install --ignore-scripts
    node node_modules\electron\install.js
}

# Iniciar Vite en background
Write-Host "[StockFlow POS] Iniciando Vite en puerto 5174..." -ForegroundColor Cyan
$vite = Start-Process -FilePath "node" -ArgumentList "node_modules\vite\bin\vite.js" -PassThru -NoNewWindow

Write-Host "[StockFlow POS] Esperando que Vite este listo (5 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Iniciar Electron
Write-Host "[StockFlow POS] Iniciando Electron..." -ForegroundColor Green
node launch-electron.js

# Al cerrar Electron, detener Vite
Write-Host "[StockFlow POS] Aplicacion cerrada. Deteniendo Vite..." -ForegroundColor Yellow
if ($vite -and !$vite.HasExited) { $vite.Kill() }
