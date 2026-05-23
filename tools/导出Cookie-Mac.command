#!/bin/bash
# WoTui Cookie 导出工具 - macOS 双击启动器
# 把本文件拖到桌面，双击即可运行（首次运行可能弹出权限提示，选择"打开"）

set -e
cd "$(dirname "$0")/.."

# 检查 Node
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "✗ 未安装 Node.js"
  echo "  请先从 https://nodejs.org 下载并安装 Node.js 18+"
  echo ""
  read -p "按回车键关闭..."
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo ""
  echo "✗ Node.js 版本过低 ($(node -v))"
  echo "  需要 Node.js 18 或更高版本"
  echo ""
  read -p "按回车键关闭..."
  exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
  echo "→ 首次运行，正在安装依赖..."
  npm install --no-audit --no-fund
fi

# 启动 CLI
node tools/wotui-cookie-export.js "$@"

echo ""
read -p "按回车键关闭..."
