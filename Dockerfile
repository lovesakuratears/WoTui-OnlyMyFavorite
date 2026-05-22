# ── Stage 1: 安装 Playwright 浏览器 ──────────────────────────────────────────
FROM node:20-bookworm-slim AS playwright-install

# 正确顺序：先换源 → 再更新
RUN sed -i "s@http://deb.debian.org@http://mirrors.aliyun.com@g" /etc/apt/sources.list.d/debian.sources \
    && sed -i "s@https@http@g" /etc/apt/sources.list.d/debian.sources

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 关键：删掉失效的加速！直接用官方源（现在系统源已经正常，能跑通）
WORKDIR /app
COPY package.json ./

RUN npm config set registry https://registry.npmmirror.com/
RUN npm install --production --no-audit

# 只安装浏览器，不自动装依赖（避免再次触发apt）
RUN npx playwright install chromium

# ── Stage 2: 最终镜像 ────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# 最终镜像也换国内源
RUN sed -i "s@http://deb.debian.org@http://mirrors.aliyun.com@g" /etc/apt/sources.list.d/debian.sources \
    && sed -i "s@https@http@g" /etc/apt/sources.list.d/debian.sources

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxcb1 libxkbcommon0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libxshmfence1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=playwright-install /app/node_modules ./node_modules
COPY --from=playwright-install /root/.cache/ms-playwright /root/.cache/ms-playwright

COPY server.js ./
COPY public/ ./public/
COPY demo-data/ ./data/

ENV NODE_ENV=production PORT=3000 LOG_LEVEL=info
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]