<div align="center">
  <img src="/logo/logo.png" width="100" height="100" alt="WoTui Logo">
  <h1 align="center" style="margin-top: 12px; font-size: 2.2em; background: linear-gradient(135deg, #ff3366, #ee0979); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">WoTui · OnlyMyFavorite</h1>
  <p align="center" style="font-size: 1.1em; color: #888;">
    订阅你喜欢的微博用户，本地完整归档帖子内容（文字 + 图片）
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/version-1.0.0-ff3366" alt="版本">
    <img src="https://img.shields.io/badge/stack-Express%20%2B%20React%2018-7c3aed" alt="技术栈">
    <img src="https://img.shields.io/badge/docker-supported-2496ED" alt="Docker">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  </p>
</div>

---

## 🌟 项目简介

WoTui（我推）是一个微博内容归档工具，帮助你订阅关注的微博用户，自动抓取并本地保存其全部帖子与图片。支持 Docker 一键部署，数据完全存储在本地，隐私安全。

> **v1.0 正式版** — 采用 CloakBrowser 隐形 Chromium 内核（C++ 源码级反爬），Docker 环境完美支持无头浏览器登录。

---

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| 🔐 **微博登录** | 自动浏览器窗口 / 手动 Cookie 粘贴 / Docker 无头截图登录 |
| 🛡️ **CloakBrowser 隐形内核** | C++ 源码级反爬补丁，57 个补丁绕过 reCAPTCHA v3 |
| 📋 **订阅管理** | 添加/删除微博用户订阅，字母排序 + 分页 |
| 🔄 **智能抓取** | 全量 / 增量 / 并发 / 断点恢复 / 强制全量覆盖 |
| 🖼️ **图片归档** | 自动下载帖子图片，去重 + 重试 + 已有检测跳过 |
| 🔍 **全文搜索** | 关键字 + 多维度筛选（用户 / 时间 / 有图无图） |
| 📄 **分页浏览** | 自定义每页条数（10-50条），页码跳转 |
| 💾 **图片下载** | 一键保存图片到本地 |
| 📡 **实时进度** | SSE 推送抓取进度，无需刷新页面 |
| 🐳 **Docker 支持** | 一键容器化部署，数据持久化 |
| 🖥️ **截图日志面板** | Docker 无头模式下截图 + 日志 + 计时器一体化面板 |

---

## 🚀 快速启动

### 方式一：Docker（推荐）

```bash
# 克隆项目
git clone https://github.com/lovesakuratears/WoTui-OnlyMyFavorite.git
cd WoTui-OnlyMyFavorite

# 一键启动（构建 + 运行）
docker compose up -d

# 查看日志
docker compose logs -f

# 访问
open http://localhost:3030
```

> 首次构建需下载 CloakBrowser 隐形 Chromium（约 200MB），请耐心等待。

### 方式二：本地 Node.js

```bash
# 前置要求：Node.js >= 20

git clone https://github.com/lovesakuratears/WoTui-OnlyMyFavorite.git
cd WoTui-OnlyMyFavorite

npm install
node server.js

# 访问
open http://localhost:3030
```

---

## 📖 使用指南

### 1. 登录微博

点击顶部导航栏 **「登录微博」** 按钮。

**本地环境：** 自动弹出浏览器窗口，在窗口中完成登录后点击 **「我已完成登录」**。

**Docker 环境：** 自动打开无头浏览器加载微博登录页，截图实时展示在 **Docker 登录面板** 中。使用手机微博 App 扫描截图中的二维码完成登录，系统会自动检测并保存 Cookie。面板同时显示：
- 实时截图（每 2 秒刷新）
- 操作日志（页面加载 / 点击扫码 / 截图大小等信息）
- 等待计时器（已等待秒数）
- 超时提示（超过 15 秒截图未显示时）
- **「我已完成登录」** 确认按钮

### 2. 添加订阅

在左侧侧边栏输入微博用户 **UID**（纯数字）或 **主页 URL**，点击 **「+ 添加订阅」**。支持格式：
- `1669879400`
- `https://weibo.com/u/1669879400`
- `https://m.weibo.cn/profile/1669879400`

### 3. 抓取帖子

