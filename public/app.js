/* ============================================================
   微博归档器 v0.0.2 - 前端应用
   新增：SSE 实时进度 / 登录验证反馈 / 进度条 / 日志面板
   ============================================================ */

const { useState, useEffect, useCallback, useRef, useMemo } = React;
const dayjs = window.dayjs;

// ─── API 层 ───────────────────────────────────────────────────────────────────

const API = {
  authStatus:   (verify = false) => fetch(`/api/auth/status${verify ? '?verify=true' : ''}`).then(r => r.json()),
  authVerify:   () => fetch('/api/auth/verify', { method: 'POST' }).then(r => r.json()),
  login:        () => fetch('/api/auth/login', { method: 'POST' }).then(r => r.json()),
  logout:       () => fetch('/api/auth/logout', { method: 'POST' }).then(r => r.json()),
  setCookie:    (cookie) => fetch('/api/auth/set-cookie', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie }),
  }).then(r => r.json()),
  subscriptions:() => fetch('/api/subscriptions').then(r => r.json()),
  addSub:       (input, intervalMinutes) => fetch('/api/subscriptions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, intervalMinutes }),
  }).then(r => r.json()),
  deleteSub:    (uid) => fetch(`/api/subscriptions/${uid}`, { method: 'DELETE' }).then(r => r.json()),
  posts:        (uid, page = 1) => fetch(`/api/posts/${uid}?page=${page}&pageSize=20`).then(r => r.json()),
  fetch:        (uid, incremental = false) => fetch(`/api/fetch/${uid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incremental }),
  }).then(r => r.json()),
  logs:         (limit = 100, level = '') => fetch(`/api/logs?limit=${limit}${level ? '&level='+level : ''}`).then(r => r.json()),
  health:       () => fetch('/api/health').then(r => r.json()),
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function formatTime(str) {
  if (!str) return '';
  try {
    const d = dayjs(str);
    if (!d.isValid()) return str;
    const diff = dayjs().diff(d, 'minute');
    if (diff < 1) return '刚刚';
    if (diff < 60) return `${diff}分钟前`;
    if (diff < 1440) return `${Math.floor(diff / 60)}小时前`;
    if (diff < 43200) return `${Math.floor(diff / 1440)}天前`;
    return d.format('YYYY年MM月DD日 HH:mm');
  } catch (_) { return str; }
}

function formatNum(n) {
  if (!n) return '0';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

// ─── SSE Hook ─────────────────────────────────────────────────────────────────

function useSSE(onMessage) {
  const esRef = useRef(null);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    const connect = () => {
      try {
        const es = new EventSource('/api/events');
        esRef.current = es;

        es.onmessage = (e) => {
          if (!e.data || e.data.startsWith(':')) return;
          try {
            const data = JSON.parse(e.data);
            cbRef.current(data);
          } catch (_) {}
        };

        es.onerror = () => {
          es.close();
          esRef.current = null;
          // 断线重连
          setTimeout(connect, 3000);
        };
      } catch (_) {
        setTimeout(connect, 5000);
      }
    };

    connect();
    return () => { if (esRef.current) esRef.current.close(); };
  }, []);
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((msg, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), duration);
  }, []);
  return { toasts, show };
}

function ToastContainer({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}

// ─── 进度条 ───────────────────────────────────────────────────────────────────

function ProgressBar({ progress = 0, status = 'idle', message = '' }) {
  if (status === 'idle' || status === 'success') return null;
  const isError = status === 'error';
  const color = isError ? '#f44336' : '#ff6b35';
  const pct = Math.max(0, Math.min(100, progress || 0));

  return (
    <div className="progress-wrap">
      <div className="progress-bar" style={{
        background: '#eee',
        borderRadius: '4px',
        overflow: 'hidden',
        height: '4px',
        margin: '4px 0',
      }}>
        <div style={{
          width: `${isError ? 100 : pct}%`,
          height: '100%',
          background: color,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <div className="progress-msg" style={{ fontSize: '12px', color: isError ? '#f44336' : '#666', marginTop: '2px' }}>
        {message} {!isError && pct > 0 && pct < 100 && `(${pct}%)`}
      </div>
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ images, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx(i => Math.min(images.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [images, onClose]);

  if (!images?.length) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>✕</button>
      <div className="lightbox-counter">{idx + 1} / {images.length}</div>
      <div className="lightbox-content" onClick={e => e.stopPropagation()}>
        <img
          src={images[idx]}
          alt={`图片 ${idx + 1}`}
          className="lightbox-img"
          onError={e => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect fill="%23222" width="200" height="150"/><text fill="%23999" x="100" y="80" text-anchor="middle" font-size="14">加载失败</text></svg>'; }}
        />
      </div>
      {images.length > 1 && (
        <>
          <button className="lightbox-nav lightbox-prev" onClick={e => { e.stopPropagation(); setIdx(i => Math.max(0, i - 1)); }} disabled={idx === 0}>‹</button>
          <button className="lightbox-nav lightbox-next" onClick={e => { e.stopPropagation(); setIdx(i => Math.min(images.length - 1, i + 1)); }} disabled={idx === images.length - 1}>›</button>
        </>
      )}
    </div>
  );
}

// ─── 图片宫格 ─────────────────────────────────────────────────────────────────

function PicGrid({ post, uid }) {
  const [lightbox, setLightbox] = useState(null);

  const pics = useMemo(() => (post.pics || []).map((pic, i) => ({
    src: (post.localPics?.[i]) ? `/api/images/${uid}/${post.localPics[i]}` : pic,
  })), [post, uid]);

  if (pics.length === 0) return null;

  const gridClass = ['', 'pic-grid-1', 'pic-grid-2', 'pic-grid-3'][Math.min(pics.length, 3)] || 'pic-grid-n';

  return (
    <div className={`pic-grid ${gridClass}`}>
      {pics.slice(0, 9).map((pic, i) => (
        <div key={i} className="pic-item" onClick={() => setLightbox(i)}>
          <img src={pic.src} alt={`图片${i + 1}`} loading="lazy"
            onError={e => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect fill="%23f5f5f5" width="200" height="150"/><text fill="%23ccc" x="100" y="80" text-anchor="middle" font-size="13">图片加载失败</text></svg>'; }} />
          {i === 8 && pics.length > 9 && <div className="pic-more">+{pics.length - 9}</div>}
        </div>
      ))}
      {lightbox !== null && (
        <Lightbox images={pics.map(p => p.src)} startIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

// ─── 微博卡片 ─────────────────────────────────────────────────────────────────

function PostCard({ post, profile, uid }) {
  const [expanded, setExpanded] = useState(false);
  const text = post.text || '';
  const isLong = text.length > 220;

  return (
    <div className="post-card">
      <div className="post-header">
        <div className="post-avatar">
          {profile.avatar
            ? <img src={profile.avatar} alt={profile.name} onError={e => { e.target.style.display = 'none'; }} />
            : <span className="avatar-placeholder">{(profile.name || '?').charAt(0)}</span>}
        </div>
        <div className="post-meta">
          <div className="post-author">{profile.name || `用户 ${uid}`}</div>
          <div className="post-time">
            <span>{formatTime(post.createdAt)}</span>
            {post.source && <span className="post-source"> · {post.source}</span>}
            {post.isRetweet && <span className="post-badge">转发</span>}
          </div>
        </div>
        <a href={`https://weibo.com/u/${uid}`} target="_blank" rel="noopener noreferrer" className="post-link-btn" title="查看微博主页">↗</a>
      </div>

      <div className="post-content">
        <p className={`post-text ${!expanded && isLong ? 'text-clamped' : ''}`}>
          {text || <span className="text-empty">（无文字内容）</span>}
        </p>
        {post.retweetedData && (
          <div className="retweet-box">
            <span className="retweet-user">@{post.retweetedData.user}：</span>
            {post.retweetedData.text}
          </div>
        )}
        {isLong && (
          <button className="expand-btn" onClick={() => setExpanded(e => !e)}>
            {expanded ? '收起 ▲' : '展开全文 ▼'}
          </button>
        )}
      </div>

      <PicGrid post={post} uid={uid} />

      <div className="post-footer">
        <span className="post-stat">🔁 {formatNum(post.reposts)}</span>
        <span className="post-stat">💬 {formatNum(post.comments)}</span>
        <span className="post-stat">❤️ {formatNum(post.likes)}</span>
        <span className="post-mid">#{post.mid}</span>
      </div>
    </div>
  );
}

