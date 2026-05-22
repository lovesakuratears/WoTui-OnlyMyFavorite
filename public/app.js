/* ============================================================
   WoTui · OnlyMyFavorite v0.3.0 - 前端应用
   v0.3.0: 项目改名 / 现代暗色UI重设计 / 居中布局 / Docker支持 / Demo数据
   v0.2.0: 搜索功能 / 全量强制抓取 / 分页控件 / 图片下载 / 搜索高亮
   v0.1.0: 全量只允许首次 / 已有帖子缺图片补全 / Cookie失效后图片不丢失
   v0.0.9: 后台持续抓取 / 已有图片+帖子检测跳过 / 启动时恢复断点
   ============================================================ */

const { useState, useEffect, useCallback, useRef, useMemo } = React;
const dayjs = window.dayjs;

// ─── API 层 ───────────────────────────────────────────────────────────────────

const API = {
  authStatus:   (verify = false) => fetch(`/api/auth/status${verify ? '?verify=true' : ''}`).then(r => r.json()),
  authVerify:   () => fetch('/api/auth/verify', { method: 'POST' }).then(r => r.json()),
  login:        () => fetch('/api/auth/login', { method: 'POST' }).then(r => r.json()),
  confirmLogin: () => fetch('/api/auth/confirm-login', { method: 'POST' }).then(r => r.json()),
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
  posts:        (uid, page = 1, pageSize = 20) => fetch(`/api/posts/${uid}?page=${page}&pageSize=${pageSize}`).then(r => r.json()),
  fetch:        (uid, incremental = false) => fetch(`/api/fetch/${uid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incremental }),
  }).then(r => r.json()),
  fullFetch:    (uid) => fetch(`/api/fetch/${uid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incremental: false, force: true }),
  }).then(r => r.json()),
  abortFetch:   (uid) => fetch(`/api/fetch/${uid}/abort`, { method: 'POST' }).then(r => r.json()),
  fetchQueue:   () => fetch('/api/fetch/queue').then(r => r.json()),
  logs:         (limit = 100, level = '') => fetch(`/api/logs?limit=${limit}${level ? '&level='+level : ''}`).then(r => r.json()),
  health:       () => fetch('/api/health').then(r => r.json()),
  search:       async (params) => {
    const query = new URLSearchParams();
    if (params.keyword) query.set('keyword', params.keyword);
    if (params.scope) query.set('scope', params.scope);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.picFilter && params.picFilter !== 'all') query.set('picFilter', params.picFilter);
    query.set('page', params.page || 1);
    query.set('pageSize', params.pageSize || 20);
    const res = await fetch(`/api/search?${query.toString()}`);
    return res.json();
  },
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function formatTime(str) {
  if (!str) return '';
  try {
    const d = dayjs(str);
    if (!d.isValid()) return str;
    const now = dayjs();
    const diff = now.diff(d, 'minute');
    // 近1小时内
    if (diff < 1) return '刚刚';
    if (diff < 60) return `${diff}分钟前`;
    // 近24小时内
    if (diff < 1440) return `${Math.floor(diff / 60)}小时前`;
    // 近30天内
    if (diff < 43200) return `${Math.floor(diff / 1440)}天前`;
    // 超过30天：微博风格简洁日期
    if (d.year() === now.year()) return d.format('MM月DD日');
    return d.format('YYYY年MM月DD日');
  } catch (_) { return str; }
}

