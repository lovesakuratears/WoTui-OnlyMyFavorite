# ── Stage 1: 安装 Playwright 浏览器 ──────────────────────────────────────────
FROM node:20-bookworm-slim AS playwright-install

WORKDIR /app

# 只复制 package.json 以利用缓存
COPY package.json ./

# 安装生产依赖
RUN npm install --production --no-audit

# 安装 Playwright Chromium 及系统依赖
RUN npx playwright install chromium --with-deps

# ── Stage 2: 最终镜像 ────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# 系统依赖（Playwright Chromium 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxcb1 libxkbcommon0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libxshmfence1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 从 Stage 1 复制 node_modules 和 Playwright 浏览器缓存
COPY --from=playwright-install /app/node_modules ./node_modules
COPY --from=playwright-install /root/.cache/ms-playwright /root/.cache/ms-playwright

# 复制应用代码
COPY server.js ./
COPY public/ ./public/

# 复制 Demo 示例数据（让新部署用户立即有内容可看）
COPY demo-data/ ./data/

# 环境变量
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=info

# 数据目录挂载点（用户真实数据持久化）
VOLUME ["/app/data"]

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
