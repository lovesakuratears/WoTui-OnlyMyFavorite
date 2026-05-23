/**
 * server.js - WoTui · OnlyMyFavorite 后端服务 v1.0.0
 *
 * 变更记录：
 *   v1.0.0 - 正式版发布 / Docker 无头登录 + CloakBrowser 隐形内核 / 截图日志一体化面板
 *   v0.5.0 - Docker环境下也支持弹出用户浏览器/移除环境检测和Cookie校验/使用本地数据/默认端口3030
 *   v0.3.0 - 项目改名 WoTui / Docker 支持 / Demo 数据 / 现代化 UI
 *   v0.2.0 - 搜索 API / 全量强制抓取(force) / 全量覆盖更新 / 图片下载 / health 返回版本号
 *   v0.1.0 - 全量只允许首次（有数据自动增量）/ 已有帖子缺图片补全 / Cookie失效后图片不再丢失
 *   v0.0.9 - 全量抓取后台持续运行（页面关闭不影响）/ 已有图片+帖子检测跳过 / 启动时自动恢复断点任务
 *   v0.0.8 - 并发任务队列（多订阅并行抓取）/ 终止抓取+断点恢复 / Cookie失效时先保存已抓数据再报错
 *   v0.0.7 - 修复 Playwright 浏览器内存泄漏（根因：browser 实例从不关闭）/ 优雅退出 / 进程 detach
 *   v0.0.6 - 增量保存（每下载完一个帖子的图片就保存进度）/ 进程防崩溃保护 / 图片下载重试+0字节检测
 *   v0.0.5 - 登录改为用户手动确认（去除误判）/ 加宽松随机延迟防封IP / 内存LRU缓存加速读取
 *   v0.0.4 - 修复登录流程：改用 m.weibo.cn 移动端 / 防止误判登录成功 / 移动端 API 抓取
 *   v0.0.3 - 修复 403 反爬（改用 Playwright 浏览器上下文执行 API 请求） / 修复退出按钮 confirm 拦截
 *   v0.0.2 - 结构化日志系统 / 修复抓取 Bug / SSE 实时进度 / 登录状态验证
 *   v0.0.1 - 自动登录 / Cookie 持久化 / 真实数据抓取
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');

// CloakBrowser 动态导入（ESM 包，用 import() 在 CJS 中使用）
let _cloakModule = null;
async function getCloakBrowser() {
  if (!_cloakModule) {
    _cloakModule = await import('cloakbrowser');
  }
  return _cloakModule;
}
// 同步检测 cloakbrowser 二进制是否已下载
function getCloakBinaryPath() {
  const cacheDir = process.env.CLOAKBROWSER_CACHE_DIR ||
    path.join(os.homedir(), '.cloakbrowser');
  try {
    if (!fs.existsSync(cacheDir)) return null;
    const entries = fs.readdirSync(cacheDir);
    for (const e of entries) {
      const full = path.join(cacheDir, e);
      if (fs.statSync(full).isDirectory()) {
        const chromePath = path.join(full, 'chrome');
        if (fs.existsSync(chromePath)) return chromePath;
      }
    }
  } catch (_) {}
  return null;
}

const app = express();
const PORT = 3030;

/**
 * 检测可用的浏览器内核，优先级：
 *   1) 系统已装的 Chrome / Edge / Brave / Chromium / Arc / Vivaldi
 *   2) CloakBrowser 隐形 Chromium（C++ 源码级防检测）
 */
function getSystemBrowserCandidates() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const apps = [
      ['Google Chrome',         'Google Chrome.app/Contents/MacOS/Google Chrome'],
      ['Microsoft Edge',        'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      ['Brave Browser',         'Brave Browser.app/Contents/MacOS/Brave Browser'],
      ['Chromium',              'Chromium.app/Contents/MacOS/Chromium'],
      ['Arc',                   'Arc.app/Contents/MacOS/Arc'],
      ['Vivaldi',               'Vivaldi.app/Contents/MacOS/Vivaldi'],
      ['Google Chrome Canary',  'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'],
    ];
    const roots = ['/Applications', path.join(home, 'Applications')];
    const out = [];
    for (const [name, rel] of apps) {
      for (const root of roots) out.push({ name, exe: path.join(root, rel) });
    }
    return out;
  }
  if (process.platform === 'win32') {
    const pf  = process.env['PROGRAMFILES']      || 'C:\\Program Files';
    const pf86= process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const lad = process.env['LOCALAPPDATA']      || path.join(home, 'AppData', 'Local');
    return [
      { name: 'Google Chrome',  exe: path.join(pf,   'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Google Chrome',  exe: path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Google Chrome',  exe: path.join(lad,  'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Microsoft Edge', exe: path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe') },
      { name: 'Microsoft Edge', exe: path.join(pf,   'Microsoft\\Edge\\Application\\msedge.exe') },
      { name: 'Brave Browser',  exe: path.join(pf,   'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
      { name: 'Brave Browser',  exe: path.join(pf86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
      { name: 'Brave Browser',  exe: path.join(lad,  'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
      { name: 'Vivaldi',        exe: path.join(lad,  'Vivaldi\\Application\\vivaldi.exe') },
      { name: 'Chromium',       exe: path.join(pf,   'Chromium\\Application\\chrome.exe') },
    ];
  }
  // linux & others
  return [
    { name: 'Google Chrome', exe: '/usr/bin/google-chrome-stable' },
    { name: 'Google Chrome', exe: '/usr/bin/google-chrome' },
    { name: 'Chromium',      exe: '/usr/bin/chromium-browser' },
    { name: 'Chromium',      exe: '/usr/bin/chromium' },
    { name: 'Chromium',      exe: '/snap/bin/chromium' },
    { name: 'Microsoft Edge',exe: '/usr/bin/microsoft-edge-stable' },
    { name: 'Microsoft Edge',exe: '/usr/bin/microsoft-edge' },
    { name: 'Brave Browser', exe: '/usr/bin/brave-browser' },
    { name: 'Brave Browser', exe: '/usr/bin/brave' },
  ];
}

let BROWSER_CACHE = null;
function detectBrowser({ refresh = false } = {}) {
  if (BROWSER_CACHE && !refresh) return BROWSER_CACHE;

  // 1) 系统浏览器
  for (const c of getSystemBrowserCandidates()) {
    try {
      if (fs.existsSync(c.exe)) {
        BROWSER_CACHE = { available: true, source: 'system', name: c.name, executablePath: c.exe, reason: null };
        return BROWSER_CACHE;
      }
    } catch (_) {}
  }

  // 2) CloakBrowser 隐形 Chromium
  const cloakPath = getCloakBinaryPath();
  if (cloakPath) {
    BROWSER_CACHE = { available: true, source: 'cloakbrowser', name: 'CloakBrowser Chromium', executablePath: cloakPath, reason: null };
    return BROWSER_CACHE;
  }
  BROWSER_CACHE = { available: false, source: null, name: null, executablePath: cloakPath, reason: '未找到任何浏览器' };
  return BROWSER_CACHE;
}

// 兼容旧调用名
function getPlaywrightStatus() { return detectBrowser(); }

/**
 * 生成 cloakbrowser launch 配置：优先使用系统浏览器 executablePath，
 * 否则交给 CloakBrowser 自动管理。
 */
function withDetectedBrowser(opts = {}) {
  const b = detectBrowser();
  if (b.available && b.executablePath) {
    return { ...opts, executablePath: b.executablePath };
  }
  return opts;
}

const BROWSER_INSTALL_HINT = '建议安装 Chrome（推荐）/ Edge / Brave 任一浏览器即可，工具会自动复用。在 Docker 环境下会自动使用 CloakBrowser 隐形 Chromium（自动下载约 200MB，C++ 源码级防反爬）。';

// ─── 目录初始化 ────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const COOKIE_FILE = path.join(DATA_DIR, 'cookies.json');
const SESSION_DIR = path.join(DATA_DIR, 'session');
const LOGS_DIR = path.join(__dirname, 'logs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureFile(filePath, defaultContent) {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath))
    fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2), 'utf8');
}

ensureDir(DATA_DIR);
ensureDir(USERS_DIR);
ensureDir(SESSION_DIR);
ensureDir(LOGS_DIR);
ensureFile(SUBSCRIPTIONS_FILE, []);
ensureFile(COOKIE_FILE, []);

// ─── 结构化日志系统 ────────────────────────────────────────────────────────────

const LOG_LEVELS = { silly: 0, debug: 1, info: 2, warn: 3, error: 4 };
const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL
  ? LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info
  : LOG_LEVELS.info;

let currentLogFile = null;
let logStream = null;

function getLogFilePath() {
  const d = new Date();
  const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`;
  return path.join(LOGS_DIR, name);
}

function getLogStream() {
  const filePath = getLogFilePath();
  if (filePath !== currentLogFile) {
    if (logStream) { try { logStream.end(); } catch (_) {} }
    logStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    currentLogFile = filePath;
  }
  return logStream;
}

// SSE 客户端列表（用于实时推送日志）
const sseClients = new Set();

function log(level, module_, message, meta = {}) {
  const levelNum = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  if (levelNum < CURRENT_LOG_LEVEL) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    module: module_,
    message,
    ...( Object.keys(meta).length ? { meta } : {} ),
  };

  const line = JSON.stringify(entry);

  // 写文件（不阻塞）
  try { getLogStream().write(line + '\n'); } catch (_) {}

  // 控制台输出（带颜色），忽略 EPIPE 错误（后台运行时 stdout 可能关闭）
  const colors = { silly: '\x1b[37m', debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
  const reset = '\x1b[0m';
  const color = colors[level] || '';
  try {
    console.log(`${color}[${entry.ts.slice(11, 19)}][${level.toUpperCase().padEnd(5)}][${module_}]${reset} ${message}${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`);
  } catch (_) {}

  // SSE 推送
  const ssePayload = `data: ${line}\n\n`;
  for (const client of sseClients) {
    try { client.write(ssePayload); } catch (_) { sseClients.delete(client); }
  }
}

// 模块化 logger 工厂
function createLogger(module_) {
  return {
    silly: (msg, meta) => log('silly', module_, msg, meta),
    debug: (msg, meta) => log('debug', module_, msg, meta),
    info:  (msg, meta) => log('info',  module_, msg, meta),
    warn:  (msg, meta) => log('warn',  module_, msg, meta),
    error: (msg, meta) => log('error', module_, msg, meta),
  };
}

const logger = createLogger('App');
logger.info('微博归档器 v0.4.0 启动中...', { logLevel: Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === CURRENT_LOG_LEVEL) });

// ─── 中间件 ────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tools', express.static(path.join(__dirname, 'tools')));

// 请求日志中间件
const reqLogger = createLogger('HTTP');
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    reqLogger[level](`${req.method} ${req.path}`, { status: res.statusCode, ms });
  });
  next();
});

// ─── 内存状态 ──────────────────────────────────────────────────────────────────

const schedulers = new Map();
const fetchStatus = new Map(); // uid -> { status, message, progress, lastFetch }
let loginBrowser = null;
let isLoggedIn = false;

// v0.0.5：用于手动确认登录的浏览器上下文（全局持有，直到用户确认或超时）
let pendingLoginContext = null;
let pendingLoginPage = null;
let pendingTempUserDataDir = null; // Chrome 临时用户数据目录，关闭时清理

// v0.5.0：Docker 无头模式截图缓冲区
let loginScreenshotBuffer = null;

// v0.5.0：Docker 环境检测
function isDockerEnv() {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
  } catch (_) {}
  if (process.platform === 'linux' && !process.env.DISPLAY) return true;
  return false;
}

// ─── v0.0.8：并发任务队列 + 终止信号 ─────────────────────────────────────────

const MAX_CONCURRENT_FETCHES = 2; // 最大并发抓取数
const fetchQueue = []; // 等待执行的任务
const activeFetches = new Map(); // uid -> AbortController（正在执行的）
const abortControllers = new Map(); // uid -> AbortController（终止信号，跨函数访问）

function enqueueFetch(uid, isIncremental) {
  // 同一 uid 不重复排队
  if (activeFetches.has(uid)) {
    return { queued: false, reason: '正在抓取中' };
  }
  if (fetchQueue.find(t => t.uid === uid)) {
    return { queued: false, reason: '已在队列中' };
  }

  fetchQueue.push({ uid, isIncremental, enqueuedAt: Date.now() });
  createLogger('FetchQueue').info(`任务入队`, { uid, isIncremental, queueLen: fetchQueue.length });

  // 尝试立即执行
  processQueue();
  return { queued: true, queueLen: fetchQueue.length };
}

function processQueue() {
  const qLog = createLogger('FetchQueue');
  while (activeFetches.size < MAX_CONCURRENT_FETCHES && fetchQueue.length > 0) {
    const task = fetchQueue.shift();
    if (!task) break;

    const ac = new AbortController();
    activeFetches.set(task.uid, ac);
    abortControllers.set(task.uid, ac);

    qLog.info(`开始执行任务`, { uid: task.uid, activeCount: activeFetches.size, remaining: fetchQueue.length });

    // 执行抓取
    fetchUserPosts(task.uid, task.isIncremental, ac.signal)
      .catch(err => {
        qLog.error(`任务异常`, { uid: task.uid, err: err.message });
      })
      .finally(() => {
        activeFetches.delete(task.uid);
        abortControllers.delete(task.uid);
        qLog.info(`任务完成`, { uid: task.uid, activeCount: activeFetches.size, remaining: fetchQueue.length });
        // 继续处理队列
        processQueue();
      });
  }
}

function abortFetch(uid) {
  const ac = abortControllers.get(uid);
  if (ac) {
    ac.abort();
    createLogger('FetchQueue').info(`发送终止信号`, { uid });
    return true;
  }
  // 也检查队列中的
  const idx = fetchQueue.findIndex(t => t.uid === uid);
  if (idx >= 0) {
    fetchQueue.splice(idx, 1);
    createLogger('FetchQueue').info(`从队列中移除`, { uid });
    return true;
  }
  return false;
}

async function closePendingLogin() {
  try { if (pendingLoginContext) await pendingLoginContext.close(); } catch (_) {}
  try { if (loginBrowser) { await loginBrowser.close(); loginBrowser = null; } } catch (_) {}
  if (pendingTempUserDataDir) {
    try { fs.rmSync(pendingTempUserDataDir, { recursive: true, force: true }); } catch (_) {}
    pendingTempUserDataDir = null;
  }
  pendingLoginContext = null;
  pendingLoginPage = null;
  loginScreenshotBuffer = null;
}

// ─── 进程防崩溃保护 ──────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason, promise) => {
  createLogger('Process').error(`未捕获的 Promise 异常: ${reason}`);
});

process.on('uncaughtException', (err) => {
  // 直接写文件，避免级联调用 console.log 导致无限 EPIPE
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), level: 'error', module: 'Process', message: `未捕获的同步异常: ${err.message}` });
    fs.appendFileSync(getLogFilePath(), entry + '\n');
    const ssePayload = `data: ${entry}\n\n`;
    for (const client of sseClients) {
      try { client.write(ssePayload); } catch (_) { sseClients.delete(client); }
    }
  } catch (_) {}
});

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function readJSON(filePath, defaultVal = null) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    createLogger('IO').error(`readJSON 失败: ${filePath}`, { err: err.message });
    return defaultVal;
  }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function extractUid(input) {
  if (!input) return null;
  const t = input.trim();
  if (/^\d+$/.test(t)) return t;
  const patterns = [
    /weibo\.com\/u\/(\d+)/,
    /weibo\.com\/(\d{6,})/,
    /weibo\.cn\/profile\/(\d+)/,
    /uid=(\d+)/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── 速率限制配置（可按需调整，防 IP 封禁）──────────────────────────────────────

const RATE_LIMIT = {
  // 翻页抓取之间的随机延迟（毫秒）
  PAGE_DELAY_MIN: 2000,
  PAGE_DELAY_MAX: 5000,
  // 图片下载之间的随机延迟（毫秒）
  IMAGE_DELAY_MIN: 800,
  IMAGE_DELAY_MAX: 2000,
  // 连续多帖抓取完一批后的额外冷却（毫秒）
  BATCH_COOLDOWN: 3000,
};

function randomDelay(min = RATE_LIMIT.PAGE_DELAY_MIN, max = RATE_LIMIT.PAGE_DELAY_MAX) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

// ─── 内存 LRU 缓存（帖子列表加速，避免每次都读大文件）─────────────────────────

const POST_CACHE_TTL = 60 * 1000; // 60 秒过期
const postCache = new Map(); // uid -> { data, ts }

function cacheGet(uid) {
  const entry = postCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.ts > POST_CACHE_TTL) {
    postCache.delete(uid);
    return null;
  }
  return entry.data;
}

function cacheSet(uid, data) {
  postCache.set(uid, { data, ts: Date.now() });
}

function cacheInvalidate(uid) {
  if (uid) postCache.delete(uid);
  else postCache.clear();
}

// ─── 进度推送（SSE 增强版） ─────────────────────────────────────────────────────

/**
 * 更新抓取进度，同时通过 SSE 推送给前端
 * @param {string} uid
 * @param {object} update { status, message, progress?, total?, current? }
 */
function updateProgress(uid, update) {
  const current = fetchStatus.get(uid) || {};
  const next = { ...current, ...update, uid, updatedAt: Date.now() };
  fetchStatus.set(uid, next);

  // 推送 SSE 进度事件
  const payload = `data: ${JSON.stringify({ type: 'progress', ...next })}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (_) { sseClients.delete(client); }
  }

  createLogger('Progress')[update.status === 'error' ? 'error' : 'info'](
    `[${uid}] ${update.message}`,
    update.progress !== undefined ? { progress: `${update.progress}/${update.total}` } : {}
  );
}

// ─── 图片下载 ──────────────────────────────────────────────────────────────────

const imgLogger = createLogger('Image');

const IMAGE_MAX_RETRIES = 2; // 最多重试 2 次

/**
 * 下载单张图片（带重试 + 0 字节检测）
 * @param {string} url
 * @param {string} destPath
 * @param {string} cookieStr
 * @param {number} retries - 剩余重试次数
 * @returns {Promise<boolean>}
 */
async function downloadImage(url, destPath, cookieStr, retries = IMAGE_MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      ensureDir(path.dirname(destPath));

      // 如果文件已存在且 > 0 字节，跳过
      if (fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        if (stat.size > 0) {
          imgLogger.debug(`文件已存在，跳过: ${path.basename(destPath)}`);
          return true;
        }
        // 0 字节文件 → 删除重下
        imgLogger.warn(`0 字节文件，删除重下: ${path.basename(destPath)}`);
        fs.unlinkSync(destPath);
      }

      const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000, // v0.0.6: 从 25s 缩短到 15s
        headers: {
          Referer: 'https://weibo.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(cookieStr ? { Cookie: cookieStr } : {}),
        },
      });

      const buf = Buffer.from(resp.data);
      if (buf.length === 0) {
        imgLogger.warn(`下载到空数据: ${url}`);
        if (attempt < retries) {
          imgLogger.info(`重试 ${attempt + 1}/${retries}: ${path.basename(destPath)}`);
          await randomDelay(1000, 2000);
          continue;
        }
        return false;
      }

      fs.writeFileSync(destPath, buf);
      imgLogger.debug(`下载成功: ${path.basename(destPath)} (${(buf.length / 1024).toFixed(1)}KB)`);
      return true;
    } catch (err) {
      imgLogger.warn(`下载失败 (尝试 ${attempt + 1}/${retries + 1}): ${url}`, { err: err.message });
      if (attempt < retries) {
        await randomDelay(1000, 2000);
        continue;
      }
      return false;
    }
  }
  return false;
}