// ─── 侧边栏条目 ───────────────────────────────────────────────────────────────

function SidebarItem({ sub, isActive, onClick, onDelete, onFetch, toast }) {
  const [deleting, setDeleting] = useState(false);
  const status = sub.fetchStatus || {};
  const isFetching = status.status === 'fetching';
  const progress = status.progress || 0;
  const isError = status.status === 'error';

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm(`确认删除订阅「${sub.name || sub.uid}」？\n本地数据不会被删除。`)) return;
    setDeleting(true);
    const res = await API.deleteSub(sub.uid);
    if (res.success) { toast('已删除', 'success'); onDelete(sub.uid); }
    else { toast(res.error || '删除失败', 'error'); setDeleting(false); }
  };

  const handleFetch = async (e) => {
    e.stopPropagation();
    const res = await API.fetch(sub.uid, true);
    if (res.success) { toast('增量抓取已启动', 'success'); onFetch(); }
    else toast(res.error || '触发失败', 'error');
  };

  return (
    <div className={`sidebar-item ${isActive ? 'active' : ''} ${isError ? 'has-error' : ''}`} onClick={onClick}>
      <div className="sidebar-avatar">
        {sub.avatar && <img src={sub.avatar} alt={sub.name} onError={e => { e.target.style.display = 'none'; }} />}
        <span className="avatar-placeholder" style={sub.avatar ? {display:'none'} : {}}>
          {(sub.name || sub.uid || '?').charAt(0)}
        </span>
      </div>
      <div className="sidebar-info">
        <div className="sidebar-name">{sub.name || `UID: ${sub.uid}`}</div>
        <div className="sidebar-uid">
          {sub.postCount || 0} 条
          {isFetching && <span className="status-dot fetching" title="抓取中"></span>}
          {isError && <span className="status-dot error" title={status.message}></span>}
          {status.status === 'success' && <span className="status-dot success"></span>}
        </div>
        {isFetching && (
          <ProgressBar progress={progress} status="fetching" message={status.message} />
        )}
        {isError && <div className="sidebar-error-msg">{status.message}</div>}
      </div>
      <div className="sidebar-actions">
        <button className="icon-btn" title="增量抓取" onClick={handleFetch} disabled={isFetching || deleting}>
          {isFetching ? <span className="spin">⟳</span> : '↻'}
        </button>
        <button className="icon-btn danger" title="删除订阅" onClick={handleDelete} disabled={deleting || isFetching}>✕</button>
      </div>
    </div>
  );
}

