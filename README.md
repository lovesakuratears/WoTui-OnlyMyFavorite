# WoTui · OnlyMyFavorite

> 订阅你喜欢的微博用户，本地完整归档其帖子内容（文字 + 图片）

![版本](https://img.shields.io/badge/version-0.3.0-ff3366)
![技术栈](https://img.shields.io/badge/stack-Express%20%2B%20React%2018-7c3aed)
![Docker](https://img.shields.io/badge/docker-supported-2496ED)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ 功能特性

- 🔐 **微博登录** — 自动浏览器窗口 + 手动 Cookie 设置
- 📋 **订阅管理** — 添加/删除微博用户订阅，字母排序+分页
- 🔄 **帖子抓取** — 支持全量/增量/并发/断点恢复/终止/强制全量
- 🖼️ **图片归档** — 自动下载帖子图片，去重/重试/已有检测跳过
- 🔍 **全文搜索** — 关键字 + 多维度筛选（用户/时间/有图无图）
- 📄 **分页浏览** — 自定义每页条数（10-50条），页码跳转
- 💾 **图片下载** — 一键保存图片到本地
- 🏷️ **无图标记** — 帖子标记+筛选有图/无图
- ⏰ **微博风格时间** — 近期相对时间，远期简洁日期
- 📡 **实时进度** — SSE 推送抓取进度
- 🐳 **Docker 支持** — 一键容器化部署
<img width="702" height="1188" alt="ce307fa80642d073ca8f79d40661bb97" src="https://github.com/user-attachments/assets/ffd21f2a-bd46-4623-a874-d6c654116393" />

## 🚀 快速启动

### 方式一：Docker（推荐）

```bash
# 克隆项目
git clone https://github.com/lovesakuratears/WoTui-OnlyMyFavorite.git
cd WoTui-OnlyMyFavorite

# 一键启动（含 Demo 数据）
docker-compose up -d

# 访问
open http://localhost:3000
```

Demo 数据包含示例帖子，部署后**立即可以预览效果**。

> **注意**：首次构建需下载 Playwright Chromium（~300MB），请耐心等待。

### 方式二：本地 Node.js

```bash
# 前置要求：Node.js >= 18

git clone https://github.com/lovesakuratears/WoTui-OnlyMyFavorite.git
cd WoTui-OnlyMyFavorite

npm install
node server.js

# 或 Windows 双击
start.bat
```

访问 [http://localhost:3000](http://localhost:3000)

## 📖 使用指南

### 1. 登录微博

点击「登录微博」按钮，自动打开浏览器完成登录，或手动粘贴 Cookie。

### 2. 添加订阅

在侧边栏输入微博用户 UID 或主页 URL，点击「+ 添加订阅」。

### 3. 抓取帖子

- **增量抓取**：只获取上次后的新帖子（默认）
- **全量抓取**：仅首次可用，获取全部历史帖子
- **强制全量**：点击 🟡 按钮，对已有数据的订阅重新全量抓取（覆盖更新）

### 4. 搜索

侧边栏搜索框支持：关键字 + 指定用户 + 时间范围 + 有图/无图

## 🐳 Docker 详细说明

### 构建镜像

```bash
docker build -t wotui-onlymyfavorite .
```

### 运行容器

```bash
docker run -d \
  --name wotui \
  -p 3000:3000 \
  -v wotui_data:/app/data \
  wotui-onlymyfavorite
```

### 数据持久化

用户数据（帖子、图片、Cookie）存储在 Docker volume `wotui_data` 中。  
首次启动时，容器内的 `demo-data/` 内容会作为初始数据展示。  
实际使用的数据写入 volume，不会覆盖镜像内的 Demo 数据。

## 📁 项目结构

```
WoTui-OnlyMyFavorite/
├── server.js              # Express 后端
├── package.json
├── Dockerfile             # 容器镜像定义
├── docker-compose.yml     # 一键部署配置
├── .dockerignore
├── start.bat              # Windows 启动脚本
├── demo-data/             # 示例数据（Docker 演示用）
│   ├── subscriptions.json
│   ├── cookies.json
│   └── users/demo_user_001/
│       ├── profile.json
│       └── posts.json
├── public/                # 前端静态文件
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── data/                  # 本地用户数据（.gitignore）
```

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Express + Playwright + Axios |
| 前端 | React 18 (CDN) + Babel Standalone |
| 数据存储 | 本地 JSON 文件 + 内存 LRU 缓存 |
| 样式 | 纯 CSS（暗色 Glassmorphism 设计） |
| 容器化 | Docker + docker-compose |

## 📝 版本历史

### v0.3.0 — Docker & UI 重设计
- 🐳 新增 Docker 支持（Dockerfile + docker-compose）
- 🎨 全面重设计 UI（暗色现代风格 + 居中布局 + Glassmorphism）
- 📦 内置 Demo 示例数据（部署即可预览）
- 🏷️ 项目改名为 WoTui · OnlyMyFavorite

### v0.2.0 — 功能增强版
- 全文搜索 / 帖子分页 / 图片下载 / 订阅排序分页 / 强制全量抓取

### v0.1.0 — 基础增强版
- 全量只允许首次 / 微博风格时间 / 无图标记 / Bug修复

### v0.0.9 — 稳定性增强版
- 后台持续抓取 / 断点恢复 / 已有图片检测

## ⚠️ 注意事项

- 本工具仅供个人学习使用，请遵守微博相关使用条款
- 抓取间隔已设置为宽松模式以降低 IP 封禁风险
- 数据存储在本地，不会上传至任何服务器
- 建议定期备份 `data/` 目录（或 Docker volume）

## 📄 License

MIT
