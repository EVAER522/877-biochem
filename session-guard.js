/* 临时会话保护：在「搜索」进入的刷题过程中，不写入/清除断点记录，
   保证章节进度（qb.sess.*）不被搜索小队列覆盖。 */
(function () {
  var PRE = 'qb.sess.';
  var si = Storage.prototype.setItem, ri = Storage.prototype.removeItem;
  function inSearch() {
    var t = document.getElementById('tbSub');
    return !!t && /搜索：/.test(t.textContent || '');
  }
  Storage.prototype.setItem = function (k, v) {
    if (k && k.indexOf(PRE) === 0 && inSearch()) return;
    return si.call(this, k, v);
  };
  Storage.prototype.removeItem = function (k) {
    if (k && k.indexOf(PRE) === 0 && inSearch()) return;
    return ri.call(this, k);
  };
})();
