@echo off
REM WoTui Cookie 导出工具 - Windows 双击启动器
REM 把本文件拖到桌面，双击即可运行

setlocal
cd /d "%~dp0\.."

REM 检查 Node
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo X 未安装 Node.js
  echo   请先从 https://nodejs.org 下载并安装 Node.js 18+
  echo.
  pause
  exit /b 1
)

REM 检查依赖
if not exist "node_modules" (
  echo -^> 首次运行，正在安装依赖...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo X 依赖安装失败
    pause
    exit /b 1
  )
)

REM 启动 CLI
node tools\wotui-cookie-export.js %*

echo.
pause
