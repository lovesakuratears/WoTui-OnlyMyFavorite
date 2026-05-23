#!/usr/bin/env node
/**
 * WoTui Cookie 导出工具（独立 CLI）
 *
 * 在物理机上脱离 Docker 运行。流程：
 *   1) 工具自动启动一个 Chromium 窗口，打开 m.weibo.cn
 *   2) 用户在弹出的浏览器中完成登录
 *   3) 回到终端按回车，工具自动捕获 Cookie 并推送到 WoTui Docker URL
 *   4) WoTui 在线校验后落盘
 *
 * 使用方式：
 *   node tools/wotui-cookie-export.js [docker-url]
 *   node tools/wotui-cookie-export.js http://192.168.1.100:3000
 *   WOTUI_URL=http://x.x.x.x:3000 node tools/wotui-cookie-export.js
 *
 * 不依赖项目其它代码，只依赖 node_modules/playwright。
 */
'use strict';

const path = require('path');
const readline = require('readline');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const VERSION = '0.4.0';
const DEFAULT_URL = 'http://localhost:3000';

// ── 终端着色 ─────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};
const ok = s => `${c.green}${s}${c.reset}`;
const err = s => `${c.red}${s}${c.reset}`;
const warn = s => `${c.yellow}${s}${c.reset}`;
const info = s => `${c.cyan}${s}${c.reset}`;
const dim = s => `${c.dim}${s}${c.reset}`;

// ── 工具函数 ─────────────────────────────────────────────────────────────────
function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve((ans || '').trim()); });
  });
}

function normalizeUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

function describeError(e) {
  const parts = [];
  if (e && e.code) parts.push(e.code);
  if (e && e.message) parts.push(e.message);
  if (!parts.length) parts.push(String(e));
  return parts.join(' ');
}

function httpRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(new Error(`URL 无效: ${targetUrl}`)); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = lib.request({
      method: options.method || 'GET',
      host: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      headers: {
        'User-Agent': `wotui-cookie-export/${VERSION}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: options.timeout || 15000,
    }, res => {
      const chunks = [];
      res.on('data', ch => chunks.push(ch));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = text;
        try { data = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, data, text });
      });
    });
    req.on('timeout', () => {
      const e = new Error('request timeout');
      e.code = 'ETIMEDOUT';
      req.destroy(e);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function isChromiumInstalled() {
  try {
    const { chromium } = require('playwright');
    const exe = chromium.executablePath();
    return Boolean(exe) && require('fs').existsSync(exe);
  } catch (_) {
    return false;
  }
}

function installChromium() {
  console.log(info('→ 正在安装 Playwright Chromium 浏览器（首次运行需要，约 150MB）…'));
  // 优先用本地 node_modules/.bin/playwright，否则 npx
  const root = path.resolve(__dirname, '..');
  const localBin = path.join(root, 'node_modules', '.bin', 'playwright');
  const fs = require('fs');
  let cmd, args;
  if (fs.existsSync(localBin)) {
    cmd = localBin;
    args = ['install', 'chromium'];
  } else {
    cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    args = ['playwright', 'install', 'chromium'];
  }
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  return r.status === 0;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log(c.bold + '┌──────────────────────────────────────────────────────────┐' + c.reset);
  console.log(c.bold + `│  WoTui Cookie 导出工具 v${VERSION}                              │` + c.reset);
  console.log(c.bold + '│  本机登录 m.weibo.cn → 自动捕获 Cookie → 推送到 Docker   │' + c.reset);
  console.log(c.bold + '└──────────────────────────────────────────────────────────┘' + c.reset);
  console.log('');

  // 1. 解析 Docker URL
  let target = process.argv[2] || process.env.WOTUI_URL || '';
  if (!target) {
    const input = await ask(`Docker URL ${dim('[' + DEFAULT_URL + ']')}: `);
    target = input || DEFAULT_URL;
  }
  target = normalizeUrl(target);
  if (!target) {
    console.log(err('✗ URL 无效'));
    process.exit(1);
  }
  console.log(`  目标实例: ${info(target)}`);
  console.log('');

  // 2. 测试连接
  process.stdout.write(`→ 测试 ${target}/api/health … `);
  let healthData;
  try {
    const r = await httpRequest(target + '/api/health', { timeout: 5000 });
    if (r.status !== 200 || !r.data || !r.data.success) {
      throw new Error(`HTTP ${r.status} ${typeof r.data === 'string' ? r.data.slice(0, 60) : ''}`);
    }
    healthData = r.data;
    console.log(ok('✓'));
    console.log(`  ${dim('版本')} ${healthData.version}`);
    console.log(`  ${dim('无头模式')} ${healthData.headlessOnly ? warn('是（Docker / 无 GUI）') : '否'}`);
    console.log(`  ${dim('订阅数')} ${healthData.subscriptions}`);
    console.log(`  ${dim('当前登录态')} ${healthData.loggedIn ? ok('已登录') : warn('未登录')}`);
  } catch (e) {
    console.log(err('✗'));
    console.log(err(`  ${describeError(e)}`));
    console.log(dim('  请确认 Docker 容器已启动且端口已映射；可重试或检查 URL。'));
    process.exit(1);
  }
  console.log('');

  // 3. 检查 Playwright Chromium
  if (!isChromiumInstalled()) {
    console.log(warn('⚠ 未检测到 Playwright Chromium，需要先安装。'));
    const yn = await ask(`是否现在安装？${dim('[Y/n]')} `);
    if (yn && /^n/i.test(yn)) {
      console.log(err('已取消。请手动运行: npx playwright install chromium'));
      process.exit(1);
    }
    if (!installChromium()) {
      console.log(err('✗ 安装失败，请手动运行: npx playwright install chromium'));
      process.exit(1);
    }
    console.log(ok('✓ Chromium 已就绪'));
    console.log('');
  }

  // 4. 启动 Playwright
  console.log(info('→ 启动 Chromium 窗口，访问 m.weibo.cn …'));
  const { chromium } = require('playwright');
  let browser, context, page;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    // 用移动版 UA + 移动端 viewport，避免被微博识别为 PC
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    await page.goto('https://m.weibo.cn', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(err(`✗ 启动失败: ${e.message}`));
    if (browser) try { await browser.close(); } catch (_) {}
    process.exit(1);
  }

  console.log(ok('✓ 浏览器已打开 m.weibo.cn'));
  console.log('');
  console.log(c.bold + '请在浏览器中完成登录（账号密码 / 短信 / 扫码均可）。' + c.reset);
  console.log(dim('  登录成功的标志：页面右下角导航栏出现“我”，或左上角显示头像/昵称。'));
  console.log('');

  // 5. 等待用户确认
  await ask(c.bold + '完成登录后，回到这里按回车继续 …' + c.reset);

  // 6. 捕获 cookies
  console.log(info('→ 读取 Cookie …'));
  let allCookies;
  try {
    allCookies = await context.cookies();
  } catch (e) {
    console.log(err(`✗ 读取失败: ${e.message}`));
    try { await browser.close(); } catch (_) {}
    process.exit(1);
  }
  const weiboCookies = allCookies.filter(c => /weibo\.(cn|com)$/i.test(c.domain.replace(/^\./, '')) || /\.weibo\.(cn|com)$/i.test(c.domain));
  const names = new Set(weiboCookies.map(c => c.name));
  if (!names.has('SUB')) {
    console.log(err(`✗ 未检测到 SUB Cookie（共 ${weiboCookies.length} 个 weibo 域 Cookie），登录可能未完成`));
    console.log(dim('  请确认浏览器页面已显示登录后的内容（如“我”页可见昵称），再重新运行本工具。'));
    try { await browser.close(); } catch (_) {}
    process.exit(1);
  }
  console.log(ok(`✓ 已捕获 ${weiboCookies.length} 个 weibo 域 Cookie`));
  const keyNames = ['SUB', 'SUBP', '_T_WM', 'MLOGIN', 'SUHB', 'XSRF-TOKEN'];
  const present = keyNames.filter(n => names.has(n));
  const missing = keyNames.filter(n => !names.has(n));
  console.log(`  ${dim('关键字段')} ${present.length ? ok(present.join(', ')) : err('无')}`);
  if (missing.length) console.log(`  ${dim('缺失（非必需）')} ${warn(missing.join(', '))}`);
  console.log('');

  // 7. 拼成字符串推送
  const cookieStr = weiboCookies.map(c => `${c.name}=${c.value}`).join('; ');
  process.stdout.write(`→ 推送到 ${target}/api/auth/set-cookie 并在线校验 … `);
  try {
    const r = await httpRequest(target + '/api/auth/set-cookie', {
      method: 'POST',
      body: { cookie: cookieStr },
      timeout: 25000,
    });
    if (r.data && r.data.success) {
      console.log(ok('✓'));
      console.log(`  ${r.data.message || '已保存并通过校验'}`);
      if (r.data.verifyResult && r.data.verifyResult.name) {
        console.log(`  ${dim('登录身份')} ${ok(r.data.verifyResult.name)} (uid=${r.data.verifyResult.uid || '?'})`);
      }
    } else {
      console.log(err('✗'));
      console.log(err(`  ${(r.data && (r.data.error || r.data.message)) || `HTTP ${r.status}`}`));
    }
  } catch (e) {
    console.log(err('✗'));
    console.log(err(`  ${describeError(e)}`));
  }

  // 8. 收尾
  try { await browser.close(); } catch (_) {}
  console.log('');
  console.log(c.bold + '完成。' + c.reset + ` 回到 WoTui 网页 ${info(target)} 刷新即可看到登录态。`);
  console.log('');
}

main().catch(e => {
  console.error('');
  console.error(err(`✗ 异常: ${describeError(e)}`));
  console.error(dim(e.stack || ''));
  process.exit(1);
});
