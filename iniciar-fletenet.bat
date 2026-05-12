@echo off
title FleteNet - Sistema de Gestion de Fletes
color 0A
cls

echo.
echo  ╔════════════════════════════════════════╗
echo  ║     FleteNet — Iniciando sistema...    ║
echo  ╚════════════════════════════════════════╝
echo.

:: Ir a la carpeta del backend
cd /d "%~dp0backend"

:: Verificar si Node.js está instalado
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js no está instalado.
    echo  Descargalo desde: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Instalar dependencias si no existen
if not exist "node_modules" (
    echo  Instalando dependencias por primera vez...
    echo  Esto puede tardar unos minutos.
    echo.
    npm install
    echo.
)

:: Iniciar el servidor
echo  Abriendo FleteNet en el navegador...
echo.
start "" http://localhost:3000

:: Arrancar Node
node server.js

:: Si el servidor se cierra
echo.
echo  [!] El servidor se detuvo.
pause
