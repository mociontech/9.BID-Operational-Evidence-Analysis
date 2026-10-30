@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 22 o superior antes de continuar.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Preparando dependencias. Esta primera vez requiere internet.
  call npm.cmd ci
  if errorlevel 1 goto fallo
)
echo Preparando reproductor...
call npm.cmd run build
if errorlevel 1 goto fallo
echo Abre http://localhost:5173 en el navegador.
call npm.cmd start
goto fin
:fallo
echo No se pudo iniciar. Revisa el mensaje anterior.
:fin
pause
