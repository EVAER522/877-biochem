/* 877生化速刷 — 移动端刷题 */
(function () {
  const BANK = window.QBANK || [];
  const ALLQ = BANK.slice();          // 全量题库（去重后会从 BANK 中移除，但这里始终保留）
  const BYID = {};
  ALLQ.forEach(q => { BYID[q.id] = q; });
  const qById = id => BYID[id] || BANK.find(x => x.id === id) || null;   // 含被去重隐藏的题
  let HIDDEN = new Set();             // 被去重隐藏的题号
  const CHS = window.CHAPTERS || [];
  const KPS = window.KPS || [];
  const LS = {
    users: 'qb.users', cur: 'qb.cur', token: 'qb.token', repo: 'qb.repo', branch: 'qb.branch',
    auto: 'qb.auto', rec: u => 'qb.rec.' + u, sess: u => 'qb.sess.' + u, mem: u => 'qb.mem.' + u
  };
  const COLORS = ['#0f766e', '#9a3412', '#4338ca'];
  const CUR_VER = (function () { const t = document.querySelector('script[src*="app.js?v="]'); return t ? (t.getAttribute('src').split('?v=')[1] || '') : ''; })();
  const RATE_TXT = { forgot: '忘记', vague: '模糊', known: '熟悉' };
  const LIST_NAME = { fav: '我的收藏', forgot: '忘记的题', vague: '模糊待巩固', known: '已熟悉', weak: '未掌握', done: '已练过的题', today: '今日刷的题', all: '全部题目' };

  const S = {
    user: '', rec: { u: '', updated: 0, progress: {}, fav: [], sessions: [] }, tab: 'quiz', view: 'setup',
    filter: { tp: '', chap: '', kp: '', scope: 'all', order: 'seq' },
    fold: { tp: true, chap: true, kp: true }, mo: {}, mo2: {}, mw: '', mem: {}, mf: 'all',
    queue: [], idx: 0, phase: 'ask', revealed: {}, picked: null,
    session: null, token: '', repo: 'EVAER522/877-biochem', branch: 'main',
    auto: true, snap: null, sw: '', custom: '', listKind: 'fav', syncAt: 0, syncErr: '', sync: { state: 'idle', msg: '' }, _syncTimer: null, _syncing: false
  };

  let LAST_PULL = 0;                   // 前台自动拉取的节流时间
  let LAST_SHARED = 0;                 // 共享层（纠错/笔记/去重）的节流时间

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
    async write(path, text, msg, sha, opt, attempt) {
      if (!S.token) throw Object.assign(new Error('NO_TOKEN'), { code: 'no_token' });
      opt = opt || {}; attempt = attempt || 0;
      const body = { message: msg, content: b64e(text), branch: S.branch };
      if (sha) body.sha = sha;
      const r = await fetch(api.base() + encodeURI(path), { method: 'PUT', headers: { ...api.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 409 && attempt < 3) {
        // 冲突不能拿旧快照硬写：先读最新版本，交给调用方真正合并后再提交
        const cur = await api.read(path).catch(() => null);
        let nextText = text;
        if (cur && typeof opt.onConflict === 'function') {
          try { nextText = opt.onConflict(cur.text); } catch (e) { nextText = text; }
        }
        return api.write(path, nextText, msg, cur && cur.sha, opt, attempt + 1);
      }
      if (!r.ok) { let t = ''; try { t = (await r.json()).message || ''; } catch (e) { } throw Object.assign(new Error(t || ('HTTP ' + r.status)), { status: r.status }); }
      return r.json();
    }
  };
  /* ---------- 题库纠错覆盖层（fixes.json，全设备生效） ---------- */
  let FIXES = {};
  const SUBJ_TY = t => /填空|名词|问答|简答|论述|计算/.test(t || '');
  function baseOf(q) {
    if (!q.__base) q.__base = { ans: q.ans, correct: q.correct, pts: (q.pts || []).slice(), stem: q.stem };
    return q.__base;
  }
  function applyFix(q) {
    const b = baseOf(q);
    q.ans = b.ans; q.correct = b.correct; q.pts = b.pts.slice(); q.stem = b.stem;
    const f = FIXES[q.id]; if (!f) return;
    if (typeof f.s === 'string' && f.s) q.stem = f.s;
    if (f.s) q.__dn = undefined;
    if (f.c) q.correct = f.c;
    if (typeof f.a === 'string') q.ans = f.a.indexOf('｜考点') >= 0 ? f.a : (f.a + (q.kp ? '｜考点：' + q.kp : ''));
    if (Array.isArray(f.pts)) q.pts = f.pts.slice();
  }
  function applyFixes() { (window.QBANK || []).forEach(applyFix); S._memo = null; if (typeof rebuildHay === 'function') rebuildHay(); }
  /* 先用本机缓存（0 网络、0 等待），再后台拉最新；不阻塞首屏 */
  function applyFixesCache() {
    FIXES = loadJSON('qb.fixes', null) || {};
    applyFixes();
  }
  function mergeFixObjects(a, b) {
    const out = {};
    const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    ids.forEach(id => {
      const x = (a || {})[id], y = (b || {})[id];
      if (!x) { out[id] = y; return; }
      if (!y) { out[id] = x; return; }
      out[id] = ((y.ts || 0) > (x.ts || 0)) ? y : x;     // 时间新的胜出（Pages 部署有延迟，不会把新改动打回去）
    });
    return out;
  }
  async function fetchFixFile(url) {
    try {
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 6000);
      const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
      clearTimeout(tm);
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j === 'object') ? j : null;
    } catch (e) { return null; }
  }
  async function loadFixesRemote(quiet) {
    const viaApi = S.token ? api.read('fixes.json').then(f => f ? JSON.parse(f.text) : null).catch(() => null) : Promise.resolve(null);
    const [viaPages, viaRaw, viaDirect] = await Promise.all([
      fetchFixFile('./fixes.json?t=' + now()),
      fetchFixFile(api.raw('fixes.json') + '?t=' + now()),
      viaApi
    ]);
    const merged = mergeFixObjects(mergeFixObjects(mergeFixObjects(FIXES, viaPages || {}), viaRaw || {}), viaDirect || {});
    if (JSON.stringify(merged) !== JSON.stringify(FIXES)) {
      FIXES = merged; saveJSON('qb.fixes', FIXES); applyFixes(); if (!quiet && S.view) render();
    }
  }

  /* ---------- 重复题去重（全库同题干只留一版） ---------- */
  // 归一化：空号 (1)(28) 统一、分值不计、标点空白忽略
  const dupNorm = t => String(t == null ? '' : t)
    .replace(/[（(]\s*\d+\s*分\s*[)）]/g, '')
    .replace(/[（(]\s*\d+\s*[)）]/g, '#')
    .replace(/[\s\u3000（）()【】\[\]，,。.、；;：:？?！!“”"'’‘\-—_/\\]/g, '')
    .toLowerCase();
  const normOf = q => (q.__dn === undefined ? (q.__dn = dupNorm(q.stem)) : q.__dn);   // 每题只算一次
  const qclass = q => (q.ty === '选择' || q.ty === '单选' || q.ty === '多选') ? 'sel' : q.ty === '填空' ? 'fill' : q.ty === '判断' ? 'judge' : q.ty === '名词' ? 'noun' : 'subj';
  let DUP_CACHE = {};
  let DUPG = null, DUPG_BY_ID = new Map();     // dupgroups.json：人工/离线核对过的同题分组
  function clearDupCache() { DUP_CACHE = {}; }
  function applyDupGroups(o) {
    if (!o || !o.groups) return false;
    DUPG = o; DUPG_BY_ID = new Map();
    o.groups.forEach(g => (g.ids || []).forEach(id => DUPG_BY_ID.set(id, g)));
    return true;
  }
  function loadDupGroupsCache() {
    applyDupGroups(window.DUPGROUPS || loadJSON('qb.dupg', null));   // 随 questions.js 同步加载，避免去重时还没拉到分组
    if (window.DUPGROUPS) saveJSON('qb.dupg', window.DUPGROUPS);
  }
  function pruneHiddenByGroups() {
    if (!DUPG || !DUPG.groups) return;
    const allow = new Set();
    DUPG.groups.forEach(g => { if (!g.cross && !g.sus) g.ids.forEach(id => allow.add(id)); });
    const kept = [...HIDDEN].filter(id => allow.has(id));
    if (kept.length !== HIDDEN.size) {
      HIDDEN = new Set(kept); saveJSON('qb.dedup', { hidden: kept, updated: now() }); applyDedup();
    }
  }
  function detectDups(includeNoun) {
    const groups = [];
    if (DUPG && DUPG.groups) {
      DUPG.groups.forEach(g => {
        const items = (g.ids || []).map(id => BYID[id]).filter(Boolean);
        if (items.length < 2) return;
        if (g.cross) return;                       // 跨题型（选择 vs 填空）不算重复
        if (g.cls === 'noun' && !includeNoun) return;
        if (g.sus) return;                         // 题干同但选项差异大：疑似题，不自动隐藏
        groups.push({ key: g.k + '|' + g.ids[0], items, cls: g.cls });
      });
    } else {
      const map = new Map();
      ALLQ.forEach(q => {
        if (!includeNoun && q.ty === '名词') return;
        const k = normOf(q); if (!k || k.length < 6) return;
        const kk = qclass(q) + '|' + k;            // 兜底也不跨题型合并
        if (!map.has(kk)) map.set(kk, []);
        map.get(kk).push(q);
      });
      map.forEach((list, k) => { if (list.length > 1) groups.push({ key: k, items: list }); });
    }
    groups.sort((a, b) => b.items.length - a.items.length);
    return groups;
  }
  function dupInfo(includeNoun) {
    const key = includeNoun ? 'on' : 'off';
    if (DUP_CACHE[key]) return DUP_CACHE[key];
    const g = detectDups(includeNoun);
    DUP_CACHE[key] = { groups: g, extra: g.reduce((n, x) => n + x.items.length - 1, 0) };
    return DUP_CACHE[key];
  }
  function isHidden(id) { return HIDDEN.has(id); }
  function applyDedup() {
    clearDupCache();
    const keep = ALLQ.filter(q => !HIDDEN.has(q.id));
    BANK.length = 0; keep.forEach(q => BANK.push(q));
    S._memo = null;
    if (typeof rebuildHay === 'function') rebuildHay();
  }
  function loadDedupCache() {
    const d = loadJSON('qb.dedup', null) || {};
    HIDDEN = new Set(d.hidden || []);
    applyDedup();
  }
  async function loadDedupRemote(quiet) {
    const viaApi = S.token ? api.read('dedup.json').then(f => f ? JSON.parse(f.text) : null).catch(() => null) : Promise.resolve(null);
    const [a, b, c] = await Promise.all([fetchFixFile('./dedup.json?t=' + now()), fetchFixFile(api.raw('dedup.json') + '?t=' + now()), viaApi]);
    const objs = [a, b, c].filter(Boolean);
    const local = loadJSON('qb.dedup', {}) || {};
    // 别的设备点过「关闭去重」：远端 off 且比本地新，就以远端为准清空
    let off = null;
    objs.forEach(o => { if (o.off && (!off || (o.updated || 0) > (off.updated || 0))) off = o; });
    if (off && (off.updated || 0) > (local.updated || 0)) {
      HIDDEN = new Set(); saveJSON('qb.dedup', { hidden: [], updated: off.updated, off: true });
      applyDedup(); if (!quiet && S.view) render(); return;
    }
    const latestUp = objs.reduce((n, o) => Math.max(n, o.updated || 0), 0);
    // 本机较新地“关闭去重”时，不能被别的设备旧 hidden 列表又打开
    if (local.off && (local.updated || 0) >= latestUp) return;
    const list = objs.reduce((arr, o) => arr.concat(o.hidden || []), []);
    if (!list.length) return;
    let changed = false;
    list.forEach(id => { if (!HIDDEN.has(id)) { HIDDEN.add(id); changed = true; } });
    if (changed) { saveJSON('qb.dedup', { hidden: [...HIDDEN], updated: now() }); applyDedup(); if (!quiet && S.view) render(); }
  }
  function saveDedup(reset) {
    const payload = { hidden: [...HIDDEN], updated: now(), off: !!reset };
    saveJSON('qb.dedup', payload);           // 本地即时生效
    applyDedup();
    if (S.token) syncDedup(payload, reset);  // 网络写回放后台，不挡界面
  }
  async function syncDedup(payload, reset) {
    try {
      const cur = await api.read('dedup.json');
      let remote = {};
      if (cur && cur.text) { try { remote = JSON.parse(cur.text) || {}; } catch (e) { remote = {}; } }
      const merged = reset ? payload.hidden : [...new Set([...(remote.hidden || []), ...payload.hidden])];
      payload.hidden = merged;
      const onConflict = latest => {
        let r = {}; try { r = JSON.parse(latest) || {}; } catch (e) { }
        const h = reset ? payload.hidden : [...new Set([...(r.hidden || []), ...payload.hidden])];
        payload.hidden = h;
        return JSON.stringify(payload, null, 1);
      };
      await api.write('dedup.json', JSON.stringify(payload, null, 1), 'dedup: 隐藏重复题 ' + merged.length + ' 条', cur && cur.sha, { onConflict });
      // 只做并集，不反向改本地：避免把本机刚关掉的状态拉回来
    } catch (e) { toast('同步失败：' + ((e && e.message) || '未知错误')); }
  }

  /* ---------- 共享笔记（跨用户可见，随日志同步） ---------- */
  let NOTES = {};
  function noteKey(n) { return (n.u || ''); }                 // 每人每题只保留最新一条
  function mergeNotes(a, b) {
    const out = {};
    const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    ids.forEach(id => {
      if (id === '__del') return;
      const map = new Map();
      const add = n => {
        if (!n) return;
        const k = noteKey(n); const cur = map.get(k);
        if (!cur || (n.ts || 0) > (cur.ts || 0) || ((n.ts || 0) === (cur.ts || 0) && n.del && !cur.del)) map.set(k, n);
      };
      ((a || {})[id] || []).forEach(add);
      ((b || {})[id] || []).forEach(add);
      const list = Array.from(map.values()).sort((x, y) => (x.ts || 0) - (y.ts || 0));
      if (list.length) out[id] = list;
    });
    return out;
  }
  function visibleNotes(id) { return (NOTES[id] || []).filter(n => !n.del); }
  function applyNotesCache() { NOTES = loadJSON('qb.notes', null) || {}; }
  async function loadNotesRemote(quiet) {
    const viaApi = S.token ? api.read('notes.json').then(f => f ? JSON.parse(f.text) : null).catch(() => null) : Promise.resolve(null);
    const [viaPages, viaRaw, viaDirect] = await Promise.all([
      fetchFixFile('./notes.json?t=' + now()),
      fetchFixFile(api.raw('notes.json') + '?t=' + now()),
      viaApi
    ]);
    const merged = mergeNotes(mergeNotes(mergeNotes(NOTES, viaPages || {}), viaRaw || {}), viaDirect || {});
    if (JSON.stringify(merged) !== JSON.stringify(NOTES)) {
      NOTES = merged; saveJSON('qb.notes', NOTES); if (!quiet && S.view) render();
    }
  }

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
  function blankRec(u) { return { u, updated: 0, progress: {}, fav: [], favTs: {}, favDel: {}, sessions: [], mem: {}, brk: null }; }
  function loadRec(u) {
    let r = loadJSON(LS.rec(u), null);
    if (!r) {
      const bad = loadJSON(LS.rec('"' + u + '"'), null);
      if (bad) { r = bad; saveJSON(LS.rec(u), r); localStorage.removeItem(LS.rec('"' + u + '"')); }
    }
    S.rec = r || blankRec(u);
    S.rec.fav = S.rec.fav || []; S.rec.progress = S.rec.progress || {}; S.rec.sessions = S.rec.sessions || [];
    S.rec.favTs = S.rec.favTs || {}; S.rec.favDel = S.rec.favDel || {}; S.rec.mem = S.rec.mem || {};
    S.rec.fav.forEach(id => { if (S.rec.favTs[id] === undefined) S.rec.favTs[id] = 0; });
    // 旧版本把背名词熟练度单独存在 qb.mem.<用户>，迁移进记录并清理
    const legacyMem = loadJSON(LS.mem(u), null);
    if (legacyMem && typeof legacyMem === 'object') {
      Object.keys(legacyMem).forEach(k => {
        const v = legacyMem[k], cur = S.rec.mem[k];
        if (v && (!cur || (v.ts || 0) > (cur.ts || 0))) S.rec.mem[k] = { r: v.r || '', ts: v.ts || 0 };
      });
      localStorage.removeItem(LS.mem(u));
    }
    S.mem = S.rec.mem;
  }
  function adoptRec(rec, u) {
    if (u && u !== S.user) return false;          // 用户已切走：不要把上一个用户的记录塞给新用户
    S.rec = rec;
    S.mem = S.rec.mem || (S.rec.mem = {});
    S._memo = null;                       // 进度/背名词变了，派生缓存作废
    saveJSON(LS.rec(S.user), S.rec);
    return true;
  }
  function afterRemoteRec() {
    S.mem = S.rec.mem || (S.rec.mem = {});
    if (S.view !== 'quiz') loadSess(S.user);          // 别的设备的断点也能出现在“继续上次”
    const sh = $('sheet');
    if (S.view && S.view !== 'quiz' && !(sh && sh.classList.contains('show'))) render();
  }
  function saveMem() { if (S.user) saveRec(); }
  function pendKey(u) { return 'qb.pend.' + (u || ''); }
  function saveRec() {
    S.rec.updated = now();
    saveJSON(LS.rec(S.user), S.rec);
    S._dirty = true;
    S._rev = (S._rev || 0) + 1;
    if (S.user) saveJSON(pendKey(S.user), 1);
    scheduleSync();
  }
  function saveSess() {
    if (!S.user || S.ephemeral || S.view !== 'quiz' || !S.queue || !S.queue.length) return;
    const payload = { t: now(), filter: { ...S.filter }, idx: S.idx, ids: S.queue.map(q => q.id) };
    saveJSON(LS.sess(S.user), payload);
    S.rec.brk = payload; S.snap = payload; saveRec();   // 断点跟着记录同步，换设备可续刷
  }
  function clearSess() {
    if (S.user) localStorage.removeItem(LS.sess(S.user));
    S.snap = null;
    // 断点也要有“删除”语义：空值会把别的设备的旧断点又合并回来
    if (S.rec) { S.rec.brk = { t: now(), cleared: true }; saveRec(); }
  }
  function loadSess(u) {
    const local = loadJSON(LS.sess(u), null);
    const remote = (S.rec && S.rec.brk) || null;
    S.snap = !local ? remote : !remote ? local : ((local.t || 0) >= (remote.t || 0) ? local : remote);
  }
  function snapInfo() {
    const s = S.snap; if (!s || s.cleared || !s.ids || !s.ids.length) return null;
    if (s.idx >= s.ids.length) return null;
    return s;
  }
  function mergeRec(local, remote) {
    const out = blankRec(local.u || remote.u);
    out.sessions = (local.sessions || []).slice();
    (remote.sessions || []).forEach(rs => { if (!out.sessions.some(x => x.t === rs.t)) out.sessions.push(rs); });
    out.sessions.sort((a, b) => a.t - b.t);
    if (out.sessions.length > 300) out.sessions = out.sessions.slice(-300);
    out.favTs = { ...(remote.favTs || {}) }; Object.entries(local.favTs || {}).forEach(([k, v]) => { if ((v || 0) > (out.favTs[k] || 0)) out.favTs[k] = v; });
    out.favDel = { ...(remote.favDel || {}) }; Object.entries(local.favDel || {}).forEach(([k, v]) => { if ((v || 0) > (out.favDel[k] || 0)) out.favDel[k] = v; });
    out.fav = Array.from(new Set([...(local.fav || []), ...(remote.fav || [])]))
      .filter(id => !(out.favDel[id] && out.favDel[id] > (out.favTs[id] || 0)));   // 只有“删除时间晚于收藏时间”才删；老数据无收藏时间时保留
    out.progress = { ...(remote.progress || {}) };
    Object.entries(local.progress || {}).forEach(([k, v]) => {
      const r = out.progress[k];
      // 一律以最后评定的时间戳为准；n 只用于同一毫秒下的兜底
      if (!r || (v.ts || 0) > (r.ts || 0) || ((v.ts || 0) === (r.ts || 0) && (v.n || 0) > (r.n || 0))) out.progress[k] = v;
    });
    out.mem = { ...(remote.mem || {}) };
    Object.entries(local.mem || {}).forEach(([k, v]) => { const cur = out.mem[k]; if (!cur || (v && (v.ts || 0) > (cur.ts || 0))) out.mem[k] = v; });
    const lb = local.brk, rb = remote.brk;
    out.brk = !lb ? rb : !rb ? lb : ((lb.t || 0) >= (rb.t || 0) ? lb : rb);
    out.updated = Math.max(local.updated || 0, remote.updated || 0);
    return out;
  }
  async function pullFromRepo(u, silent) {
    LAST_PULL = now();
    const path = `logs/${encodeURIComponent(u)}.json`;
    try {
      const f = await api.read(path);
      if (!f) { if (!silent) toast('远端暂无该用户日志'); return; }
      if (S.user !== u) return;                  // 切用户后才回来的响应，直接丢弃
      const remote = JSON.parse(f.text);
      const before = JSON.stringify(S.rec);
      const merged = mergeRec(S.rec, remote);
      const changed = JSON.stringify(merged) !== before;
      if (!adoptRec(merged, u)) return;
      if (changed) afterRemoteRec();
      if (S._dirty) { setSync('pending', '远端已更新，本机改动待写入'); scheduleSync(); }
      else setSync('ok', S.token ? '已同步 ' + hhmm(now()) : '已读取远端');
    } catch (e) {
      setSync('fail', '读取失败：' + e.message);
    }
  }
  function scheduleSync() {
    if (!S.token || !S.user) { setSync(S.token ? 'idle' : 'off', S.token ? '待同步' : '仅本地'); return; }
    setSync('pending', '有改动，等待写入');
    clearTimeout(S._syncTimer);
    S._syncTimer = setTimeout(pushToRepo, 1500);
  }
  async function pushToRepo() {
    if (!S.token || !S.user) return;
    if (S._syncing) { S._dirty = true; return; }   // 正在写：记下“写完还要再写一次”，不能直接丢掉
    S._syncing = true; setSync('sync', '正在写入仓库…');
    const user = S.user;
    const rev = S._rev || 0;
    const path = `logs/${encodeURIComponent(user)}.json`;
    let success = false;
    try {
      const cur = await api.read(path);
      if (S.user !== user) return;               // 用户已切换：这次写入作废
      // 推送前先与远端合并，避免旧设备用空数据覆盖别的设备的收藏/熟练度/断点
      if (cur && cur.text) { try { adoptRec(mergeRec(S.rec, JSON.parse(cur.text)), user); } catch (e) { } }
      const idxOnConflict = latest => {
        let old = []; try { old = JSON.parse(latest).users || []; } catch (e) { }
        return JSON.stringify({ users: Array.from(new Set([...allUsers(), ...old])).filter(Boolean) });
      };
      const pushIndex = async () => {
        try {
          const idxCur = await api.read('logs/index.json');
          await api.write('logs/index.json', JSON.stringify({ users: allUsers() }), 'log index update', idxCur && idxCur.sha, { onConflict: idxOnConflict });
        } catch (e) { }   // 索引只是用户列表，失败不影响主记录
      };
      const body = JSON.stringify(S.rec, null, 0);
      if (cur && cur.text === body) {
        success = true;
        if (rev === (S._rev || 0)) { S._dirty = false; localStorage.removeItem(pendKey(user)); }
        S._retryN = 0;
        setSync('ok', '已同步 ' + hhmm(now()));
        await pushIndex();
        return;
      }
      const onConflict = latest => {
        // 409：别的设备刚写过，把最新远端再合并进来，而不是拿旧快照覆盖
        try { adoptRec(mergeRec(S.rec, JSON.parse(latest)), user); return JSON.stringify(S.rec); }
        catch (e) { return body; }
      };
      await api.write(path, body, `log: ${user} ${new Date().toISOString().slice(0, 16)}`, cur && cur.sha, { onConflict });
      await pushIndex();
      success = true; S._retryN = 0;
      if (rev === (S._rev || 0)) { S._dirty = false; localStorage.removeItem(pendKey(user)); }
      setSync('ok', '已同步 ' + hhmm(now()));
    } catch (e) {
      S._dirty = true;
      if (e.code === 'no_token') setSync('off', '仅本地');
      else {
        setSync('fail', e.message + (syncErrText(e) ? '\n' + syncErrText(e) : ''));
        if ((!e.status || e.status >= 500) && (S._retryN || 0) < 3) {
          // 网络/服务端抖动：退避补推 3 次，避免离线时无限重试耗电
          const delay = [8000, 20000, 45000][S._retryN || 0];
          S._retryN = (S._retryN || 0) + 1;
          clearTimeout(S._retryTimer);
          S._retryTimer = setTimeout(pushToRepo, delay);
        }
      }
    } finally {
      const switched = (S.user !== user);
      S._syncing = false;
      if ((success || switched) && S._dirty) { clearTimeout(S._syncTimer); S._syncTimer = setTimeout(pushToRepo, 300); }
    }
  }
  function syncErrText(e) {
    const st = e.status, m = e.message || '';
    if (st === 401) return '提示：令牌无效或已被删除，请重新生成（需勾选 877-biochem，Contents 读写）';
    if (st === 403) return '提示：令牌权限不足，需 Contents: Read and write';
    if (st === 404) return '提示：仓库或用户目录不存在，检查仓库名 owner/repo';
    if (st === 409) return '提示：多设备同时写入，已自动合并；如仍失败请点刷新后再试';
    if (/Failed to fetch|network/i.test(m)) return '提示：网络不通，稍后重试';
    return '';
  }
  function setSync(st, msg) {
    S.sync = { state: st, msg: msg || '', at: now() };
    if (st === 'ok') { S.syncAt = now(); S.syncErr = ''; }
    if (st === 'fail') S.syncErr = msg || '';
    const dot = $('syncDot'); if (dot) { const c = st === 'ok' ? 'ok' : st === 'off' ? 'off' : 'warn'; dot.className = 'dot ' + c; dot.title = msg || ''; }
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
  async function flushThenSwitch(u) {
    const old = S.user;
    if (S.token && old && old !== u && S._dirty) {
      await Promise.race([pushToRepo(), new Promise(r => setTimeout(r, 2500))]);
    }
    setUser(u);
  }
  function setUser(u, silent) {
    S.user = u; localStorage.setItem(LS.cur, u);
    clearTimeout(S._syncTimer); clearTimeout(S._retryTimer);
    S._dirty = false; S._rev = 0;
    const users = allUsers(); if (!users.includes(u)) { users.push(u); saveJSON(LS.users, users); }
    loadRec(u); loadSess(u); updateUserName(); render();
    if (loadJSON(pendKey(u), 0)) { S._dirty = true; if (S.token) scheduleSync(); }   // 上次没写回的改动，继续补推
    if (!silent && S.token) pullFromRepo(u, true);
    else if (!S.token) setSync('off', '仅本地（未配置令牌）');
  }
  function updateUserName() { const el = $('userName'); if (el) el.textContent = S.user || '未选择'; }

  /* ---------- filtering ---------- */
  function tpGroup(q) {
    const t = q.ty || '';
    if (t.indexOf('名词') === 0) return '名词';
    if (t.indexOf('问答') === 0 || t.indexOf('简答') === 0 || t.indexOf('计算') === 0 || t.indexOf('论述') === 0) return '大题';
    if (t.indexOf('选择') === 0 || t.indexOf('单选') === 0 || t.indexOf('多选') === 0) return '选择';
    if (t.indexOf('判断') === 0) return '判断';
    if (t.indexOf('填空') === 0) return '填空';
    return '其他';
  }
  function scopeLabel() {
    const f = S.filter;
    const ch = f.chap ? (CHS.find(c => c.id === f.chap) || {}).name : '全部章节';
    const kp = f.kp ? f.kp : '全部考点';
    const sc = { all: '全部题', weak: '未掌握', forgot: '只刷忘记', vague: '模糊待巩固', fav: '收藏' }[f.scope];
    return { ch, kp, sc, tp: f.tp };
  }
  function buildQueue() { return buildQueueWith(S.filter); }
  function buildQueueWith(f) {
    const prog = S.rec.progress, fav = S.rec.fav;
    let list = BANK.filter(q => {
      if (f.tp && tpGroup(q) !== f.tp) return false;
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
    if (S.tab === 'quiz') v.innerHTML = S.view === 'quiz' ? quizHTML() : S.view === 'summary' ? summaryHTML() : S.view === 'lists' ? listHTML() : S.view === 'memo' ? memHTML() : setupHTML();
    if (S.tab === 'weak') v.innerHTML = weakHTML();
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
    if (S.tab === 'weak') { t.textContent = '薄弱考点'; s.textContent = '按小知识点统计掌握情况'; return; }
    if (S.view === 'quiz') { t.textContent = '刷题中'; s.textContent = `${S.idx + 1} / ${S.queue.length} · ${S.custom || ((S.filter.tp ? S.filter.tp + ' · ' : '') + esc(shortName(scopeLabel().ch)) + (S.filter.kp ? ' · ' + S.filter.kp : ''))}`; return; }
    if (S.view === 'memo') { const gs = memoGroups(); t.textContent = '背名词解释'; s.textContent = `${gs.length} 个词条 · ${BANK.filter(q => q.ty === '名词').length} 道真题 · 不计入进度`; return; }
    if (S.view === 'lists') { const c = listQueue(S.listKind); t.textContent = LIST_NAME[S.listKind] || '题单'; s.textContent = `${c.length} 题 · 点题目开始刷`; return; }
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
    const TP_ORDER = ['名词', '大题', '选择', '判断', '填空'];
    const tpCnt = {}; BANK.forEach(q => { const g = tpGroup(q); tpCnt[g] = (tpCnt[g] || 0) + 1; });
    const tpChips = [`<button class="chip ${!f.tp ? 'on' : ''}" data-act="tp" data-v="">全部<span class="n">${BANK.length}</span></button>`]
      .concat(TP_ORDER.map(t => `<button class="chip ${f.tp === t ? 'on' : ''}" data-act="tp" data-v="${t}">${t}${t === '名词' ? '解释' : t === '大题' ? '（问答·计算）' : ''}<span class="n">${tpCnt[t] || 0}</span></button>`)).join('');
    const chName = f.chap ? shortName(((CHS.find(c => c.id === f.chap)) || {}).name || '') : '全部章节';
    const foldHead = (k, title, summary) => `<button class="foldh" data-act="fold" data-v="${k}">
      <span class="foldt">${title}</span><span class="folds">${esc(summary)}</span><i class="caret ${S.fold[k] ? '' : 'open'}">▾</i></button>`;
    const scopes = [['all', '全部题'], ['weak', '未掌握'], ['forgot', '只刷忘记'], ['vague', '模糊待巩固'], ['fav', '我的收藏']];
    const scopeChips = scopes.map(([v, t]) => `<button class="chip ${f.scope === v ? 'on' : ''}" data-act="scope" data-v="${v}">${t}</button>`).join('');
    const cnt = buildQueue().length;
    const p = S.rec.progress;
    const known = Object.values(p).filter(x => x.r === 'known').length;
    const sn = snapInfo();
    const snapCard = sn ? `<div class="card" style="border:1px solid var(--pri);background:linear-gradient(180deg,#f0fdfa,#fff)">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="h1" style="margin:0">继续上次</div>
        <div class="muted" style="margin-top:4px">${esc((sn.filter && sn.filter.chap ? shortName(((CHS.find(c => c.id === sn.filter.chap)) || {}).name || '') : '全部章节'))}${sn.filter && sn.filter.kp ? ' · ' + esc(sn.filter.kp) : ''}<br>停在第 ${sn.idx + 1} / ${sn.ids.length} 题 · ${new Date(sn.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div></div>
        <div class="badge pri">${sn.ids.length - sn.idx} 题待刷</div>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn" style="flex:2" data-act="resume">继续刷（第 ${sn.idx + 1} 题）</button>
        <button class="btn ghost" style="flex:1" data-act="dropSess">不继续</button>
      </div>
    </div>` : '';
    const doneN = Object.keys(p).length;
    const forgotN = Object.values(p).filter(x => x.r === 'forgot').length;
    const pct = Math.round(doneN / BANK.length * 100);
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const todayN = Object.values(p).filter(x => x.ts && new Date(x.ts) >= d0).length;
    const memoN = memoGroups().length;
    const tiles = [['fav', '收藏', '#b45309'], ['forgot', '忘记', '#c2410c'], ['vague', '模糊', '#b45309'], ['known', '熟悉', '#0f766e'], ['weak', '未掌握', '#5b636e']];
    return `
    <div class="hero">
      <div class="hero-row">
        <div><div class="hero-t">生物化学 · 刷题台</div><div class="hero-s">${BANK.length - known} 题未掌握 · 今日已练 ${todayN} 题</div></div>
        <div class="hero-right">
          <button class="refb" data-act="refresh" aria-label="刷新所有状态"><i>↻</i><span>刷新</span></button>
          <div class="hero-ring" style="--p:${pct}"><b>${pct}%</b><span>已练</span></div>
        </div>
      </div>
      <div class="hstats">
        <button class="hstat" data-act="listOpen" data-v="done"><b>${doneN}</b><span>已练</span></button>
        <button class="hstat" data-act="listOpen" data-v="fav"><b>${S.rec.fav.length}</b><span>收藏</span></button>
        <button class="hstat" data-act="listOpen" data-v="known"><b>${known}</b><span>熟悉</span></button>
        <button class="hstat warn" data-act="listOpen" data-v="forgot"><b>${forgotN}</b><span>待复盘</span></button>
      </div>
    </div>
    <div class="quick">
      <button class="qcard" data-act="memo">
        <div class="qt">背名词解释</div>
        <div class="qn">${memoN}<span>词条</span></div>
        <div class="qn sub">熟悉 ${memStat().st.known} · 薄弱 ${memStat().st.forgot + memStat().st.vague}</div>
      </button>
      <button class="qcard" data-act="searchSheet">
        <div class="qt">搜题</div>
        <div class="qn">${BANK.length}<span>题</span></div>
        <div class="qn sub">题干 · 答案 · 考点</div>
      </button>
    </div>
    ${snapCard}
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div><div class="h1" style="margin:0">选范围</div>
        <div class="muted" style="margin-top:4px">题型、章节、考点可叠加，选完直接开刷</div></div>
        <div class="badge pri">${cnt} 题</div>
      </div>
      <div class="filterset">
        ${foldHead('tp', '按题型', f.tp || '全部')}
        ${S.fold.tp ? '' : `<div class="foldbody">${tpChips}</div>`}
        ${foldHead('chap', '按章节', chName)}
        ${S.fold.chap ? '' : `<div class="foldbody">${chapChips}</div>`}
        ${foldHead('kp', '按考点', f.chap ? (f.kp || '全部考点') : '先选章节')}
        ${S.fold.kp || !f.chap ? '' : `<div class="foldbody">${kpChips}</div>`}
      </div>
      <div class="section-label">掌握程度</div>
      <div class="row wrap">${scopeChips}</div>
      <div class="section-label">出题顺序</div>
      <div class="seg">
        <button class="segbtn ${f.order === 'seq' ? 'on' : ''}" data-act="order" data-v="seq">按年份</button>
        <button class="segbtn ${f.order === 'random' ? 'on' : ''}" data-act="order" data-v="random">随机</button>
      </div>
      <div class="duprow">
        <div>
          <div class="duptitle">重复题去重 <span class="badge" style="${HIDDEN.size ? 'background:var(--pri-weak);color:var(--pri)' : 'background:#f2f4f6;color:var(--tx2)'}">${HIDDEN.size ? '已开启' : '未开启'}</span></div>
          <div class="dupdesc">${HIDDEN.size ? `隐藏 ${HIDDEN.size} 条 · 现有 ${BANK.length} 题 · 名词解释未动` : `${dupInfo(false).groups.length} 组重复 · 开启后留最早年份，隐藏 ${dupInfo(false).extra} 条`}</div>
        </div>
        <button class="switch ${HIDDEN.size ? 'on' : ''}" data-act="dupToggle" aria-label="重复题去重"><i></i></button>
      </div>
      <button class="linkbtn" data-act="dedupOpen" style="margin-top:6px">逐组查看、改留哪一条 ›</button>
      <button class="btn block ctabtn" data-act="start" ${cnt ? '' : 'disabled style="opacity:.45"'}>开始刷题（${cnt}）</button>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="h1" style="margin:0">我的题单</div>
        <div class="muted" style="margin-top:4px">点进任意清单，按清单直接刷</div></div>
      </div>
      <div class="tiles">
        ${tiles.map(([k, n, c]) => `<button class="tile" data-act="listOpen" data-v="${k}" style="--c:${c}"><b>${listQueue(k).length}</b><span>${n}</span></button>`).join('')}
      </div>
    </div>
    <div class="hintline">选择题点选项即判；判断题选对/错；填空与主观题答案分要点遮盖，点一下显示一块。</div>`;
  }
  function shortName(n) { return n.replace(/^第[一二三四五六七八九十]+章\s*/, ''); }

  /* ----- 搜题 ----- */
  const normTxt = t => String(t == null ? '' : t).toLowerCase().replace(/[\s\u3000]+/g, '');
  /* 答案里带序号的分点，显示时自动换行（题库文本是单行存储的） */
  function fmtAnsText(t) {
    let x = String(t == null ? '' : t).replace(/\r/g, '');
    if (x.indexOf('\n') >= 0) return x;
    const re = /(\(\d{1,2}\)|（\d{1,2}）|[①②③④⑤⑥⑦⑧⑨⑩]|\([a-d]\)|（[a-d]）)/g;
    const hits = x.match(re) || [];
    if (hits.length < 2) return x;
    return x.replace(re, (m, _g, off) => (off > 0 ? '\n' + m : m));
  }

  function haystack(q) {
    return normTxt([q.stem, (q.opts || []).join(' '), q.ans, q.kp, q.kpnote, q.y + '年', q.id, q.chname].join(' '));
  }
  let HAY = [];
  function rebuildHay() { HAY = BANK.map(q => ({ q, h: haystack(q) })); }
  rebuildHay();
  function searchResults() {
    const kw = normTxt(S.sw);
    if (!kw) return [];
    const terms = String(S.sw || '').toLowerCase().split(/[\s\u3000]+/).map(normTxt).filter(Boolean);
    return HAY.filter(x => (kw && x.h.indexOf(kw) >= 0) || terms.every(t => x.h.indexOf(t) >= 0)).map(x => x.q);
  }
  function snippet(q, kw) {
    const s = q.stem || '';
    const t = (kw || '').trim().toLowerCase();
    const k = t && t.split(/\s+/)[0] ? s.toLowerCase().indexOf(t.split(/\s+/)[0]) : -1;
    if (s.length <= 46 || k < 0) return s.length <= 46 ? s : s.slice(0, 46) + '…';
    const st = Math.max(0, k - 12);
    return (st ? '…' : '') + s.slice(st, st + 46) + (st + 46 < s.length ? '…' : '');
  }
  function searchHTML() {
    if (!S.sw.trim()) return `<div class="muted" style="margin-top:10px">支持题干、选项、答案、考点、年份；多个词用空格分隔，需同时命中。</div>`;
    const rs = searchResults();
    if (!rs.length) return `<div class="muted" style="margin-top:10px">没搜到，换个词试试（如“操纵子”“β-氧化”）</div>`;
    const show = rs.slice(0, 40);
    return `<div class="row" style="justify-content:space-between;margin:10px 0 8px">
      <span class="muted">命中 ${rs.length} 题${rs.length > 40 ? '（显示前 40）' : ''}</span>
      <button class="chip on" data-act="brushRes">刷这 ${rs.length} 题</button></div>
      <div class="slist">${show.map(q => `<button class="srow" data-act="openq" data-v="${esc(q.id)}">
        <div class="st"><span class="sid">${q.y}·${esc(q.ty)}${esc(q.num)}</span>${esc(snippet(q, S.sw))}</div>
        <div class="sk">${esc(shortName(q.chname))} · ${esc(q.kp)}</div></button>`).join('')}</div>`;
  }

  /* ----- 题单 ----- */
  function listQueue(kind) {
    const p = S.rec.progress || {}, fav = S.rec.fav || [];
    if (kind === 'fav') return BANK.filter(q => fav.includes(q.id));
    if (kind === 'all') return BANK.slice();
    if (kind === 'done') return BANK.filter(q => p[q.id]);
    if (kind === 'today') { const t0 = new Date(); t0.setHours(0, 0, 0, 0); return BANK.filter(q => p[q.id] && p[q.id].ts >= t0.getTime()); }
    if (kind === 'weak') return BANK.filter(q => !p[q.id] || p[q.id].r !== 'known');
    return BANK.filter(q => p[q.id] && p[q.id].r === kind);
  }
  function listHTML() {
    const kind = S.listKind, list = listQueue(kind);
    if (!list.length) return `<div class="card" style="text-align:center;padding:26px 16px">
      <div style="font-size:15px;color:var(--tx2)">${LIST_NAME[kind]}里还没有题</div>
      <div class="muted" style="margin:8px 0 16px">刷题时点右上角 ☆ 收藏，或做自评标记后就会出现在这里</div>
      <button class="btn block" data-act="home">返回首页</button></div>`;
    const p = S.rec.progress || {};
    // 按章节分组（顺序跟章节表一致）
    const groups = [];
    const byChap = new Map();
    list.forEach(q => { if (!byChap.has(q.chap)) { const g = { chap: q.chap, name: q.chname || q.chap, items: [] }; byChap.set(q.chap, g); groups.push(g); } byChap.get(q.chap).items.push(q); });
    const order = (CHS || []).map(c => c.id);
    groups.sort((a, b) => order.indexOf(a.chap) - order.indexOf(b.chap));
    const cur = S.listChap || '';
    const chips = `<div class="row wrap" style="gap:6px;margin:8px 0 2px">
      <button class="chip ${cur === '' ? 'on' : ''}" data-act="listChap" data-v="">全部 ${list.length}</button>
      ${groups.map(g => `<button class="chip ${cur === g.chap ? 'on' : ''}" data-act="listChap" data-v="${esc(g.chap)}">${esc(shortName(g.name))} ${g.items.length}</button>`).join('')}
    </div>`;
    const shown = cur ? groups.filter(g => g.chap === cur) : groups;
    const qrow = q => `<button class="qrow" data-act="openListQ" data-v="${esc(q.id)}">
        <div class="qh"><span class="badge pri">${esc(q.kp)}</span><span class="badge">${q.y}年 · ${esc(q.ty)}${esc(q.num)}</span>
        ${p[q.id] ? `<span class="qst ${p[q.id].r}">${RATE_TXT[p[q.id].r]}</span>` : ''}${(S.rec.fav || []).includes(q.id) ? '<span class="qstar">★</span>' : ''}</div>
        <div class="qs">${esc(q.stem.length > 60 ? q.stem.slice(0, 60) + '…' : q.stem)}</div></button>`;
    const sect = shown.map(g => {
      const folded = !!(S.listFold && S.listFold[g.chap]);
      return `<div class="chapsec">
        <div class="chaphead">
          <button class="chapname" data-act="listChapFold" data-v="${esc(g.chap)}">${folded ? '▸' : '▾'} ${esc(g.name)}<span class="k"> ${g.items.length} 题</span></button>
          <button class="chip" data-act="listChapStart" data-v="${esc(g.chap)}">刷本章</button>
        </div>
        ${folded ? '' : `<div class="card" style="padding:4px 16px">${g.items.map(qrow).join('')}</div>`}
      </div>`;
    }).join('');
    return `<div class="backrow"><button class="backbtn" data-act="back">${backLabel()}</button>
      <span class="bk-sub">${LIST_NAME[kind]} · ${list.length} 题</span></div>
      <div class="muted" style="margin:6px 4px 2px">按章节查看，点“刷本章”只刷这一章（不计入主进度）</div>
      ${chips}
      <div style="margin-top:10px">${sect}</div>`;
  }
  /* ----- 薄弱考点 ----- */
  function kpStats() {
    const p = S.rec.progress || {};
    return KPS.map(k => {
      const qs = BANK.filter(q => q.ch === k.ch && q.kp === k.kp);
      let f = 0, v = 0, kn = 0;
      qs.forEach(q => { const st = p[q.id]; if (!st) return; if (st.r === 'forgot') f++; else if (st.r === 'vague') v++; else if (st.r === 'known') kn++; });
      const t = qs.length, u = t - f - v - kn;
      const weak = t ? (f * 3 + v * 2 + u) / t : 0;
      return { ...k, t, f, v, kn, u, weak, ids: qs.map(q => q.id) };
    });
  }
  function weakHTML() {
    const p = S.rec.progress || {};
    const done = Object.keys(p).length;
    if (!done) return `<div class="card" style="text-align:center;padding:26px 16px">
      <div style="font-size:15px;color:var(--tx2)">还没有答题记录</div>
      <div class="muted" style="margin:8px 0 16px">先刷几题，这里会按考点告诉你哪块最薄弱</div>
      <button class="btn block" data-act="toSetup">去刷题</button></div>`;
    let forgot = 0, vague = 0, known = 0;
    Object.values(p).forEach(x => { if (x.r === 'forgot') forgot++; else if (x.r === 'vague') vague++; else if (x.r === 'known') known++; });
    const rate = Math.round(known / BANK.length * 100);
    const st = kpStats().filter(k => k.t).sort((a, b) => b.weak - a.weak);
    const top = st.filter(k => k.weak > 0).slice(0, 20);
    const chapName = id => shortName(((CHS.find(c => c.id === id)) || {}).name || id);
    const rows = top.map((k, i) => {
      const wf = Math.round(k.f / k.t * 100), wv = Math.round(k.v / k.t * 100), wk = Math.round(k.kn / k.t * 100);
      return `<div class="wrow">
        <div class="whead"><div class="wname">${i < 3 ? '<span class="wtag">重点</span>' : ''}${esc(k.kp)}</div>
          <button class="chip" data-act="weakKp" data-v="${esc(k.ch)}|${esc(k.kp)}">刷</button></div>
        <div class="wmeta">${esc(chapName(k.ch))} · 共 ${k.t} 题 · 忘 ${k.f} · 模 ${k.v} · 熟 ${k.kn}${k.u ? ' · 未练 ' + k.u : ''}</div>
        <div class="wbar"><i style="width:${wf}%;background:var(--forgot)"></i><i style="width:${wv}%;background:var(--vague)"></i><i style="width:${wk}%;background:var(--pri)"></i></div>
      </div>`;
    }).join('');
    return `<div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="h1" style="margin:0">整体掌握</div>
        <div class="muted" style="margin-top:4px">已练 ${done} / ${BANK.length} 题 · 熟悉 ${known} 题</div></div>
        <div class="badge pri">${rate}%</div>
      </div>
      <div class="progress" style="margin-top:12px;height:6px;background:#eef1f4"><i style="width:${rate}%"></i></div>
      <div class="row wrap" style="margin-top:12px;gap:6px">
        <span class="badge" style="background:#fdeee7;color:var(--forgot)">忘记 ${forgot}</span>
        <span class="badge" style="background:#fdf3e3;color:var(--vague)">模糊 ${vague}</span>
        <button class="badge" style="background:var(--pri-weak);color:var(--pri)" data-act="weakForgot">只刷忘记的 ${forgot} 题 ›</button>
      </div>
      <div class="row" style="margin-top:14px;gap:8px">
        <button class="btn" style="flex:1" data-act="weakAll">刷全部未掌握</button>
        <button class="btn ghost" style="flex:1" data-act="toSetup">换范围</button>
      </div>
    </div>
    <div class="section-label">最薄弱的考点（${top.length}）</div>
    <div class="card wlist">${rows || '<div class="empty">各考点都挺稳，继续刷新题吧</div>'}</div>
    <div class="muted" style="margin:10px 4px;line-height:1.7">条形：橙=忘记，黄=模糊，绿=熟悉，灰=未练；按“忘记×3＋模糊×2＋未练×1”排序，所以最上面就是你最该补的。</div>`;
  }

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
        return `<div class="pt ${masked ? 'masked' : ''}" data-act="${masked ? 'reveal' : ''}" data-i="${i}" style="--c:${COLORS[i % COLORS.length]}" data-label="要点 ${i + 1} · 轻点显示"><span class="txt">${esc(fmtAnsText(t))}</span></div>`;
      }).join('')}
        ${q.pts && q.pts.length > 1 ? `<div class="reveal-all" data-act="revealAll">显示全部要点</div>` : ''}
        ${q.kpnote ? `<div class="kpnote">考点：${esc(q.kpnote.replace(/^：/, ''))}</div>` : ''}
      </div>`;
    }
    const rated = S.rated;
    return `
    <div class="progress"><i id="qbar"></i></div>
    <div class="backrow"><button class="backbtn" data-act="back">${backLabel()}</button>
      <span class="bk-sub">${esc(q.chname)}${st ? ' · 上次：' + RATE_TXT[st.r] : ''}${S.ephemeral ? ' · 临时' : ''}</span>
      <button class="backbtn" style="margin-left:auto;white-space:nowrap" data-act="cardSheet">答题卡 ${S.idx + 1}/${S.queue.length}</button></div>
    <div class="card">
      <div class="qhead">
        <div class="qmeta"><span class="badge pri">${esc(q.kp)}</span><span class="badge">${q.y}年 · ${esc(q.ty)}${esc(q.num)}</span></div>
        <button class="star ${isFav ? 'on' : ''}" data-act="star">${isFav ? '★' : '☆'}</button>
      </div>
      <div class="stem">${esc(q.stem)}</div>
      ${sibBlockHTML(q)}
      ${body}
      ${ansBlock}
      <div class="rate ${showAns ? 'show' : ''}">
        <button class="btn ${rated === 'forgot' ? 'on' : ''}" data-r="forgot" data-act="rate">忘记</button>
        <button class="btn ${rated === 'vague' ? 'on' : ''}" data-r="vague" data-act="rate">模糊</button>
        <button class="btn ${rated === 'known' ? 'on' : ''}" data-r="known" data-act="rate">熟悉</button>
      </div>
      ${showAns ? `<div class="rate-hint">${S.auto ? '选完自动下一题' : '选完点下方按钮进入下一题'}</div>` : `<div class="rate-hint">先自己作答，再显示答案</div>`}
      <div style="text-align:right;margin-top:2px"><button class="linkbtn" data-act="fixOpen">答案有问题？纠错 ›</button></div>
      <div class="row" style="margin-top:14px;gap:8px">
        <button class="btn ghost" style="flex:1" data-act="prev">上一题</button>
        <button class="btn ghost" style="flex:1" data-act="skip">跳过/下一题</button>
      </div>
    </div>
    ${notesInlineHTML(q)}
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
      <button class="stat" data-act="listOpen" data-v="done"><b>${Object.keys(p).length}</b><span>已练题 ›</span></button>
      <button class="stat" data-act="listOpen" data-v="today"><b>${todayN}</b><span>今日 ›</span></button>
      <button class="stat" data-act="listOpen" data-v="fav"><b>${fav.length}</b><span>收藏 ›</span></button>
      <button class="stat" data-act="listOpen" data-v="known"><b style="color:var(--known)">${cnt.known}</b><span>熟悉 ›</span></button>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="row" style="justify-content:space-between">
        <div><div class="h1" style="margin:0;font-size:15px">掌握分布</div>
        <div class="muted" style="margin-top:3px"><button data-act="listOpen" data-v="forgot">忘记 ${cnt.forgot}</button> · <button data-act="listOpen" data-v="vague">模糊 ${cnt.vague}</button> · <button data-act="listOpen" data-v="known">熟悉 ${cnt.known}</button> ›</div></div>
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
      <div class="muted" style="line-height:1.9">题库 ${BANK.length} 题 · 已练 ${Object.keys(p).length} 题 · 收藏 ${S.rec.fav.length} 题<br/>日志文件：logs/${esc(S.user || 'user')}.json<br/>版本：${esc(CUR_VER)}</div>
    </div>
    <div class="muted" style="margin:14px 4px;line-height:1.7">题目与答案来自南航 877 历年真题整理，仅供本人复习使用。</div>`;
  }

  /* ---------- sheets ---------- */
  function openSheet(html) {
    $('sheet').innerHTML = html;
    $('sheet').classList.add('show'); $('sheetMask').classList.add('show');
  }
  function closeSheet() { $('sheet').classList.remove('show'); $('sheetMask').classList.remove('show'); }
  function cardSheet() {
    const p = S.rec.progress || {};
    const groups = [['forgot', '忘记'], ['vague', '模糊'], ['known', '熟悉']];
    const stat = { forgot: 0, vague: 0, known: 0, none: 0 };
    S.queue.forEach(q => { const r = p[q.id] && p[q.id].r; if (r) stat[r]++; else stat.none++; });
    const cells = S.queue.map((q, i) => {
      const r = p[q.id] && p[q.id].r;
      const cls = i === S.idx ? 'cur' : (r || '');
      const fav = (S.rec.fav || []).includes(q.id);
      return `<button class="agnum ${cls}" data-act="goto" data-i="${i}">${i + 1}${fav ? '<i class="agstar">★</i>' : ''}</button>`;
    }).join('');
    openSheet(`<h3>答题卡</h3>
      <div class="agbar"><b>第 ${S.idx + 1} 题 / 共 ${S.queue.length}</b>
        <span class="aglegend">${groups.map(([k, n]) => `<i class="agdot ${k}"></i>${n} ${stat[k]}`).join(' ')}<i class="agdot"></i>未做 ${stat.none}</span></div>
      <div class="aggrid">${cells}</div>
      <div class="row" style="margin-top:14px;gap:8px">
        <button class="btn" style="flex:1" data-act="gotoNextNone">跳到下一道未做</button>
        <button class="btn ghost" style="flex:1" data-act="closeSheet">关闭</button>
      </div>`);
  }
  function cleanTerm(t) { return String(t || '').replace(/[\s\u3000]*\d{2,}[\s\u3000]*$/, '').trim(); }
  function normTerm(t) {
    return cleanTerm(t).replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').toLowerCase();
  }
  function searchSheet() {
    openSheet(`<h3>搜题</h3>
      <div class="searchwrap" style="margin-top:10px">
        <input id="sq" class="search" type="search" placeholder="词如 米氏方程 / 端粒酶 / 2009年" value="${esc(S.sw)}"/>
        ${S.sw ? '<button class="sclr" data-act="clearSearch">×</button>' : ''}
      </div>
      <div id="sres">${searchHTML()}</div>
      <div style="margin-top:12px"><button class="btn ghost block" data-act="closeSheet">关闭</button></div>`);
    setTimeout(() => { const el = $('sq'); if (el) el.focus(); }, 60);
  }
  function memoGroups() {
    if (S._memo) return S._memo;
    const map = new Map();
    BANK.forEach(q => {
      if (q.ty !== '名词') return;
      const k = normTerm(q.stem); if (!k) return;
      if (!map.has(k)) map.set(k, { key: k, terms: [], items: [], ch: q.ch, chname: q.chname, kp: q.kp });
      const g = map.get(k);
      g.items.push(q);
      const ct = cleanTerm(q.stem); if (g.terms.indexOf(ct) < 0) g.terms.push(ct);
      if (!g.chname) { g.ch = q.ch; g.chname = q.chname; g.kp = q.kp; }
    });
    const arr = [...map.values()];
    arr.forEach(g => {
      const cnt = new Map(); g.items.forEach(q => cnt.set(q.ans, (cnt.get(q.ans) || 0) + 1));
      g.ansVars = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
      g.years = [...new Set(g.items.map(q => q.y))].sort();
      g.label = g.terms.slice().sort((a, b) => b.length - a.length)[0];
      g.en = ((g.label.match(/[（(]([^）)]*)[）)]/) || [])[1] || '').trim();
      g.zh = g.label.replace(/[（(][^）)]*[）)]/g, '').trim();
    });
    arr.sort((a, b) => (parseInt(a.years[0], 10) - parseInt(b.years[0], 10)) || a.zh.localeCompare(b.zh, 'zh'));
    arr.forEach((g, i) => { g.idx = i; });
    S._memo = arr; return arr;
  }
  function memStat() {
    const gs = memoGroups();
    const st = { known: 0, vague: 0, forgot: 0, none: 0 };
    const rows = gs.map(g => {
      const it = S.mem[g.key] || null;
      const r = it && it.r;
      if (r === 'known') st.known++; else if (r === 'vague') st.vague++; else if (r === 'forgot') st.forgot++; else st.none++;
      const score = r === 'known' ? 100 : r === 'vague' ? 50 : r === 'forgot' ? 0 : null;
      return { g, r, score, ts: it && it.ts || 0 };
    });
    const rated = rows.filter(x => x.score !== null).sort((a, b) => b.score - a.score || b.ts - a.ts);
    return { rows, st, rated };
  }
  function memCard(g) {
    const open = !!S.mo[g.key], open2 = !!S.mo2[g.key];
    const mr = (S.mem[g.key] && S.mem[g.key].r) || '';
    const ansMain = g.ansVars[0] || '';
    const others = g.ansVars.slice(1);
    return `<div class="mcard ${open ? 'open' : ''} ${mr ? 'r-' + mr : ''}">
      <button class="mhead" data-act="memoOpen" data-v="${g.idx}">
        <div style="min-width:0">
          <div class="mterm">${esc(g.zh)}${g.en ? `<span class="men">${esc(g.en)}</span>` : ''}<span class="mcnt">${g.items.length} 次</span></div>
          <div class="msub">${esc(g.chname || '')} · ${esc(g.kp || '')} · ${g.years.join(' / ')}</div>
        </div>
        <i class="caret ${open ? 'open' : ''}">▾</i>
      </button>
      <div class="mrate">
        <span class="mrlab">熟练度</span>
        ${['forgot', 'vague', 'known'].map(k => `<button class="mbtn ${mr === k ? 'on ' + k : ''}" data-act="memoRate" data-v="${g.idx}" data-r="${k}">${RATE_TXT[k]}</button>`).join('')}
        ${mr ? '<span class="mrtime">' + new Date(S.mem[g.key].ts).toLocaleDateString('zh-CN') + '</span>' : '<span class="mrtime">未标记</span>'}
      </div>
      ${open ? `<div class="mans"><div class="mstrike">答案</div><p>${esc(ansMain)}</p>
        ${others.map(o => `<p class="mvar">另有表述：${esc(o)}</p>`).join('')}</div>` : ''}
      ${open ? `<button class="mhead2" data-act="memoOpen2" data-v="${g.idx}">
        <span>历年原题（${g.items.length}）</span><i class="caret ${open2 ? 'open' : ''}">▾</i></button>
        ${open2 ? `<div class="mdetail">${g.items.map(q => `<div class="mrow">
          <div class="mrowtop"><span class="badge">${esc(q.y)} 年 · 名词${esc(q.num)}</span><span class="muted">${esc(q.kp)}</span></div>
          <div class="mstem">${esc(cleanTerm(q.stem))}</div>
          <div class="mraw">${esc(q.ans)}</div></div>`).join('')}</div>` : ''}` : ''}
    </div>`;
  }
  function memListHTML() {
    const gs = memoGroups(); const kw = (S.mw || '').trim().toLowerCase();
    let list = kw ? gs.filter(g => (g.zh + ' ' + g.en + ' ' + g.ansVars.join(' ')).toLowerCase().indexOf(kw) >= 0) : gs;
    const mf = S.mf || 'all';
    if (mf !== 'all') list = list.filter(g => {
      const r = S.mem[g.key] && S.mem[g.key].r;
      if (mf === 'weak') return r === 'forgot' || r === 'vague';
      if (mf === 'none') return !r;
      if (mf === 'known') return r === 'known';
      return true;
    });
    const by = S.msort || 'default';
    if (by !== 'default') {
      const dir = S.mdir === 1 ? 1 : -1;
      const base = new Map(gs.map((g, i) => [g.key, i]));
      const prof = g => { const r = S.mem[g.key] && S.mem[g.key].r; return r === 'known' ? 2 : r === 'vague' ? 1 : r === 'forgot' ? 0 : null; };
      list = list.slice().sort((a, b) => {
        let x, y;
        if (by === 'freq') { x = a.items.length; y = b.items.length; }
        else {
          const pa = prof(a), pb = prof(b);
          if (pa === null && pb !== null) return 1;      // 未标记恒定垫底
          if (pb === null && pa !== null) return -1;
          x = pa === null ? 0 : pa; y = pb === null ? 0 : pb;
        }
        return (x - y) * dir || (b.items.length - a.items.length) || (base.get(a.key) - base.get(b.key));
      });
    }
    if (!list.length) return `<div class="muted" style="padding:20px 4px;text-align:center">没有匹配的词条</div>`;
    return list.map(memCard).join('');
  }
  function memHTML() {
    const gs = memoGroups(); const ms = memStat();
    return `<div class="backrow"><button class="backbtn" data-act="back">${backLabel()}</button>
      <span class="bk-sub">点开看答案 · 可标熟练度</span>
      <button class="backbtn" style="margin-left:auto;white-space:nowrap" data-act="memoToggleAll">${Object.keys(S.mo).length ? '全部收起' : '全部展开'}</button></div>
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div class="h1" style="margin:0">${gs.length} 个词条</div>
        </div>
        <div class="searchwrap" style="margin-top:10px">
          <input id="mq" class="search" type="search" placeholder="搜词条名或答案，如 信号肽 / 操纵子" value="${esc(S.mw)}"/>
          ${S.mw ? '<button class="sclr" data-act="memoClear">×</button>' : ''}
        </div>
      </div>
      <div class="sortbar">
        <span class="slab">排序</span>
        ${[['default', '默认'], ['freq', '考频'], ['prof', '熟练度']].map(([k, t]) =>
        `<button class="chip sm ${(S.msort || 'default') === k ? 'on' : ''}" data-act="memSort" data-v="${k}">${t}</button>`).join('')}
        <button class="dirbtn" data-act="memDir" title="切换升降序">${S.mdir === 1 ? '↑' : '↓'}</button>
      </div>
      <div class="sortstat"><i class="agdot known"></i>熟悉 ${ms.st.known} <i class="agdot vague"></i>模糊 ${ms.st.vague} <i class="agdot forgot"></i>忘记 ${ms.st.forgot} <i class="agdot"></i>未标 ${ms.st.none}</div>
      <div class="row wrap" style="margin:0 0 10px">
        ${[['all', '全部 ' + gs.length], ['weak', '薄弱 ' + (ms.st.forgot + ms.st.vague)], ['none', '未标 ' + ms.st.none], ['known', '熟悉 ' + ms.st.known]].map(([k, t]) =>
        `<button class="chip ${S.mf === k ? 'on' : ''}" data-act="memFilter" data-v="${k}">${t}</button>`).join('')}
      </div>
      <div id="mlist">${memListHTML()}</div>`;
  }
  function statusSheet() {
    const st = S.sync || { state: 'idle', msg: '' };
    const dot = st.state === 'ok' ? 'ok' : st.state === 'off' ? 'off' : 'warn';
    const title = {
      ok: '已同步，无待写改动', sync: '正在同步…', pending: '有改动未写入（稍后自动同步）',
      fail: '同步失败', off: '仅本地（未配置令牌）', idle: '尚未同步'
    }[st.state] || '尚未同步';
    const when = S.syncAt ? new Date(S.syncAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    openSheet(`<h3>同步状态</h3>
      <div class="statline"><span class="dot ${dot}"></span><b>${title}</b>
      <div class="desc">${st.state === 'fail' && S.syncErr
          ? '失败原因：' + esc(S.syncErr).replace(/\n/g, '<br>')
          : (st.state === 'ok' || !st.msg || st.msg === title || st.msg.indexOf(title) === 0 ? '' : esc(st.msg))}${when ? '<br>最近成功同步：' + when : '<br>还没有成功同步过'}</div></div>
      <div class="list">
        <div class="item" data-act="switchUser"><div><div>当前用户</div><div class="k">${esc(S.user || '未选择')}</div></div><div>切换 ›</div></div>
        <div class="item" data-act="tokenSheet"><div><div>同步令牌</div><div class="k">${S.token ? '已配置，日志写入 ' + esc(S.repo) : '未配置，只存本机'}</div></div><div>›</div></div>
      </div>
      <div class="row" style="margin-top:14px;gap:8px">
        <button class="btn" style="flex:1" data-act="syncNow">立即同步</button>
        <button class="btn ghost" style="flex:1" data-act="switchUser">切换用户</button>
      </div>
      <div class="desc" style="margin-top:14px">日志文件：logs/${esc(S.user || 'user')}.json；黄灯表示有改动还没写回仓库或写入失败，点“立即同步”可重试，失败原因会显示在上方。</div>`);
  }
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
  /* ---------- 重复题去重面板 ---------- */
  function dedupHTML() {
    if (!S.dup) S.dup = { includeNoun: false, keep: {} };
    const info = dupInfo(S.dup.includeNoun);
    if (!Object.keys(S.dup.keep).length) {
      info.groups.forEach(g => {   // 默认保留最早年份，同年取先出现的
        const sorted = g.items.slice().sort((a, b) => (a.y || '') - (b.y || ''));
        S.dup.keep[g.key] = sorted[0].id;
      });
    }
    const shown = info.groups;
    const rows = shown.map((g, gi) => {
      const keep = S.dup.keep[g.key] || g.items[0].id;
      const tags = g.items.map(q => `<button class="dupchip ${q.id === keep ? 'on' : ''}" data-act="dupKeep" data-key="${esc(g.key)}" data-id="${esc(q.id)}">${esc(q.y)}·${esc(q.ty)}${esc(q.num)}</button>`).join('');
      return `<div class="card" style="margin-top:10px;padding:12px 14px">
        <div class="muted" style="font-size:12px;line-height:1.6">${esc((g.items[0].stem || '').slice(0, 46))}${(g.items[0].stem || '').length > 46 ? '…' : ''}</div>
        <div class="row wrap" style="margin-top:8px;gap:6px">${tags}</div>
      </div>`;
    }).join('');
    const extra = shown.reduce((n, g) => n + g.items.length - 1, 0);
    return `<h3>重复题去重</h3>
      <div class="card" style="padding:10px 12px;margin-top:4px;background:${HIDDEN.size ? 'var(--pri-weak)' : '#f6f8fa'}">
        <b style="font-size:13px;color:${HIDDEN.size ? 'var(--pri)' : 'var(--tx2)'}">${HIDDEN.size ? '当前状态：已去重，隐藏了 ' + HIDDEN.size + ' 条，题库共 ' + BANK.length + ' 题' : '当前状态：未去重，题库共 ' + BANK.length + ' 题（全部重复题都在刷题里出现）'}</b>
      </div>
      <div class="desc">同题干、同题型、选项一致才判为重复；跨题型和选项差异大的「疑似同题」不自动隐藏，名词解释默认不参与。每题卡里还会折叠显示历年同题，可逐个对照。</div>
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <button class="chip ${S.dup.includeNoun ? 'on' : ''}" data-act="dupNoun">${S.dup.includeNoun ? '✓ ' : ''}名词解释也去重</button>
        <span class="k" id="dupCount">${shown.length} 组 · 将隐藏 ${extra} 条</span>
      </div>
      <div style="margin-top:8px">${rows || '<div class="muted">没有检测到重复题</div>'}</div>
      <button class="btn block" style="margin-top:14px" data-act="dupApply">应用去重（隐藏 ${extra} 条）</button>
      ${HIDDEN.size ? `<button class="btn ghost block" style="margin-top:8px" data-act="dupReset">恢复已隐藏的 ${HIDDEN.size} 条</button>` : ''}
      <button class="btn ghost block" style="margin-top:8px" data-act="closeSheet">关闭</button>
      <div class="desc" style="margin-top:12px">组内默认留最早年份；点其它年份可改留哪一条。写入仓库 dedup.json，所有设备同步。</div>`;
  }

  /* ---------- 笔记（题下内嵌，默认展开） ---------- */
  function noteDraftOf(q) {
    const d = loadJSON('qb.noteDraft', {}) || {};
    if (d[q.id] !== undefined) return d[q.id];
    const mine = visibleNotes(q.id).filter(n => (n.u || '') === (S.user || ''));
    return mine.length ? mine[mine.length - 1].t : '';
  }
  function setNoteDraft(qid, v) {
    const d = loadJSON('qb.noteDraft', {}) || {}; d[qid] = v; saveJSON('qb.noteDraft', d);
  }
  function notesInlineHTML(q) {
    const list = visibleNotes(q.id);
    const rows = list.map(n => `<div class="noteitem">
        <div class="row" style="justify-content:space-between">
          <b class="noteuser">${esc(n.u || '匿名')}</b>
          <span class="k">${new Date(n.ts || 0).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}${(n.u || '') === (S.user || '') ? `<button class="linkbtn" style="margin-left:8px" data-act="noteDel" data-ts="${n.ts}">删除</button>` : ''}</span>
        </div>
        <div class="notetext">${esc(n.t || '')}</div>
      </div>`).join('');
    return `<div class="card notes" style="margin-top:12px">
      <div class="row" style="justify-content:space-between">
        <div class="h1" style="margin:0;font-size:14px">笔记${list.length ? ` · ${list.length}` : ''}</div>
        <span class="k">所有人可见 · 署名「${esc(S.user || '未命名')}」</span>
      </div>
      ${rows}
      <div class="field" style="margin:10px 0 0"><textarea id="noteInline" rows="3" placeholder="记易错点、口诀、这题的关键逻辑…（发布后所有使用者可见）">${esc(noteDraftOf(q))}</textarea></div>
      <button class="btn block" style="margin-top:8px" data-act="noteSave">发布笔记</button>
    </div>`;
  }

  /* ---------- 笔记面板 ---------- */
  function noteHTML(q) {
    const list = visibleNotes(q.id);
    const mine = list.filter(n => (n.u || '') === (S.user || ''));
    const rows = list.map(n => `<div class="card" style="margin-top:10px;padding:12px 14px">
        <div class="row" style="justify-content:space-between">
          <b style="font-size:13px;color:var(--pri)">${esc(n.u || '匿名')}</b>
          <span class="k">${new Date(n.ts || 0).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div style="margin-top:6px;line-height:1.75;white-space:pre-wrap">${esc(n.t || '')}</div>
        ${(n.u || '') === (S.user || '') ? `<div style="text-align:right"><button class="linkbtn" data-act="noteDel" data-ts="${n.ts}">删除</button></div>` : ''}
      </div>`).join('');
    const last = mine.length ? mine[mine.length - 1].t : '';
    return `<h3>笔记 · ${esc(q.y)}年 ${esc(q.ty)}${esc(q.num)}</h3>
      <div class="desc">这里的笔记对所有使用者可见，署名是你的用户名「${esc(S.user || '未命名')}」。同一题可多人叠加。</div>
      ${rows || '<div class="muted" style="margin-top:10px">还没有人写过这题，来写第一条。</div>'}
      <div class="field" style="margin-top:14px"><label>${last ? '补充或修改你的笔记' : '写笔记'}</label>
        <textarea id="noteTxt" rows="4" placeholder="记易错点、口诀、和这题相关的联系…">${esc(last)}</textarea></div>
      <button class="btn block" data-act="noteSave">发布笔记</button>
      <button class="btn ghost block" style="margin-top:8px" data-act="closeSheet">关闭</button>`;
  }
  async function saveNote() {
    const q = S.queue[S.idx]; if (!q) return;
    const box = $('noteInline') || $('noteTxt');
    const txt = (box && box.value || '').trim();
    if (!txt) { toast('先写点内容'); return; }
    if (!S.token) { toast('未配置令牌，无法发布'); tokenSheet(); return; }
    const entry = { u: S.user || '匿名', t: txt, ts: now() };
    try {
      const cur = await api.read('notes.json');
      let obj = {};
      if (cur && cur.text) { try { obj = JSON.parse(cur.text) || {}; } catch (e) { obj = {}; } }
      obj = mergeNotes(obj, NOTES);
      const list = (obj[q.id] || []).filter(n => (n.u || '') !== entry.u);   // 每人每题保留最新一条，旧的可改/可覆盖删除
      list.push(entry); obj[q.id] = list;
      const onConflict = latest => {
        let o = {}; try { o = JSON.parse(latest) || {}; } catch (e) { }
        o = mergeNotes(o, obj);
        const l = (o[q.id] || []).filter(n => (n.u || '') !== entry.u); l.push(entry); o[q.id] = l;
        obj = o; return JSON.stringify(o, null, 1);
      };
      await api.write('notes.json', JSON.stringify(obj, null, 1), 'note: ' + q.id + ' by ' + (S.user || ''), cur && cur.sha, { onConflict });
      NOTES = mergeNotes(NOTES, { [q.id]: [entry] });
      NOTES[q.id] = list;
      saveJSON('qb.notes', NOTES);
      const dr = loadJSON('qb.noteDraft', {}) || {}; delete dr[q.id]; saveJSON('qb.noteDraft', dr);
      render(); toast('笔记已发布');
    } catch (e) {
      toast('发布失败：' + ((e && e.message) || '未知错误'));
      if (e && e.status === 401) { closeSheet(); tokenSheet(); }
    }
  }
  async function delNote(ts) {
    const q = S.queue[S.idx]; if (!q || !S.token) { toast('未配置令牌'); return; }
    try {
      const cur = await api.read('notes.json');
      let obj = (cur && cur.text) ? JSON.parse(cur.text) : {};
      obj = mergeNotes(obj, NOTES);
      const tomb = { u: S.user || '', del: 1, ts: now() };
      obj[q.id] = (obj[q.id] || []).filter(n => (n.u || '') !== (S.user || ''));
      obj[q.id].push(tomb);
      const onConflict = latest => {
        let o = {}; try { o = JSON.parse(latest) || {}; } catch (e) { }
        o = mergeNotes(o, obj);
        o[q.id] = (o[q.id] || []).filter(n => (n.u || '') !== (S.user || ''));
        o[q.id].push(tomb);
        obj = o; return JSON.stringify(o, null, 1);
      };
      await api.write('notes.json', JSON.stringify(obj, null, 1), 'note: 删除笔记 ' + q.id, cur && cur.sha, { onConflict });
      NOTES = mergeNotes(NOTES, { [q.id]: [tomb] });
      NOTES[q.id] = (NOTES[q.id] || []).filter(n => (n.u || '') !== (S.user || '')).concat([tomb]);
      saveJSON('qb.notes', NOTES); openSheet(noteHTML(q)); render(); toast('已删除');
    } catch (e) { toast('删除失败：' + ((e && e.message) || '未知错误')); }
  }

  /* 同题/近似同题：优先用离线核对过的分组，缺文件时退回题干归一化 */
  function dupSiblings(q) {
    const g = DUPG_BY_ID.get(q.id);
    if (g) return (g.ids || []).map(id => BYID[id]).filter(x => x && x.id !== q.id);
    const k = dupNorm(q.stem);
    if (!k || k.length < 6) return [];
    return ALLQ.filter(x => x.id !== q.id && dupNorm(x.stem) === k);
  }
  /* 题卡内折叠展示：历年同题 */
  const ansOf = q => (q.ty === '判断' || q.opts && q.opts.length) ? (q.correct || '') : (q.ans || '');
  const ansKey = q => {
    if (q.ty === '判断') return 'J' + (q.correct || '');
    if (q.opts && q.opts.length) return 'S' + (q.correct || '');
    return 'T' + dupNorm(q.ans || '').slice(0, 160);
  };
  function optJac(a, b) {
    const sa = new Set((a.opts || []).map(o => dupNorm(o))), sb = new Set((b.opts || []).map(o => dupNorm(o)));
    if (!sa.size || !sb.size) return null;
    let inter = 0; sa.forEach(x => { if (sb.has(x)) inter++; });
    return inter / (sa.size + sb.size - inter);
  }
  function ansSegs(q) {
    if (q.ty === '判断' || (q.opts && q.opts.length)) return null;
    let t = q.ans || '';
    t = t.replace(/[｜|]?\s*考点[：:].*$/, '');
    return t.split(/[；;，,、\s]+/).map(x => dupNorm(x)).filter(x => x.length > 1);
  }
  function ansSim(a, b) {
    const ka = ansKey(a), kb = ansKey(b);
    if (ka.charAt(0) !== 'T' || kb.charAt(0) !== 'T') return ka === kb ? 1 : 0;
    const sa = new Set(ansSegs(a) || []), sb = new Set(ansSegs(b) || []);
    if (!sa.size || !sb.size) return 0;
    let inter = 0; sa.forEach(x => { if (sb.has(x)) inter++; });
    return inter / (sa.size + sb.size - inter);
  }
  function sibBlockHTML(q) {
    const g = DUPG_BY_ID.get(q.id);
    const others = g ? (g.ids || []).map(id => BYID[id]).filter(x => x && x.id !== q.id) : dupSiblings(q);
    if (!others.length) return '';
    const idsAll = g ? (g.ids || []) : [q.id].concat(others.map(x => x.id));
    const years = idsAll.map(id => BYID[id] && BYID[id].y).filter(Boolean).sort();
    const rows = others.slice().sort((a, b) => (a.y || '').localeCompare(b.y || '')).map(x => {
      const tags = [];
      if (x.id === q.id) tags.push('<span class="sibtag same">本题</span>');
      if (HIDDEN.has(x.id)) tags.push('<span class="sibtag hid">已隐藏</span>');
      const asm = ansSim(q, x);
      tags.push(asm >= .8 ? '<span class="sibtag same">答案一致</span>' : asm >= .5 ? '<span class="sibtag">答案近似</span>' : '<span class="sibtag diff">答案有差异</span>');
      const j = optJac(q, x);
      if (j !== null && j < 0.5) tags.push('<span class="sibtag">选项不同</span>');
      if (x.ty === '名词') tags.push('<span class="sibtag">名词同词条</span>');
      let prev = '';
      if (x.opts && x.opts.length) {
        const k = x.correct || '';
        const idx = 'ABCD'.indexOf(k);
        prev = '答案 ' + (k || '—') + (idx >= 0 ? ' · ' + (x.opts[idx] || '') : '');
      } else if (x.ty === '判断') prev = '答案 ' + (x.correct || '—');
      else prev = (x.ans || '').replace(/\s+/g, ' ').slice(0, 54);
      return `<button class="sibrow" data-act="sibOpen" data-id="${esc(x.id)}">
        <span class="sy">${esc(x.y)}年 ${esc(x.ty)}${esc(x.num)}</span><span class="sibtags">${tags.join('')}</span>
        <div class="sibans">${esc(prev)}${prev.length >= 54 ? '…' : ''}</div></button>`;
    }).join('');
    const hidN = others.filter(x => HIDDEN.has(x.id)).length;
    return `<details class="sibbox"><summary><span class="sibt">历年同题 ${others.length + 1} 处</span><span class="sibsub">${years[0] ? years[0] + '–' + years[years.length - 1] + ' · ' : ''}点开看其他 ${others.length} 题${hidN ? '（其中 ' + hidN + ' 条已被去重隐藏）' : ''}</span></summary>
      <div class="siblist">${rows}</div>
      <div class="sibnote">同题干的历史版本，答案差异可直接对照；点任意一条跳到那道题（临时模式，不计入进度）。</div></details>`;
  }

  /* ---------- 纠错编辑器 ---------- */
  function fixState(q) {
    const raw = q.ans || '';
    S.fix = {
      id: q.id, stage: 'edit', c: q.correct || '', stem: q.stem || '', oldStem: q.stem || '',
      ans: raw.split('｜考点')[0],
      blocks: SUBJ_TY(q.ty) ? ((q.pts && q.pts.length) ? q.pts.slice() : []) : []
    };
  }
  function collectFix() {
    if (!S.fix) return;
    const st = $('fixStem'); if (st) S.fix.stem = st.value;
    const a = $('fixAns'); if (a) S.fix.ans = a.value;
    const c = $('fixC'); if (c) S.fix.c = c.value;
    S.fix.batch = Array.from(document.querySelectorAll('.fixdup')).filter(c => c.checked).map(c => c.value);
    const bs = Array.from(document.querySelectorAll('.fixblk')).map(t => t.value);
    if (bs.length) S.fix.blocks = bs;
  }
  function fixSheet(q) {
    fixState(q);
    S.fix.sheet = q.id;
    openSheet(fixHTML());
  }
  function fixHTML() {
    const q = qById(S.fix.id) || {};
    const subj = SUBJ_TY(q.ty);
    if (S.fix.stage === 'confirm') return fixConfirmHTML(q);
    let pick = '';
    if (q.ty === '选择' || q.ty === '单选' || q.ty === '多选') {
      const ks = (q.opts || []).map((o, i) => 'ABCD'[i] || String(i + 1));
      pick = `<div class="field"><label>正确选项</label><select id="fixC">${ks.map(k => `<option value="${k}"${k === (S.fix.c || '').charAt(0) ? ' selected' : ''}>${k}</option>`).join('')}</select></div>`;
    } else if (q.ty === '判断') {
      pick = `<div class="field"><label>正确答案</label><select id="fixC">
        <option value="√"${S.fix.c === '√' ? ' selected' : ''}>对（√）</option>
        <option value="×"${S.fix.c === '×' ? ' selected' : ''}>错（×）</option></select></div>`;
    }
    let blocksHTML = '';
    if (subj) {
      blocksHTML = `<div class="field"><label>答案遮挡块（刷题时一块一块点开）</label>
        ${S.fix.blocks.map((t, i) => `<div style="position:relative;margin-bottom:10px">
          <textarea class="fixblk" rows="3">${esc(t)}</textarea>
          <button class="linkbtn" style="position:absolute;right:2px;top:-2px" data-act="fixDelBlock" data-i="${i}">删除</button>
        </div>`).join('') || '<div class="muted" style="margin-bottom:8px">还没有遮挡块，可先点“按句切分”自动生成</div>'}
        <div class="row" style="gap:8px"><button class="btn ghost" style="flex:1" data-act="fixAddBlock">＋ 新增一块</button>
        <button class="btn ghost" style="flex:1" data-act="fixSplit">按句切分</button></div>
        <div class="muted" style="margin-top:6px">块数越多遮盖越细；建议每块 1–2 句。</div></div>`;
    }
    return `<h3>纠错 · ${esc(q.y)}年 ${esc(q.ty)}${esc(q.num)}</h3>
      <div class="field"><label>题干</label><textarea id="fixStem" rows="5">${esc(S.fix.stem)}</textarea></div>
      ${pick}
      <div class="field"><label>答案文本（不含“考点”）</label><textarea id="fixAns" rows="${subj ? 6 : 2}">${esc(S.fix.ans)}</textarea></div>
      ${blocksHTML}
      ${fixSibHTML(q)}
      <button class="btn block" data-act="fixSubmit">提交修改</button>
      <button class="btn ghost block" style="margin-top:8px" data-act="fixCancel">取消</button>
      <div class="desc" style="margin-top:12px">提交后会写回 GitHub 仓库的 fixes.json，所有设备打开页面时自动生效；不影响本机刷题记录。</div>`;
  }
  function fixSibHTML(q) {
    const sibs = dupSiblings(q);
    if (!sibs.length) return '';
    const base = String(q.ans || '').split('｜考点')[0].replace(/\s/g, '');
    const rows = sibs.map(x => {
      const same = String(x.ans || '').split('｜考点')[0].replace(/\s/g, '') === base && (x.correct || '') === (q.correct || '');
      return `<label class="sibrow">
        <input type="checkbox" class="fixdup" value="${esc(x.id)}" ${same ? '' : 'checked'}>
        <div>
          <div><b>${esc(x.y)}年 ${esc(x.ty)}${esc(x.num)}</b> <span class="badge" style="${same ? 'background:#f2f4f6;color:var(--tx2)' : 'background:#fdeee7;color:var(--forgot)'}">${same ? '与本题一致' : '与本题不同'}</span></div>
          <div class="k" style="margin-top:2px">现答案：${esc(String(x.ans || '—').split('｜考点')[0].slice(0, 46))}${x.correct ? '（' + esc(x.correct) + '）' : ''}</div>
        </div></label>`;
    }).join('');
    return `<div class="field" style="margin-top:12px">
      <label>同题还出现在 ${sibs.length} 处，勾选的一并改成一模一样</label>
      <div class="muted" style="margin:2px 0 8px;font-size:12px">默认只勾“与本题不同”的；一致的不必重复提交。</div>
      ${rows}
    </div>`;
  }

  const splitSent = t => String(t || '').split(/(?<=[。；;])/).map(x => x.trim()).filter(Boolean);
  /* 核心：主观题“答案正文”和“遮挡块”只能有一个真源，谁被改就以谁为准，避免刷新后显示旧内容 */
  function normalizeFix(q) {
    const oldC = q.correct || '';
    const oldAns = (q.ans || '').split('｜考点')[0];
    const oldBlocks = (q.pts || []).slice();
    let cChanged = !!(S.fix.c && S.fix.c !== oldC);
    let stemChanged = String(S.fix.stem || '').trim() !== String(q.stem || '').trim();
    let ansChanged = S.fix.ans.trim() !== oldAns.trim();
    let blocksChanged = SUBJ_TY(q.ty) && S.fix.blocks.filter(t => String(t).trim()).join('') !== oldBlocks.join('');
    if (SUBJ_TY(q.ty)) {
      if (blocksChanged) S.fix.ans = S.fix.blocks.map(t => String(t).trim()).filter(Boolean).join(' ');
      else if (ansChanged) S.fix.blocks = splitSent(S.fix.ans);
    } else if (cChanged && !ansChanged) {
      const idx = 'ABCD'.indexOf(S.fix.c);
      const opt = idx >= 0 && q.opts && q.opts[idx] ? q.opts[idx] : '';
      S.fix.ans = S.fix.c + (opt ? `（${opt}）` : '');
    } else if (cChanged && ansChanged && (q.ty === '选择' || q.ty === '单选' || q.ty === '多选')) {
      S.fix.ans = S.fix.ans.replace(/^[ABCD]/,'')
      S.fix.ans = S.fix.c + (optText(q, S.fix.c) ? `（${optText(q, S.fix.c)}）` : '');
    }
    return { cChanged, ansChanged, blocksChanged, stemChanged, oldC, oldAns, oldBlocks };
  }
  function optText(q, k) { const i = 'ABCD'.indexOf(k); return (q.opts || [])[i] || ''; }
  function diffFix(q) {
    const d = normalizeFix(q);
    const rows = [];
    if (d.stemChanged) rows.push(`题干已修改（${String(q.stem || '').length} → ${String(S.fix.stem).trim().length} 字）`);
    if (d.cChanged) rows.push(`正确项：${esc(d.oldC || '—')} → <b>${esc(S.fix.c)}</b>`);
    if (d.ansChanged) rows.push(`答案正文已修改（${d.oldAns.length} → ${S.fix.ans.length} 字）`);
    if (d.blocksChanged) rows.push(`遮挡块：${d.oldBlocks.length} 块 → <b>${S.fix.blocks.filter(t => String(t).trim()).length}</b> 块`);
    if (S.fix.batch && S.fix.batch.length) rows.push(`同时修改 <b>${S.fix.batch.length}</b> 道同题：${S.fix.batch.map(id => esc(id)).join('、')}`);
    if (d.stemChanged) rows.push(`<div style="color:var(--tx2);margin-top:6px">提交后的题干：${esc(String(S.fix.stem).trim().slice(0, 90))}${String(S.fix.stem).trim().length > 90 ? '…' : ''}</div>`);
    if (rows.length) rows.push(`<div style="color:var(--tx2);margin-top:6px">提交后的答案：${esc(S.fix.ans.slice(0, 90))}${S.fix.ans.length > 90 ? '…' : ''}</div>`);
    return rows;
  }
  function fixConfirmHTML(q) {
    const rows = diffFix(q);
    return `<h3>确认提交修改</h3>
      <div class="desc">${esc(q.y)}年 ${esc(q.ty)}${esc(q.num)} · ${esc(q.id)}</div>
      <div class="card" style="margin-top:10px;padding:14px">${rows.length ? rows.map(r => `<div style="line-height:1.9">• ${r}</div>`).join('') : '<div class="muted">内容没有变化</div>'}</div>
      <div class="desc" style="margin-top:12px">确认后写入仓库 fixes.json，立即对本账号所有设备生效，其它设备刷新后同步。</div>
      <button class="btn block" data-act="fixConfirm">确认提交</button>
      <button class="btn ghost block" style="margin-top:8px" data-act="fixBack">返回修改</button>`;
  }
  async function saveFix() {
    const q = qById(S.fix.id); if (!q) return;
    normalizeFix(q);   // 再兜一次，保证“正文/遮挡块/正确项”一致
    if (!S.token) { toast('未配置令牌，无法写回题库'); tokenSheet(); return; }
    const entry = { a: S.fix.ans, u: S.user || '', ts: now() };
    const newStem = String(S.fix.stem || '').trim();
    if (newStem && newStem !== String(q.stem || '').trim()) entry.s = newStem;
    if (S.fix.c) entry.c = S.fix.c;
    if (SUBJ_TY(q.ty)) entry.pts = S.fix.blocks.filter(t => String(t).trim());
    try {
      const cur = await api.read('fixes.json');
      let obj = {};
      if (cur && cur.text) { try { obj = JSON.parse(cur.text) || {}; } catch (e) { obj = {}; } }
      const batch = (S.fix.batch || []).filter(id => id !== q.id);
      obj[q.id] = entry;
      batch.forEach(id => { obj[id] = Object.assign({}, entry); });
      const onConflict = latest => {
        let o = {}; try { o = JSON.parse(latest) || {}; } catch (e) { }
        o = mergeFixObjects(o, obj);
        obj = o; return JSON.stringify(o, null, 1);
      };
      await api.write('fixes.json', JSON.stringify(obj, null, 1), 'fix: 纠错 ' + q.id + (batch.length ? ' + ' + batch.length + ' 同题' : '') + (S.user ? ' by ' + S.user : ''), cur && cur.sha, { onConflict });
      FIXES = obj; saveJSON('qb.fixes', FIXES);
      applyFix(q); batch.forEach(id => { const x = BYID[id]; if (x) applyFix(x); });
      if (typeof rebuildHay === 'function') rebuildHay();
      closeSheet(); S.fix = null; S.revealed = {}; render(); toast(batch.length ? '已提交，含 ' + batch.length + ' 道同题' : '已提交，题库已更新');
    } catch (e) {
      const msg = e && e.code === 'no_token' ? '未配置令牌' : (e && e.message || '未知错误');
      toast('提交失败：' + msg);
      if (e && e.status === 401) { closeSheet(); tokenSheet(); }
    }
  }

  function importSheet() {
    openSheet(`<h3>导入记录</h3><div class="desc">选择之前导出的 JSON，会与当前用户记录合并。</div>
      <input type="file" id="impFile" accept="application/json,.json" style="width:100%;padding:10px;border:1px dashed var(--line);border-radius:10px;background:#fafbfc"/>`);
  }

  /* ---------- 返回上一级（导航栈） ---------- */
  let NAV = [];                       // 记录进入下一级前的界面
  function pushPlace(p) {
    if (!p) return;
    const sig = o => JSON.stringify({ t: o.type, k: o.listKind, c: o.listChap, i: o.idx, q: o.custom });
    if (NAV.length && sig(NAV[NAV.length - 1]) === sig(p)) return;
    NAV.push(p);
    if (NAV.length > 20) NAV.shift();
  }
  function currentPlace() {
    if (S.view === 'lists') return { type: 'lists', listKind: S.listKind, listChap: S.listChap, fold: Object.assign({}, S.listFold) };
    if (S.view === 'memo') return { type: 'memo' };
    if (S.view === 'quiz') return { type: 'quiz', queue: S.queue, idx: S.idx, custom: S.custom, ephemeral: S.ephemeral, session: S.session };
    if (S.tab === 'weak') return { type: 'weak' };
    if (S.view === 'summary') return { type: 'summary' };
    return { type: 'setup' };
  }
  function backLabel() { return NAV.length ? '‹ 返回' : '‹ 首页'; }
  function restorePlace(p) {
    if (!p || p.type === 'setup') { S.view = 'setup'; S.tab = 'quiz'; render(); return; }
    if (p.type === 'lists') { S.listKind = p.listKind || 'fav'; S.listChap = p.listChap || ''; S.listFold = p.fold || {}; S.view = 'lists'; S.tab = 'quiz'; render(); return; }
    if (p.type === 'memo') { S.view = 'memo'; S.tab = 'quiz'; render(); return; }
    if (p.type === 'weak') { S.tab = 'weak'; S.view = 'setup'; render(); return; }
    if (p.type === 'search') { S.sw = p.sw || ''; S.view = 'setup'; S.tab = 'quiz'; render(); searchSheet(); return; }
    if (p.type === 'quiz') {
      S.queue = p.queue || []; S.idx = Math.max(0, Math.min(p.idx || 0, Math.max(0, S.queue.length - 1)));
      S.custom = p.custom || ''; S.ephemeral = p.ephemeral !== false;
      S.session = p.session || S.session;
      S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null; S.correctFlag = null;
      S.view = 'quiz'; S.tab = 'quiz'; render(); return;
    }
    S.view = 'setup'; S.tab = 'quiz'; render();
  }
  function goBack() {
    const p = NAV.pop();
    restorePlace(p);
  }

  /* ---------- 刷新所有状态 ---------- */
  async function refreshAll() {
    if (S._refreshing) return;
    S._refreshing = true;
    setSync('sync', '正在刷新…'); toast('正在刷新所有状态…');
    try { saveRec(); saveSess(); } catch (e) { }
    try { if (S.token && S.user) await pushToRepo(); } catch (e) { }
    try {
      await Promise.allSettled([loadRemoteIndex(), loadFixesRemote(), loadNotesRemote(), loadDedupRemote()]);
      if (S.token && S.user) await pullFromRepo(S.user, true);
      S._memo = null; clearDupCache();
      if (typeof rebuildHay === 'function') rebuildHay();
      S._refreshing = false;
      render(); toast('已刷新');
    } catch (e) {
      S._refreshing = false;
      const rb = document.querySelector('.refb'); if (rb) rb.classList.remove('busy');
      toast('刷新失败：' + ((e && e.message) || '未知错误'));
    }
  }

  /* ---------- flow ---------- */
  function startSession() {
    S.queue = buildQueue();
    if (!S.queue.length) { toast('这个范围没有题目'); return; }
    S.ephemeral = false;
    pushPlace(currentPlace());
    launch(0);
  }
  function startCustom(list, idx, label, keepProgress, fromPlace) {
    if (!list.length) { toast('没有题目'); return; }
    S.queue = list;
    S.ephemeral = keepProgress !== false;
    pushPlace(fromPlace || currentPlace());
    launch(Math.max(0, Math.min(idx || 0, list.length - 1)), label);
  }
  function launch(idx, label) {
    if (!S.ephemeral) S.ephemeral = false;
    S.custom = label || '';
    S.idx = idx; S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null; S.correctFlag = null;
    const lb = label ? { ch: label, kp: '', sc: '', tp: '' } : scopeLabel();
    S.session = { t: now(), scope: label || ((lb.tp ? lb.tp + ' · ' : '') + lb.ch + ' · ' + lb.kp + ' · ' + lb.sc), n: 0, forgot: 0, vague: 0, known: 0, correct: 0, wrong: 0 };
    S.view = 'quiz'; S.tab = 'quiz'; render(); saveSess();
  }
  function jumpTo(i) {
    if (!S.queue.length || i < 0 || i >= S.queue.length) return;
    S.idx = i; S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null; S.correctFlag = null;
    S.view = 'quiz'; render(); saveSess();
  }
  function resumeSession() {
    const s = snapInfo();
    if (!s) { toast('没有可继续的进度'); return; }
    const map = new Map(BANK.map(q => [q.id, q]));
    const list = s.ids.map(id => map.get(id)).filter(Boolean);
    if (!list.length) { clearSess(); toast('上次的题目已失效'); render(); return; }
    S.filter = Object.assign({ tp: '', chap: '', kp: '', scope: 'all', order: 'seq' }, s.filter || {});
    S.queue = list;
    pushPlace(currentPlace());
    S.custom = ''; S.ephemeral = false;
    S.idx = Math.min(s.idx || 0, list.length - 1);
    S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null; S.correctFlag = null;
    const lb = scopeLabel();
    S.session = { t: now(), scope: lb.ch + ' · ' + lb.kp + ' · ' + lb.sc, n: 0, forgot: 0, vague: 0, known: 0, correct: 0, wrong: 0 };
    S.view = 'quiz'; S.tab = 'quiz'; render(); saveSess();
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
    S.rated = r; saveRec(); saveSess();
    if (S.auto) setTimeout(() => next(true), 420); else render();
  }
  function next(auto) {
    if (S.idx + 1 >= S.queue.length) {
      finish(); return;
    }
    S.idx++; S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null; S.correctFlag = null;
    render(); saveSess();
  }
  function finish() {
    if (S.session && !S.ephemeral) { S.rec.sessions.push({ ...S.session }); if (S.rec.sessions.length > 300) S.rec.sessions = S.rec.sessions.slice(-300); saveRec(); }
    if (!S.ephemeral) clearSess(); else S.snap = loadJSON(LS.sess(S.user), null) || S.snap;
    S.view = 'summary'; render();
  }

  /* ---------- events ---------- */
  document.addEventListener('input', e => {
    const t = e.target;
    if (t && t.id === 'noteInline') { const q = S.queue[S.idx]; if (q) setNoteDraft(q.id, t.value); }
  }, true);

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (el) {
      const act = el.dataset.act, v = el.dataset.v, i = el.dataset.i, r = el.dataset.r;
      switch (act) {
        case 'fold': S.fold[v] = !S.fold[v]; render(); return;
        case 'tp': S.filter.tp = v; S.filter.chap = ''; S.filter.kp = ''; render(); return;
        case 'chap': S.filter.chap = v; S.filter.kp = ''; render(); return;
        case 'kp': S.filter.kp = v; render(); return;
        case 'scope': S.filter.scope = v; render(); return;
        case 'order': S.filter.order = v; render(); return;
        case 'start': startSession(); return;
        case 'clearSearch': S.sw = ''; render(); return;
        case 'back': goBack(); return;
        case 'refresh': if (el) el.classList.add('busy'); refreshAll(); return;
        case 'home': NAV = []; S.view = 'setup'; S.tab = 'quiz'; render(); return;
        case 'searchSheet': searchSheet(); return;
        case 'memo': pushPlace(currentPlace()); S.view = 'memo'; S.tab = 'quiz'; render(); return;
        case 'memoOpen': { const g = memoGroups()[v]; if (!g) return; S.mo[g.key] = !S.mo[g.key]; render(); return; }
        case 'memFilter': S.mf = v; render(); return;
        case 'memSort': S.msort = v; render(); return;
        case 'memDir': S.mdir = S.mdir === 1 ? -1 : 1; render(); return;
        case 'memoRate': {
          const g = memoGroups()[v]; if (!g) return;
          const cur = S.mem[g.key];
          S.mem[g.key] = (cur && cur.r === r) ? { r: '', ts: Date.now() } : { r, ts: Date.now() };
          saveMem(); render(); return;
        }
        case 'memoOpen2': { const g = memoGroups()[v]; if (!g) return; S.mo2[g.key] = !S.mo2[g.key]; render(); return; }
        case 'memoClear': S.mw = ''; render(); return;
        case 'memoToggleAll': { const gs = memoGroups(); if (Object.keys(S.mo).length) { S.mo = {}; S.mo2 = {}; } else { gs.forEach(g => S.mo[g.key] = true); } render(); return; }
        case 'cardSheet': cardSheet(); return;
        case 'closeSheet': closeSheet(); return;
        case 'goto': { const gi = parseInt(i === undefined ? v : i, 10); if (!isNaN(gi)) jumpTo(gi); closeSheet(); return; }
        case 'gotoNextNone': { const p = S.rec.progress || {}; const from = S.idx + 1; let k = -1;
          for (let j = from; j < S.queue.length; j++) { if (!p[S.queue[j].id]) { k = j; break; } }
          if (k < 0) for (let j = 0; j < from; j++) { if (!p[S.queue[j].id]) { k = j; break; } }
          if (k < 0) { toast('这一组都做过了'); return; } jumpTo(k); closeSheet(); return; }
        case 'listOpen': pushPlace(currentPlace()); S.listKind = v; S.listChap = ''; S.listFold = {}; S.view = 'lists'; S.tab = 'quiz'; render(); return;
        case 'listChap': S.listChap = el.dataset.v || ''; render(); return;
        case 'listChapFold': {
          S.listFold = S.listFold || {}; const k = el.dataset.v;
          S.listFold[k] = !S.listFold[k]; render(); return;
        }
        case 'listChapStart': {
          const g = listQueue(S.listKind).filter(q => q.chap === el.dataset.v);
          const nm = (g[0] && g[0].chname) || el.dataset.v;
          startCustom(g, 0, LIST_NAME[S.listKind] + "：" + nm);
          return;
        }
        case 'openListQ': {
          const list = listQueue(S.listKind);
          const i = list.findIndex(q => q.id === v);
          startCustom(list, i < 0 ? 0 : i, LIST_NAME[S.listKind] + '（' + list.length + '题）'); return;
        }
        case 'brushRes': {
          const rs = searchResults();
          startCustom(rs, 0, '搜索：' + S.sw.trim() + '（' + rs.length + '题）', undefined, { type: 'search', sw: S.sw }); return;
        }
        case 'openq': {
          const swq = S.sw; closeSheet();
          const rs = searchResults();
          const i = rs.findIndex(q => q.id === v);
          startCustom(rs, i < 0 ? 0 : i, '搜索：' + swq.trim() + '（' + rs.length + '题）', undefined, { type: 'search', sw: swq }); return;
        }
        case 'weakKp': {
          const [ch, kp] = String(v || '').split('|');
          const list = BANK.filter(q => q.ch === ch && q.kp === kp && (!S.rec.progress[q.id] || S.rec.progress[q.id].r !== 'known'));
          startCustom(list, 0, shortName(((CHS.find(c => c.id === ch)) || {}).name || '') + ' · ' + kp + ' · 待巩固'); return;
        }
        case 'weakAll': {
          const list = buildQueueWith({ chap: '', kp: '', scope: 'weak', order: 'seq' });
          startCustom(list, 0, '全部未掌握'); return;
        }
        case 'weakForgot': {
          const list = buildQueueWith({ chap: '', kp: '', scope: 'forgot', order: 'seq' });
          startCustom(list, 0, '只刷忘记的题'); return;
        }
        case 'resume': resumeSession(); return;
        case 'dropSess': clearSess(); render(); toast('已放弃上次进度'); return;
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
        case 'fixOpen': { const q = S.queue[S.idx]; if (q) fixSheet(q); return; }
        case 'dupToggle': {
          if (HIDDEN.size) { HIDDEN = new Set(); saveDedup(true); render(); toast('已关闭去重，题库恢复 ' + BANK.length + ' 题'); return; }
          const info = dupInfo(false);
          info.groups.forEach(g => {
            const sorted = g.items.slice().sort((a, b) => (a.y || '').localeCompare(b.y || ''));
            const keepId = sorted[0].id;
            g.items.forEach(q => { if (q.id !== keepId) HIDDEN.add(q.id); });
          });
          saveDedup(); render(); toast('已开启去重，题库剩 ' + BANK.length + ' 题');
          return;
        }
        case 'dedupOpen': S.dup = null; openSheet(dedupHTML()); return;
        case 'dupNoun': S.dup.includeNoun = !S.dup.includeNoun; S.dup.keep = {}; openSheet(dedupHTML()); return;
        case 'dupKeep': {
          const k = el.dataset.key, id = el.dataset.id;
          S.dup.keep[k] = id;
          el.parentNode.querySelectorAll('.dupchip').forEach(x => x.classList.toggle('on', x === el));
          const info = dupInfo(S.dup.includeNoun);
          const extra = info.groups.reduce((n, g) => n + g.items.length - 1, 0);
          const c = $('dupCount'); if (c) c.textContent = info.groups.length + ' 组 · 将隐藏 ' + extra + ' 条';
          return;
        }
        case 'dupApply': {
          const info = dupInfo(S.dup.includeNoun);
          info.groups.forEach(g => {
            const keep = S.dup.keep[g.key];
            g.items.forEach(q => { if (q.id !== keep) HIDDEN.add(q.id); });
          });
          saveDedup();
          closeSheet(); S.dup = null; render(); toast('已去重，题库剩 ' + BANK.length + ' 题');
          return;
        }
        case 'dupReset': {
          HIDDEN = new Set();
          saveDedup(true);
          closeSheet(); S.dup = null; render(); toast('已恢复全部题目');
          return;
        }
        case 'noteOpen': { const q = S.queue[S.idx]; if (q) openSheet(noteHTML(q)); return; }
        case 'noteSave': await saveNote(); return;
        case 'noteDel': await delNote(Number(el.dataset.ts)); return;
        case 'fixCancel': closeSheet(); S.fix = null; return;
        case 'fixSubmit': {
          collectFix();
          const q = qById(S.fix.id);
          if (!q || !diffFix(q).length) { toast('内容没有变化'); return; }
          S.fix.stage = 'confirm'; openSheet(fixHTML()); return;
        }
        case 'fixBack': S.fix.stage = 'edit'; openSheet(fixHTML()); return;
        case 'fixConfirm': await saveFix(); return;
        case 'fixAddBlock': collectFix(); S.fix.blocks.push(''); openSheet(fixHTML()); return;
        case 'fixDelBlock': { collectFix(); S.fix.blocks.splice(i, 1); openSheet(fixHTML()); return; }
        case 'fixSplit': {
          collectFix();
          const parts = S.fix.ans.split(/(?<=[。；;])/).map(t => t.trim()).filter(Boolean);
          S.fix.blocks = parts.length ? parts : [S.fix.ans];
          openSheet(fixHTML()); return;
        }
        case 'reveal': { const q = S.queue[S.idx]; S.revealed[q.id + ':' + i] = 1; render(); return; }
        case 'revealAll': { const q = S.queue[S.idx]; (q.pts || []).forEach((_, k) => S.revealed[q.id + ':' + k] = 1); render(); return; }
        case 'rate': rate(el.dataset.r); return;
        case 'sibOpen': {
          const id = el.dataset.id; const q2 = BYID[id];
          if (!q2) { toast('题目不存在'); return; }
          startCustom([q2], 0, '同题 · ' + id, undefined, currentPlace()); return;
        }
        case 'star': {
          const q = S.queue[S.idx]; const fav = S.rec.fav;
          const k = fav.indexOf(q.id);
          if (k >= 0) { fav.splice(k, 1); S.rec.favDel[q.id] = now(); delete S.rec.favTs[q.id]; }
          else { fav.push(q.id); S.rec.favTs[q.id] = now(); delete S.rec.favDel[q.id]; }
          saveRec(); render(); return;
        }
        case 'next': case 'skip': next(); return;
        case 'prev': if (S.idx > 0) { S.idx--; S.phase = 'ask'; S.revealed = {}; S.picked = null; S.rated = null; render(); } return;
        case 'again': S.view = 'quiz'; S.queue = buildQueue(); S.idx = 0; S.session = { t: now(), scope: scopeLabel().ch + ' · ' + scopeLabel().kp + ' · ' + scopeLabel().sc, n: 0, forgot: 0, vague: 0, known: 0, correct: 0, wrong: 0 }; S.phase = 'ask'; render(); return;
        case 'toSetup': NAV = []; S.view = 'setup'; S.tab = 'quiz'; render(); return;
        case 'syncNow': if (!S.token) { tokenSheet(); return; } toast('同步中…'); await pushToRepo(); statusSheet(); render(); return;
        case 'switchUser': userSheet(); return;
        case 'pickUser': flushThenSwitch(v); closeSheet(); return;
        case 'createUser': {
          const v2 = ($('newUser').value || '').trim().replace(/[\\/:*?"<>|]/g, '');
          if (!v2) { toast('请输入用户名'); return; }
          flushThenSwitch(v2); closeSheet(); return;
        }
        case 'tokenSheet': tokenSheet(); return;
        case 'saveToken': {
          S.token = ($('tk').value || '').trim();
          if (S.token && !/^(github_pat_|ghp_|github_pat_[A-Za-z0-9_]+)/.test(S.token)) toast('令牌格式不像 GitHub PAT，可能复制不全'); saveJSON(LS.token, S.token); closeSheet();
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
          adoptRec(mergeRec(S.rec, { ...j, u: S.user }));
          saveRec(); closeSheet(); toast('已导入并合并'); render();
        } catch (err) { toast('导入失败：' + err.message); }
      };
      rd.readAsText(f);
    }
  });
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'mq') {
      S.mw = e.target.value;
      const box2 = $('mlist'); if (box2) box2.innerHTML = memListHTML();
      return;
    }
    if (e.target && e.target.id === 'sq') {
      S.sw = e.target.value;
      const box = $('sres'); if (box) box.innerHTML = searchHTML();
    }
  });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    S.tab = t.dataset.tab;
    if (S.tab === 'quiz' && S.view === 'quiz' && !S.queue.length) S.view = 'setup';
    render();
  }));
  $('sheetMask').addEventListener('click', closeSheet);
  $('btnUser').addEventListener('click', statusSheet);

  /* ---------- boot ---------- */
  async function boot() {
    S.token = (function () {
      let t = loadJSON(LS.token, '') || localStorage.getItem(LS.token) || '';
      if (typeof t === 'string') t = t.trim().replace(/^["']+|["']+$/g, '');
      return t;
    })();
    if (S.token) saveJSON(LS.token, S.token);
    S.repo = localStorage.getItem(LS.repo) || S.repo;
    S.branch = localStorage.getItem(LS.branch) || 'main';
    S.auto = loadJSON(LS.auto, true);
    let cur = localStorage.getItem(LS.cur) || '';
    cur = cur.trim();
    if (cur.charAt(0) === '"') { try { cur = JSON.parse(cur); } catch (e) { cur = cur.replace(/^"|"$/g, ''); } }
    if (cur.indexOf('\\"') >= 0) cur = cur.replace(/\\?"/g, '');
    applyFixesCache();                 // 修复：同步读缓存，先保证题库是校订后的
    applyNotesCache();                 // 笔记也先读缓存
    loadDupGroupsCache();              // 判重分组：随页面同步加载
    loadDedupCache();                  // 去重：同步读缓存，先按已去重的题库渲染
    pruneHiddenByGroups();             // 新规则下不再成立的旧隐藏项放回
    if (!cur) { render(); userSheet(); loadRemoteIndex(); loadFixesRemote(); loadNotesRemote(); loadDedupRemote(); return; }
    setUser(cur, true);                // 先用本地记录渲染，不等网络
    loadRemoteIndex(); loadFixesRemote(); loadNotesRemote(); loadDedupRemote();
    if (S.token) pullFromRepo(cur, true); else setSync('off', '仅本地（未配置令牌）');
  }
  async function autoPull(force) {
    if (document.visibilityState !== 'visible') return;
    if (force || now() - LAST_SHARED > 60000) {  // 别人的纠错/笔记/去重开关，回到前台也拉一次
      LAST_SHARED = now();
      Promise.allSettled([loadRemoteIndex(), loadFixesRemote(true), loadNotesRemote(true), loadDedupRemote(true)]);
    }
    if (!S.token || !S.user) return;
    if (!force && now() - LAST_PULL < 20000) return;
    LAST_PULL = now();
    await pullFromRepo(S.user, true);
  }
  function flushSync() {
    if (!S.token || !S.user) return;
    clearTimeout(S._syncTimer);
    pushToRepo();
  }
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { saveSess(); flushSync(); }
    else autoPull();                       // 手机切回来先拉一次别的设备的改动
  });
  window.addEventListener('focus', () => { autoPull(); });
  window.addEventListener('online', () => { autoPull(true); if (S._dirty) pushToRepo(); });
  window.addEventListener('pagehide', () => { saveSess(); flushSync(); });
  boot();
})();
