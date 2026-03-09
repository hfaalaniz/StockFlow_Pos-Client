@echo off
REM Script para iniciar el POS en modo desarrollo desde cmd.exe

SET NODE_PATH=C:\Program Files\nodejs
SET PATH=%NODE_PATH%;%PATH%

echo [StockFlow POS] Iniciando modo desarrollo...
echo.

cd /d "%~dp0"

node --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo ERROR: Node.js no encontrado.
    pause
    exit /b 1
)

IF NOT EXIST "node_modules\electron\dist\electron.exe" (
    echo [StockFlow POS] Instalando dependencias...
    npm install --ignore-scripts
    node node_modules\electron\install.js
)

echo [StockFlow POS] Iniciando Vite en puerto 5174...
start /b node_modules\.bin\vite.cmd

echo [StockFlow POS] Esperando que Vite este listo (5 segundos)...
timeout /t 5 /nobreak >nul

echo [StockFlow POS] Iniciando Electron (modo desarrollo)...
set NODE_ENV=development
node launch-electron.js

echo [StockFlow POS] Aplicacion cerrada.