function formatNum(n) {
  if (!n) return '0';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

/**
 * 搜索高亮：将文本中匹配关键字的部分用 <mark> 标签包裹
 * @param {string} text - 原始文本
 * @param {string} keyword - 搜索关键字
 * @returns {Array} - React 元素数组
 */
function highlightText(text, keyword) {
  if (!keyword || !text) return [text || ''];
  try {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    if (parts.length <= 1) return [text];
    return parts.map((part, i) => {
      if (regex.test(part)) {
        regex.lastIndex = 0; // 重置正则 lastIndex
        return <mark key={i} className="search-highlight">{part}</mark>;
      }
      return part;
    });
  } catch (_) {
    return [text];
  }
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

// ─── Toast ────────────────────────────────────────────────────────────────────

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
  const isPaused = status === 'paused';
  const color = isError ? '#f44336' : isPaused ? '#ff9800' : '#ff6b35';
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

// ─── Lightbox ──────────────────────────────────────────────────────────────────

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
    filename: post.localPics?.[i] || null,
  })), [post, uid]);

  if (pics.length === 0) return null;

  const gridClass = ['', 'pic-grid-1', 'pic-grid-2', 'pic-grid-3'][Math.min(pics.length, 3)] || 'pic-grid-n';

  // v0.2.0：图片下载处理
  const handleDownload = (e, pic) => {
    e.stopPropagation();
    if (pic.filename) {
      // 使用本地图片 API 触发下载
      const link = document.createElement('a');
      link.href = `/api/images/${uid}/${pic.filename}?download=true`;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className={`pic-grid ${gridClass}`}>
      {pics.slice(0, 9).map((pic, i) => (
        <div key={i} className="pic-item" onClick={() => setLightbox(i)}>
          <img src={pic.src} alt={`图片${i + 1}`} loading="lazy"
            onError={e => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect fill="%23f5f5f5" width="200" height="150"/><text fill="%23ccc" x="100" y="80" text-anchor="middle" font-size="13">图片加载失败</text></svg>'; }} />
          {i === 8 && pics.length > 9 && <div className="pic-more">+{pics.length - 9}</div>}
          {pic.filename && (
            <button className="pic-download-btn" title="下载图片" onClick={(e) => handleDownload(e, pic)}>⬇</button>
          )}
        </div>
      ))}
      {lightbox !== null && (
        <Lightbox images={pics.map(p => p.src)} startIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

// ─── 微博卡片 ─────────────────────────────────────────────────────────────────

function PostCard({ post, profile, uid, highlightKeyword, searchMode }) {
  const [expanded, setExpanded] = useState(false);
  const text = post.text || '';
  const isLong = text.length > 220;

  // v0.2.0：搜索高亮文本
  const displayText = highlightKeyword
    ? highlightText(text, highlightKeyword)
    : text || <span className="text-empty">（无文字内容）</span>;

  return (
    <div className="post-card">
      {/* v0.2.0：搜索模式下显示来源用户信息 */}
      {searchMode && (post.userName || post.userAvatar) && (
        <div className="search-result-source">
          {post.userAvatar && <img src={post.userAvatar} alt={post.userName} className="search-source-avatar" onError={e => { e.target.style.display = 'none'; }} />}
          <span className="search-source-name">{post.userName || `用户 ${post.uid}`}</span>
        </div>
      )}
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
            {(!post.pics || post.pics.length === 0) && <span className="post-badge no-pic-badge">无图</span>}
          </div>
        </div>
        <a href={`https://weibo.com/u/${uid}`} target="_blank" rel="noopener noreferrer" className="post-link-btn" title="查看微博主页">↗</a>
      </div>

      <div className="post-content">
        <p className={`post-text ${!expanded && isLong ? 'text-clamped' : ''}`}>
          {displayText}
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

// ─── 确认弹窗 ─────────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmText, dangerous, onConfirm, onCancel }) {
  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="confirm-modal-title">{title || '确认操作'}</div>
        <div className="confirm-modal-message">{message}</div>
        <div className="confirm-modal-actions">
          <button className="confirm-modal-btn" onClick={onCancel}>取消</button>
          <button className={`confirm-modal-btn ${dangerous ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmText || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 分页控件 ─────────────────────────────────────────────────────────────────

function PaginationControl({ pagination, pageSizeOptions, onPageChange, onPageSizeChange, onJumpToPage }) {
  const [jumpInput, setJumpInput] = useState('');
  const { page, pageSize, total, totalPages } = pagination;

  if (!total || total === 0) return null;

  // 生成页码按钮列表
  const getPageButtons = () => {
    const buttons = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      // 全部显示
      for (let i = 1; i <= totalPages; i++) buttons.push(i);
    } else {
      buttons.push(1);
      let start = Math.max(2, page - 1);
      let end = Math.min(totalPages - 1, page + 1);

      if (page <= 3) {
        end = Math.min(4, totalPages - 1);
      } else if (page >= totalPages - 2) {
        start = Math.max(totalPages - 3, 2);
      }

      if (start > 2) buttons.push('...');
      for (let i = start; i <= end; i++) buttons.push(i);
      if (end < totalPages - 1) buttons.push('...');
      buttons.push(totalPages);
    }
    return buttons;
  };

  const handleJump = () => {
    const targetPage = parseInt(jumpInput);
    if (targetPage >= 1 && targetPage <= totalPages) {
      onJumpToPage(targetPage);
      setJumpInput('');
    }
  };

  return (
    <div className="pagination-control">
      <div className="page-size-section">
        <span className="page-size-label">每页</span>
        <select className="page-size-select" value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}>
          {(pageSizeOptions || [10, 20, 30, 40, 50]).map(size => (
            <option key={size} value={size}>{size} 条</option>
          ))}
        </select>
      </div>
      <div className="page-nav">
        <button className="page-btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹</button>
        {getPageButtons().map((btn, i) =>
          btn === '...'
            ? <span key={`ellipsis-${i}`} className="page-ellipsis">...</span>
            : <button key={btn} className={`page-btn ${btn === page ? 'active' : ''}`} onClick={() => onPageChange(btn)}>{btn}</button>
        )}
        <button className="page-btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>›</button>
      </div>
      <div className="page-jump">
        <span className="page-info">第 {page} / {totalPages} 页</span>
        <input
          className="page-jump-input"
          type="number"
          min="1"
          max={totalPages}
          value={jumpInput}
          onChange={e => setJumpInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleJump(); }}
          placeholder="跳转"
        />
        <button className="page-jump-btn" onClick={handleJump} disabled={!jumpInput}>跳转</button>
      </div>
    </div>
  );
}

// ─── 搜索栏 ──────────────────────────────────────────────────────────────────

function SearchBar({ subscriptions, onSearch, onClear }) {
  const [keyword, setKeyword] = useState('');
  const [scope, setScope] = useState('all');
  const [selectedUids, setSelectedUids] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [picFilter, setPicFilter] = useState('all');

  const handleSearch = () => {
    if (!keyword.trim()) return;
    onSearch({
      keyword: keyword.trim(),
      scope: scope === 'all' ? 'all' : selectedUids.join(','),
      startDate: startDate || null,
      endDate: endDate || null,
      picFilter,
      page: 1,
      pageSize: 20
    });
  };

  const handleClear = () => {
    setKeyword('');
    setScope('all');
    setSelectedUids([]);
    setShowAdvanced(false);
    setStartDate('');
    setEndDate('');
    setPicFilter('all');
    onClear();
  };

  const toggleUid = (uid) => {
    setSelectedUids(prev =>
      prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid]
    );
  };

  return (
    <div className="search-bar">
      <div className="search-main-row">
        <input
          className="search-input"
          type="text"
          placeholder="搜索帖子内容..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
        />
        <select className="search-scope-select" value={scope} onChange={e => { setScope(e.target.value); if (e.target.value === 'all') setSelectedUids([]); }}>
          <option value="all">全部用户</option>
          <option value="custom">指定用户</option>
        </select>
        <button className="search-filter-btn" onClick={() => setShowAdvanced(v => !v)} title="高级筛选">
          {showAdvanced ? '∧' : '∨'} 筛选
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleSearch} disabled={!keyword.trim()}>搜索</button>
        <button className="btn btn-ghost btn-sm" onClick={handleClear}>清除</button>
      </div>

      {scope === 'custom' && (
        <div className="search-user-list">
          {subscriptions.map(sub => (
            <label key={sub.uid} className="search-user-check">
              <input type="checkbox" checked={selectedUids.includes(sub.uid)} onChange={() => toggleUid(sub.uid)} />
              <span>{sub.name || sub.uid}</span>
            </label>
          ))}
        </div>
      )}

      {showAdvanced && (
        <div className="search-advanced">
          <div className="search-advanced-row">
            <label className="search-advanced-label">时间范围</label>
            <input className="search-date-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            <span>至</span>
            <input className="search-date-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div className="search-advanced-row">
            <label className="search-advanced-label">图片筛选</label>
            <button className={`search-filter-btn ${picFilter === 'all' ? 'active' : ''}`} onClick={() => setPicFilter('all')}>全部</button>
            <button className={`search-filter-btn ${picFilter === 'withPics' ? 'active' : ''}`} onClick={() => setPicFilter('withPics')}>有图</button>
            <button className={`search-filter-btn ${picFilter === 'noPics' ? 'active' : ''}`} onClick={() => setPicFilter('noPics')}>无图</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 侧边栏条目 ───────────────────────────────────────────────────────────────

function SidebarItem({ sub, isActive, onClick, onDelete, onFetch, toast }) {
  const [deleting, setDeleting] = useState(false);
  const [showFullFetchConfirm, setShowFullFetchConfirm] = useState(false);
  const status = sub.fetchStatus || {};
  const isFetching = status.status === 'fetching';
  const isPaused = status.status === 'paused';
  const progress = status.progress || 0;
  const isError = status.status === 'error';

  const handleDelete = async (e) => {
    e.stopPropagation();
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

  const handleAbort = async (e) => {
    e.stopPropagation();
    const res = await API.abortFetch(sub.uid);
    if (res.success) toast('终止信号已发送，正在保存进度...', 'info');
    else toast(res.error || '终止失败', 'error');
  };

  // v0.2.0：全量强制抓取
  const handleFullFetch = async () => {
    setShowFullFetchConfirm(false);
    const res = await API.fullFetch(sub.uid);
    if (res.success) {
      toast('全量抓取已启动，请等待进度更新', 'success');
      onFetch();
    } else {
      toast(res.error || '触发失败', 'error');
    }
  };

  return (
    <div className={`sidebar-item ${isActive ? 'active' : ''} ${isError ? 'has-error' : ''} ${isPaused ? 'has-paused' : ''}`} onClick={onClick}>
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
          {isPaused && <span className="status-dot paused" title="已暂停"></span>}
          {isError && <span className="status-dot error" title={status.message}></span>}
          {status.status === 'success' && <span className="status-dot success"></span>}
        </div>
        {(isFetching || isPaused) && (
          <ProgressBar progress={progress} status={isFetching ? 'fetching' : 'paused'} message={status.message} />
        )}
        {isError && <div className="sidebar-error-msg">{status.message}</div>}
        {isPaused && <div className="sidebar-paused-msg" style={{fontSize:'11px',color:'#ff9800',marginTop:'2px'}}>⏸ 可增量继续</div>}
      </div>
      <div className="sidebar-actions">
        {isFetching && (
          <button className="icon-btn abort-btn" title="终止抓取" onClick={handleAbort}>⏹</button>
        )}
        <button className="icon-btn" title="增量抓取" onClick={handleFetch} disabled={isFetching || deleting}>
          {isFetching ? <span className="spin">⟳</span> : '↻'}
        </button>
        <button className="full-fetch-btn" title="全量抓取" onClick={(e) => { e.stopPropagation(); setShowFullFetchConfirm(true); }} disabled={isFetching || deleting}>
          ⟳+
        </button>
        <button className="icon-btn danger" title="删除订阅" onClick={handleDelete} disabled={deleting || isFetching}>✕</button>
      </div>
      {showFullFetchConfirm && (
        <ConfirmModal
          title="全量抓取确认"
          message={`即将对 ${sub.name || sub.uid} 进行全量抓取，可能耗时较长，是否继续？`}
          confirmText="开始全量抓取"
          dangerous={true}
          onConfirm={handleFullFetch}
          onCancel={() => setShowFullFetchConfirm(false)}
        />
      )}
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
          <p className="form-hint">首次添加将执行全量保存（如已有数据则自动增量），之后按设定间隔自动增量更新。</p>
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

/**
 * v0.0.5 重写：
 * - 去掉 setInterval 轮询（根因误判）
 * - 打开浏览器后显示「我已完成登录」按钮，用户手动确认
 * - 通过 SSE loginWindowOpen / loginResult 同步状态
 */
function LoginModal({ onClose, onLoginSuccess, toast }) {
  const [mode, setMode] = useState('auto');
  const [cookieStr, setCookieStr] = useState('');
  const [loading, setLoading] = useState(false);
  const [windowOpen, setWindowOpen] = useState(false); // 登录窗口是否已打开
  const [confirming, setConfirming] = useState(false); // 正在提交"我已完成登录"
  const [verifyResult, setVerifyResult] = useState(null);

  // 监听 SSE 登录事件
  useSSE((data) => {
    if (data.type === 'loginWindowOpen') {
      setWindowOpen(true);
      setLoading(false);
    }
    if (data.type === 'loginResult') {
      setConfirming(false);
      if (data.success) {
        setVerifyResult({ valid: true, name: data.userInfo?.name, uid: data.userInfo?.uid });
        const name = data.userInfo?.name || data.userInfo?.uid || '';
        toast(name ? `✅ 登录成功！欢迎 ${name}` : '✅ 登录成功！Cookie 已持久化', 'success', 5000);
        onLoginSuccess();
        setTimeout(onClose, 1200);
      } else {
        setVerifyResult({ valid: false, error: data.message });
        toast(data.message || '登录失败', 'error');
      }
    }
  });

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
      if (res.pending) {
        // 等待 SSE loginWindowOpen 推送
        toast('已打开登录窗口，请在浏览器完成登录...', 'info', 8000);
      }
    } catch (_) {
      toast('启动登录窗口失败，请使用手动方式', 'error');
      setLoading(false);
    }
  };

  const handleConfirmLogin = async () => {
    setConfirming(true);
    setVerifyResult(null);
    try {
      const res = await API.confirmLogin();
      if (res.success) {
        setVerifyResult({ valid: true, name: res.userInfo?.name, uid: res.userInfo?.uid });
        const name = res.userInfo?.name || res.userInfo?.uid || '';
        toast(name ? `✅ 登录成功！欢迎 ${name}` : '✅ Cookie 已保存', 'success', 5000);
        onLoginSuccess();
        setTimeout(onClose, 1200);
      } else {
        setVerifyResult({ valid: false, error: res.error || '验证失败，请确认已在浏览器中完成登录' });
        toast(res.error || '未检测到登录 Cookie，请先在浏览器中完成登录', 'error');
      }
    } catch (_) { toast('网络错误', 'error'); }
    setConfirming(false);
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
              <div className="login-icon">📱</div>
              {!windowOpen ? (
                <>
                  <p>点击下方按钮，将自动打开<strong>微博移动端登录页</strong>（m.weibo.cn）。</p>
                  <p>使用手机号/账号密码或扫码完成登录，然后点击「<strong>我已完成登录</strong>」按钮保存 Cookie。</p>
                  <p className="login-tip">💡 提示：完成登录前请不要关闭弹出的浏览器窗口</p>
                  <button className="btn btn-primary btn-block" onClick={handleAutoLogin} disabled={loading} style={{marginTop:'16px'}}>
                    {loading ? <><span className="spin">⟳</span> 正在打开...</> : '打开微博登录窗口'}
                  </button>
                </>
              ) : (
                <>
                  <div className="login-window-open-hint">
                    <div className="login-window-icon">🌐</div>
                    <p><strong>浏览器登录窗口已打开</strong></p>
                    <p style={{fontSize:'13px',color:'var(--text-muted)',marginBottom:'16px'}}>
                      请在弹出的浏览器中完成登录，然后回到这里点击下方按钮。
                    </p>
                    <button
                      className="btn btn-primary btn-block confirm-login-btn"
                      onClick={handleConfirmLogin}
                      disabled={confirming}
                    >
                      {confirming
                        ? <><span className="spin">⟳</span> 正在验证 Cookie...</>
                        : '✅ 我已完成登录'}
                    </button>
                  </div>
                  <p className="login-tip" style={{marginTop:'12px'}}>
                    💡 如果登录后按钮提示"未检测到 Cookie"，可等待 3 秒后再试
                  </p>
                </>
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
  const [serverDown, setServerDown] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [fetchStatuses, setFetchStatuses] = useState({}); // uid -> status obj (来自 SSE)
  const [activeUid, setActiveUid] = useState(null);
  const [posts, setPosts] = useState([]);
  const [profile, setProfile] = useState({});
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, pageSize: 20 });
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [picFilter, setPicFilter] = useState('all'); // 'all' | 'withPics' | 'noPics'

  // v0.2.0：搜索相关状态
  const [searchMode, setSearchMode] = useState(false);
  const [searchParams, setSearchParams] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searchPagination, setSearchPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [searchKeyword, setSearchKeyword] = useState('');

  // v0.2.0：帖子分页增强 — pageSize 持久化
  const [postsPageSize, setPostsPageSize] = useState(() => {
    return parseInt(localStorage.getItem('wotui_posts_page_size')) || 20;
  });

  // v0.2.0：订阅列表分页+排序
  const [subsPage, setSubsPage] = useState(1);
  const [subsPageSize, setSubsPageSize] = useState(() => {
    return parseInt(localStorage.getItem('wotui_subs_page_size')) || 10;
  });

  // SSE：接收进度推送和登录结果
  useSSE((data) => {
    if (data.type === 'progress') {
      const { uid, type: _, ...status } = data;
      setFetchStatuses(prev => ({ ...prev, [uid]: status }));

      // 抓取成功后自动刷新帖子
      if (status.status === 'success' && uid === activeUidRef.current) {
        setTimeout(() => loadPosts(uid, 1, postsPageSizeRef.current), 500);
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
  const postsPageSizeRef = useRef(postsPageSize);
  useEffect(() => { postsPageSizeRef.current = postsPageSize; }, [postsPageSize]);

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
    if (activeUid) loadPosts(activeUid, 1, postsPageSize);
  }, [activeUid]);

  const refreshAuth = async () => {
    try {
      const res = await API.authStatus();
      if (res.success) { setLoggedIn(res.data.loggedIn); setServerDown(false); }
    } catch (_) { setServerDown(true); }
  };

  const refreshSubscriptions = async (silent = false) => {
    try {
      const res = await API.subscriptions();
      if (res.success) {
        setSubscriptions(res.data);
        setServerDown(false);
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
    } catch (_) { setServerDown(true); }
  };

  const loadPosts = async (uid, page = 1, pageSize = 20) => {
    setLoadingPosts(true);
    try {
      const res = await API.posts(uid, page, pageSize);
      if (res.success) {
        setPosts(page === 1 ? res.data.posts : prev => [...prev, ...res.data.posts]);
        setProfile(res.data.profile || {});
        setPagination(res.data.pagination || { page: 1, totalPages: 1, total: 0, pageSize });
        setServerDown(false);
      }
    } catch (_) { toast('加载帖子失败，请检查服务器是否运行', 'error'); setServerDown(true); }
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

  // v0.2.0：搜索相关方法
  const handleSearch = async (params) => {
    setSearchMode(true);
    setSearchParams(params);
    setSearchKeyword(params.keyword);
    setLoadingPosts(true);
    try {
      const res = await API.search(params);
      if (res.success) {
        setSearchResults(res.data.posts);
        setSearchPagination(res.data.pagination);
      } else {
        toast(res.error || '搜索失败', 'error');
      }
    } catch (_) {
      toast('搜索请求失败', 'error');
    }
    setLoadingPosts(false);
  };

  const handleSearchPageChange = async (newPage) => {
    if (!searchParams) return;
    const updatedParams = { ...searchParams, page: newPage };
    setSearchParams(updatedParams);
    setLoadingPosts(true);
    try {
      const res = await API.search(updatedParams);
      if (res.success) {
        setSearchResults(res.data.posts);
        setSearchPagination(res.data.pagination);
      }
    } catch (_) {
      toast('搜索请求失败', 'error');
    }
    setLoadingPosts(false);
  };

  const handleClearSearch = () => {
    setSearchMode(false);
    setSearchParams(null);
    setSearchResults([]);
    setSearchKeyword('');
  };

  // v0.2.0：帖子分页事件处理
  const handlePostsPageChange = (newPage) => {
    if (activeUid) loadPosts(activeUid, newPage, postsPageSize);
  };

  const handlePostsPageSizeChange = (newSize) => {
    setPostsPageSize(newSize);
    localStorage.setItem('wotui_posts_page_size', String(newSize));
    if (activeUid) loadPosts(activeUid, 1, newSize);
  };

  // v0.2.0：订阅列表分页事件处理
  const handleSubsPageChange = (newPage) => {
    setSubsPage(newPage);
  };

  const handleSubsPageSizeChange = (newSize) => {
    setSubsPageSize(newSize);
    localStorage.setItem('wotui_subs_page_size', String(newSize));
    setSubsPage(1);
  };

  // 合并订阅列表和实时状态
  const subsWithStatus = useMemo(() => subscriptions.map(sub => ({
    ...sub,
    fetchStatus: fetchStatuses[sub.uid] || sub.fetchStatus || { status: 'idle', message: '' },
  })), [subscriptions, fetchStatuses]);

  // v0.2.0：订阅列表排序 + 分页
  const sortedSubs = useMemo(() => {
    return [...subsWithStatus].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));
  }, [subsWithStatus]);

  const totalSubs = sortedSubs.length;
  const subsTotalPages = Math.ceil(totalSubs / subsPageSize) || 1;
  const pagedSubs = sortedSubs.slice((subsPage - 1) * subsPageSize, subsPage * subsPageSize);

  const activeSub = subsWithStatus.find(s => s.uid === activeUid);
  const activeStatus = activeSub?.fetchStatus || {};
  const isFetching = activeStatus.status === 'fetching';
  const isPaused = activeStatus.status === 'paused';

  const handleFullFetch = async () => {
    try {
      // v0.2.0：使用 force 全量抓取
      const res = await API.fullFetch(activeUid);
      if (res.success) {
        toast('全量抓取已启动，请等待进度更新', 'success');
      } else {
        toast(res.error || '触发失败', 'error');
      }
    } catch (_) {
      toast('无法连接服务器，请检查服务是否正在运行', 'error');
    }
  };

  const handleIncrFetch = async () => {
    try {
      const res = await API.fetch(activeUid, true);
      if (res.success) toast('增量抓取已开始', 'success');
      else toast(res.error || '触发失败', 'error');
    } catch (_) {
      toast('无法连接服务器，请检查服务是否正在运行', 'error');
    }
  };

  const handleAbortFetch = async () => {
    try {
      const res = await API.abortFetch(activeUid);
      if (res.success) toast('终止信号已发送，正在保存进度...', 'info');
      else toast(res.error || '终止失败', 'error');
    } catch (_) {
      toast('无法连接服务器', 'error');
    }
  };

  return (
    <div className="app">
      {/* 服务器离线警告 */}
      {serverDown && (
        <div className="server-offline-bar">
          ⚠️ 无法连接服务器，请确认后端服务正在运行（node server.js）
        </div>
      )}
      {/* 顶部导航 */}
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">W</span>
          <div>
            <div className="app-title">WoTui <span className="version-badge">v0.3.0</span></div>
            <div className="app-subtitle">OnlyMyFavorite</div>
          </div>
        </div>
        <div className="header-right">
          {loggedIn ? (
            <>
              <span className="login-status"><span className="status-dot success"></span>已登录</span>
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                try {
                  const res = await API.logout();
                  if (res.success) { setLoggedIn(false); toast('已退出登录', 'info'); }
                  else toast(res.message || '退出失败', 'error');
                } catch (_) { toast('无法连接服务器', 'error'); }
              }}>退出</button>
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

          {/* v0.2.0：搜索栏 */}
          <SearchBar
            subscriptions={subscriptions}
            onSearch={handleSearch}
            onClear={handleClearSearch}
          />

          {pagedSubs.length === 0
            ? <div className="sidebar-empty">暂无订阅</div>
            : pagedSubs.map(sub => (
                <SidebarItem key={sub.uid} sub={sub} isActive={sub.uid === activeUid}
                  onClick={() => {
                    if (sub.uid !== activeUid) {
                      setActiveUid(sub.uid);
                      setPosts([]);
                      // 退出搜索模式
                      if (searchMode) handleClearSearch();
                    }
                  }}
                  onDelete={handleDeleteSub} onFetch={refreshSubscriptions} toast={toast} />
              ))
          }

          {/* v0.2.0：订阅列表分页 */}
          {totalSubs > 0 && (
            <PaginationControl
              pagination={{ page: subsPage, pageSize: subsPageSize, total: totalSubs, totalPages: subsTotalPages }}
              pageSizeOptions={[5, 10, 20]}
              onPageChange={handleSubsPageChange}
              onPageSizeChange={handleSubsPageSizeChange}
              onJumpToPage={handleSubsPageChange}
            />
          )}
        </aside>

        {/* 主内容区 */}
        <main className="main-content">
          <div className="content-inner">
          {!activeUid ? (
            <EmptyState loggedIn={loggedIn} onAddClick={() => setShowAddModal(true)} onLoginClick={() => setShowLoginModal(true)} />
          ) : searchMode ? (
            /* v0.2.0：搜索结果展示 */
            <>
              <div className="content-header">
                <div className="content-profile">
                  <div>
                    <div className="content-name">搜索结果：{searchKeyword}</div>
                    <div className="content-stats">共 {searchPagination.total} 条匹配</div>
                  </div>
                </div>
                <div className="content-actions">
                  <button className="btn btn-ghost btn-sm" onClick={handleClearSearch}>✕ 退出搜索</button>
                </div>
              </div>

              {loadingPosts ? (
                <div className="loading-state"><div className="spinner"></div><span>搜索中...</span></div>
              ) : searchResults.length === 0 ? (
                <div className="empty-posts">
                  <p>未找到匹配的帖子</p>
                </div>
              ) : (
                <>
                  <div className="posts-list">
                    {searchResults
                      .filter(post => {
                        if (picFilter === 'withPics') return post.pics && post.pics.length > 0;
                        if (picFilter === 'noPics') return !post.pics || post.pics.length === 0;
                        return true;
                      })
                      .map(post => {
                        // 搜索结果中的帖子，使用帖子自带的 uid/userName/userAvatar
                        const postProfile = {
                          name: post.userName || `用户 ${post.uid}`,
                          avatar: post.userAvatar || '',
                        };
                        return <PostCard
                          key={post.mid}
                          post={post}
                          profile={postProfile}
                          uid={post.uid || activeUid}
                          highlightKeyword={searchKeyword}
                          searchMode={true}
                        />;
                      })
                    }
                  </div>
                  <PaginationControl
                    pagination={searchPagination}
                    pageSizeOptions={[10, 20, 30, 40, 50]}
                    onPageChange={handleSearchPageChange}
                    onPageSizeChange={() => {}}
                    onJumpToPage={handleSearchPageChange}
                  />
                </>
              )}
            </>
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
                      {/* v0.2.0：全量模式标签 */}
                      {activeStatus.fullFetchMode && (
                        <span className="full-fetch-mode-tag">全量模式</span>
                      )}
                      {activeStatus.progress > 0 && activeStatus.progress < 100 && (
                        <span style={{color:'#ff6b35'}}> {activeStatus.progress}%</span>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={handleAbortFetch} style={{marginLeft:'8px',background:'#f44336',color:'#fff',border:'none'}}>
                        ⏹ 终止
                      </button>
                    </div>
                  )}
                  {isPaused && (
                    <div className="fetch-indicator-wrap" style={{color:'#ff9800'}}>
                      ⏸ {activeStatus.message}
                    </div>
                  )}
                  {activeStatus.status === 'error' && (
                    <div className="fetch-error-inline">{activeStatus.message}</div>
                  )}
                  <a href={`https://weibo.com/u/${activeUid}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">查看微博主页 ↗</a>
                  <button className="btn btn-primary btn-sm" onClick={handleIncrFetch} disabled={isFetching}>增量抓取</button>
                  <button className="btn btn-sm" onClick={handleFullFetch} disabled={isFetching} style={{background:'#ff6d00',color:'#fff',border:'none'}}>全量抓取</button>
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
                <span className="filter-group">
                  <button className={`filter-btn ${picFilter === 'all' ? 'active' : ''}`} onClick={() => setPicFilter('all')}>全部</button>
                  <button className={`filter-btn ${picFilter === 'withPics' ? 'active' : ''}`} onClick={() => setPicFilter('withPics')}>有图</button>
                  <button className={`filter-btn ${picFilter === 'noPics' ? 'active' : ''}`} onClick={() => setPicFilter('noPics')}>无图</button>
                </span>
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
                      <button className="btn btn-primary" onClick={handleFullFetch}>立即抓取</button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="posts-list">
                    {posts
                      .filter(post => {
                        if (picFilter === 'withPics') return post.pics && post.pics.length > 0;
                        if (picFilter === 'noPics') return !post.pics || post.pics.length === 0;
                        return true;
                      })
                      .map(post => <PostCard key={post.mid} post={post} profile={profile} uid={activeUid} />)
                    }
                  </div>
                  {/* v0.2.0：帖子列表分页控件 */}
                  <PaginationControl
                    pagination={pagination}
                    pageSizeOptions={[10, 20, 30, 40, 50]}
                    onPageChange={handlePostsPageChange}
                    onPageSizeChange={handlePostsPageSizeChange}
                    onJumpToPage={handlePostsPageChange}
                  />
                </>
              )}
            </>
          )}
          </div>
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