// ─── 添加订阅弹窗 ─────────────────────────────────────────────────────────────

function AddSubscriptionModal({ onClose, onAdded, toast }) {
  const [input, setInput] = useState('');
  const [interval, setIntervalVal] = useState(60);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!input.trim()) { toast('请输入 UID 或微博主页 URL', 'error'); return; }
    setLoading(true);
    try {
      const res = await API.addSub(input.trim(), interval);
      if (res.success) {
        toast(res.message || '添加成功！首次全量抓取已开始', 'success');
        onAdded();
        onClose();
      } else {
        toast(res.error || '添加失败', 'error');
      }
    } catch (_) { toast('网络错误', 'error'); }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>添加订阅</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label className="form-label">微博用户 UID 或主页 URL</label>
          <input className="form-input" type="text"
            placeholder="例：1669879400 或 https://weibo.com/u/1669879400"
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} autoFocus />
          <label className="form-label" style={{marginTop:'16px'}}>抓取间隔</label>
          <select className="form-select" value={interval} onChange={e => setIntervalVal(Number(e.target.value))}>
            <option value={5}>5 分钟（测试用）</option>
            <option value={15}>15 分钟</option>
            <option value={30}>30 分钟</option>
            <option value={60}>1 小时</option>
            <option value={360}>6 小时</option>
            <option value={720}>12 小时</option>
            <option value={1440}>每天</option>
          </select>
          <p className="form-hint">首次添加将执行全量保存，之后按设定间隔自动增量更新。</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? '添加中...' : '开始订阅'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 登录弹窗 ─────────────────────────────────────────────────────────────────

