# 微博归档器

本地化微博订阅归档工具，基于 Node.js + Express + Playwright，支持订阅微博用户、全量/增量抓取内容、本地存储和页面展示。

---

## 🚀 快速启动

### 1. 安装依赖

```bash
cd weibo-archiver
npm install
```

### 2. 安装 Playwright 浏览器（首次运行需要）

```bash
npx playwright install chromium
```

### 3. 启动服务

```bash
npm start
# 或使用热重载开发模式：
npm run dev
```

服务启动后访问：**http://localhost:3000**

---

## 📦 项目结构

```
weibo-archiver/
├── package.json         # 依赖配置
├── server.js            # 后端服务（Express + Playwright）
├── data/                # 本地数据存储（自动创建）
│   ├── subscriptions.json  # 订阅列表
│   ├── cookie.json         # 微博 Cookie
│   └── users/
│       └── {uid}/
│           ├── profile.json    # 用户信息
│           ├── posts.json      # 归档帖子
│           └── images/         # 下载的图片
└── public/
    ├── index.html       # 主页面
    ├── app.js           # 前端 React 应用
    └── styles.css       # 样式
```

---

## 🍪 配置微博 Cookie（重要）

首次使用前，需要配置微博 Cookie 以绕过登录限制：

1. 在浏览器中访问 [weibo.com](https://weibo.com) 并登录
2. 按 **F12** 打开开发者工具 → **Network** 标签
3. 刷新页面，找到任意对 `weibo.com` 的请求
4. 在 **Request Headers** 中找到 `Cookie` 字段，复制全部值
5. 在归档器页面右上角点击 **⚙️ 设置** → 粘贴 Cookie → **保存**

---

## 📖 功能说明

### 添加订阅
- 点击右上角「**+ 添加订阅**」
- 输入微博用户 **UID**（纯数字）或直接粘贴**微博主页 URL**（自动提取 UID）
- 设置抓取间隔（默认 1 小时）
- 首次添加后自动触发**全量抓取**

### 查看归档内容
- 在左侧侧边栏选择订阅用户
- 右侧展示归档的微博卡片（含文字、图片、互动数据）
- 图片支持**点击放大**（Lightbox），键盘左右键切换

### Mock 演示
- 无需登录即可体验 UI，右上角切换「**📦 Mock 模式**」
- 或点击首页「查看 Mock 演示」按钮

### 手动抓取
- 侧边栏每个用户右侧的 **🔄** 按钮：触发增量抓取
- 用户信息栏的「🔄 立即抓取」按钮：同上

### 删除订阅
- 侧边栏每个用户右侧的 **🗑️** 按钮
- 注意：删除订阅**不会删除**已归档的本地数据

---

## 🛡️ 反爬策略

- 使用 Playwright Chromium（非无头模式，方便调试）
- 注入脚本隐藏 `navigator.webdriver` 特征
- 伪装真实 Chrome UA（Windows Chrome 124）
- 设置中文 locale 和 Asia/Shanghai 时区
- 滚动之间加入随机延迟（800ms - 2000ms）
- 图片下载携带 `Referer: https://weibo.com`

---

## 🔌 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/subscriptions` | 获取所有订阅 |
| POST | `/api/subscriptions` | 添加订阅 |
| DELETE | `/api/subscriptions/:uid` | 删除订阅 |
| GET  | `/api/posts/:uid` | 获取归档帖子（分页） |
| POST | `/api/fetch/:uid` | 触发抓取 |
| GET  | `/api/status` | 获取抓取状态 |
| POST | `/api/set-cookie` | 设置 Cookie |
| GET  | `/api/images/:uid/:filename` | 代理本地图片 |
| GET  | `/api/mock-posts/:uid` | Mock 演示数据 |
| GET  | `/api/profile/:uid` | 获取用户 profile |

---

## ⚠️ 注意事项

1. **Node.js 版本**：需要 18.0.0 或以上
2. **微博 DOM 结构**：微博前端随时可能变更，如解析失败会保存原始 HTML 到 `data/users/{uid}/raw_last.html` 供调试
3. **Cookie 有效期**：微博 Cookie 有效期通常为 30 天，过期后需重新配置
4. **首次 Playwright 安装**：约需下载 100MB+ 的 Chromium

---

## 📄 License

MIT
