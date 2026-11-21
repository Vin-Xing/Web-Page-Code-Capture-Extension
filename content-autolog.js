// ============================================================
// 网页完整代码捕获插件 v1.1 - 自动记录（常驻 content script，仅顶层 frame）
// 开关默认关闭。开启后，页面上每次 click / change 后 400ms 存一份轻量快照到
// chrome.storage.local，最多 30 条，可在 popup 里一次性复制或下载导出。
// 快照复用 capture-core.js 的 ykCaptureFrame('summary')，不返回完整 HTML。
// ============================================================
(function () {
  'use strict';

  if (window.top !== window) return;
  if (window.__YK_AUTOLOG_INSTALLED__) return;
  window.__YK_AUTOLOG_INSTALLED__ = true;

  var KEY_ENABLED = 'yk_autolog_enabled';
  var KEY_SNAPS = 'yk_snapshots';
  var MAX_SNAPS = 30;
  var enabled = false;

  try {
    chrome.storage.local.get(KEY_ENABLED, function (r) {
      enabled = !!(r && r[KEY_ENABLED]);
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes[KEY_ENABLED]) {
        enabled = !!changes[KEY_ENABLED].newValue;
      }
    });
  } catch (e) {}

  function trunc(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + ' ...[截断]' : s;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function nowStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function makeSnapshot(clickHTML) {
    try {
      if (typeof ykCaptureFrame !== 'function') return null;
      var r = ykCaptureFrame('summary');
      var s = r.summary || {};
      var de = (s.dealElements || []).slice(0, 3).map(function (h) {
        return { tag: h.tag, outerHTML: trunc(h.outerHTML, 400), parentTdHTML: trunc(h.parentTdHTML, 700) };
      });
      var bare = (s.bareDealTextNodes || []).slice(0, 1).map(function (h) {
        return { tdHTML: trunc(h.tdHTML, 700) };
      });
      var tables = (s.tables || []).slice(0, 3).map(function (t) {
        return { index: t.index, rows: t.rows, headText: trunc(t.headText, 120) };
      });
      var iframes = (s.iframes || []).slice(0, 6).map(function (f) { return f.src; });

      return {
        time: nowStr(),
        url: r.url,
        title: trunc(r.title, 120),
        click: trunc(clickHTML, 320),
        dealButtonMarkedCount: s.dealButtonMarkedCount || 0,
        dealElements: de,
        bareDealTextNodes: bare,
        tables: tables,
        iframes: iframes,
        rootDataAttrs: s.rootDataAttrs || {}
      };
    } catch (e) {
      return { time: nowStr(), error: String(e && e.message ? e.message : e), url: location.href };
    }
  }

  function save(snap) {
    try {
      chrome.storage.local.get(KEY_SNAPS, function (r) {
        var list = (r && r[KEY_SNAPS]) || [];
        if (Object.prototype.toString.call(list) !== '[object Array]') list = [];
        list.push(snap);
        while (list.length > MAX_SNAPS) list.shift();
        try { chrome.storage.local.set({ yk_snapshots: list }); } catch (e2) {}
      });
    } catch (e) {}
  }

  var timer = null;
  var pendingClick = '';
  function schedule(clickHTML) {
    if (!enabled) return;
    if (clickHTML) pendingClick = clickHTML;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      var snap = makeSnapshot(pendingClick);
      pendingClick = '';
      if (snap) save(snap);
    }, 400);
  }

  function targetHTML(e) {
    try {
      var t = e && e.target;
      if (!t || !t.outerHTML) return '';
      return t.outerHTML;
    } catch (err) { return ''; }
  }

  document.addEventListener('click', function (e) { schedule(targetHTML(e)); }, true);
  document.addEventListener('change', function (e) { schedule(targetHTML(e)); }, true);
})();
