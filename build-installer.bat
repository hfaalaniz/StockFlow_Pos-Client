@echo off
REM Script para generar el instalador Windows del POS
REM Ejecutar desde PowerShell o cmd.exe

SET NODE_PATH=C:\Program Files\nodejs
SET PATH=%NODE_PATH%;%PATH%

echo [StockFlow POS] Generando instalador Windows...
echo.

cd /d "%~dp0"

node --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo ERROR: Node.js no encontrado.
    pause
    exit /b 1
)

echo [StockFlow POS] Compilando React con Vite...
node_modules\.bin\vite.cmd build
IF ERRORLEVEL 1 (
    echo ERROR: Fallo el build de Vite.
    pause
    exit /b 1
)

echo [StockFlow POS] Empaquetando con electron-builder...
node_modules\.bin\electron-builder.cmd
IF ERRORLEVEL 1 (
    echo ERROR: Fallo electron-builder.
    pause
    exit /b 1
)

echo.
echo [StockFlow POS] Instalador generado en: release\
dir release\*.exe 2>nul
pause