// ─── Cookie 管理 ───────────────────────────────────────────────────────────────

const cookieLogger = createLogger('Cookie');

function loadCookies() {
  return readJSON(COOKIE_FILE, []);
}

function saveCookies(cookies) {
  writeJSON(COOKIE_FILE, cookies);
  cookieLogger.info(`已保存 ${cookies.length} 条 Cookie`);
}

function cookiesToString(cookies) {
  return (cookies || []).map(c => `${c.name}=${c.value}`).join('; ');
}

function checkLoginFromCookies(cookies) {
  // 用户已要求取消在线校验，只要本机有保存过 Cookie 就视为已登录；
  // 若实际未登录，让用户通过「重新登录」按钮自行清理重置。
  return Array.isArray(cookies) && cookies.length > 0;
}

/**
 * 验证 Cookie 是否真实有效（通过浏览器上下文调用微博 API 验证）
 * @param {string|Array} cookieInput - Cookie 字符串或数组
 * @returns {Promise<{valid: boolean, uid?: string, name?: string, error?: string}>}
 */
async function verifyCookieOnline(cookieInput) {
  const vLogger = createLogger('CookieVerify');
  try {
    // 兼容字符串或数组
    let cookies = cookieInput;
    if (typeof cookieInput === 'string') {
      cookies = cookieInput.split(';').map(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return null;
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        return name ? { name, value, domain: '.weibo.com', path: '/' } : null;
      }).filter(Boolean);
    }

    // 优先用移动端 API 验证（更稳定，不容易 403）
    const mobileResult = await browserFetch('https://m.weibo.cn/api/config', cookies, 'https://m.weibo.cn');
    if (mobileResult.ok && mobileResult.data) {
      const d = mobileResult.data.data || mobileResult.data;
      // m.weibo.cn/api/config 返回 { data: { uid: "xxx", screen_name: "xxx", login: true } }
      if (d.login === true || d.uid) {
        vLogger.info('Cookie 验证成功（移动端）', { uid: d.uid, name: d.screen_name });
        return { valid: true, uid: String(d.uid || ''), name: d.screen_name || '' };
      }
    }

    // 备用：PC 端 loginInfo 接口
    const pcResult = await browserFetch('https://weibo.com/ajax/account/loginInfo', cookies, 'https://weibo.com');
    if (pcResult.ok && pcResult.data) {
      const d = pcResult.data.data || pcResult.data;
      if (d.login === true || d.islogin === 1 || d.uid) {
        vLogger.info('Cookie 验证成功（PC 端）', { uid: d.uid, name: d.screen_name });
        return { valid: true, uid: String(d.uid || ''), name: d.screen_name || '' };
      }
    }

    if (pcResult.status === 403 || pcResult.loginRequired) {
      vLogger.warn('Cookie 验证返回 403，Cookie 已失效');
      return { valid: false, error: 'Cookie 已失效，请重新登录' };
    }

    vLogger.warn('Cookie 存在但未检测到登录态');
    return { valid: false, error: 'Cookie 无效或已过期' };
  } catch (err) {
    vLogger.warn(`Cookie 在线验证异常: ${err.message}`);
    return { valid: null, error: `验证异常: ${err.message}` };
  }
}

// ─── 浏览器配置 ────────────────────────────────────────────────────────────────

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--window-size=1280,900',
  '--lang=zh-CN',
];

const CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
};

const INIT_SCRIPT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: { connect: () => {}, sendMessage: () => {} } };
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
};

// ─── 登录管理 ──────────────────────────────────────────────────────────────────

const loginLogger = createLogger('Login');

function getLoginStatus() {
  const cookies = loadCookies();
  isLoggedIn = checkLoginFromCookies(cookies);
  return isLoggedIn;
}

/**
 * 打开登录窗口，等待用户手动点击"我已完成登录"按钮后采集并验证 Cookie
 *
 * v0.0.5 变更：
 * - 完全移除自动 Cookie 轮询检测（根本原因：未登录时 Cookie 文件就存在会导致误判）
 * - 浏览器窗口打开后，通过 SSE 推送 loginWindowOpen 状态
 * - 前端展示"我已完成登录"手动确认按钮
 * - 用户点击后，服务端接收 /api/auth/confirm-login 请求才真正采集 Cookie 并验证
 * - 浏览器 context 保持活跃，直到确认或超时才关闭
 */
