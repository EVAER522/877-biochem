/* 人工校订覆盖层：刷题页加载时用这里的答案覆盖 questions.js 中的对应题，
   避免每次改几道题都要重传 500KB 的题库文件。新增修订只需在 F 里加一行。 */
(function () {
  var F = {
    '2022-选18': { a: 'B（可抑制鸟嘌呤脱氨酶）', c: 'B' },
    '2008-选5': { a: 'D（生物素）', c: 'D' },
    '2008-填11': { a: '(28) 逆转录；(29) DNA的突变和DNA损伤修复' },
    '2008-填15': { a: '(36) 操纵基因（O）；(37) 结构基因（lacZ、lacY、lacA）；(38) 调节基因（lacI）' }
  };
  (window.QBANK || []).forEach(function (q) {
    var f = F[q.id];
    if (!f) return;
    if (f.a) q.ans = f.a + (q.kp ? '｜考点：' + q.kp : '');
    if (f.c) q.correct = f.c;
  });
})();
