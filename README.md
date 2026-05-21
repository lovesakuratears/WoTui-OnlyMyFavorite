# WoTui - OnlyMyFavorite

> 微博归档器 — 订阅你喜欢的微博用户，本地归档其帖子内容（文字+图片）

![版本](https://img.shields.io/badge/version-0.2.0-orange)
![技术栈](https://img.shields.io/badge/stack-Express%20%2B%20React%2018-blue)

## ✨ 功能特性

- 🔐 **微博登录** — 自动浏览器窗口 + 手动 Cookie 设置
- 📋 **订阅管理** — 添加/删除微博用户订阅
- 🔄 **帖子抓取** — 支持全量/增量/并发/断点恢复/终止
- 🖼️ **图片归档** — 自动下载帖子图片，去重/重试/0字节检测/已有检测跳过
- 🔍 **全文搜索** — 关键字搜索 + 多维度筛选（用户/时间/有图无图）
- 📄 **分页浏览** — 自定义每页条数（10-50条），页码跳转
- 💾 **图片下载** — 一键保存图片到本地
- 📊 **订阅管理** — 字母排序 + 分页显示
- 🏷️ **无图标记** — 帖子标记+筛选有图/无图
- ⏰ **微博风格时间** — 近期相对时间，远期简洁日期
- 📡 **实时进度** — SSE 推送抓取进度
- 🛡️ **数据保护** — Cookie失效时保存已抓数据 + 缺图帖子自动补全
- 🔄 **强制全量** — 支持对已有订阅重新全量抓取（覆盖更新）

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Express + Playwright + Axios |
| 前端 | React 18 (CDN) + Babel Standalone |
| 数据存储 | 本地 JSON 文件 + 内存 LRU 缓存 |
| 样式 | 纯 CSS |

## 📦 安装与启动

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [npm](https://www.npmjs.com/)

### 快速启动

```bash
# 克隆仓库
git clone git@github.com:lovesakuratears/WoTui-OnlyMyFavorite.git
cd WoTui-OnlyMyFavorite

# 安装依赖
npm install

# 启动（Windows 双击 start.bat 或）
node server.js
```

启动后访问 [http://localhost:3000](http://localhost:3000)

### Windows 用户

双击 `start.bat` 即可一键启动。

## 📖 使用指南

### 1. 登录微博

首次使用需要登录微博账号：
- 点击「登录微博」按钮，自动打开浏览器窗口
- 在浏览器中完成微博登录
- 登录成功后点击「已登录完成」确认

也可以手动粘贴 Cookie。

### 2. 添加订阅

- 在侧边栏输入微博用户 UID
- 点击「添加订阅」，系统自动获取用户信息

### 3. 抓取帖子

- **增量抓取**：只获取上次抓取后的新帖子
- **全量抓取**：获取该用户所有帖子（仅首次无数据时可用，或通过「强制全量」按钮）
- 抓取过程支持实时查看进度和终止

### 4. 搜索帖子

- 使用顶部搜索栏进行全文搜索
- 可按关键字、指定用户、时间范围、有图/无图筛选
- 搜索结果高亮显示匹配关键字

### 5. 浏览与下载

- 分页浏览帖子，可自定义每页显示条数
- 鼠标悬停图片可一键下载到本地
- 无图帖子有明确标记，支持筛选

## 📁 项目结构

```
weibo-archiver/
├── server.js              # Express 后端（API 路由 + 抓取逻辑）
├── package.json           # 依赖管理
├── start.bat              # Windows 启动脚本
├── .gitignore
├── README.md
├── docs/                  # 文档
│   ├── PRD-v0.2.0.md
│   └── ARCHITECTURE-v0.2.0.md
├── public/                # 前端静态文件
│   ├── index.html         # 入口 HTML
│   ├── app.js             # React 前端（单文件，Babel 编译）
│   └── styles.css         # 全部样式
└── data/                  # 本地数据（已 gitignore）
    ├── subscriptions.json # 订阅列表
    └── users/
        └── {uid}/
            ├── posts.json     # 该用户所有帖子
            ├── profile.json   # 用户资料
            ├── checkpoint.json # 断点信息
            └── images/        # 下载的图片
```

## 🔌 API 接口

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/auth/status | 获取登录状态 |
| POST | /api/auth/login | 启动浏览器登录 |
| POST | /api/auth/confirm-login | 确认登录完成 |
| POST | /api/auth/logout | 退出登录 |
| POST | /api/auth/set-cookie | 手动设置 Cookie |
| POST | /api/auth/verify | 验证 Cookie 有效性 |

### 订阅
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/subscriptions | 获取订阅列表 |
| POST | /api/subscriptions | 添加订阅 |
| DELETE | /api/subscriptions/:uid | 删除订阅 |

### 帖子
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/posts/:uid | 获取帖子列表（分页） |
| GET | /api/search | 全文搜索帖子 |

### 抓取
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/fetch/:uid | 触发抓取（增量/全量/强制全量） |
| POST | /api/fetch/:uid/abort | 终止抓取 |
| GET | /api/fetch/queue | 查看任务队列 |

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/images/:uid/:filename | 获取/下载图片 |
| GET | /api/profile/:uid | 获取用户资料 |
| GET | /api/search | 搜索帖子 |
| GET | /api/health | 健康检查 |

## 📝 版本历史

### v0.2.0 — 功能增强版
- ✨ 新增全文搜索（关键字+用户+时间+图片筛选）
- ✨ 新增帖子分页加载（10-50条/页，页码跳转）
- ✨ 新增图片下载按钮（一键保存到本地）
- ✨ 新增订阅列表分页+字母排序
- ✨ 新增强制全量抓取入口（覆盖更新）
- ✨ 搜索结果关键字高亮
- ✨ 全量模式进度标签

### v0.1.0 — 基础增强版
- ✨ 全量爬取只允许首次，后续一律增量
- ✨ 时间显示改为微博风格
- ✨ 无图帖子标记+筛选
- 🐛 Cookie失效后图片丢失修复
- 🐛 订阅列表 postCount 实时统计修复

### v0.0.9 — 稳定性增强版
- ✨ 后台持续抓取（不依赖前端页面）
- ✨ 启动时自动恢复断点任务
- ✨ 已有图片检测跳过
- 🐛 帖子合并保留 localPics

### v0.0.8 — 并发与断点
- ✨ 并发任务队列
- ✨ 终止抓取+断点恢复
- 🐛 Cookie失效时先保存已抓数据

### v0.0.7 — 稳定性修复
- 🐛 Playwright 浏览器实例内存泄漏修复
- ✨ 优雅退出处理

### v0.0.6 — 数据安全
- ✨ 图片下载增量保存
- ✨ 进程防崩溃保护

### v0.0.5 — 基础修复
- 🐛 移动端 API since_id 翻页修复
- ✨ 登录流程优化

## ⚠️ 注意事项

- 本工具仅供个人学习使用，请遵守微博相关使用条款
- 抓取间隔已设置为宽松模式以降低 IP 封禁风险
- 数据存储在本地，不会上传至任何服务器
- 建议定期备份 `data/` 目录

## 📄 License

MIT