async function openLoginWindow() {
  if (loginBrowser) {
    try { await loginBrowser.close(); } catch (_) {}
    loginBrowser = null;
  }

  const IS_DOCKER = isDockerEnv();
  loginLogger.info(`打开登录窗口（${IS_DOCKER ? 'Docker 无头模式' : '本地有头模式'}）...`);

  const loginUrl = 'https://m.weibo.cn/login';

  if (IS_DOCKER) {
    // ── Docker 无头模式：headless:true + 截图推送 + Cookie 自动监测 ──
    loginLogger.info('Docker 环境：使用无头浏览器 + 截图模式');

    const { launch } = await getCloakBrowser();
    const launchOptions = withDetectedBrowser({
      headless: true,
      args: BROWSER_ARGS,
    });

    const browser = await launch(launchOptions);
    loginBrowser = browser;
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
      viewport: { width: 390, height: 844 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    loginLogger.info('Docker 无头浏览器登录页面已加载');

    pendingLoginContext = context;
    pendingLoginPage = page;

    // 推送 Docker 模式事件
    const dockerPayload = `data: ${JSON.stringify({
      type: 'loginDockerMode',
      message: 'Docker 环境：已打开无头浏览器，准备加载二维码',
    })}\n\n`;
    for (const client of sseClients) {
      try { client.write(dockerPayload); } catch (_) { sseClients.delete(client); }
    }

    // 推送窗口打开事件（保持前端兼容）
    const openPayload = `data: ${JSON.stringify({
      type: 'loginWindowOpen',
      message: '已打开登录窗口（无头模式），请在下方完成登录',
    })}\n\n`;
    for (const client of sseClients) {
      try { client.write(openPayload); } catch (_) { sseClients.delete(client); }
    }

    // 截图循环：立即拍第一张，之后每 2 秒刷新
    const sendLogEvent = (msg) => {
      const payload = `data: ${JSON.stringify({ type: 'loginScreenLog', message: msg })}\n\n`;
      for (const client of sseClients) {
        try { client.write(payload); } catch (_) { sseClients.delete(client); }
      }
    };

    const takeScreenshot = async () => {
      try {
        const pages = context.pages();
        if (pages.length === 0) return;
        const buf = await pages[0].screenshot({ type: 'jpeg', quality: 80, fullPage: false });
        loginScreenshotBuffer = buf;
        // 同时保存到磁盘，方便通过容器日志/文件查看
        try {
          const dataDir = path.join(__dirname, 'data');
          if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
          fs.writeFileSync(path.join(dataDir, 'login-screenshot.jpg'), buf);
        } catch (_) {}
        // 发送截图就绪日志事件（含文件大小）
        const sizeKB = (buf.length / 1024).toFixed(1);
        const sseLogPayload = `data: ${JSON.stringify({ type: 'loginScreenLog', message: `📷 截图已更新 (${sizeKB}KB)`, screenshotSize: buf.length })}\n\n`;
        for (const client of sseClients) {
          try { client.write(sseLogPayload); } catch (_) { sseClients.delete(client); }
        }
      } catch (_) {}
    };
    await takeScreenshot().catch(() => {});
    loginLogger.info('第一张截图已就绪（/app/data/login-screenshot.jpg）');
    sendLogEvent('截图已就绪');
    const screenshotInterval = setInterval(takeScreenshot, 2000);

    // 异步加载二维码（不阻塞截图）
    (async () => {
      try {
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
        sendLogEvent('页面加载完成');
        const scanBtn = page.locator('text=扫码登录').first();
        if (await scanBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await scanBtn.click();
          loginLogger.info('已点击"扫码登录"按钮，等待二维码加载');
          sendLogEvent('已点击"扫码登录"按钮');
          await page.waitForSelector('img[src*="qrcode"]', { timeout: 10000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 1500));
          await takeScreenshot().catch(() => {});
          loginLogger.info('二维码截图已更新');
          sendLogEvent('二维码截图已更新');
        } else {
          sendLogEvent('未找到"扫码登录"按钮，使用默认视图');
        }
      } catch (e) {
        loginLogger.warn(`二维码切换异常: ${e.message}，使用默认视图`);
        sendLogEvent('二维码切换异常，使用默认视图');
      }
    })().catch(() => {});

    // Cookie 自动监测循环（每 3 秒检查一次）
    let autoConfirmed = false;
    const cookieMonitor = setInterval(async () => {
      try {
        if (!pendingLoginContext || autoConfirmed) return;
        const cookies = await pendingLoginContext.cookies();
        const pagesList = pendingLoginContext.pages();
        if (pagesList.length === 0) return;
        const currentUrl = pagesList[0].url();
        const hasSUB = cookies.some(c =>
          c.name === 'SUB' && c.value && c.value.length > 20
        );
        const hasSUBP = cookies.some(c =>
          c.name === 'SUBP' && c.value && c.value.length > 0
        );
        const isRedirected = currentUrl &&
          !currentUrl.includes('/login') &&
          !currentUrl.includes('/passport') &&
          currentUrl.includes('weibo');
        if (hasSUB && hasSUBP && isRedirected) {
          autoConfirmed = true;
          clearInterval(screenshotInterval);
          clearInterval(cookieMonitor);
          loginLogger.info('Docker 无头浏览器检测到登录完成（页面已跳转 + SUB + SUBP），自动确认');

          saveCookies(cookies);
          isLoggedIn = true;

          const resultPayload = `data: ${JSON.stringify({
            type: 'loginResult',
            success: true,
            message: `✅ 已自动保存 ${cookies.length} 条 Cookie`,
            userInfo: {},
          })}\n\n`;
          for (const client of sseClients) {
            try { client.write(resultPayload); } catch (_) { sseClients.delete(client); }
          }

          await closePendingLogin();
          loginScreenshotBuffer = null;
          clearTimeout(timeoutTimer);
        }
      } catch (_) {}
    }, 3000);

    // 10 分钟超时自动关闭
    const timeoutTimer = setTimeout(async () => {
      loginLogger.warn('Docker 登录超时（10分钟），自动关闭');
      clearInterval(screenshotInterval);
      clearInterval(cookieMonitor);
      const payload = `data: ${JSON.stringify({
        type: 'loginResult',
        success: false,
        message: '登录超时（10分钟），请重试',
      })}\n\n`;
      for (const client of sseClients) { try { client.write(payload); } catch (_) {} }
      await closePendingLogin();
      loginScreenshotBuffer = null;
    }, 10 * 60 * 1000);

    // page 意外关闭时的处理
    page.on('close', async () => {
      if (autoConfirmed || !pendingLoginContext) return;
      clearInterval(screenshotInterval);
      clearInterval(cookieMonitor);
      clearTimeout(timeoutTimer);
      loginLogger.info('Docker 无头浏览器页面意外关闭');
      const payload = `data: ${JSON.stringify({
        type: 'loginResult',
        success: false,
        message: '登录页面意外关闭，请重试',
      })}\n\n`;
      for (const client of sseClients) { try { client.write(payload); } catch (_) {} }
      await closePendingLogin();
      loginScreenshotBuffer = null;
    });
  } else {
    // ── 本地有头模式（保持原有逻辑） ──
    // 使用临时用户数据目录，强制 Chrome 启动全新独立实例（而非复用已有窗口）
    const tempUserDataDir = path.join(os.tmpdir(), `wotui-login-${Date.now()}`);
    pendingTempUserDataDir = tempUserDataDir;
    loginLogger.info(`临时用户数据目录: ${tempUserDataDir}`);

    // launchPersistentContext = 启动 CloakBrowser 并用指定用户数据目录（保证新实例 + 可见窗口）
    const { launchPersistentContext } = await getCloakBrowser();
    const launchOptions = withDetectedBrowser({
      headless: false,
      args: [
        ...BROWSER_ARGS,
        '--window-size=420,900',
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const persistentOptions = {
      ...launchOptions,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
      viewport: { width: 390, height: 844 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
      isMobile: true,
      hasTouch: true,
    };
    // launchPersistentContext 的第一个参数是 userDataDir，第二个是选项
    const context = await launchPersistentContext(tempUserDataDir, persistentOptions);
    loginLogger.info('Chrome 进程已启动，窗口应已弹出');

    // macOS：延迟激活 Chrome 到前台
    if (process.platform === 'darwin') {
      setTimeout(() => {
        try {
          exec('osascript -e \'tell application "Google Chrome" to activate\'');
          loginLogger.info('已通过 AppleScript 激活 Chrome 窗口到前台');
        } catch (_) {}
      }, 2000);
    }

    await context.addInitScript(INIT_SCRIPT);
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    loginLogger.info('登录页面已加载，等待用户操作...');

    pendingLoginContext = context;
    pendingLoginPage = page;

    // 推送 SSE：窗口已打开，等待用户手动确认
    const openPayload = `data: ${JSON.stringify({
      type: 'loginWindowOpen',
      message: '请在弹出的浏览器窗口中完成登录，完成后点击「我已完成登录」按钮',
    })}\n\n`;
    for (const client of sseClients) {
      try { client.write(openPayload); } catch (_) { sseClients.delete(client); }
    }

    // 10 分钟超时自动关闭
    const timeoutTimer = setTimeout(async () => {
      loginLogger.warn('登录超时（10分钟），自动关闭');
      const payload = `data: ${JSON.stringify({ type: 'loginResult', success: false, message: '登录超时（10分钟），请重试' })}\n\n`;
      for (const client of sseClients) { try { client.write(payload); } catch (_) {} }
      await closePendingLogin();
    }, 10 * 60 * 1000);

    // 用户手动关闭窗口时的处理
    page.on('close', async () => {
      if (!pendingLoginContext) return; // 已被 confirmLogin 处理
      clearTimeout(timeoutTimer);
      loginLogger.info('用户手动关闭了登录窗口（未确认）');
      try {
        const cookies = await context.cookies().catch(() => []);
        if (cookies && cookies.length > 0) {
          saveCookies(cookies);
          isLoggedIn = true;
          const payload = `data: ${JSON.stringify({ type: 'loginResult', success: true, message: `窗口已关闭，已保存 ${cookies.length} 条 Cookie（未校验）`, userInfo: {} })}\n\n`;
          for (const client of sseClients) { try { client.write(payload); } catch (_) {} }
        } else {
          const payload = `data: ${JSON.stringify({ type: 'loginResult', success: false, message: '窗口已关闭，未采集到任何 Cookie' })}\n\n`;
          for (const client of sseClients) { try { client.write(payload); } catch (_) {} }
        }
      } catch (_) {}
      await closePendingLogin();
    });
  }
}

function logout() {
  writeJSON(COOKIE_FILE, []);
  isLoggedIn = false;
  loginLogger.info('已清除登录态');
}

// ─── 微博 API 抓取 ─────────────────────────────────────────────────────────────

const fetchLogger = createLogger('Fetch');

/**
 * 使用 Playwright 浏览器上下文发起 API 请求（绕过 403 反爬）
 * 浏览器上下文持有真实 Cookie、UA、语言等，与手动浏览器完全一致
 */
let sharedBrowserContext = null; // 复用一个后台浏览器上下文，避免每次都启动新浏览器
let sharedBrowser = null; // v0.0.7：保存 browser 引用，避免泄漏

async function getSharedContext(cookies) {
  const ctxLogger = createLogger('BrowserCtx');
  try {
    // 如果已有上下文，检查是否还活着
    if (sharedBrowserContext) {
      try {
        // 尝试一个轻量操作验证上下文是否有效
        await sharedBrowserContext.cookies();
        return sharedBrowserContext;
      } catch (_) {
        ctxLogger.warn('浏览器上下文已失效，重新创建');
        // v0.0.7：正确关闭旧 browser，防止泄漏
        try { if (sharedBrowserContext) await sharedBrowserContext.close(); } catch (_) {}
        try { if (sharedBrowser) await sharedBrowser.close(); } catch (_) {}
        sharedBrowserContext = null;
        sharedBrowser = null;
      }
    }

    ctxLogger.info('创建后台浏览器上下文...');
    const { launch } = await getCloakBrowser();
    sharedBrowser = await launch(withDetectedBrowser({ headless: true, args: BROWSER_ARGS }));
    const context = await sharedBrowser.newContext({ ...CONTEXT_OPTIONS });
    await context.addInitScript(INIT_SCRIPT);

    // 注入 Cookie
    if (cookies && cookies.length > 0) {
      try { await context.addCookies(cookies); } catch (e) {
        ctxLogger.warn('注入 Cookie 失败', { err: e.message });
      }
    }

    sharedBrowserContext = context;
    ctxLogger.info('后台浏览器上下文已就绪');
    return context;
  } catch (err) {
    ctxLogger.error(`创建浏览器上下文失败: ${err.message}`);
    // 失败时清理
    try { if (sharedBrowserContext) await sharedBrowserContext.close(); } catch (_) {}
    try { if (sharedBrowser) await sharedBrowser.close(); } catch (_) {}
    sharedBrowserContext = null;
    sharedBrowser = null;
    throw err;
  }
}

/**
 * 通过浏览器上下文发起 JSON API 请求（绕过微博 403 反爬）
 */
async function browserFetch(url, cookies, referer) {
  const bfLogger = createLogger('BrowserFetch');
  let page = null;
  try {
    const context = await getSharedContext(cookies);
    page = await context.newPage();

    // 设置额外请求头
    await page.setExtraHTTPHeaders({
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': referer || 'https://weibo.com',
    });

    bfLogger.debug(`浏览器请求: ${url}`);

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    if (!response) {
      bfLogger.warn('页面响应为空');
      return { ok: false, status: 0, data: null };
    }

    const status = response.status();
    bfLogger.debug(`响应状态: ${status}`, { url });

    if (status === 403) {
      bfLogger.warn('收到 403，Cookie 可能已失效或需要重新验证');
      return { ok: false, status: 403, data: null, loginRequired: true };
    }

    if (status !== 200) {
      bfLogger.warn(`非 200 响应: ${status}`);
      return { ok: false, status, data: null };
    }

    // 提取页面内容（JSON）
    const text = await page.evaluate(() => document.body.innerText || document.body.textContent);
    try {
      const data = JSON.parse(text);
      return { ok: true, status, data };
    } catch (_) {
      // 非 JSON 响应 — 检查是否为登录页 HTML（status 通常为 200 但内容是 passport 登录页）
      const loginMarkers = [
        'window.use_fp',          // passport.weibo.com 反爬指纹脚本
        '扫描二维码登录',
        '账号登录',
        '请登录后访问',
        'passport.weibo.com',
        'login.sina.com.cn',
      ];
      const looksLikeLoginPage = loginMarkers.some(m => text.includes(m));
      if (looksLikeLoginPage) {
        bfLogger.warn('响应为微博登录页 HTML，判定 Cookie 已失效', { preview: text.slice(0, 120) });
        return { ok: false, status, data: null, loginRequired: true };
      }
      bfLogger.warn('响应不是有效 JSON', { preview: text.slice(0, 200) });
      return { ok: false, status, data: null, rawText: text };
    }
  } catch (err) {
    bfLogger.error(`浏览器请求失败: ${err.message}`, { url });
    // v0.0.7：上下文可能已损坏，正确清理并重置
    try { if (sharedBrowserContext) await sharedBrowserContext.close(); } catch (_) {}
    try { if (sharedBrowser) await sharedBrowser.close(); } catch (_) {}
    sharedBrowserContext = null;
    sharedBrowser = null;
    return { ok: false, status: 0, data: null, error: err.message };
  } finally {
    if (page) {
      try { await page.close(); } catch (_) {}
    }
  }
}

/**
 * 获取用户资料
 * 优先尝试移动端 API（m.weibo.cn），失败再回落到 PC 端
 */
async function fetchUserProfile(uid, cookies) {
  // 先尝试移动端 API
  const mobileUrl = `https://m.weibo.cn/api/container/getIndex?type=uid&value=${uid}`;
  const mobileResult = await browserFetch(mobileUrl, cookies, `https://m.weibo.cn/u/${uid}`);

  if (mobileResult.ok && mobileResult.data) {
    const d = mobileResult.data;
    // 移动端返回结构：{ ok: 1, data: { userInfo: {...} } }
    const u = d.data?.userInfo;
    if (u && (u.screen_name || u.id)) {
      fetchLogger.info(`获取用户资料成功（移动端）`, { name: u.screen_name });
      return {
        name: u.screen_name || '',
        avatar: u.avatar_hd || u.profile_image_url || u.avatar_large || '',
        description: u.description || '',
        followers: u.followers_count || 0,
        friends: u.friends_count || 0,
        statuses: u.statuses_count || 0,
        verified: u.verified || false,
        verifiedReason: u.verified_reason || '',
      };
    }
  }

  // 回落到 PC 端
  const pcUrl = `https://weibo.com/ajax/profile/info?uid=${uid}`;
  const pcResult = await browserFetch(pcUrl, cookies, `https://weibo.com/u/${uid}`);

  if (!pcResult.ok || !pcResult.data) {
    fetchLogger.warn(`获取用户资料失败 uid=${uid}`, { mobileStatus: mobileResult.status, pcStatus: pcResult.status });
    return null;
  }

  if (pcResult.data?.data?.user) {
    const u = pcResult.data.data.user;
    return {
      name: u.screen_name || '',
      avatar: u.avatar_hd || u.profile_image_url || u.avatar_large || '',
      description: u.description || '',
      followers: u.followers_count || 0,
      friends: u.friends_count || 0,
      statuses: u.statuses_count || 0,
      verified: u.verified || false,
      verifiedReason: u.verified_reason || '',
    };
  }
  return null;
}

/**
 * 从微博 API 获取帖子列表（单页）
 * 优先移动端 m.weibo.cn/api（反爬更宽松），失败回落 PC 端
 *
 * v0.0.5 修复：移动端改用 since_id 翻页（page 参数只能翻几页就停了）
 * @param {string} uid
 * @param {Array} cookies
 * @param {number} pageNum - 页码（仅 PC 端回落用）
 * @param {string|null} sinceId - 移动端翻页标识（上一页返回的 cardlistInfo.since_id）
 */
async function fetchWeiboApiPosts(uid, cookies, pageNum = 1, sinceId = null) {
  fetchLogger.debug(`请求 API 第 ${pageNum} 页（移动端, since_id=${sinceId || '首页'}）`, { uid, pageNum });

  const containerId = `107603${uid}`;
  // 移动端 API：首页不带 since_id，后续页带 since_id（而非 page 参数）
  const mobileUrl = sinceId
    ? `https://m.weibo.cn/api/container/getIndex?type=uid&value=${uid}&containerid=${containerId}&since_id=${sinceId}`
    : `https://m.weibo.cn/api/container/getIndex?type=uid&value=${uid}&containerid=${containerId}`;

  const mobileResult = await browserFetch(mobileUrl, cookies, `https://m.weibo.cn/u/${uid}`);

  if (mobileResult.ok && mobileResult.data) {
    const d = mobileResult.data;

    // 移动端登录失效检测
    if (d.ok === 0 || d.errno === 100 || (d.msg && (d.msg.includes('请登录') || d.msg.includes('login')))) {
      fetchLogger.error('移动端 API 返回未登录', { uid, ok: d.ok, errno: d.errno });
      return { posts: [], total: 0, loginRequired: true, nextSinceId: null };
    }

    // 移动端帖子列表：cards 数组，card_type=9 的是微博卡片
    const cards = d.data?.cards || [];
    const weibos = cards
      .filter(c => c.card_type === 9 && c.mblog)
      .map(c => c.mblog);

    // 提取下一页 since_id
    const nextSinceId = d.data?.cardlistInfo?.since_id || null;

    if (weibos.length > 0) {
      fetchLogger.debug(`移动端 API 第 ${pageNum} 页成功`, { count: weibos.length, nextSinceId });
      return { posts: parseMobilePosts(weibos), total: 0, nextSinceId };
    }

    // 如果 cards 存在但没有 type=9，说明已到末尾
    if (cards.length >= 0 && d.ok === 1) {
      fetchLogger.info(`移动端 API 第 ${pageNum} 页无数据，已到末尾`);
      return { posts: [], total: 0, nextSinceId: null };
    }
  }

  // 移动端失败，回落到 PC 端
  fetchLogger.warn(`移动端 API 失败（page=${pageNum}），回落到 PC 端`, { status: mobileResult.status });

  const pcUrl = `https://weibo.com/ajax/statuses/mymblog?uid=${uid}&page=${pageNum}&feature=0`;
  const pcResult = await browserFetch(pcUrl, cookies, `https://weibo.com/u/${uid}`);

  if (!pcResult.ok) {
    if (pcResult.loginRequired || pcResult.status === 403) {
      fetchLogger.error('PC 端 API 被反爬拦截，需要重新登录', { uid, status: pcResult.status });
      return { posts: [], total: 0, loginRequired: true, nextSinceId: null };
    }
    fetchLogger.error(`PC 端 API 请求失败 page=${pageNum}`, { uid, status: pcResult.status, error: pcResult.error });
    return { posts: [], total: 0, error: pcResult.error || `HTTP ${pcResult.status}`, nextSinceId: null };
  }

  const resp = pcResult.data;
  if (resp?.data?.list) {
    fetchLogger.debug(`PC 端 API 第 ${pageNum} 页成功（回落）`, { count: resp.data.list.length });
    return { posts: parseApiPosts(resp.data.list), total: resp.data.total || 0, nextSinceId: null, usePcFallback: true };
  }

  if (resp?.errno === 20111 || resp?.msg?.includes('未登录')) {
    return { posts: [], total: 0, loginRequired: true, nextSinceId: null };
  }

  fetchLogger.warn(`API 返回异常数据`, { uid, pageNum, keys: Object.keys(resp || {}) });
  return { posts: [], total: 0, nextSinceId: null };
}

/**
 * 解析移动端微博 API 帖子数据（m.weibo.cn 格式）
 */
function parseMobilePosts(list) {
  return list.map(item => {
    const pics = [];

    // 移动端图片结构：pic_ids + pic_infos（与 PC 端一致）
    if (item.pic_ids?.length && item.pic_infos) {
      for (const picId of item.pic_ids) {
        const info = item.pic_infos[picId];
        if (info) {
          const url = info.largest?.url || info.large?.url || info.original?.url || info.mw2000?.url || info.bmiddle?.url || '';
          if (url) pics.push(url);
        }
      }
    }
    // 也可能是 pics 数组格式
    if (pics.length === 0 && item.pics?.length) {
      for (const p of item.pics) {
        const url = p.large?.url || p.url || '';
        if (url) pics.push(url);
      }
    }

    let retweetedData = null;
    if (item.retweeted_status) {
      const rt = item.retweeted_status;
      retweetedData = {
        user: rt.user?.screen_name || '原博主',
        text: (rt.text_raw || rt.text || '').replace(/<[^>]+>/g, ''),
      };
    }

    return {
      mid: String(item.id || item.mid || ''),
      text: (item.text_raw || item.raw_text || item.text || '').replace(/<[^>]+>/g, ''),
      createdAt: item.created_at || '',
      pics,
      reposts: item.reposts_count || 0,
      comments: item.comments_count || 0,
      likes: item.attitudes_count || 0,
      source: (item.source || '').replace(/<[^>]+>/g, ''),
      isRetweet: !!item.retweeted_status,
      retweetedData,
      localPics: [],
      fetchedAt: Date.now(),
    };
  }).filter(p => p.mid);
}

/**
 * 解析 PC 端微博 API 帖子数据（weibo.com 格式，作为回落）
 */
function parseApiPosts(list) {
  return list.map(item => {
    const pics = [];
    if (item.pic_ids?.length && item.pic_infos) {
      for (const picId of item.pic_ids) {
        const info = item.pic_infos[picId];
        if (info) {
          const url = info.largest?.url || info.large?.url || info.original?.url || info.mw2000?.url || info.bmiddle?.url || '';
          if (url) pics.push(url);
        }
      }
    }

    let retweetedData = null;
    if (item.retweeted_status) {
      const rt = item.retweeted_status;
      retweetedData = {
        user: rt.user?.screen_name || '原博主',
        text: (rt.text_raw || rt.text || '').replace(/<[^>]+>/g, ''),
      };
    }

    return {
      mid: String(item.id || item.mid || ''),
      text: (item.text_raw || item.text || '').replace(/<[^>]+>/g, ''),
      createdAt: item.created_at || '',
      pics,
      reposts: item.reposts_count || 0,
      comments: item.comments_count || 0,
      likes: item.attitudes_count || 0,
      source: (item.source || '').replace(/<[^>]+>/g, ''),
      isRetweet: !!item.retweeted_status,
      retweetedData,
      localPics: [],
      fetchedAt: Date.now(),
    };
  }).filter(p => p.mid);
}

/**
 * 核心抓取函数（v0.0.8 版本）
 *
 * v0.0.8 变更：
 * 1. 支持 AbortSignal 终止信号，可随时中断抓取
 * 2. Cookie 失效时先保存已抓取数据，再报错（不再丢弃）
 * 3. 翻页阶段每 5 页保存一次进度（防止中途异常丢失）
 * 4. 终止时记录断点位置，下次增量可继续
 * 5. 多订阅可并发执行（通过任务队列）
 */
async function fetchUserPosts(uid, isIncremental = false, abortSignal = null) {
  const fLog = createLogger(`Fetch:${uid}`);
  fLog.info(`开始${isIncremental ? '增量' : '全量'}抓取`, { uid });

  // 辅助函数：检查终止信号
  const checkAbort = () => {
    if (abortSignal?.aborted) throw new Error('ABORTED');
  };

  const userDir = path.join(USERS_DIR, uid);
  const postsFile = path.join(userDir, 'posts.json');
  const profileFile = path.join(userDir, 'profile.json');
  const imagesDir = path.join(userDir, 'images');

  ensureDir(userDir);
  ensureDir(imagesDir);

  const existingPosts = readJSON(postsFile, []);
  const existingMids = new Set(existingPosts.map(p => String(p.mid)));

  // ── 步骤 1：读取并验证 Cookie ──
  updateProgress(uid, { status: 'fetching', message: '正在检查登录状态...', progress: 0, total: 100 });

  const storedCookies = loadCookies();
  if (!checkLoginFromCookies(storedCookies)) {
    fLog.error('未登录，无法抓取');
    updateProgress(uid, { status: 'error', message: '❌ 未登录，请先登录微博', lastFetch: null });
    return { success: false, error: '未登录' };
  }

  fLog.debug('Cookie 基础检查通过', { cookieCount: storedCookies.length });
  checkAbort();

  // ── 步骤 2：获取用户资料（使用浏览器上下文）──
  updateProgress(uid, { status: 'fetching', message: '正在获取用户资料...', progress: 5, total: 100 });
  let profile = null;
  try {
    profile = await fetchUserProfile(uid, storedCookies);
    if (profile) {
      writeJSON(profileFile, { ...profile, uid, updatedAt: new Date().toISOString() });
      fLog.info('用户资料已更新', { name: profile.name, statuses: profile.statuses });

      // 更新订阅中的昵称/头像
      const subs = readJSON(SUBSCRIPTIONS_FILE, []);
      const sub = subs.find(s => s.uid === uid);
      if (sub && (profile.name || profile.avatar)) {
        sub.name = profile.name || sub.name;
        sub.avatar = profile.avatar || sub.avatar;
        writeJSON(SUBSCRIPTIONS_FILE, subs);
      }
    } else {
      fLog.warn('获取用户资料失败，继续尝试抓取帖子...');
    }
  } catch (err) {
    if (err.message === 'ABORTED') throw err;
    fLog.warn(`获取用户资料异常: ${err.message}`);
  }

  checkAbort();

  // ── 步骤 3：分页抓取帖子（v0.0.8：支持终止 + 每5页保存 + Cookie失效时保存）──
  const POSTS_PER_PAGE = 10;
  const estimatedTotal = profile?.statuses || 0;
  const maxPages = isIncremental
    ? 2
    : Math.max(20, Math.ceil(estimatedTotal / POSTS_PER_PAGE) + 5);
  const hardCap = 200;
  const effectiveMaxPages = Math.min(maxPages, hardCap);

  fLog.info(`翻页计划`, { estimatedTotal, maxPages: effectiveMaxPages, isIncremental });

  let allFetchedPosts = [];
  let shouldStop = false;
  let currentSinceId = null;
  let usePcFallback = false;
  let abortedByUser = false; // 用户主动终止
  let cookieExpired = false; // Cookie 失效

  // v0.0.8 辅助函数：将已抓取帖子增量保存到磁盘
  const saveFetchedPosts = (newPostsBatch) => {
    const newOnes = newPostsBatch.filter(p => !existingMids.has(p.mid));
    if (newOnes.length === 0) return;
    // 合并：新抓取的 + 已有的，去重
    const merged = [...newOnes, ...existingPosts];
    // 也加入本轮之前已抓取但还没保存的
    const allMids = new Set(merged.map(p => p.mid));
    for (const p of allFetchedPosts) {
      if (!allMids.has(p.mid)) {
        merged.unshift(p); // 前面插入（最新的在前）
      }
    }
    // 按时间倒序去重
    const deduped = [];
    const seen = new Set();
    for (const p of merged) {
      if (!seen.has(p.mid)) {
        seen.add(p.mid);
        deduped.push(p);
      }
    }
    writeJSON(postsFile, deduped);
    cacheInvalidate(uid);
    fLog.debug(`已增量保存 ${newOnes.length} 条帖子到磁盘`, { total: deduped.length });
  };

  for (let p = 1; p <= effectiveMaxPages && !shouldStop; p++) {
    // 检查终止信号
    if (abortSignal?.aborted) {
      fLog.info(`用户终止抓取，已获取 ${allFetchedPosts.length} 条`);
      abortedByUser = true;
      break;
    }

    const progressPct = Math.round(10 + (p / effectiveMaxPages) * 60);
    updateProgress(uid, {
      status: 'fetching',
      message: `正在获取第 ${p}/${effectiveMaxPages} 页${currentSinceId ? ' (since_id)' : ''}...`,
      progress: progressPct,
      total: 100,
    });

    const result = usePcFallback
      ? await fetchWeiboApiPosts(uid, storedCookies, p, null)
      : await fetchWeiboApiPosts(uid, storedCookies, p, currentSinceId);

    // v0.0.8 关键修复：Cookie 失效时，先保存已抓取数据再报错
    if (result.loginRequired) {
      cookieExpired = true;
      fLog.warn(`Cookie 失效，已抓取 ${allFetchedPosts.length} 条，先保存再报错`);
      // 先保存已有的帖子数据（不下载图片，先保帖子元数据）
      saveFetchedPosts(allFetchedPosts);
      updateProgress(uid, {
        status: 'error',
        message: `❌ Cookie 已失效，已保存 ${allFetchedPosts.length} 条帖子元数据，图片可后续增量下载。请重新登录后再增量抓取。`,
        lastFetch: null,
      });
      return { success: false, error: 'Cookie已失效', savedPosts: allFetchedPosts.length };
    }

    if (result.error && result.posts.length === 0) {
      fLog.warn(`第 ${p} 页请求失败，停止翻页`, { error: result.error });
      if (p === 1 && allFetchedPosts.length === 0) {
        updateProgress(uid, { status: 'error', message: `❌ 抓取失败: ${result.error}` });
        return { success: false, error: result.error };
      }
      break;
    }

    if (result.posts.length === 0) {
      fLog.info(`第 ${p} 页返回空数据，已到末尾`);
      break;
    }

    if (result.usePcFallback) usePcFallback = true;

    if (result.nextSinceId) {
      currentSinceId = result.nextSinceId;
    } else if (!usePcFallback) {
      fLog.info(`移动端 since_id 为空，翻页结束（已获取 ${allFetchedPosts.length + result.posts.length} 条）`);
    }

    allFetchedPosts = allFetchedPosts.concat(result.posts);
    fLog.debug(`第 ${p} 页获取 ${result.posts.length} 条`, { total: allFetchedPosts.length });

    // v0.0.8：每 5 页保存一次进度到磁盘（防止翻页阶段异常丢数据）
    if (p % 5 === 0) {
      saveFetchedPosts(allFetchedPosts);
      fLog.info(`翻页进度保存（每5页）`, { page: p, total: allFetchedPosts.length });
    }

    // 增量模式：遇到重复内容停止
    if (isIncremental) {
      const hasOverlap = result.posts.some(post => existingMids.has(post.mid));
      if (hasOverlap) {
        fLog.info('增量检测到重复内容，停止翻页', { page: p });
        shouldStop = true;
      }
    }

    if (!result.nextSinceId && !usePcFallback) {
      fLog.info('移动端翻页标识耗尽，完成抓取');
      break;
    }

    if (p < effectiveMaxPages && !shouldStop) await randomDelay(RATE_LIMIT.PAGE_DELAY_MIN, RATE_LIMIT.PAGE_DELAY_MAX);
  }

  // 终止后保存断点信息
  if (abortedByUser) {
    saveFetchedPosts(allFetchedPosts);
    const newPosts = allFetchedPosts.filter(p => !existingMids.has(p.mid));
    fLog.info(`终止后保存 ${newPosts.length} 条新帖子（未下载图片）`, { total: allFetchedPosts.length });

    // 保存断点信息
    const checkpointFile = path.join(userDir, 'checkpoint.json');
    writeJSON(checkpointFile, {
      uid,
      abortedAt: new Date().toISOString(),
      lastSinceId: currentSinceId,
      usePcFallback,
      fetchedPages: effectiveMaxPages,
      fetchedPostCount: allFetchedPosts.length,
      existingPostCount: existingPosts.length,
    });

    updateProgress(uid, {
      status: 'paused',
      message: `⏸ 已终止抓取，保存了 ${newPosts.length} 条新帖子（图片未下载）。可再次增量抓取继续。`,
      progress: 70,
      total: 100,
      lastFetch: new Date().toISOString(),
    });

    return { success: true, aborted: true, newCount: newPosts.length, total: allFetchedPosts.length + existingPosts.length };
  }

  // ── 步骤 4：筛选新帖子 + 找出缺图片的已有帖子（v0.1.0：补全逻辑）──
  const newPosts = allFetchedPosts.filter(p => !existingMids.has(p.mid));
  
  // v0.1.0：找出已有帖子中"有图片但未下载"的（pics 非空但 localPics 为空/缺失）
  // 这些帖子可能是之前 Cookie 失效时只保存了元数据、图片没下载的情况
  const incompletePosts = existingPosts.filter(p => 
    p.pics && p.pics.length > 0 && (!p.localPics || p.localPics.length === 0)
  );
  
  fLog.info(`抓取完成`, { total: allFetchedPosts.length, new: newPosts.length, existing: existingPosts.length, incomplete: incompletePosts.length });

  // v0.1.0：构建已有帖子的 mid -> localPics 映射，确保合并时不丢失已下载的图片引用
  const existingLocalPicsMap = new Map();
  for (const p of existingPosts) {
    if (p.localPics && p.localPics.length > 0) {
      existingLocalPicsMap.set(p.mid, p.localPics);
    }
  }

  // v0.1.0：构建已有图片文件名集合（用于跳过已下载的图片）
  const existingImageFiles = new Set();
  if (fs.existsSync(imagesDir)) {
    try {
      const files = fs.readdirSync(imagesDir);
      for (const f of files) {
        const stat = fs.statSync(path.join(imagesDir, f));
        if (stat.isFile() && stat.size > 0) {
          existingImageFiles.add(f);
        }
      }
      fLog.info(`本地已有 ${existingImageFiles.size} 张图片`, { uid });
    } catch (_) {}
  }

  if (newPosts.length === 0 && incompletePosts.length === 0 && !isIncremental && allFetchedPosts.length === 0) {
    updateProgress(uid, { status: 'error', message: '⚠️ 未获取到任何帖子，请检查 Cookie 是否有效' });
    return { success: false, error: '未获取到帖子' };
  }

  if (newPosts.length === 0 && incompletePosts.length === 0) {
    // 没有新帖子也没有缺图片的帖子
    updateProgress(uid, {
      status: 'success',
      message: `✅ 无新帖子，共 ${existingPosts.length} 条`,
      progress: 100,
      total: 100,
      lastFetch: new Date().toISOString(),
    });
    return { success: true, newCount: 0, total: existingPosts.length };
  }

  // ── 步骤 5：下载图片（v0.1.0：补全新帖子 + 缺图片的已有帖子）──
  const cookieStr = cookiesToString(storedCookies);
  
  // v0.1.0：合并新帖子和缺图片的已有帖子，统一下载
  const postsNeedImages = [...newPosts, ...incompletePosts];
  
  if (postsNeedImages.length > 0) {
    // v0.1.0：先扫描需要下载的图片数量（排除已有的）
    let totalImgs = 0;
    let skippedImgs = 0;
    for (const post of postsNeedImages) {
      for (let i = 0; i < post.pics.length; i++) {
        const picUrl = post.pics[i];
        const rawExt = picUrl.split('?')[0].split('.').pop() || 'jpg';
        const ext = rawExt.slice(0, 4).replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
        const filename = `${post.mid}_${i}.${ext}`;
        if (existingImageFiles.has(filename)) {
          skippedImgs++;
        } else {
          totalImgs++;
        }
      }
    }

    let downloadedImgs = 0;

    fLog.info(`开始下载图片`, { 
      newPosts: newPosts.length, 
      incompletePosts: incompletePosts.length, 
      imagesToDownload: totalImgs, 
      imagesSkipped: skippedImgs 
    });

    if (totalImgs === 0 && skippedImgs > 0) {
      // 所有图片都已存在，不需要下载，只需补全 localPics 引用
      fLog.info(`所有 ${skippedImgs} 张图片已存在，跳过下载，补全 localPics 引用`);
      for (const post of postsNeedImages) {
        const localPics = [];
        for (let i = 0; i < post.pics.length; i++) {
          const picUrl = post.pics[i];
          const rawExt = picUrl.split('?')[0].split('.').pop() || 'jpg';
          const ext = rawExt.slice(0, 4).replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
          const filename = `${post.mid}_${i}.${ext}`;
          localPics.push(filename);
        }
        post.localPics = localPics;
      }
    } else {
      updateProgress(uid, {
        status: 'fetching',
        message: `正在下载图片 (0/${totalImgs})，${skippedImgs > 0 ? `已跳过 ${skippedImgs} 张` : ''}${incompletePosts.length > 0 ? `，补全 ${incompletePosts.length} 条缺图帖子` : ''}...`,
        progress: 70,
        total: 100,
      });

      for (let postIdx = 0; postIdx < postsNeedImages.length; postIdx++) {
        // 检查终止信号（图片下载循环中）
        if (abortSignal?.aborted) {
          fLog.info(`用户终止图片下载，已处理 ${postIdx}/${postsNeedImages.length} 个帖子`);
          // 保存已完成的
          const savedPosts = [...postsNeedImages.slice(0, postIdx).filter(p => !existingMids.has(p.mid)), ...existingPosts];
          writeJSON(postsFile, savedPosts);
          cacheInvalidate(uid);

          const checkpointFile = path.join(userDir, 'checkpoint.json');
          writeJSON(checkpointFile, {
            uid,
            abortedAt: new Date().toISOString(),
            downloadedPostIdx: postIdx,
            totalPostsNeedImages: postsNeedImages.length,
            remainingImgs: totalImgs - downloadedImgs,
          });

          updateProgress(uid, {
            status: 'paused',
            message: `⏸ 已终止，下载了 ${postIdx}/${postsNeedImages.length} 个帖子的图片。可再次增量抓取继续。`,
            progress: 70 + Math.round((downloadedImgs / totalImgs) * 25),
            total: 100,
            lastFetch: new Date().toISOString(),
          });

          return { success: true, aborted: true, newCount: newPosts.length, total: savedPosts.length };
        }

        const post = postsNeedImages[postIdx];
        const localPics = [];
        for (let i = 0; i < post.pics.length; i++) {
          const picUrl = post.pics[i];
          const rawExt = picUrl.split('?')[0].split('.').pop() || 'jpg';
          const ext = rawExt.slice(0, 4).replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
          const filename = `${post.mid}_${i}.${ext}`;

          // v0.1.0：如果本地已有该图片文件，跳过下载
          if (existingImageFiles.has(filename)) {
            localPics.push(filename);
            fLog.debug(`图片已存在，跳过下载: ${filename}`);
            continue;
          }

          const destPath = path.join(imagesDir, filename);
          const ok = await downloadImage(picUrl, destPath, cookieStr);
          if (ok) {
            localPics.push(filename);
            existingImageFiles.add(filename); // 记录已下载，后续帖子同文件名也会跳过
          }

          downloadedImgs++;
          if (totalImgs > 0) {
            const imgPct = Math.round(70 + (downloadedImgs / totalImgs) * 25);
            updateProgress(uid, {
              status: 'fetching',
              message: `正在下载图片 (${downloadedImgs}/${totalImgs})${skippedImgs > 0 ? `，已跳过 ${skippedImgs}` : ''}${incompletePosts.length > 0 ? `，补全 ${incompletePosts.length} 条缺图帖子` : ''}...`,
              progress: imgPct,
              total: 100,
            });
          }

          // 图片间延迟（只在真正下载时才延迟，跳过的不延迟）
          if (!(postIdx === postsNeedImages.length - 1 && i === post.pics.length - 1)) {
            await randomDelay(RATE_LIMIT.IMAGE_DELAY_MIN, RATE_LIMIT.IMAGE_DELAY_MAX);
          }
        }
        post.localPics = localPics;

        // 每下载完一个帖子的图片，立即保存进度到磁盘
        // v0.1.0：合并时用 existingMids 区分新帖子和已有帖子
        const allNewSoFar = postsNeedImages.slice(0, postIdx + 1).filter(p => !existingMids.has(p.mid));
        const allExistingUpdated = existingPosts.map(ep => {
          // 如果已有帖子被补全了图片，用更新后的版本
          const updated = postsNeedImages.slice(0, postIdx + 1).find(p => p.mid === ep.mid);
          return updated || ep;
        });
        const savedPosts = [...allNewSoFar, ...allExistingUpdated.filter(ep => !allNewSoFar.find(np => np.mid === ep.mid))];
        writeJSON(postsFile, savedPosts);
        cacheInvalidate(uid);

        fLog.debug(`已保存第 ${postIdx + 1}/${postsNeedImages.length} 个帖子的图片进度`, { mid: post.mid });
      }
    }
  }

  // ── 步骤 6：最终确认保存（v0.2.0：全量模式覆盖更新 + 补全已有帖子的 localPics）──
  updateProgress(uid, { status: 'fetching', message: '正在保存数据...', progress: 97, total: 100 });

  // v0.2.0：合并逻辑
  // 全量模式（incremental=false）：以 mid 为 key，新数据覆盖旧数据
  // 增量模式（incremental=true）：新帖子直接加入，已有帖子如果 localPics 被更新了也用新版本
  let allPosts;
  if (!isIncremental) {
    // 全量模式：新数据覆盖旧数据
    const newMids = new Set(newPosts.map(p => p.mid));
    // 保留旧数据中未被新数据覆盖的帖子
    const keptOld = existingPosts.filter(ep => !newMids.has(ep.mid));
    // 对于被覆盖的帖子，如果旧帖子有 localPics 而新帖子没有，保留旧 localPics
    for (const np of newPosts) {
      if (!np.localPics || np.localPics.length === 0) {
        const oldPics = existingLocalPicsMap.get(np.mid);
        if (oldPics && oldPics.length > 0) {
          np.localPics = oldPics;
        }
      }
    }
    allPosts = [...newPosts, ...keptOld];
  } else {
    // 增量模式：保持 v0.1.0 逻辑
    allPosts = [...newPosts];
    const newMids = new Set(newPosts.map(p => p.mid));
    for (const existingPost of existingPosts) {
      if (!newMids.has(existingPost.mid)) {
        const updated = incompletePosts.find(p => p.mid === existingPost.mid);
        allPosts.push(updated || existingPost);
      }
    }
  }

  writeJSON(postsFile, allPosts);
  cacheInvalidate(uid);

  // 清除断点文件（完成抓取后不需要了）
  const checkpointFile = path.join(userDir, 'checkpoint.json');
  if (fs.existsSync(checkpointFile)) {
    try { fs.unlinkSync(checkpointFile); } catch (_) {}
  }

  // 更新订阅 lastFetch & postCount
  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  const sub = subs.find(s => s.uid === uid);
  if (sub) {
    sub.lastFetch = new Date().toISOString();
    sub.postCount = allPosts.length;
    writeJSON(SUBSCRIPTIONS_FILE, subs);
  }

  const incompleteFixed = incompletePosts.length;
  const summary = isIncremental
    ? `✅ 增量完成，新增 ${newPosts.length} 条${incompleteFixed > 0 ? `，补全 ${incompleteFixed} 条缺图帖子` : ''}`
    : `✅ 完成，共 ${allPosts.length} 条（新增 ${newPosts.length}${incompleteFixed > 0 ? `，补全 ${incompleteFixed} 条缺图` : ''}）`;

  updateProgress(uid, {
    status: 'success',
    message: summary,
    progress: 100,
    total: 100,
    lastFetch: new Date().toISOString(),
  });

  fLog.info(summary, { uid, newPosts: newPosts.length, incompleteFixed, total: allPosts.length });
  return { success: true, newCount: newPosts.length, total: allPosts.length, incompleteFixed };
}

// ─── 定时调度 ──────────────────────────────────────────────────────────────────

const schedLogger = createLogger('Scheduler');

function startScheduler(uid, intervalMinutes) {
  stopScheduler(uid);
  const ms = Math.max(intervalMinutes, 5) * 60 * 1000;
  const timer = setInterval(async () => {
    schedLogger.info(`触发定时增量抓取`, { uid, intervalMinutes });
    // v0.0.8：通过任务队列，支持并发
    enqueueFetch(uid, true);
  }, ms);
  schedulers.set(uid, timer);
  schedLogger.info(`调度器已启动`, { uid, intervalMinutes });
}

function stopScheduler(uid) {
  if (schedulers.has(uid)) {
    clearInterval(schedulers.get(uid));
    schedulers.delete(uid);
    schedLogger.debug(`调度器已停止`, { uid });
  }
}

function restoreSchedulers() {
  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  let count = 0;
  for (const sub of subs) {
    if (sub.uid && sub.intervalMinutes > 0) {
      startScheduler(sub.uid, sub.intervalMinutes);
      count++;
    }
  }
  schedLogger.info(`已恢复 ${count} 个调度器`);
}

// ─── API 路由 ──────────────────────────────────────────────────────────────────

// SSE 进度流
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(': connected\n\n');

  // 发送当前所有状态快照
  for (const [uid, status] of fetchStatus.entries()) {
    res.write(`data: ${JSON.stringify({ type: 'progress', ...status, uid })}\n\n`);
  }

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));

  // 心跳
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(heartbeat); sseClients.delete(res); }
  }, 25000);
});

