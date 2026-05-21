/**
 * server.js - 微博归档系统后端服务 v0.0.2
 *
 * 变更记录：
 *   v0.0.2 - 结构化日志系统 / 修复抓取 Bug / SSE 实时进度 / 登录状态验证
 *   v0.0.1 - 自动登录 / Cookie 持久化 / 真实数据抓取
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const axios = require('axios');

const app = express();
const PORT = 3000;

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

  // 控制台输出（带颜色）
  const colors = { silly: '\x1b[37m', debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
  const reset = '\x1b[0m';
  const color = colors[level] || '';
  console.log(`${color}[${entry.ts.slice(11, 19)}][${level.toUpperCase().padEnd(5)}][${module_}]${reset} ${message}${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`);

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
logger.info('微博归档器 v0.0.2 启动中...', { logLevel: Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === CURRENT_LOG_LEVEL) });

// ─── 中间件 ────────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

function randomDelay(min = 800, max = 2500) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
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

async function downloadImage(url, destPath, cookieStr) {
  try {
    ensureDir(path.dirname(destPath));
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 25000,
      headers: {
        Referer: 'https://weibo.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
    });
    fs.writeFileSync(destPath, Buffer.from(resp.data));
    imgLogger.debug(`下载成功: ${path.basename(destPath)}`);
    return true;
  } catch (err) {
    imgLogger.warn(`下载失败: ${url}`, { err: err.message });
    return false;
  }
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
  if (!cookies || cookies.length === 0) return false;
  const names = new Set(cookies.map(c => c.name));
  return names.has('SUB') || names.has('SUBP');
}

/**
 * 验证 Cookie 是否真实有效（调用微博 API 验证）
 * @param {string} cookieStr
 * @returns {Promise<{valid: boolean, uid?: string, name?: string, error?: string}>}
 */