function LoginModal({ onClose, onLoginSuccess, toast }) {
  const [mode, setMode] = useState('auto');
  const [cookieStr, setCookieStr] = useState('');
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const pollRef = useRef(null);

  const handleAutoLogin = async () => {
    setLoading(true);
    setVerifyResult(null);
    try {
      const res = await API.login();
      if (res.alreadyLoggedIn) {
        toast('已登录', 'success');
        onLoginSuccess();
        onClose();
        return;
      }
      if (res.success) {
        toast('已打开登录窗口，请在弹出的浏览器中完成登录...', 'info', 10000);
        setPolling(true);
        setLoading(false);
        pollRef.current = setInterval(async () => {
          try {
            const status = await API.authStatus();
            if (status.data?.loggedIn) {
              clearInterval(pollRef.current);
              setPolling(false);
              // 做一次在线验证确认
              try {
                const v = await API.authVerify();
                setVerifyResult(v.data);
                if (v.data?.valid === true) {
                  toast(`登录成功！欢迎 ${v.data.name || v.data.uid}`, 'success');
                } else {
                  toast('Cookie 已保存', 'success');
                }
              } catch (_) {
                toast('登录成功！Cookie 已保存', 'success');
              }
              onLoginSuccess();
              setTimeout(onClose, 1500);
            }
          } catch (_) {}
        }, 2000);
        setTimeout(() => {
          if (pollRef.current) { clearInterval(pollRef.current); setPolling(false); }
        }, 6 * 60 * 1000);
      }
    } catch (_) {
      toast('启动登录窗口失败，请使用手动方式', 'error');
      setLoading(false);
    }
  };

  const handleManualCookie = async () => {
    if (!cookieStr.trim()) { toast('请粘贴 Cookie', 'error'); return; }
    setLoading(true);
    setVerifyResult(null);
    try {
      const res = await API.setCookie(cookieStr.trim());
      setVerifyResult(res.verifyResult);
      if (res.loggedIn) {
        const name = res.verifyResult?.name || res.verifyResult?.uid || '';
        toast(name ? `Cookie 验证成功！欢迎 ${name}` : 'Cookie 设置成功，登录态已验证', 'success');
        onLoginSuccess();
        onClose();
      } else {
        toast(res.message || 'Cookie 已保存，但未验证到登录态', 'warn');
      }
    } catch (_) { toast('网络错误', 'error'); }
    setLoading(false);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-login" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>登录微博</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="login-tabs">
          <button className={`login-tab ${mode === 'auto' ? 'active' : ''}`} onClick={() => setMode('auto')}>自动登录（推荐）</button>
          <button className={`login-tab ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>手动粘贴 Cookie</button>
        </div>

        <div className="modal-body">
          {mode === 'auto' ? (
            <div className="login-auto">
              <div className="login-icon">🌐</div>
              <p>点击下方按钮，自动打开微博登录页面。</p>
              <p>完成登录后，Cookie 自动保存并验证，<strong>重启服务无需再次登录</strong>。</p>
              {polling ? (
                <div className="login-polling">
                  <div className="spinner"></div>
                  <span>等待浏览器登录完成，请在弹出的浏览器中完成登录...</span>
                </div>
              ) : (
                <button className="btn btn-primary btn-block" onClick={handleAutoLogin} disabled={loading}>
                  {loading ? '正在打开...' : '打开微博登录窗口'}
                </button>
              )}
              {verifyResult && (
                <div className={`verify-result ${verifyResult.valid ? 'success' : 'fail'}`}>
                  {verifyResult.valid === true
                    ? `✅ 验证成功，当前账号：${verifyResult.name || verifyResult.uid}`
                    : `⚠️ ${verifyResult.error || '验证失败'}`}
                </div>
              )}
            </div>
          ) : (
            <div className="login-manual">
              <p className="form-hint">
                在 Chrome 中打开并登录 <a href="https://weibo.com" target="_blank" rel="noopener">weibo.com</a>，
                按 F12 → Application → Cookies → weibo.com，复制所有 Cookie 粘贴到下方。
                <br/><strong>重要：确保 Cookie 中包含 SUB 和 SUBP 字段。</strong>
              </p>
              <label className="form-label">Cookie 字符串</label>
              <textarea className="form-textarea" rows={5}
                placeholder="粘贴 Cookie，格式：SUB=xxx; SUBP=xxx; ..."
                value={cookieStr} onChange={e => setCookieStr(e.target.value)} />
              {verifyResult && (
                <div className={`verify-result ${verifyResult.valid ? 'success' : 'fail'}`}>
                  {verifyResult.valid === true
                    ? `✅ 验证成功，当前账号：${verifyResult.name || verifyResult.uid}`
                    : `⚠️ ${verifyResult.error || '验证跳过'}`}
                </div>
              )}
              <button className="btn btn-primary btn-block" onClick={handleManualCookie} disabled={loading} style={{marginTop:'12px'}}>
                {loading ? '验证中...' : '保存并验证 Cookie'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 日志面板 ─────────────────────────────────────────────────────────────────

function LogPanel({ onClose }) {
  const [logs, setLogs] = useState([]);
  const [level, setLevel] = useState('');
  const [loading, setLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(true);
  const bottomRef = useRef(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.logs(200, level);
      if (res.success) setLogs(res.data);
    } catch (_) {}
    setLoading(false);
  }, [level]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  // 实时日志：通过 SSE 接收
  useSSE((data) => {
    if (!liveMode) return;
    if (data.level) {
      setLogs(prev => {
        const next = [data, ...prev];
        return next.slice(0, 300); // 只保留最新 300 条
      });
    }
  });

  const levelColors = { error: '#f44336', warn: '#ff9800', info: '#4caf50', debug: '#2196f3', silly: '#9e9e9e' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-logs" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📋 系统日志</h3>
          <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
            <select className="form-select" value={level} onChange={e => { setLevel(e.target.value); }} style={{fontSize:'12px',padding:'2px 6px',height:'28px'}}>
              <option value="">全部级别</option>
              <option value="error">错误</option>
              <option value="warn">警告</option>
              <option value="info">信息</option>
              <option value="debug">调试</option>
            </select>
            <label style={{fontSize:'12px', cursor:'pointer'}}>
              <input type="checkbox" checked={liveMode} onChange={e => setLiveMode(e.target.checked)} /> 实时
            </label>
            <button className="btn btn-ghost btn-sm" onClick={loadLogs} disabled={loading}>刷新</button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="log-list">
          {loading && <div style={{textAlign:'center',padding:'20px',color:'#999'}}>加载中...</div>}
          {!loading && logs.length === 0 && <div style={{textAlign:'center',padding:'20px',color:'#999'}}>暂无日志</div>}
          {logs.map((entry, i) => (
            <div key={i} className="log-entry" style={{borderLeftColor: levelColors[entry.level] || '#999'}}>
              <span className="log-time">{entry.ts ? entry.ts.slice(11, 23) : ''}</span>
              <span className="log-level" style={{color: levelColors[entry.level] || '#999'}}>{(entry.level||'').toUpperCase()}</span>
              <span className="log-module">[{entry.module}]</span>
              <span className="log-msg">{entry.message}</span>
              {entry.meta && Object.keys(entry.meta).length > 0 && (
                <span className="log-meta">{JSON.stringify(entry.meta)}</span>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

// ─── 空状态 ───────────────────────────────────────────────────────────────────

function EmptyState({ loggedIn, onAddClick, onLoginClick }) {
  if (!loggedIn) return (
    <div className="empty-state">
      <div className="empty-icon">🔐</div>
      <h3>请先登录微博</h3>
      <p>登录后才能订阅和抓取微博内容</p>
      <button className="btn btn-primary" onClick={onLoginClick}>登录微博</button>
    </div>
  );
  return (
    <div className="empty-state">
      <div className="empty-icon">📭</div>
      <h3>暂无订阅</h3>
      <p>添加微博用户订阅，开始归档内容</p>
      <button className="btn btn-primary" onClick={onAddClick}>+ 添加订阅</button>
    </div>
  );
}

// ─── 主应用 ───────────────────────────────────────────────────────────────────

function App() {
  const { toasts, show: toast } = useToast();
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [fetchStatuses, setFetchStatuses] = useState({}); // uid -> status obj (来自 SSE)
  const [activeUid, setActiveUid] = useState(null);
  const [posts, setPosts] = useState([]);
  const [profile, setProfile] = useState({});
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // SSE：接收进度推送和登录结果
  useSSE((data) => {
    if (data.type === 'progress') {
      const { uid, type: _, ...status } = data;
      setFetchStatuses(prev => ({ ...prev, [uid]: status }));

      // 抓取成功后自动刷新帖子
      if (status.status === 'success' && uid === activeUidRef.current) {
        setTimeout(() => loadPosts(uid, 1), 500);
      }
      // 刷新订阅列表（更新 postCount）
      if (status.status === 'success') {
        refreshSubscriptions(true);
      }
    }
    if (data.type === 'loginResult') {
      if (data.success) {
        setLoggedIn(true);
        const name = data.userInfo?.name || data.userInfo?.uid || '';
        toast(name ? `✅ 登录成功！欢迎 ${name}` : '✅ 登录成功！Cookie 已持久化', 'success', 5000);
      }
    }
  });

  // 用于在 SSE 回调中读取最新值（避免闭包问题）
  const activeUidRef = useRef(activeUid);
  useEffect(() => { activeUidRef.current = activeUid; }, [activeUid]);

  // 初始化
  useEffect(() => {
    refreshAuth();
    refreshSubscriptions();
    // 定期刷新订阅（备用，SSE 已主动推送）
    const t = setInterval(() => refreshSubscriptions(true), 10000);
    return () => clearInterval(t);
  }, []);

  // 切换用户加载帖子
  useEffect(() => {
    if (activeUid) loadPosts(activeUid, 1);
  }, [activeUid]);

  const refreshAuth = async () => {
    try {
      const res = await API.authStatus();
      if (res.success) setLoggedIn(res.data.loggedIn);
    } catch (_) {}
  };

  const refreshSubscriptions = async (silent = false) => {
    try {
      const res = await API.subscriptions();
      if (res.success) {
        setSubscriptions(res.data);
        if (!activeUidRef.current && res.data.length > 0) {
          setActiveUid(res.data[0].uid);
        }
        // 同步 fetchStatus（用于首次加载）
        setFetchStatuses(prev => {
          const next = { ...prev };
          for (const sub of res.data) {
            if (!next[sub.uid] && sub.fetchStatus) {
              next[sub.uid] = sub.fetchStatus;
            }
          }
          return next;
        });
      }
    } catch (_) {}
  };

  const loadPosts = async (uid, page = 1) => {
    setLoadingPosts(true);
    try {
      const res = await API.posts(uid, page);
      if (res.success) {
        setPosts(page === 1 ? res.data.posts : prev => [...prev, ...res.data.posts]);
        setProfile(res.data.profile || {});
        setPagination(res.data.pagination || { page: 1, totalPages: 1, total: 0 });
      }
    } catch (_) { toast('加载帖子失败', 'error'); }
    setLoadingPosts(false);
  };

  const handleDeleteSub = (uid) => {
    setSubscriptions(prev => prev.filter(s => s.uid !== uid));
    if (activeUid === uid) {
      const rem = subscriptions.filter(s => s.uid !== uid);
      setActiveUid(rem.length > 0 ? rem[0].uid : null);
      setPosts([]);
    }
  };

  // 合并订阅列表和实时状态
  const subsWithStatus = useMemo(() => subscriptions.map(sub => ({
    ...sub,
    fetchStatus: fetchStatuses[sub.uid] || sub.fetchStatus || { status: 'idle', message: '' },
  })), [subscriptions, fetchStatuses]);

  const activeSub = subsWithStatus.find(s => s.uid === activeUid);
  const activeStatus = activeSub?.fetchStatus || {};
  const isFetching = activeStatus.status === 'fetching';

  const handleFullFetch = async () => {
    const res = await API.fetch(activeUid, false);
    if (res.success) toast('全量抓取已开始，请等待进度更新', 'success');
    else toast(res.error || '触发失败', 'error');
  };

  const handleIncrFetch = async () => {
    const res = await API.fetch(activeUid, true);
    if (res.success) toast('增量抓取已开始', 'success');
    else toast(res.error || '触发失败', 'error');
  };

  return (
    <div className="app">
      {/* 顶部导航 */}
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">微</span>
          <span className="app-title">微博归档器 <span className="version-badge">v0.0.2</span></span>
        </div>
        <div className="header-right">
          {loggedIn ? (
            <>
              <span className="login-status"><span className="status-dot success"></span>已登录</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('确认退出登录？')) { API.logout().then(() => { setLoggedIn(false); toast('已退出', 'info'); }); } }}>退出</button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setShowLoginModal(true)}>🔐 登录微博</button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>+ 添加订阅</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowLogs(true)} title="查看日志">📋</button>
        </div>
      </header>

      <div className="app-body">
        {/* 侧边栏 */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <span>订阅列表</span>
            <span className="count-badge">{subscriptions.length}</span>
          </div>
          {subsWithStatus.length === 0
            ? <div className="sidebar-empty">暂无订阅</div>
            : subsWithStatus.map(sub => (
                <SidebarItem key={sub.uid} sub={sub} isActive={sub.uid === activeUid}
                  onClick={() => { if (sub.uid !== activeUid) { setActiveUid(sub.uid); setPosts([]); } }}
                  onDelete={handleDeleteSub} onFetch={refreshSubscriptions} toast={toast} />
              ))
          }
        </aside>

        {/* 主内容区 */}
        <main className="main-content">
          {!activeUid ? (
            <EmptyState loggedIn={loggedIn} onAddClick={() => setShowAddModal(true)} onLoginClick={() => setShowLoginModal(true)} />
          ) : (
            <>
              <div className="content-header">
                <div className="content-profile">
                  {profile.avatar && <img src={profile.avatar} alt={profile.name} className="content-avatar" onError={e => e.target.style.display = 'none'} />}
                  <div>
                    <div className="content-name">{profile.name || `用户 ${activeUid}`}</div>
                    {profile.description && <div className="content-stats">{profile.description.slice(0, 60)}</div>}
                  </div>
                </div>
                <div className="content-actions">
                  {isFetching && (
                    <div className="fetch-indicator-wrap">
                      <div className="spinner spinner-sm"></div>
                      <span>{activeStatus.message}</span>
                      {activeStatus.progress > 0 && activeStatus.progress < 100 && (
                        <span style={{color:'#ff6b35'}}> {activeStatus.progress}%</span>
                      )}
                    </div>
                  )}
                  {activeStatus.status === 'error' && (
                    <div className="fetch-error-inline">{activeStatus.message}</div>
                  )}
                  <a href={`https://weibo.com/u/${activeUid}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">查看微博主页 ↗</a>
                  <button className="btn btn-ghost btn-sm" onClick={handleIncrFetch} disabled={isFetching}>增量抓取</button>
                  <button className="btn btn-primary btn-sm" onClick={handleFullFetch} disabled={isFetching}>全量抓取</button>
                </div>
              </div>

              {/* 全局进度条（当有抓取任务时显示） */}
              {isFetching && (
                <div style={{padding:'0 20px 8px'}}>
                  <ProgressBar progress={activeStatus.progress} status={activeStatus.status} message={activeStatus.message} />
                </div>
              )}

              <div className="posts-info">
                共 <strong>{pagination.total}</strong> 条归档内容
                {activeSub?.lastFetch && <span className="last-fetch"> · 最近更新：{formatTime(activeSub.lastFetch)}</span>}
              </div>

              {loadingPosts && posts.length === 0 ? (
                <div className="loading-state"><div className="spinner"></div><span>加载中...</span></div>
              ) : posts.length === 0 ? (
                <div className="empty-posts">
                  {isFetching ? (
                    <>
                      <div className="spinner"></div>
                      <p>{activeStatus.message}</p>
                      <ProgressBar progress={activeStatus.progress} status={activeStatus.status} message="" />
                    </>
                  ) : (
                    <>
                      <p>暂无归档内容</p>
                      <button className="btn btn-primary" onClick={handleFullFetch}>立即全量抓取</button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="posts-list">
                    {posts.map(post => <PostCard key={post.mid} post={post} profile={profile} uid={activeUid} />)}
                  </div>
                  {pagination.page < pagination.totalPages && (
                    <div className="load-more">
                      <button className="btn btn-ghost" onClick={() => loadPosts(activeUid, pagination.page + 1)} disabled={loadingPosts}>
                        {loadingPosts ? '加载中...' : `加载更多（${posts.length}/${pagination.total}）`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>

      {showAddModal && <AddSubscriptionModal onClose={() => setShowAddModal(false)} onAdded={refreshSubscriptions} toast={toast} />}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} onLoginSuccess={() => { setLoggedIn(true); refreshAuth(); }} toast={toast} />}
      {showLogs && <LogPanel onClose={() => setShowLogs(false)} />}
      <ToastContainer toasts={toasts} />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
