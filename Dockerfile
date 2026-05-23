# ── CloakBrowser 隐形 Chromium ──
# C++ 源码级防反爬，自动下载约 200MB 隐身 Chromium 二进制
FROM node:20-bookworm-slim

# 换国内源（阿里云镜像）
RUN sed -i "s@http://deb.debian.org@http://mirrors.aliyun.com@g" /etc/apt/sources.list.d/debian.sources \
    && sed -i "s@https@http@g" /etc/apt/sources.list.d/debian.sources

# 安装 Chromium 系统依赖 + ca-certificates（用于 HTTPS 下载）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxcb1 libxkbcommon0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libxshmfence1 libglib2.0-0 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./

RUN npm config set registry https://registry.npmmirror.com/
RUN npm install --production --no-audit

# 预下载 CloakBrowser 隐形 Chromium 二进制
RUN npx cloakbrowser install

COPY server.js ./
COPY public/ ./public/
COPY data/ ./data/

ENV NODE_ENV=production PORT=3030 LOG_LEVEL=info
VOLUME ["/app/data"]
EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3030/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]