- **增量抓取**：只获取上次截断后的新帖子（默认，点击 `↻`）
- **全量抓取**：首次添加自动全量抓取（点击 `⟳+` 可强制重新全量）
- **终止抓取**：点击 `⏹` 可随时终止，已抓取内容自动保存

### 4. 搜索

侧边栏搜索框支持：
- 关键字搜索（帖子文本内容）
- 指定用户范围（全部 / 选定用户）
- 时间范围筛选
- 有图 / 无图筛选
- 搜索结果高亮显示

---

## 🐳 Docker 详细说明

### 技术实现

WoTui 在 Docker 环境下使用 **CloakBrowser** 隐形 Chromium 内核以 **headless 模式**（无头）运行。登录流程：

1. 服务端启动无头浏览器，打开 `m.weibo.cn/login`
2. 页面加载后自动点击 **「扫码登录」** 按钮切换至二维码模式
3. 每 2 秒截图一次，通过 SSE 推送至前端展示
4. Cookie 自动监测（每 3 秒检查 SUB + SUBP + URL 跳转状态）
5. 用户也可手动点击 **「我已完成登录」** 按钮确认
6. 10 分钟超时自动关闭

### 构建与运行

```bash
# 构建镜像
docker compose build

# 启动
docker compose up -d

# 停止
docker compose down

# 查看日志
docker compose logs -f
```

### 数据持久化

用户数据（帖子、图片、Cookie）存储在 Docker volume `wotui_data` 中：

```bash
docker volume inspect wotui_data
```

如需备份：

```bash
# 导出数据
docker run --rm -v wotui_data:/source -v $(pwd):/backup alpine tar czf /backup/wotui_backup.tar.gz -C /source .

# 恢复数据
docker run --rm -v wotui_data:/target -v $(pwd):/backup alpine tar xzf /backup/wotui_backup.tar.gz -C /target
```

---

## 📁 项目结构

```
WoTui-OnlyMyFavorite/
├── server.js              # Express 后端（CloakBrowser 集成 + API 路由）
├── package.json
├── CHANGELOG.json         # 版本变更记录
├── Dockerfile             # 容器镜像定义（基于 node:20-bookworm-slim）
├── docker-compose.yml     # 一键部署配置
├── .dockerignore
├── start.bat              # Windows 启动脚本
├── public/                # 前端静态文件
│   ├── index.html
│   ├── app.js             # React 18 应用（CDN + Babel Standalone）
│   ├── styles.css         # 暗色 Glassmorphism 样式
│   ├── logo.svg           # 项目主 logo
│   └── favicon.ico
├── tools/                 # 辅助工具脚本
│   ├── cookie-helper.html
│   └── 导出Cookie-Mac.command
├── data/                  # 本地用户数据（.gitignore）
│   ├── cookies.json
│   ├── subscriptions.json
│   └── users/
│       └── {uid}/
│           ├── profile.json
│           ├── posts.json
│           ├── images/
│           └── checkpoint.json
└── logs/                  # 日志文件
    └── YYYY-MM-DD.log
```

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Express + CloakBrowser + playwright-core + Axios |
| 前端 | React 18（CDN）+ Babel Standalone |
| 数据存储 | 本地 JSON 文件 + 内存 LRU 缓存 |
| 样式 | 纯 CSS（暗色 Glassmorphism 设计） |
| 容器化 | Docker + docker-compose |
| 实时通信 | SSE（Server-Sent Events） |
| 浏览器引擎 | CloakBrowser 隐形 Chromium（C++ 源码级防反爬） |

---

## 📝 版本历史

完整的版本变更记录请查看 [CHANGELOG.json](CHANGELOG.json)。

---

## ⚠️ 注意事项

- 本工具仅供个人学习使用，请遵守微博相关使用条款
- 抓取间隔已设置为宽松模式（2-5 秒随机延迟）以降低 IP 封禁风险
- 数据存储在本地，不会上传至任何服务器
- 建议定期备份 `data/` 目录（或 Docker volume）
- CloakBrowser 首次运行需下载约 200MB 隐形 Chromium 二进制

## 📄 License

MIT © [lovesakuratears](https://github.com/lovesakuratears)