/* 令牌持久化修正（在 app.js 之前执行）：localStorage 里存的 JSON 引号会让
   Authorization 头变成 Bearer "github_pat_..."，GitHub 返回 401，表现为
   “重开网页就得重新输一次令牌”。这里统一存成裸字符串。 */
(function () {
  try {
    var raw = localStorage.getItem('qb.token');
    if (!raw) return;
    var t = raw;
    try { t = JSON.parse(raw); } catch (e) { }
    if (typeof t !== 'string') t = '';
    t = t.trim().replace(/^["']+|["']+$/g, '').trim();
    if (!t) { localStorage.removeItem('qb.token'); return; }
    if (t !== raw) localStorage.setItem('qb.token', t);
  } catch (e) { }
})();