async function verifyCookieOnline(cookieStr) {
  const vLogger = createLogger('CookieVerify');
  try {
    // 访问微博个人信息接口，如果返回用户数据说明 Cookie 有效
    const resp = await axios.get('https://weibo.com/ajax/account/loginInfo', {
      timeout: 10000,
      headers: {
        Cookie: cookieStr,
        Referer: 'https://weibo.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (resp.data) {
      // loginInfo 接口：返回 { data: { login: true, uid, screen_name } }
      const d = resp.data.data || resp.data;
      if (d.login === true || d.islogin === 1 || d.uid) {
        vLogger.info('Cookie 验证成功', { uid: d.uid, name: d.screen_name });
        return { valid: true, uid: String(d.uid || ''), name: d.screen_name || '' };
      }
    }

    // 备用：尝试 profile/me 接口
    const resp2 = await axios.get('https://weibo.com/ajax/profile/me', {
      timeout: 8000,
      headers: {
        Cookie: cookieStr,
        Referer: 'https://weibo.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (resp2.data && resp2.data.data) {
      const u = resp2.data.data;
      if (u.id || u.uid) {
        vLogger.info('Cookie 验证成功（备用接口）', { uid: u.id || u.uid });
        return { valid: true, uid: String(u.id || u.uid || ''), name: u.screen_name || '' };
      }
    }

    vLogger.warn('Cookie 存在但未检测到登录态');
    return { valid: false, error: 'Cookie 已失效，请重新登录' };
  } catch (err) {
    vLogger.warn(`Cookie 在线验证失败: ${err.message}`);
    // 网络问题时降级为本地检查
    return { valid: null, error: `网络验证失败: ${err.message}（已降级为本地检查）` };
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
 * 打开登录窗口，等待用户完成登录，自动保存并验证 Cookie
 */
async function openLoginWindow() {
  if (loginBrowser) {
    try { await loginBrowser.close(); } catch (_) {}
    loginBrowser = null;
  }

  loginLogger.info('打开登录窗口...');

  loginBrowser = await chromium.launch({ headless: false, args: BROWSER_ARGS });
  const context = await loginBrowser.newContext({ ...CONTEXT_OPTIONS });
  await context.addInitScript(INIT_SCRIPT);

  // 注入已有 Cookie
  const existing = loadCookies();
  if (existing.length > 0) {
    try { await context.addCookies(existing); } catch (_) {}
  }

  const page = await context.newPage();
  await page.goto('https://weibo.com/login.php', { waitUntil: 'domcontentloaded', timeout: 30000 });

  loginLogger.info('登录窗口已打开，等待用户操作...');

  return new Promise((resolve) => {
    let resolved = false;
    let checkInterval = null;

    const finish = async (result) => {
      if (resolved) return;
      resolved = true;
      if (checkInterval) clearInterval(checkInterval);
      isLoggedIn = result.success;
      resolve(result);
    };

    checkInterval = setInterval(async () => {
      try {
        const currentUrl = page.url();
        const cookies = await context.cookies();
        const hasLoginCookie = checkLoginFromCookies(cookies);

        if (hasLoginCookie || (currentUrl.includes('weibo.com') && !currentUrl.includes('login'))) {
          // 等待页面稳定后再保存（避免拿到登录中间态 Cookie）
          await page.waitForTimeout(1500);
          const finalCookies = await context.cookies(['https://weibo.com', 'https://www.weibo.com', 'https://passport.weibo.com']);

          saveCookies(finalCookies);
          loginLogger.info('Cookie 已保存，正在在线验证...');

          const verifyResult = await verifyCookieOnline(cookiesToString(finalCookies));

          setTimeout(async () => {
            try { await context.close(); await loginBrowser.close(); loginBrowser = null; } catch (_) {}
          }, 2000);

          if (verifyResult.valid === true) {
            loginLogger.info('登录验证成功', { uid: verifyResult.uid, name: verifyResult.name });
            await finish({ success: true, message: `登录成功！欢迎 ${verifyResult.name || verifyResult.uid}`, userInfo: verifyResult });
          } else if (verifyResult.valid === false) {
            loginLogger.warn('Cookie 无效', { error: verifyResult.error });
            await finish({ success: false, message: verifyResult.error });
          } else {
            // 网络验证失败，降级通过
            loginLogger.warn('在线验证失败，降级接受 Cookie');
            await finish({ success: true, message: 'Cookie 已保存（网络验证跳过）', userInfo: {} });
          }
        }
      } catch (err) {
        loginLogger.error(`登录检测异常: ${err.message}`);
        if (!resolved) await finish({ success: false, message: `检测异常: ${err.message}` });
      }
    }, 2000);

    page.on('close', async () => {
      if (resolved) return;
      try {
        const cookies = await context.cookies();
        if (checkLoginFromCookies(cookies)) {
          saveCookies(cookies);
          await finish({ success: true, message: '窗口关闭，Cookie 已保存' });
        } else {
          await finish({ success: false, message: '窗口已关闭，未检测到登录态' });
        }
      } catch (_) {
        await finish({ success: false, message: '窗口已关闭' });
      }
    });

    setTimeout(() => finish({ success: false, message: '登录超时（5分钟），请重试' }), 5 * 60 * 1000);
  });
}

function logout() {
  writeJSON(COOKIE_FILE, []);
  isLoggedIn = false;
  loginLogger.info('已清除登录态');
}

// ─── 微博 API 抓取 ─────────────────────────────────────────────────────────────

const fetchLogger = createLogger('Fetch');

/**
 * 获取用户资料（API 接口）
 */
async function fetchUserProfile(uid, cookieStr) {
  try {
    const resp = await axios.get(`https://weibo.com/ajax/profile/info?uid=${uid}`, {
      timeout: 10000,
      headers: {
        Cookie: cookieStr,
        Referer: `https://weibo.com/u/${uid}`,
        'User-Agent': CONTEXT_OPTIONS.userAgent,
        Accept: 'application/json, text/plain, */*',
      },
    });
    if (resp.data?.data?.user) {
      const u = resp.data.data.user;
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
  } catch (err) {
    fetchLogger.warn(`获取用户资料失败 uid=${uid}`, { err: err.message });
    return null;
  }
}

/**
 * 从微博 API 获取帖子列表（单页）
 */
async function fetchWeiboApiPosts(uid, cookieStr, page = 1) {
  const url = `https://weibo.com/ajax/statuses/mymblog?uid=${uid}&page=${page}&feature=0`;
  fetchLogger.debug(`请求 API 第 ${page} 页`, { uid, url });

  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: {
        Cookie: cookieStr,
        Referer: `https://weibo.com/u/${uid}`,
        'User-Agent': CONTEXT_OPTIONS.userAgent,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
    });

    fetchLogger.debug(`API 响应 page=${page}`, {
      status: resp.status,
      hasData: !!resp.data?.data?.list,
      count: resp.data?.data?.list?.length ?? 0,
    });

    if (resp.data?.data?.list) {
      return { posts: parseApiPosts(resp.data.data.list), total: resp.data.data.total || 0 };
    }

    // 检测登录失效
    if (resp.data?.errno === 20111 || resp.data?.msg?.includes('未登录') || resp.data?.msg?.includes('请先登录')) {
      fetchLogger.error('Cookie 已失效，需要重新登录', { uid, errno: resp.data.errno });
      return { posts: [], total: 0, loginRequired: true };
    }

    fetchLogger.warn(`API 返回异常数据`, { uid, page, keys: Object.keys(resp.data || {}) });
    return { posts: [], total: 0 };
  } catch (err) {
    fetchLogger.error(`API 请求失败 page=${page}`, { uid, err: err.message, code: err.code });
    return { posts: [], total: 0, error: err.message };
  }
}

/**
 * 解析微博 API 帖子数据
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
 * 核心抓取函数（v0.0.2 修复版本）
 *
 * 修复点：
 * 1. 不再依赖 Playwright 刷新 Cookie（直接用存储的 Cookie 调 API）
 * 2. 增加 Cookie 有效性检查（调 API 前验证）
 * 3. 全程进度更新（updateProgress）
 * 4. 详细错误日志
 */
async function fetchUserPosts(uid, isIncremental = false) {
  const fLog = createLogger(`Fetch:${uid}`);
  fLog.info(`开始${isIncremental ? '增量' : '全量'}抓取`, { uid });

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

  const cookieStr = cookiesToString(storedCookies);
  fLog.debug('Cookie 基础检查通过', { cookieCount: storedCookies.length });

  // ── 步骤 2：获取用户资料 ──
  updateProgress(uid, { status: 'fetching', message: '正在获取用户资料...', progress: 5, total: 100 });
  try {
    const profile = await fetchUserProfile(uid, cookieStr);
    if (profile) {
      writeJSON(profileFile, { ...profile, uid, updatedAt: new Date().toISOString() });
      fLog.info('用户资料已更新', { name: profile.name });

      // 更新订阅中的昵称/头像
      const subs = readJSON(SUBSCRIPTIONS_FILE, []);
      const sub = subs.find(s => s.uid === uid);
      if (sub && (profile.name || profile.avatar)) {
        sub.name = profile.name || sub.name;
        sub.avatar = profile.avatar || sub.avatar;
        writeJSON(SUBSCRIPTIONS_FILE, subs);
      }
    } else {
      fLog.warn('获取用户资料失败，可能 Cookie 已失效');
      // 如果连用户资料都拿不到，检查是否真的登录
      const verify = await verifyCookieOnline(cookieStr);
      if (verify.valid === false) {
        updateProgress(uid, { status: 'error', message: '❌ Cookie 已失效，请重新登录' });
        return { success: false, error: 'Cookie 已失效' };
      }
    }
  } catch (err) {
    fLog.warn(`获取用户资料异常: ${err.message}`);
  }

  // ── 步骤 3：分页抓取帖子 ──
  const maxPages = isIncremental ? 2 : 8;
  let allFetchedPosts = [];
  let shouldStop = false;

  for (let p = 1; p <= maxPages && !shouldStop; p++) {
    const progressPct = Math.round(10 + (p / maxPages) * 60);
    updateProgress(uid, {
      status: 'fetching',
      message: `正在获取第 ${p}/${maxPages} 页...`,
      progress: progressPct,
      total: 100,
    });

    const result = await fetchWeiboApiPosts(uid, cookieStr, p);

    if (result.loginRequired) {
      updateProgress(uid, { status: 'error', message: '❌ 登录已过期，请重新登录' });
      return { success: false, error: '登录已过期' };
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

    allFetchedPosts = allFetchedPosts.concat(result.posts);
    fLog.debug(`第 ${p} 页获取 ${result.posts.length} 条`, { total: allFetchedPosts.length });

    // 增量模式：遇到重复内容停止
    if (isIncremental) {
      const hasOverlap = result.posts.some(post => existingMids.has(post.mid));
      if (hasOverlap) {
        fLog.info('增量检测到重复内容，停止翻页', { page: p });
        shouldStop = true;
      }
    }

    if (p < maxPages && !shouldStop) await randomDelay(800, 1800);
  }

  // ── 步骤 4：筛选新帖子 ──
  const newPosts = allFetchedPosts.filter(p => !existingMids.has(p.mid));
  fLog.info(`抓取完成`, { total: allFetchedPosts.length, new: newPosts.length });

  if (newPosts.length === 0 && !isIncremental && allFetchedPosts.length === 0) {
    updateProgress(uid, { status: 'error', message: '⚠️ 未获取到任何帖子，请检查 Cookie 是否有效' });
    return { success: false, error: '未获取到帖子' };
  }

  // ── 步骤 5：下载图片 ──
  if (newPosts.length > 0) {
    const totalImgs = newPosts.reduce((sum, p) => sum + p.pics.length, 0);
    let downloadedImgs = 0;

    fLog.info(`开始下载图片`, { posts: newPosts.length, images: totalImgs });
    updateProgress(uid, {
      status: 'fetching',
      message: `正在下载图片 (0/${totalImgs})...`,
      progress: 70,
      total: 100,
    });

    for (const post of newPosts) {
      const localPics = [];
      for (let i = 0; i < post.pics.length; i++) {
        const picUrl = post.pics[i];
        const rawExt = picUrl.split('?')[0].split('.').pop() || 'jpg';
        const ext = rawExt.slice(0, 4).replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
        const filename = `${post.mid}_${i}.${ext}`;
        const destPath = path.join(imagesDir, filename);

        if (!fs.existsSync(destPath)) {
          const ok = await downloadImage(picUrl, destPath, cookieStr);
          if (ok) localPics.push(filename);
          await randomDelay(200, 600);
        } else {
          localPics.push(filename);
        }

        downloadedImgs++;
        if (totalImgs > 0) {
          const imgPct = Math.round(70 + (downloadedImgs / totalImgs) * 25);
          updateProgress(uid, {
            status: 'fetching',
            message: `正在下载图片 (${downloadedImgs}/${totalImgs})...`,
            progress: imgPct,
            total: 100,
          });
        }
      }
      post.localPics = localPics;
    }
  }

  // ── 步骤 6：合并保存 ──
  updateProgress(uid, { status: 'fetching', message: '正在保存数据...', progress: 97, total: 100 });

  const allPosts = [...newPosts, ...existingPosts];
  writeJSON(postsFile, allPosts);

  // 更新订阅 lastFetch & postCount
  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  const sub = subs.find(s => s.uid === uid);
  if (sub) {
    sub.lastFetch = new Date().toISOString();
    sub.postCount = allPosts.length;
    writeJSON(SUBSCRIPTIONS_FILE, subs);
  }

  const summary = isIncremental
    ? `✅ 增量完成，新增 ${newPosts.length} 条`
    : `✅ 全量完成，共 ${allPosts.length} 条（新增 ${newPosts.length}）`;

  updateProgress(uid, {
    status: 'success',
    message: summary,
    progress: 100,
    total: 100,
    lastFetch: new Date().toISOString(),
  });

  fLog.info(summary, { uid, newPosts: newPosts.length, total: allPosts.length });
  return { success: true, newCount: newPosts.length, total: allPosts.length };
}

// ─── 定时调度 ──────────────────────────────────────────────────────────────────

const schedLogger = createLogger('Scheduler');

function startScheduler(uid, intervalMinutes) {
  stopScheduler(uid);
  const ms = Math.max(intervalMinutes, 5) * 60 * 1000;
  const timer = setInterval(async () => {
    schedLogger.info(`触发定时增量抓取`, { uid, intervalMinutes });
    fetchUserPosts(uid, true).catch(err =>
      schedLogger.error(`定时抓取失败`, { uid, err: err.message })
    );
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
    }
  });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  if (checkLoginFromCookies(loadCookies())) {
    return res.json({ success: true, message: '已登录，无需重新登录', alreadyLoggedIn: true });
  }

  loginLogger.info('收到登录请求，打开浏览器...');
  res.json({ success: true, message: '已打开微博登录窗口，请在弹出的浏览器中完成登录', pending: true });

  openLoginWindow()
    .then(result => {
      isLoggedIn = result.success;
      loginLogger.info('登录流程完成', { success: result.success, message: result.message });

      // 通过 SSE 推送登录结果
      const payload = `data: ${JSON.stringify({ type: 'loginResult', ...result })}\n\n`;
      for (const client of sseClients) {
        try { client.write(payload); } catch (_) {}
      }
    })
    .catch(err => loginLogger.error(`登录异常: ${err.message}`));
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
    return name ? { name, value, domain: '.weibo.com', path: '/', sameSite: 'Lax' } : null;
  }).filter(Boolean);

  saveCookies(cookies);

  const hasSUB = cookies.some(c => c.name === 'SUB' || c.name === 'SUBP');
  if (!hasSUB) {
    return res.json({ success: true, message: `已保存 ${cookies.length} 条 Cookie，但未找到 SUB/SUBP 字段，可能无法正常使用`, loggedIn: false });
  }

  // 在线验证
  const verify = await verifyCookieOnline(cookiesToString(cookies));
  isLoggedIn = verify.valid !== false;
  res.json({
    success: true,
    message: verify.valid === true
      ? `Cookie 验证成功！欢迎 ${verify.name || verify.uid}`
      : `已保存 ${cookies.length} 条 Cookie（${verify.error || '验证跳过'}）`,
    loggedIn: isLoggedIn,
    verifyResult: verify,
  });
});

// GET /api/subscriptions
app.get('/api/subscriptions', (req, res) => {
  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  const result = subs.map(sub => ({
    ...sub,
    fetchStatus: fetchStatus.get(sub.uid) || { status: 'idle', message: '', lastFetch: sub.lastFetch || null },
  }));
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
      const profile = await fetchUserProfile(uid, cookiesToString(cookies));
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

  res.json({ success: true, data: newSub, message: `已添加订阅 ${newSub.name}（${uid}），首次全量抓取将立即开始` });

  // 异步触发首次全量抓取
  setTimeout(() => {
    fetchUserPosts(uid, false).catch(err =>
      logger.error(`首次全量抓取失败`, { uid, err: err.message })
    );
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

  const posts = readJSON(path.join(USERS_DIR, uid, 'posts.json'), []);
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

// POST /api/fetch/:uid
app.post('/api/fetch/:uid', (req, res) => {
  const { uid } = req.params;
  const incremental = req.body.incremental === true || req.body.incremental === 'true';

  const subs = readJSON(SUBSCRIPTIONS_FILE, []);
  if (!subs.find(s => s.uid === uid)) {
    return res.status(404).json({ success: false, error: '订阅不存在' });
  }

  const current = fetchStatus.get(uid);
  if (current?.status === 'fetching') {
    return res.status(409).json({ success: false, error: '正在抓取中，请稍后', currentMessage: current.message });
  }

  const mode = incremental ? '增量' : '全量';
  logger.info(`手动触发${mode}抓取`, { uid });
  res.json({ success: true, message: `已触发${mode}抓取，进度请关注左侧状态` });

  // 立即更新状态（避免前端看到旧的 idle 状态）
  updateProgress(uid, { status: 'fetching', message: `${mode}抓取启动中...`, progress: 0, total: 100 });

  fetchUserPosts(uid, incremental).catch(err => {
    logger.error(`${mode}抓取异常`, { uid, err: err.message });
    updateProgress(uid, { status: 'error', message: `❌ 抓取异常: ${err.message}` });
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
  res.json({
    success: true,
    version: '0.0.2',
    uptime: Math.floor(process.uptime()),
    loggedIn: getLoginStatus(),
    subscriptions: readJSON(SUBSCRIPTIONS_FILE, []).length,
    sseClients: sseClients.size,
    logFile: getLogFilePath(),
  });
});

// ─── 启动 ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`╔══════════════════════════════════════════╗`);
  logger.info(`║   微博归档器 v0.0.2  已启动              ║`);
  logger.info(`║   http://localhost:${PORT}                  ║`);
  logger.info(`╚══════════════════════════════════════════╝`);

  const cookies = loadCookies();
  if (checkLoginFromCookies(cookies)) {
    isLoggedIn = true;
    logger.info(`✅ 已检测到登录态`, { cookieCount: cookies.length });
  } else {
    logger.warn(`⚠️  未登录，请访问 http://localhost:${PORT} 并点击"登录微博"按钮`);
  }

  restoreSchedulers();
});

module.exports = app;