// GET /api/logs - 获取日志（最近 N 行）
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const level = req.query.level || null;
  const logFile = getLogFilePath();

  if (!fs.existsSync(logFile)) {
    return res.json({ success: true, data: [], file: logFile });
  }

  try {
    const lines = fs.readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean);

    const filtered = level ? lines.filter(l => l.level === level) : lines;
    const recent = filtered.slice(-limit).reverse();
    res.json({ success: true, data: recent, total: filtered.length, file: logFile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/auth/status
app.get('/api/auth/status', async (req, res) => {
  const cookies = loadCookies();
  const hasLoginCookie = checkLoginFromCookies(cookies);
  isLoggedIn = hasLoginCookie;

  // 如果有 Cookie，做在线验证（异步，不阻塞返回）
  let verifyResult = null;
  if (hasLoginCookie && req.query.verify === 'true') {
    verifyResult = await verifyCookieOnline(cookiesToString(cookies));
    if (verifyResult.valid === false) {
      isLoggedIn = false;
    }
  }

  const b = detectBrowser();
  res.json({
    success: true,
    data: {
      loggedIn: hasLoginCookie,
      cookieCount: cookies.length,
      hasSUB: cookies.some(c => c.name === 'SUB'),
      cookieUpdatedAt: cookies.length > 0 && cookies[0].expires
        ? new Date(cookies[0].expires * 1000).toISOString()
        : null,
      verifyResult: verifyResult || undefined,
      headlessOnly: false,
      playwrightMissing: !b.available,
      browser: { available: b.available, source: b.source, name: b.name, reason: b.reason },
    }
  });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  if (checkLoginFromCookies(loadCookies())) {
    return res.json({ success: true, message: '已登录，无需重新登录', alreadyLoggedIn: true });
  }

  // 预检：检查是否有任何可用浏览器（系统 Chrome/Edge/Brave/... 或 bundled Chromium）
  const bStatus = detectBrowser({ refresh: true }); // 强制刷新缓存，覆盖用户中途安装浏览器的场景
  if (!bStatus.available) {
    loginLogger.error(`无可用浏览器: ${bStatus.reason}`, { executablePath: bStatus.executablePath });
    return res.status(503).json({
      success: false,
      playwrightMissing: true,
      error: `本机未检测到 Chrome / Edge / Brave / Chromium 等浏览器（${bStatus.reason || '未知原因'}）。${BROWSER_INSTALL_HINT}`,
      installCommand: 'npm install cloakbrowser',
      executablePath: bStatus.executablePath,
    });
  }
  loginLogger.info(`使用浏览器：${bStatus.name}（${bStatus.source}）`, { executablePath: bStatus.executablePath });

  // 如果已有待确认的登录窗口，直接返回
  if (pendingLoginContext) {
    return res.json({ success: true, message: '登录窗口已打开，请在浏览器中完成登录后点击「我已完成登录」', pending: true });
  }

  loginLogger.info('收到登录请求，打开浏览器...');
  res.json({ success: true, message: '已打开微博登录窗口，请在弹出的浏览器中完成登录', pending: true });

  openLoginWindow().catch(err => {
    loginLogger.error(`打开登录窗口异常: ${err.message}`);
    const isMissingBrowser = /Executable doesn't exist|playwright install|spawn .* ENOENT/i.test(err.message || '');
    const friendlyMsg = isMissingBrowser
      ? `打开登录窗口失败：本机浏览器不可用。${BROWSER_INSTALL_HINT}`
      : `打开登录窗口失败：${err.message}`;
    const payload = `data: ${JSON.stringify({
      type: 'loginResult',
      success: false,
      message: friendlyMsg,
      playwrightMissing: isMissingBrowser,
    })}\n\n`;
    for (const client of sseClients) {
      try { client.write(payload); } catch (_) { sseClients.delete(client); }
    }
  });
});

/**
 * POST /api/auth/confirm-login
 * 用户在前端点击「我已完成登录」后，服务端从浏览器上下文采集 Cookie
 */
app.post('/api/auth/confirm-login', async (req, res) => {
  if (!pendingLoginContext) {
    return res.status(400).json({ success: false, error: '没有待确认的登录窗口，请先点击「打开微博登录窗口」' });
  }

  loginLogger.info('用户手动确认登录，采集 Cookie（跳过在线校验，信任用户操作）...');

  try {
    const finalCookies = await pendingLoginContext.cookies([
      'https://weibo.com',
      'https://www.weibo.com',
      'https://m.weibo.cn',
      'https://passport.weibo.com',
    ]);

    if (!finalCookies || finalCookies.length === 0) {
      loginLogger.warn('确认时未采集到任何 Cookie，登录窗口可能未加载完成');
      return res.json({
        success: false,
        error: '未采集到任何 Cookie，请确认浏览器已加载 m.weibo.cn 后再点击',
      });
    }

    saveCookies(finalCookies);
    isLoggedIn = true;
    loginLogger.info(`✅ Cookie 已保存 ${finalCookies.length} 条（未校验，用户已确认）`);

    const ssePayload = `data: ${JSON.stringify({
      type: 'loginResult', success: true,
      message: `已保存 ${finalCookies.length} 条 Cookie`,
      userInfo: {},
    })}\n\n`;
    for (const client of sseClients) { try { client.write(ssePayload); } catch (_) {} }

    await closePendingLogin();
    return res.json({ success: true, message: `已保存 ${finalCookies.length} 条 Cookie，若实际未登录可点「重新登录」`, userInfo: {} });
  } catch (e) {
    loginLogger.error(`confirm-login 异常: ${e.message}`);
    await closePendingLogin();
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/auth/verify - 验证当前 Cookie 是否有效
app.post('/api/auth/verify', async (req, res) => {
  const cookies = loadCookies();
  if (!checkLoginFromCookies(cookies)) {
    return res.json({ success: true, data: { valid: false, error: '没有保存的 Cookie' } });
  }
  const result = await verifyCookieOnline(cookiesToString(cookies));
  res.json({ success: true, data: result });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  logout();
  res.json({ success: true, message: '已退出登录' });
});

// GET /api/auth/login-screenshot - Docker 无头模式截图
app.get('/api/auth/login-screenshot', (req, res) => {
  if (!loginScreenshotBuffer) {
    return res.status(404).send('No screenshot available');
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(loginScreenshotBuffer);
});

// POST /api/auth/set-cookie
app.post('/api/auth/set-cookie', async (req, res) => {
  const { cookie } = req.body;
  if (!cookie || typeof cookie !== 'string') {
    return res.status(400).json({ success: false, error: 'cookie 不能为空' });
  }

  const cookies = cookie.split(';').map(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return null;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    return name ? { name, value, domain: '.weibo.cn', path: '/', sameSite: 'Lax' } : null;
  }).filter(Boolean);

  if (cookies.length === 0) {
    return res.status(400).json({ success: false, error: '解析后 Cookie 数为 0，请检查格式（应为 "name=value; name=value; ..."）' });
  }

  saveCookies(cookies);
  isLoggedIn = true;
  cookieLogger.info(`✅ 已保存 ${cookies.length} 条 Cookie（未校验，用户已确认）`);

  res.json({
    success: true,
    message: `已保存 ${cookies.length} 条 Cookie，若实际未登录可点「重新登录」`,
    loggedIn: true,
  });
});

// GET /api/subscriptions
app.get('/api/subscriptions', (req, res) => {
  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  let needsWrite = false;
  const result = subs.map(sub => {
    // v0.1.0：实时统计帖子数量，而不是依赖缓存的 postCount
    const postsFile = path.join(USERS_DIR, sub.uid, 'posts.json');
    let actualPostCount = sub.postCount || 0;
    if (fs.existsSync(postsFile)) {
      try {
        const posts = readJSON(postsFile, []);
        actualPostCount = posts.length;
      } catch (_) {}
    }
    // 如果实际数量与缓存不一致，更新缓存
    if (sub.postCount !== actualPostCount) {
      sub.postCount = actualPostCount;
      needsWrite = true;
    }
    return {
      ...sub,
      postCount: actualPostCount,
      fetchStatus: fetchStatus.get(sub.uid) || { status: 'idle', message: '', lastFetch: sub.lastFetch || null },
    };
  });
  // 回写 subscriptions.json（同步 postCount）
  if (needsWrite) writeJSON(SUBSCRIPTIONS_FILE, subs);
  res.json({ success: true, data: result });
});

// POST /api/subscriptions
app.post('/api/subscriptions', async (req, res) => {
  const { input, intervalMinutes = 60 } = req.body;
  if (!input) return res.status(400).json({ success: false, error: '请输入 UID 或微博主页 URL' });

  const uid = extractUid(input);
  if (!uid) return res.status(400).json({ success: false, error: '无法解析 UID，请检查格式' });

  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  if (subs.find(s => s.uid === uid)) {
    return res.status(409).json({ success: false, error: `UID ${uid} 已在订阅列表中` });
  }

  const newSub = {
    uid,
    intervalMinutes: Math.max(parseInt(intervalMinutes) || 60, 5),
    createdAt: new Date().toISOString(),
    lastFetch: null,
    postCount: 0,
    name: `用户 ${uid}`,
    avatar: '',
  };

  // 先尝试获取用户资料
  const cookies = loadCookies();
  if (checkLoginFromCookies(cookies)) {
    try {
      const profile = await fetchUserProfile(uid, cookies);
      if (profile) {
        newSub.name = profile.name || newSub.name;
        newSub.avatar = profile.avatar || '';
        const userDir = path.join(USERS_DIR, uid);
        ensureDir(userDir);
        writeJSON(path.join(userDir, 'profile.json'), { ...profile, uid, updatedAt: new Date().toISOString() });
        logger.info(`获取到用户资料`, { uid, name: profile.name });
      }
    } catch (err) {
      logger.warn(`获取用户资料失败`, { uid, err: err.message });
    }
  }

  subs.push(newSub);
  writeJSON(SUBSCRIPTIONS_FILE, subs);

  const userDir = path.join(USERS_DIR, uid);
  ensureDir(userDir);
  ensureDir(path.join(userDir, 'images'));
  ensureFile(path.join(userDir, 'posts.json'), []);
  if (!fs.existsSync(path.join(userDir, 'profile.json'))) {
    ensureFile(path.join(userDir, 'profile.json'), { uid, name: newSub.name, avatar: newSub.avatar });
  }

  startScheduler(uid, newSub.intervalMinutes);

  // v0.1.0：判断首次抓取模式 — 有数据则增量，无数据则全量
  const existingPosts = readJSON(path.join(userDir, 'posts.json'), []);
  const hasCheckpoint = fs.existsSync(path.join(userDir, 'checkpoint.json'));
  const isFirstFull = existingPosts.length === 0 && !hasCheckpoint;

  res.json({ success: true, data: newSub, message: `已添加订阅 ${newSub.name}（${uid}），${isFirstFull ? '首次全量' : '增量'}抓取将立即开始` });

  setTimeout(() => {
    enqueueFetch(uid, !isFirstFull);
  }, 500);
});

// DELETE /api/subscriptions/:uid
app.delete('/api/subscriptions/:uid', (req, res) => {
  const { uid } = req.params;
  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  const idx = subs.findIndex(s => s.uid === uid);
  if (idx === -1) return res.status(404).json({ success: false, error: '订阅不存在' });
  subs.splice(idx, 1);
  writeJSON(SUBSCRIPTIONS_FILE, subs);
  stopScheduler(uid);
  fetchStatus.delete(uid);
  logger.info(`删除订阅`, { uid });
  res.json({ success: true, message: `已删除订阅 uid=${uid}` });
});

// GET /api/posts/:uid
app.get('/api/posts/:uid', (req, res) => {
  const { uid } = req.params;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 50);

  // 先查内存缓存，命中则跳过磁盘读取
  let posts = cacheGet(uid);
  if (!posts) {
    posts = readJSON(path.join(USERS_DIR, uid, 'posts.json'), []);
    cacheSet(uid, posts);
  }

  const profile = readJSON(path.join(USERS_DIR, uid, 'profile.json'), { uid, name: `用户 ${uid}`, avatar: '' });

  const total = posts.length;
  const start = (page - 1) * pageSize;
  const paged = posts.slice(start, start + pageSize);

  res.json({
    success: true,
    data: {
      posts: paged,
      profile,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    },
  });
});

// GET /api/search — v0.2.0 搜索 API
app.get('/api/search', (req, res) => {
  const searchLogger = createLogger('Search');
  const keyword = (req.query.keyword || '').trim();
  if (!keyword) {
    return res.status(400).json({ success: false, error: 'keyword 参数必填' });
  }

  const scope = req.query.scope || 'all';
  const startDateStr = req.query.startDate || '';
  const endDateStr = req.query.endDate || '';
  const picFilter = req.query.picFilter || 'all';
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 50);

  // 解析时间范围
  let startDate = null;
  let endDate = null;
  if (startDateStr) {
    try { startDate = new Date(startDateStr); if (isNaN(startDate.getTime())) startDate = null; } catch (_) { startDate = null; }
  }
  if (endDateStr) {
    try { endDate = new Date(endDateStr); endDate.setHours(23, 59, 59, 999); if (isNaN(endDate.getTime())) endDate = null; } catch (_) { endDate = null; }
  }

  // 解析 scope 确定要搜索的 uid 列表
  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  let targetUids = [];
  if (scope === 'all') {
    targetUids = subs.map(s => s.uid);
  } else {
    // 逗号分隔的 uid 列表
    targetUids = scope.split(',').map(u => u.trim()).filter(Boolean);
  }

  if (targetUids.length === 0) {
    return res.json({ success: true, data: { posts: [], pagination: { page, pageSize, total: 0, totalPages: 0 }, keyword } });
  }

  // 构建订阅信息的 uid -> { name, avatar } 映射
  const subMap = new Map();
  for (const sub of subs) {
    subMap.set(sub.uid, { name: sub.name || `用户 ${sub.uid}`, avatar: sub.avatar || '' });
  }

  const keywordLower = keyword.toLowerCase();
  const matchedPosts = [];

  for (const uid of targetUids) {
    // 使用缓存读取帖子
    let posts = cacheGet(uid);
    if (!posts) {
      posts = readJSON(path.join(USERS_DIR, uid, 'posts.json'), []);
      cacheSet(uid, posts);
    }

    // 获取用户信息
    const profile = readJSON(path.join(USERS_DIR, uid, 'profile.json'), null);
    const userName = profile?.name || subMap.get(uid)?.name || `用户 ${uid}`;
    const userAvatar = profile?.avatar || subMap.get(uid)?.avatar || '';

    for (const post of posts) {
      // 大小写不敏感的 includes 匹配
      const textLower = (post.text || '').toLowerCase();
      if (!textLower.includes(keywordLower)) continue;

      // 时间范围筛选
      if (startDate || endDate) {
        try {
          const postDate = new Date(post.createdAt);
          if (isNaN(postDate.getTime())) continue; // 解析失败则跳过日期筛选（即此帖子不匹配时间条件）
          if (startDate && postDate < startDate) continue;
          if (endDate && postDate > endDate) continue;
        } catch (_) {
          continue; // 解析异常则跳过
        }
      }

      // 图片筛选
      if (picFilter === 'withPics') {
        if (!post.pics || post.pics.length === 0) continue;
      } else if (picFilter === 'noPics') {
        if (post.pics && post.pics.length > 0) continue;
      }

      // 匹配成功，附加来源用户信息
      matchedPosts.push({
        ...post,
        uid,
        userName,
        userAvatar,
      });
    }
  }

  // 按时间倒序排列
  matchedPosts.sort((a, b) => {
    const dateA = new Date(a.createdAt);
    const dateB = new Date(b.createdAt);
    const timeA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
    const timeB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();
    return timeB - timeA;
  });

  // 分页
  const total = matchedPosts.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const startIdx = (page - 1) * pageSize;
  const pagedPosts = matchedPosts.slice(startIdx, startIdx + pageSize);

  searchLogger.info(`搜索完成`, { keyword, scope, picFilter, total, page, pageSize });

  res.json({
    success: true,
    data: {
      posts: pagedPosts,
      pagination: { page, pageSize, total, totalPages },
      keyword,
    },
  });
});

// POST /api/fetch/:uid
app.post('/api/fetch/:uid', (req, res) => {
  const { uid } = req.params;
  let incremental = req.body.incremental === true || req.body.incremental === 'true';
  const force = req.body.force === true;

  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  if (!subs.find(s => s.uid === uid)) {
    return res.status(404).json({ success: false, error: '订阅不存在' });
  }

  const current = fetchStatus.get(uid);
  if (current?.status === 'fetching') {
    return res.status(409).json({ success: false, error: '正在抓取中，请稍后', currentMessage: current.message });
  }

  // v0.2.0：force=true 时清除 checkpoint.json（强制从头开始）
  if (force && !incremental) {
    const userDir = path.join(USERS_DIR, uid);
    const checkpointFile = path.join(userDir, 'checkpoint.json');
    if (fs.existsSync(checkpointFile)) {
      try { fs.unlinkSync(checkpointFile); } catch (_) {}
      logger.info(`force=true，已删除断点文件`, { uid });
    }
  }

  // v0.2.0：全量抓取只允许首次（无数据时），有数据一律改为增量 — 但 force=true 时跳过此逻辑
  if (!incremental && !force) {
    const userDir = path.join(USERS_DIR, uid);
    const postsFile = path.join(userDir, 'posts.json');
    if (fs.existsSync(postsFile)) {
      try {
        const existing = readJSON(postsFile, []);
        if (existing.length > 0) {
          // 已有数据，自动改为增量
          incremental = true;
          logger.info(`已有 ${existing.length} 条帖子，全量→增量`, { uid });
        }
      } catch (_) {}
    }
    // 同时检查是否有断点需要恢复
    const checkpointFile = path.join(userDir, 'checkpoint.json');
    if (fs.existsSync(checkpointFile)) {
      incremental = true; // 有断点用增量恢复
      logger.info(`发现断点文件，使用增量恢复`, { uid });
    }
  }

  // v0.2.0：force=true 时推送 fullFetchMode 标识
  const fullFetchMode = force && !incremental;

  // v0.0.8：通过任务队列启动（支持并发）
  const result = enqueueFetch(uid, incremental);
  if (!result.queued) {
    return res.status(409).json({ success: false, error: result.reason });
  }

  const mode = incremental ? '增量' : '全量';
  logger.info(`手动触发${mode}抓取`, { uid, force, fullFetchMode });
  res.json({ success: true, message: `已触发${mode}抓取，进度请关注左侧状态`, autoIncremental: !req.body.incremental && incremental, fullFetchMode });

  updateProgress(uid, { status: 'fetching', message: `${mode}抓取启动中...`, progress: 0, total: 100, fullFetchMode: fullFetchMode || undefined });
});

// POST /api/fetch/:uid/abort — v0.0.8：终止抓取
app.post('/api/fetch/:uid/abort', (req, res) => {
  const { uid } = req.params;
  const aborted = abortFetch(uid);
  if (aborted) {
    logger.info(`终止抓取请求已发送`, { uid });
    res.json({ success: true, message: '终止信号已发送，正在保存已抓取数据...' });
  } else {
    res.json({ success: false, error: '没有正在进行的抓取任务' });
  }
});

// GET /api/fetch/queue — v0.0.8：查看任务队列
app.get('/api/fetch/queue', (req, res) => {
  const active = [];
  for (const [uid, ac] of activeFetches.entries()) {
    active.push({ uid, status: fetchStatus.get(uid)?.status || 'fetching' });
  }
  res.json({
    success: true,
    data: {
      activeCount: activeFetches.size,
      maxConcurrent: MAX_CONCURRENT_FETCHES,
      queueLength: fetchQueue.length,
      active,
      queue: fetchQueue.map(t => ({ uid: t.uid, isIncremental: t.isIncremental })),
    },
  });
});

// GET /api/status
app.get('/api/status', (req, res) => {
  const all = {};
  for (const [uid, status] of fetchStatus.entries()) all[uid] = status;
  res.json({ success: true, data: all });
});

// GET /api/images/:uid/:filename
app.get('/api/images/:uid/:filename', (req, res) => {
  const { uid, filename } = req.params;
  const imgPath = path.join(USERS_DIR, uid, 'images', path.basename(filename));
  if (!fs.existsSync(imgPath)) return res.status(404).send('图片不存在');

  // v0.2.0：支持 download 参数，触发浏览器下载
  if (req.query.download === 'true') {
    // 获取用户名
    const subs = readJSON(SUBSCRIPTIONS_FILE, []);
    const sub = subs.find(s => s.uid === uid);
    const userName = sub?.name || uid;

    // 从文件名中提取 mid（文件名格式：{mid}_{序号}.{ext}）
    const baseName = path.basename(filename);
    const midMatch = baseName.match(/^(\d+)_/);
    const mid = midMatch ? midMatch[1] : '';

    // 生成下载文件名：{用户名}_{mid}_{序号}.{ext}
    const ext = path.extname(baseName);
    const seqMatch = baseName.match(/_(\d+)\./);
    const seq = seqMatch ? seqMatch[1] : '0';
    const downloadName = mid
      ? `${userName}_${mid}_${seq}${ext}`
      : `${userName}_${baseName}`;

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
  }

  res.sendFile(imgPath);
});

// GET /api/profile/:uid
app.get('/api/profile/:uid', (req, res) => {
  const { uid } = req.params;
  const profile = readJSON(path.join(USERS_DIR, uid, 'profile.json'), { uid, name: `用户 ${uid}`, avatar: '' });
  res.json({ success: true, data: profile });
});

// GET /api/health
app.get('/api/health', (req, res) => {
  const b = detectBrowser();
  res.json({
    success: true,
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    loggedIn: getLoginStatus(),
    subscriptions: readJSON(SUBSCRIPTIONS_FILE, []).length,
    sseClients: sseClients.size,
    logFile: getLogFilePath(),
    rateLimits: RATE_LIMIT,
    cacheSize: postCache.size,
    headlessOnly: false,
    playwrightMissing: !b.available,
    browser: { available: b.available, source: b.source, name: b.name, reason: b.reason },
  });
});

// ─── 启动 ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`╔══════════════════════════════════════════╗`);
  logger.info(`║   微博归档器 v1.0.0  已启动              ║`);
  logger.info(`║   http://localhost:${PORT}                  ║`);
  logger.info(`╚══════════════════════════════════════════╝`);

  const cookies = loadCookies();
  if (checkLoginFromCookies(cookies)) {
    isLoggedIn = true;
    logger.info(`✅ 已检测到登录态`, { cookieCount: cookies.length });
  } else {
    logger.warn(`⚠️  未登录，请访问 http://localhost:${PORT} 并点击"登录微博"按钮`);
  }

  const b = detectBrowser();
  if (b.available && b.source === 'system') {
    logger.info(`🌐 使用系统浏览器：${b.name}（${b.executablePath}）— 无需下载额外组件`);
  } else if (b.available && b.source === 'cloakbrowser') {
    logger.info(`🛡️ 使用 CloakBrowser 隐形 Chromium（C++ 源码级防反爬，${b.executablePath}）`);
  } else {
    logger.warn(`⚠️  未检测到任何浏览器，自动登录将不可用。${BROWSER_INSTALL_HINT}`);
  }

  restoreSchedulers();

  // v0.0.9：启动时恢复未完成的断点任务
  restoreCheckpoints();
});

// ─── v0.0.9：启动时恢复断点任务 ──────────────────────────────────────────────

function restoreCheckpoints() {
  const cpLogger = createLogger('CheckpointRestore');
  if (!fs.existsSync(USERS_DIR)) return;

  const entries = fs.readdirSync(USERS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  let restored = 0;
  for (const uid of entries) {
    const checkpointFile = path.join(USERS_DIR, uid, 'checkpoint.json');
    if (!fs.existsSync(checkpointFile)) continue;

    const cp = readJSON(checkpointFile, null);
    if (!cp || !cp.uid) continue;

    cpLogger.info(`发现断点任务`, { uid, abortedAt: cp.abortedAt, fetchedCount: cp.fetchedPostCount });

    // 检查该用户是否在订阅列表中
    const subs = readJSON(SUBSCRIPTIONS_FILE, []);
    if (!subs.find(s => s.uid === uid)) {
      cpLogger.warn(`用户 ${uid} 不在订阅列表中，跳过断点恢复`);
      continue;
    }

    // 自动触发增量抓取来恢复
    updateProgress(uid, {
      status: 'fetching',
      message: `🔄 正在恢复断点任务（上次获取了 ${cp.fetchedPostCount || '?'} 条）...`,
      progress: 5,
      total: 100,
    });

    // 延迟 2 秒后入队，避免启动时并发冲击
    setTimeout(() => {
      enqueueFetch(uid, true); // 增量模式恢复
    }, 2000 + restored * 3000); // 每个恢复任务间隔 3 秒

    restored++;
  }

  if (restored > 0) {
    cpLogger.info(`已恢复 ${restored} 个断点任务`);
  }
}

// ─── 优雅退出 ──────────────────────────────────────────────────────────────

async function gracefulShutdown(signal) {
  logger.info(`收到 ${signal}，正在优雅退出...`);
  try {
    if (sharedBrowserContext) { await sharedBrowserContext.close(); sharedBrowserContext = null; }
  } catch (_) {}
  try {
    if (sharedBrowser) { await sharedBrowser.close(); sharedBrowser = null; }
  } catch (_) {}
  try {
    if (loginBrowser) { await loginBrowser.close(); loginBrowser = null; }
  } catch (_) {}
  if (logStream) { try { logStream.end(); } catch (_) {} }
  logger.info('浏览器资源已清理，进程退出');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;
