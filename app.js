/* 877生化速刷 — 移动端刷题 */
(function () {
  const BANK = window.QBANK || [];
  const CHS = window.CHAPTERS || [];
  const KPS = window.KPS || [];
  const LS = {
    users: 'qb.users', cur: 'qb.cur', token: 'qb.token', repo: 'qb.repo', branch: 'qb.branch',
    auto: 'qb.auto', rec: u => 'qb.rec.' + u
  };
  const COLORS = ['#0f766e', '#9a3412', '#4338ca'];
  const RATE_TXT = { forgot: '忘记', vague: '模糊', known: '熟悉' };

  const S = {
    user: '', rec: { u: '', updated: 0, progress: {}, fav: [], sessions: [] }, tab: 'quiz', view: 'setup',
    filter: { chap: '', kp: '', scope: 'all', order: 'seq' },
    queue: [], idx: 0, phase: 'ask', revealed: {}, picked: null,
    session: null, token: '', repo: 'EVAER522/877-biochem', branch: 'main',
    auto: true, sync: { state: 'idle', msg: '' }, _syncTimer: null, _syncing: false
  };

  /* ---------- utils ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const now = () => Date.now();
  const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 1800); }
  function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn(e); } }

  /* ---------- github ---------- */
  const api = {
    base: () => `https://api.github.com/repos/${S.repo}/contents/`,
    raw: p => `https://raw.githubusercontent.com/${S.repo}/${S.branch}/${p}`,
    headers: () => { const h = { 'Accept': 'application/vnd.github+json' }; if (S.token) h['Authorization'] = 'Bearer ' + S.token; return h; },
    async read(path) {
      const r = await fetch(api.base() + encodeURI(path) + '?ref=' + S.branch + '&t=' + Date.now(), { headers: api.headers(), cache: 'no-store' });
      if (r.status === 404) return null;
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
      const j = await r.json();
      return { text: b64d(j.content || ''), sha: j.sha };
    },
    async write(path, text, msg, sha, retry) {
      if (!S.token) throw Object.assign(new Error('NO_TOKEN'), { code: 'no_token' });
      const body = { message: msg, content: b64e(text), branch: S.branch };
      if (sha) body.sha = sha;
      const r = await fetch(api.base() + encodeURI(path), { method: 'PUT', headers: { ...api.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 409 && !retry) {
        const cur = await api.read(path);
        return api.write(path, text, msg, cur && cur.sha, true);
      }
      if (!r.ok) { let t = ''; try { t = (await r.json()).message || ''; } catch (e) { } throw Object.assign(new Error(t || ('HTTP ' + r.status)), { status: r.status }); }
      return r.json();
    }
  };
  function b64e(str) {
    const bytes = new TextEncoder().encode(str); let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function b64d(b64) {
    const bin = atob(String(b64).replace(/\s/g, '')); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- record ---------- */
  function blankRec(u) { return { u, updated: 0, progress: {}, fav: [], sessions: [] }; }
  function loadRec(u) {
    S.rec = loadJSON(LS.rec(u), null) || blankRec(u);
    S.rec.fav = S.rec.fav || []; S.rec.progress = S.rec.progress || {}; S.rec.sessions = S.rec.sessions || [];
  }
  function saveRec() {
    S.rec.updated = now();
    saveJSON(LS.rec(S.user), S.rec);
    scheduleSync();
  }
  function mergeRec(local, remote) {
    const out = blankRec(local.u || remote.u);
    out.sessions = local.sessions.slice();
    remote.sessions.forEach(rs => { if (!out.sessions.some(x => x.t === rs.t)) out.sessions.push(rs); });
    out.sessions.sort((a, b) => a.t - b.t);
    out.fav = Array.from(new Set([...(local.fav || []), ...(remote.fav || [])]));
    out.progress = { ...(remote.progress || {}) };
    Object.entries(local.progress || {}).forEach(([k, v]) => {
      const r = out.progress[k];
      if (!r || (v.n || 0) >= (r.n || 0) || (v.ts || 0) > (r.ts || 0)) out.progress[k] = v;
    });
    out.updated = Math.max(local.updated || 0, remote.updated || 0);
    return out;
  }
  async function pullFromRepo(u, silent) {
    const path = `logs/${encodeURIComponent(u)}.json`;
    try {
      const f = await api.read(path);
      if (!f) { if (!silent) toast('远端暂无该用户日志'); return; }
      const remote = JSON.parse(f.text);
      S.rec = mergeRec(S.rec, remote);
      saveJSON(LS.rec(u), S.rec);
      setSync('ok', S.token ? '已同步 ' + hhmm(now()) : '已读取远端');
    } catch (e) {
      setSync('warn', '读取失败：' + e.message);
    }
  }
  function scheduleSync() {
    if (!S.token || !S.user) { setSync(S.token ? 'idle' : 'off', S.token ? '待同步' : '仅本地'); return; }
    setSync('warn', '待同步…');
    clearTimeout(S._syncTimer);
    S._syncTimer = setTimeout(pushToRepo, 4000);
  }
  async function pushToRepo() {
    if (!S.token || !S.user || S._syncing) return;
    S._syncing = true; setSync('warn', '同步中…');
    const path = `logs/${encodeURIComponent(S.user)}.json`;
    try {
      const cur = await api.read(path);
      const body = JSON.stringify(S.rec, null, 0);
      if (cur && cur.text === body) { setSync('ok', '已同步 ' + hhmm(now())); S._syncing = false; return; }
      await api.write(path, body, `log: ${S.user} ${new Date().toISOString().slice(0, 16)}`, cur && cur.sha);
      await api.write('logs/index.json', JSON.stringify({ users: allUsers() }), 'log index update', (await api.read('logs/index.json') || {}).sha);
      setSync('ok', '已同步 ' + hhmm(now()));
    } catch (e) {
      if (e.code === 'no_token') setSync('off', '仅本地');
      else setSync('warn', '同步失败：' + e.message);
    } finally { S._syncing = false; }
  }
  function setSync(st, msg) {
    S.sync = { state: st, msg: msg || '' };
    const dot = $('syncDot'); if (dot) { dot.className = 'dot ' + (st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : st === 'off' ? 'off' : ''); dot.title = msg || ''; }
  }

  /* ---------- users ---------- */
  function allUsers() {
    const local = loadJSON(LS.users, []);
    const idx = loadJSON('qb.remoteUsers', []);
    return Array.from(new Set([...local, ...idx])).filter(Boolean);
  }
  async function loadRemoteIndex() {
    try {
      const f = await api.read('logs/index.json');
      if (f) { const j = JSON.parse(f.text); saveJSON('qb.remoteUsers', j.users || []); }
    } catch (e) { }
  }
  function setUser(u, silent) {
    S.user = u; localStorage.setItem(LS.cur, u);
    const users = allUsers(); if (!users.includes(u)) { users.push(u); saveJSON(LS.users, users); }
    loadRec(u); updateUserName(); render();
    if (!silent) pullFromRepo(u, true);
  }
  function updateUserName() { const el = $('userName'); if (el) el.textContent = S.user || '未选择'; }

  /* ---------- filtering ---------- */
  function scopeLabel() {
    const f = S.filter;
    const ch = f.chap ? (CHS.find(c => c.id === f.chap) || {}).name : '全部章节';
    const kp = f.kp ? f.kp : '全部考点';
    const sc = { all: '全部题', weak: '未掌握', forgot: '只刷忘记', vague: '模糊待巩固', fav: '收藏' }[f.scope];
    return { ch, kp, sc };
  }
  function buildQueue() {
    const f = S.filter, prog = S.rec.progress, fav = S.rec.fav;
    let list = BANK.filter(q => {
      if (f.chap && q.chap !== f.chap) return false;
      if (f.kp && q.kp !== f.kp) return false;
      const st = prog[q.id];
      if (f.scope === 'weak') return !st || st.r !== 'known';
      if (f.scope === 'forgot') return st && st.r === 'forgot';
      if (f.scope === 'vague') return st && st.r === 'vague';
      if (f.scope === 'fav') return fav.includes(q.id);
      return true;
    });
    list.sort((a, b) => (a.y - b.y) || (parseInt(a.num, 10) || 0) - (parseInt(b.num, 10) || 0));
    if (f.order === 'random') list = shuffle(list);
    return list;
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------- render ---------- */
  function render() {
    updateUserName(); updateTabbar();
    const v = $('view');
    if (S.tab === 'quiz') v.innerHTML = S.view === 'quiz' ? quizHTML() : S.view === 'summary' ? summaryHTML() : setupHTML();
    if (S.tab === 'logs') v.innerHTML = logsHTML();
    if (S.tab === 'me') v.innerHTML = meHTML();
    if (S.tab === 'quiz' && S.view === 'quiz') {
      const bar = $('qbar'); if (bar) bar.style.width = (S.idx / Math.max(1, S.queue.length) * 100) + '%';
      updateTitle();
    } else updateTitle();
  }
  function updateTitle() {
    const t = $('tbTitle'), s = $('tbSub');
    if (S.tab === 'logs') { t.textContent = '刷题记录'; s.textContent = S.user ? `当前用户 · ${S.user}` : '未选择用户'; return; }
    if (S.tab === 'me') { t.textContent = '我的'; s.textContent = '账号、同步与数据'; return; }
    if (S.view === 'quiz') { t.textContent = '刷题中'; s.textContent = `${S.idx + 1} / ${S.queue.length} · ${esc(shortName(scopeLabel().ch))}${S.filter.kp ? ' · ' + S.filter.kp : ''}`; return; }
    if (S.view === 'summary') { t.textContent = '本轮完成'; s.textContent = `${S.session ? S.session.n : 0} 题`; return; }
    t.textContent = '877生化速刷';
    s.textContent = `${BANK.length} 题 · ${CHS.length} 章 · ${KPS.length} 考点`;
  }
  function updateTabbar() { document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === S.tab)); }

  /* ----- setup ----- */
  function setupHTML() {
    const f = S.filter;
    const chapChips = [`<button class="chip ${!f.chap ? 'on' : ''}" data-act="chap" data-v="">全部<span class="n">${BANK.length}</span></button>`]
      .concat(CHS.map(c => `<button class="chip ${f.chap === c.id ? 'on' : ''}" data-act="chap" data-v="${c.id}">${esc(shortName(c.name))}<span class="n">${c.n}</span></button>`)).join('');
    const kpList = f.chap ? KPS.filter(k => k.ch === f.chap) : [];
    const kpChips = f.chap ? [`<button class="chip ${!f.kp ? 'on' : ''}" data-act="kp" data-v="">全部考点</button>`]
      .concat(kpList.map(k => `<button class="chip ${f.kp === k.kp ? 'on' : ''}" data-act="kp" data-v="${esc(k.kp)}">${esc(k.kp)}<span class="n">${k.n}</span></button>`)).join('') : '';
    const scopes = [['all', '全部题'], ['weak', '未掌握'], ['forgot', '只刷忘记'], ['vague', '模糊待巩固'], ['fav', '我的收藏']];
    const scopeChips = scopes.map(([v, t]) => `<button class="chip ${f.scope === v ? 'on' : ''}" data-act="scope" data-v="${v}">${t}</button>`).join('');
    const cnt = buildQueue().length;
    const p = S.rec.progress;
    const known = Object.values(p).filter(x => x.r === 'known').length;
    return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="h1" style="margin:0">选范围，开刷</div>
        <div class="muted" style="margin-top:4px">已掌握 ${known} 题 · 收藏 ${S.rec.fav.length} 题</div></div>
        <div class="badge pri">${cnt} 题</div>
      </div>
      <div class="section-label">按章节</div><div class="row wrap">${chapChips}</div>
      ${f.chap ? `<div class="section-label">按考点</div><div class="row wrap">${kpChips}</div>` : ''}
      <div class="section-label">范围</div><div class="row wrap">${scopeChips}</div>
      <div class="section-label">顺序</div>
      <div class="row wrap">
        <button class="chip ${f.order === 'seq' ? 'on' : ''}" data-act="order" data-v="seq">按年份顺序</button>
        <button class="chip ${f.order === 'random' ? 'on' : ''}" data-act="order" data-v="random">随机</button>
      </div>
      <div style="margin-top:18px"><button class="btn block" data-act="start" ${cnt ? '' : 'disabled style="opacity:.4"'}>开始刷题（${cnt}）</button></div>
    </div>
    <div class="muted" style="margin:12px 4px;line-height:1.6">选择题直接点选项判对错；判断题选对/错；填空、名词解释、解答题的答案分 2—3 个要点遮盖，点一下显示一块。</div>`;
  }
  function shortName(n) { return n.replace(/^第[一二三四五六七八九十]+章\s*/, ''); }

  /* ----- quiz ----- */
  function quizHTML() {
    const q = S.queue[S.idx];
    if (!q) return `<div class="empty">本轮已结束</div>`;
    const st = S.rec.progress[q.id];
    const isFav = S.rec.fav.includes(q.id);
    const showAns = S.phase !== 'ask';
    let body = '';
    if (q.opts && q.opts.length && (q.ty === '选择' || q.ty === '单选' || q.ty === '多选')) {
      const multi = q.ty === '多选' && (q.correct || '').length > 1;
      body = `<div class="opts">${q.opts.map((o, i) => {
        const k = 'ABCD'[i] || String(i + 1);
        let cls = 'opt';
        if (S.picked) {
          const sel = multi ? S.picked.includes(k) : S.picked === k;
          if (sel) cls += ' sel';
          if (showAns) {
            const right = (q.correct || '').includes(k);
            if (right) cls += ' right'; else if (sel) cls += ' wrong'; else cls += ' dim';
          }
        }
        return `<button class="${cls}" data-act="opt" data-k="${k}"><span class="k">${k}</span><span>${esc(o)}</span></button>`;
      }).join('')}</div>
      ${multi ? `<div style="margin-top:10px"><button class="btn ghost block" data-act="confirmMulti">确认作答</button></div>` : ''}`;
    } else if (q.ty === '判断') {
      body = `<div class="judge">
        <button class="btn ${showAns ? (q.correct === '√' ? 'right' : (S.picked === '√' ? 'wrong' : '')) : ''}" data-act="judge" data-v="√">对</button>
        <button class="btn ${showAns ? (q.correct === '×' ? 'right' : (S.picked === '×' ? 'wrong' : '')) : ''}" data-act="judge" data-v="×">错</button>
      </div>`;
    } else {
      body = showAns ? '' : `<div style="margin-top:4px"><button class="btn ghost block" data-act="showAns">显示答案</button></div>`;
    }
    let ansBlock = '';
    if (showAns) {
      const pts = (q.pts && q.pts.length) ? q.pts : [q.ans];
      ansBlock = `<div class="answer show"><div class="ans-label">答案 · ${q.pts && q.pts.length ? '分' + q.pts.length + '块遮盖，点一下显示一块' : '完整答案'}</div>
        ${pts.map((t, i) => {
        const masked = q.pts && q.pts.length && !S.revealed[q.id + ':' + i];
        return `<div class="pt ${masked ? 'masked' : ''}" data-act="${masked ? 'reveal' : ''}" data-i="${i}" style="--c:${COLORS[i % COLORS.length]}" data-label="要点 ${i + 1} · 轻点显示"><span class="txt">${esc(t)}</span></div>`;
      }).join('')}
        ${q.pts && q.pts.length > 1 ? `<div class="reveal-all" data-act="revealAll">显示全部要点</div>` : ''}
        ${q.kpnote ? `<div class="kpnote">考点：${esc(q.kpnote.replace(/^：/, ''))}</div>` : ''}
      </div>`;
    }
    const rated = S.rated;
    return `
    <div class="progress"><i id="qbar"></i></div>
    <div class="card">
      <div class="qhead">
        <div class="qmeta"><span class="badge pri">${esc(q.kp)}</span><span class="badge">${q.y}年 · ${esc(q.ty)}${esc(q.num)}</span></div>
        <button class="star ${isFav ? 'on' : ''}" data-act="star">${isFav ? '★' : '☆'}</button>
      </div>
      <div class="stem">${esc(q.stem)}</div>
      ${body}
      ${ansBlock}
      <div class="rate ${showAns ? 'show' : ''}">
        <button class="btn ${rated === 'forgot' ? 'on' : ''}" data-r="forgot" data-act="rate">忘记</button>
        <button class="btn ${rated === 'vague' ? 'on' : ''}" data-r="vague" data-act="rate">模糊</button>
        <button class="btn ${rated === 'known' ? 'on' : ''}" data-r="known" data-act="rate">熟悉</button>
      </div>
      ${showAns ? `<div class="rate-hint">${S.auto ? '选完自动下一题' : '选完点下方按钮进入下一题'}</div>` : `<div class="rate-hint">先自己作答，再显示答案</div>`}
      <div class="row" style="margin-top:14px;gap:8px">
        <button class="btn ghost" style="flex:1" data-act="prev">上一题</button>
        <button class="btn ghost" style="flex:1" data-act="skip">跳过/下一题</button>
      </div>
    </div>
    <div class="muted" style="margin:10px 4px">${esc(q.chname)} · ${esc(q.kp)}${st ? ' · 上次：' + RATE_TXT[st.r] : ''}</div>`;
  }

  /* ----- summary ----- */
  function summaryHTML() {
    const s = S.session || { n: 0, forgot: 0, vague: 0, known: 0, correct: 0, wrong: 0 };
    return `<div class="card" style="text-align:center;padding:26px 16px">
      <div style="font-size:15px;color:var(--tx2)">本轮完成</div>
      <div style="font-size:38px;font-weight:700;color:var(--pri);margin:8px 0 2px">${s.n}</div>
      <div class="muted">题 · 用时 ${Math.max(1, Math.round((s.dur || 0) / 60000))} 分钟</div>
    </div>
    <div class="stat-grid" style="margin-top:12px">
      <div class="stat"><b style="color:var(--forgot)">${s.forgot}</b><span>忘记</span></div>
      <div class="stat"><b style="color:var(--vague)">${s.vague}</b><span>模糊</span></div>
      <div class="stat"><b style="color:var(--known)">${s.known}</b><span>熟悉</span></div>
      <div class="stat"><b>${s.correct || 0}</b><span>选择答对</span></div>
    </div>
    <div class="card" style="margin-top:12px">
      <button class="btn block" data-act="again">再来一轮（同样范围）</button>
      <button class="btn ghost block" style="margin-top:8px" data-act="toSetup">换范围</button>
    </div>`;
  }

  /* ----- logs ----- */
  function logsHTML() {
    const p = S.rec.progress, fav = S.rec.fav;
    const cnt = { forgot: 0, vague: 0, known: 0 };
    Object.values(p).forEach(x => { if (cnt[x.r] != null) cnt[x.r]++; });
    const sessions = S.rec.sessions.slice().reverse();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayN = sessions.filter(s => s.t >= today.getTime()).reduce((a, b) => a + (b.n || 0), 0);
    return `
    <div class="stat-grid">
      <div class="stat"><b>${Object.keys(p).length}</b><span>已练题</span></div>
      <div class="stat"><b>${todayN}</b><span>今日</span></div>
      <div class="stat"><b>${fav.length}</b><span>收藏</span></div>
      <div class="stat"><b style="color:var(--known)">${cnt.known}</b><span>熟悉</span></div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="row" style="justify-content:space-between">
        <div><div class="h1" style="margin:0;font-size:15px">掌握分布</div>
        <div class="muted" style="margin-top:3px">忘记 ${cnt.forgot} · 模糊 ${cnt.vague} · 熟悉 ${cnt.known}</div></div>
        <button class="chip" data-act="syncNow">${S.token ? '立即同步' : '未配置同步'}</button>
      </div>
      <div class="progress" style="margin-top:12px;height:6px;background:#f0f2f4"><i style="width:${Object.keys(p).length ? Math.round(cnt.known / Object.keys(p).length * 100) : 0}%;background:var(--pri)"></i></div>
      <div class="muted" style="margin-top:6px">同步状态：${esc(S.sync.msg || '仅保存在本机')}</div>
    </div>
    <div class="section-label">刷题日志（${sessions.length}）</div>
    ${sessions.length ? `<div class="list">${sessions.map(s => `<div class="item">
      <div><div style="font-weight:500">${esc(s.scope)}</div><div class="k" style="margin-top:3px">${new Date(s.t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${s.n} 题</div></div>
      <div class="k" style="text-align:right;line-height:1.6">忘${s.forgot} 模${s.vague}<br/>熟${s.known}</div></div>`).join('')}</div>` : `<div class="empty">还没有日志，去刷几题</div>`}`;
  }

  /* ----- me ----- */
  function meHTML() {
    const p = S.rec.progress;
    return `
    <div class="list">
      <div class="item" data-act="switchUser"><div><div>当前用户</div><div class="k" style="margin-top:3px">切换或新建日志用户</div></div><div>${esc(S.user || '未选择')} ›</div></div>
      <div class="item" data-act="tokenSheet"><div><div>同步令牌</div><div class="k" style="margin-top:3px">${S.token ? '已配置（仅存本机）' : '未配置，日志只存本机'}</div></div><div>›</div></div>
      <div class="item" data-act="repoSheet"><div><div>日志仓库</div><div class="k" style="margin-top:3px">${esc(S.repo)} · ${esc(S.branch)}</div></div><div>›</div></div>
      <div class="item" data-act="toggleAuto"><div>自评后自动下一题</div><div>${S.auto ? '开' : '关'} ›</div></div>
    </div>
    <div class="list" style="margin-top:12px">
      <div class="item" data-act="export"><div><div>导出记录</div><div class="k" style="margin-top:3px">JSON 备份，可换机导入</div></div><div>›</div></div>
      <div class="item" data-act="import"><div><div>导入记录</div><div class="k" style="margin-top:3px">合并到当前用户</div></div><div>›</div></div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="h1" style="font-size:15px">数据概览</div>
      <div class="muted" style="line-height:1.9">题库 ${BANK.length} 题 · 已练 ${Object.keys(p).length} 题 · 收藏 ${S.rec.fav.length} 题<br/>日志文件：logs/${esc(S.user || 'user')}.json</div>
    </div>
    <div class="muted" style="margin:14px 4px;line-height:1.7">题目与答案来自南航 877 历年真题整理，仅供本人复习使用。</div>`;
  }

  /* ---------- sheets ---------- */
  function openSheet(html) {
    $('sheet').innerHTML = html;
    $('sheet').classList.add('show'); $('sheetMask').classList.add('show');
  }
  function closeSheet() { $('sheet').classList.remove('show'); $('sheetMask').classList.remove('show'); }
  function userSheet() {
    const users = allUsers();
    openSheet(`<h3>选择日志用户</h3><div class="desc">每个用户名对应仓库里一个日志文件，换设备后按同一用户名即可继续。</div>
      <div class="list">${users.map(u => `<div class="item" data-act="pickUser" data-v="${esc(u)}"><div>${esc(u)}</div><div>${u === S.user ? '当前' : '选择'} ›</div></div>`).join('') || '<div class="empty">还没有用户</div>'}</div>
      <div class="field"><label>新建用户（例如你的名字或设备名）</label><input id="newUser" placeholder="输入用户名" maxlength="20"/></div>
      <button class="btn block" data-act="createUser">新建并进入</button>`);
  }
  function tokenSheet() {
    openSheet(`<h3>配置同步令牌</h3><div class="desc">日志要写回 GitHub 必须用令牌。请创建一个 <b>Fine-grained PAT</b>：仅勾选本仓库、权限只给 Contents 的 Read and write。令牌只保存在这台设备的浏览器里。</div>
      <div class="field"><label>Fine-grained token</label><input id="tk" type="password" placeholder="github_pat_..." value="${esc(S.token)}"/></div>
      <button class="btn block" data-act="saveToken">保存并测试</button>
      <button class="btn ghost block" style="margin-top:8px" data-act="clearToken">清除令牌</button>
      <div class="desc" style="margin-top:14px">没有令牌也能刷题，记录只存本机，可用「导出/导入」迁移。</div>`);
  }
  function repoSheet() {
    openSheet(`<h3>日志仓库</h3><div class="desc">格式 owner/repo。写入路径固定为 logs/&lt;用户名&gt;.json。</div>
      <div class="field"><label>仓库</label><input id="rp" value="${esc(S.repo)}"/></div>
      <div class="field"><label>分支</label><input id="br" value="${esc(S.branch)}"/></div>
      <button class="btn block" data-act="saveRepo">保存</button>`);
  }
  function importSheet() {
    openSheet(`<h3>导入记录</h3><div class="desc">选择之前导出的 JSON，会与当前用户记录合并。</div>
      <input type="file" id="impFile" accept="application/json,.json" style="width:100%;padding:10px;border:1px dashed var(--line);border-radius:10px;background:#fafbfc"/>`);
  }

  /* ---------- flow ---------- */
  function startSession() {
    S.queue = buildQueue();
    if (!S.queue.length) { toast('这个范围没有题目'); return; }
    S.idx = 0; S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null;
    S.session = { t: now(), scope: scopeLabel().ch + ' · ' + scopeLabel().kp + ' · ' + scopeLabel().sc, n: 0, forgot: 0, vague: 0, known: 0, correct: 0, wrong: 0 };
    S.view = 'quiz'; S.tab = 'quiz'; render();
  }
  function answerDone(correct) {
    S.phase = 'revealed';
    if (S.session) {
      if (correct === true) S.session.correct++; else if (correct === false) S.session.wrong++;
    }
    render();
  }
  function rate(r) {
    if (S.phase === 'ask') return;
    const q = S.queue[S.idx]; if (!q) return;
    const prev = S.rec.progress[q.id];
    S.rec.progress[q.id] = { r, c: S.correctFlag, n: (prev && prev.n || 0) + 1, ts: now() };
    if (S.session) { S.session.n++; S.session[r]++; S.session.dur = now() - S.session.t; }
    S.rated = r; saveRec();
    if (S.auto) setTimeout(() => next(true), 420); else render();
  }
  function next(auto) {
    if (S.idx + 1 >= S.queue.length) {
      finish(); return;
    }
    S.idx++; S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null; S.correctFlag = null;
    render();
  }
  function finish() {
    if (S.session) { S.rec.sessions.push({ ...S.session }); if (S.rec.sessions.length > 300) S.rec.sessions = S.rec.sessions.slice(-300); saveRec(); }
    S.view = 'summary'; render();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (el) {
      const act = el.dataset.act, v = el.dataset.v, i = el.dataset.i;
      switch (act) {
        case 'chap': S.filter.chap = v; S.filter.kp = ''; render(); return;
        case 'kp': S.filter.kp = v; render(); return;
        case 'scope': S.filter.scope = v; render(); return;
        case 'order': S.filter.order = v; render(); return;
        case 'start': startSession(); return;
        case 'opt': {
          if (S.phase !== 'ask') return;
          const q = S.queue[S.idx];
          const multi = q.ty === '多选' && (q.correct || '').length > 1;
          if (multi) {
            S.picked = S.picked || [];
            S.picked = S.picked.includes(v) ? S.picked.filter(x => x !== v) : [...S.picked, v];
            render(); return;
          }
          S.picked = v; S.correctFlag = (q.correct || '') === v; answerDone(S.correctFlag); return;
        }
        case 'confirmMulti': {
          if (S.phase !== 'ask' || !S.picked || !S.picked.length) return;
          const q = S.queue[S.idx];
          S.correctFlag = S.picked.slice().sort().join('') === (q.correct || '').split('').sort().join('');
          answerDone(S.correctFlag); return;
        }
        case 'judge': {
          if (S.phase !== 'ask') return;
          const q = S.queue[S.idx];
          S.picked = v; S.correctFlag = q.correct === v; answerDone(S.correctFlag); return;
        }
        case 'showAns': S.phase = 'revealed'; render(); return;
        case 'reveal': { const q = S.queue[S.idx]; S.revealed[q.id + ':' + i] = 1; render(); return; }
        case 'revealAll': { const q = S.queue[S.idx]; (q.pts || []).forEach((_, k) => S.revealed[q.id + ':' + k] = 1); render(); return; }
        case 'rate': rate(el.dataset.r); return;
        case 'star': {
          const q = S.queue[S.idx]; const fav = S.rec.fav;
          const k = fav.indexOf(q.id); if (k >= 0) fav.splice(k, 1); else fav.push(q.id);
          saveRec(); render(); return;
        }
        case 'next': case 'skip': next(); return;
        case 'prev': if (S.idx > 0) { S.idx--; S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null; render(); } return;
        case 'again': S.view = 'quiz'; S.queue = buildQueue(); S.idx = 0; S.session = { t: now(), scope: scopeLabel().ch + ' · ' + scopeLabel().kp + ' · ' + scopeLabel().sc, n: 0, forgot: 0, vague: 0, known: 0, correct: 0, wrong: 0 }; S.phase = 'ask'; render(); return;
        case 'toSetup': S.view = 'setup'; render(); return;
        case 'syncNow': if (!S.token) { tokenSheet(); return; } toast('同步中…'); await pushToRepo(); render(); return;
        case 'switchUser': userSheet(); return;
        case 'pickUser': setUser(v); closeSheet(); return;
        case 'createUser': {
          const v2 = ($('newUser').value || '').trim().replace(/[\\/:*?"<>|]/g, '');
          if (!v2) { toast('请输入用户名'); return; }
          setUser(v2); closeSheet(); return;
        }
        case 'tokenSheet': tokenSheet(); return;
        case 'saveToken': {
          S.token = ($('tk').value || '').trim(); saveJSON(LS.token, S.token); closeSheet();
          if (S.token) { toast('测试连接…'); await pullFromRepo(S.user, false); await pushToRepo(); } else toast('已清除');
          render(); return;
        }
        case 'clearToken': S.token = ''; saveJSON(LS.token, ''); closeSheet(); setSync('off', '仅本地'); render(); return;
        case 'repoSheet': repoSheet(); return;
        case 'saveRepo': {
          const r = ($('rp').value || '').trim(); const b = ($('br').value || 'main').trim();
          if (!/^[\w.-]+\/[\w.\-\u4e00-\u9fa5]+$/.test(r)) { toast('格式应为 owner/repo'); return; }
          S.repo = r; S.branch = b; saveJSON(LS.repo, r); saveJSON(LS.branch, b); closeSheet(); toast('已保存'); render(); return;
        }
        case 'toggleAuto': S.auto = !S.auto; saveJSON(LS.auto, S.auto); render(); return;
        case 'export': {
          const blob = new Blob([JSON.stringify(S.rec, null, 2)], { type: 'application/json' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `877-${S.user}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 3000); return;
        }
        case 'import': importSheet(); return;
      }
    }
  });
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'impFile') {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const j = JSON.parse(rd.result);
          if (!j || typeof j !== 'object' || !j.progress) throw new Error('格式不对');
          S.rec = mergeRec(S.rec, { ...j, u: S.user });
          saveRec(); closeSheet(); toast('已导入并合并'); render();
        } catch (err) { toast('导入失败：' + err.message); }
      };
      rd.readAsText(f);
    }
  });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    S.tab = t.dataset.tab;
    if (S.tab === 'quiz' && S.view === 'quiz' && !S.queue.length) S.view = 'setup';
    render();
  }));
  $('sheetMask').addEventListener('click', closeSheet);
  $('btnUser').addEventListener('click', userSheet);

  /* ---------- boot ---------- */
  async function boot() {
    S.token = localStorage.getItem(LS.token) || '';
    S.repo = localStorage.getItem(LS.repo) || S.repo;
    S.branch = localStorage.getItem(LS.branch) || 'main';
    S.auto = loadJSON(LS.auto, true);
    let cur = localStorage.getItem(LS.cur) || '';
    cur = cur.trim();
    if (cur.charAt(0) === '"') { try { cur = JSON.parse(cur); } catch (e) { cur = cur.replace(/^"|"$/g, ''); } }
    if (cur.indexOf('\\"') >= 0) cur = cur.replace(/\\?"/g, '');
    await loadRemoteIndex();
    if (!cur) { render(); userSheet(); return; }
    setUser(cur, true);
    pullFromRepo(cur, true);
  }
  window.addEventListener('pagehide', () => { if (S.token && S.user) { const body = JSON.stringify(S.rec); try { navigator.sendBeacon && 0; } catch (e) { } } });
  boot();
})();
