// ============================================================
// 网页完整代码捕获插件 v1.1 - popup 逻辑
// v1.1 修复：executeScript 的 target 改用 frameIds:[id]，并加「全部失败时的兜底注入」。
// 捕获动作发生在页面各 frame 里（ykCaptureFrame），本文件只负责汇总、
// 格式化、复制 / 下载，以及「自动记录」记录的读取与导出。
// ============================================================
(function () {
  'use strict';

  var hasExtApi = (function () {
    try {
      return typeof chrome !== 'undefined' && !!(chrome.tabs && chrome.scripting &&
        chrome.webNavigation && chrome.storage && chrome.storage.local);
    } catch (e) { return false; }
  })();

  var state = {
    tab: null,
    frames: [],
    results: [],
    fullText: '',
    summaryText: '',
    capturedAt: '',
    view: 'summary'
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function nowStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function fileStamp() {
    var d = new Date();
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function fmtSize(n) {
    return n < 1024 ? n + ' B' : (n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(2) + ' MB');
  }
  function setStatus(msg, kind) {
    els.status.textContent = msg;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  // ---------------- 格式化诊断摘要 ----------------
  function linesForSummary(r, idx) {
    var s = r.summary || {};
    var L = [];
    L.push('【Frame ' + idx + ' | ' + (r.isTop ? '顶层 TOP' : 'iframe') + '】');
    L.push('  URL: ' + r.url);
    L.push('  标题: ' + r.title + ' | readyState: ' + r.readyState + ' | charset: ' + r.charset);
    L.push('  body 大小: ' + fmtSize(r.bodyLength || 0));
    L.push('  html 根元素 data-* 标记: ' + JSON.stringify(s.rootDataAttrs || {}));
    L.push('  ★ 已被「成交大按钮」改造的元素数: ' + (s.dealButtonMarkedCount || 0));

    var de = s.dealElements || [];
    L.push('  ★ 文字为「成交」的元素: 共 ' + de.length + ' 个（最多显示 5 个详情）');
    for (var i = 0; i < de.length && i < 5; i++) {
      var h = de[i];
      L.push('    [' + (i + 1) + '] <' + h.tag + '> 文本=' + JSON.stringify(h.text) +
        ' 已改造=' + h.markedByDealButton);
      L.push('        outerHTML: ' + h.outerHTML);
      L.push('        所在 td 文本: ' + h.parentTdText);
      L.push('        所在 td HTML: ' + h.parentTdHTML);
    }
    for (var j = 5; j < de.length && j < 20; j++) {
      L.push('    [' + (j + 1) + '] <' + de[j].tag + '> ' + short(de[j].outerHTML, 220));
    }

    var bare = s.bareDealTextNodes || [];
    L.push('  ★ td 内裸「成交」文本节点: 共 ' + bare.length + ' 个');
    for (var b = 0; b < bare.length && b < 2; b++) {
      L.push('    [' + (b + 1) + '] td 文本: ' + bare[b].tdText);
      L.push('        td HTML: ' + bare[b].tdHTML);
    }

    var tb = s.tables || [];
    L.push('  表格: 共列出 ' + tb.length + ' 个');
    for (var t = 0; t < tb.length; t++) {
      L.push('    #' + tb[t].index + ' 行数=' + tb[t].rows + ' 首行=' + tb[t].headText);
    }

    var ifr = s.iframes || [];
    L.push('  iframe: 共 ' + ifr.length + ' 个');
    for (var f = 0; f < ifr.length; f++) {
      L.push('    #' + f + ' id=' + JSON.stringify(ifr[f].id) + ' name=' + JSON.stringify(ifr[f].name) +
        ' src=' + ifr[f].src + ' 同源可读=' + ifr[f].sameOriginReadable);
    }

    var res = s.resources || [];
    L.push('  外部 script/css: ' + res.length + ' 条');
    for (var k = 0; k < res.length && k < 12; k++) L.push('    ' + res[k]);
    L.push('  表单数: ' + (s.forms || 0));
    L.push('');
    return L.join('\n');
  }

  function buildTexts() {
    var meta = [
      '===== 网页完整代码捕获 v1.1 | ' + state.capturedAt + ' =====',
      '标签页标题: ' + (state.tab && state.tab.title ? state.tab.title : ''),
      '标签页 URL: ' + (state.tab && state.tab.url ? state.tab.url : ''),
      'Frame 总数: ' + state.frames.length + '（成功捕获 ' + state.results.filter(function (r) { return !r.error; }).length + ' 个）',
      ''
    ].join('\n');

    var sumParts = [meta, '===== 诊断摘要 =====', ''];
    state.results.forEach(function (r, i) {
      if (r.error) {
        sumParts.push('【Frame ' + i + '】捕获失败: ' + r.error + ' | URL: ' + r.frameUrl);
      } else {
        sumParts.push(linesForSummary(r, i));
      }
    });
    state.summaryText = sumParts.join('\n');

    // 完整源码 = 元信息 + 诊断摘要 + 每个 frame 的 outerHTML
    var fullParts = [meta, '===== 诊断摘要（见下）与完整源码（含所有 frame） =====', '', state.summaryText, ''];
    state.results.forEach(function (r, i) {
      if (r.error) {
        fullParts.push('===== [Frame ' + i + '] 捕获失败: ' + r.error + ' | ' + r.frameUrl + ' =====\n');
      } else {
        fullParts.push('===== [Frame ' + i + '] ' + (r.isTop ? 'TOP' : 'iframe') + ' | ' + r.url + ' =====');
        fullParts.push(r.html || '(此 frame 未返回 HTML)');
        fullParts.push('');
      }
    });
    state.fullText = fullParts.join('\n');
  }

  // ---------------- 捕获 ----------------
  async function capture() {
    if (!hasExtApi) {
      setStatus('当前是界面预览。请从 Edge 工具栏的扩展图标打开本弹窗。', 'err');
      return;
    }
    setStatus('正在捕获所有 frame，请稍候…');
    els.btnSummary.disabled = els.btnFull.disabled = els.btnDownload.disabled = true;
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs && tabs[0];
      if (!tab || !tab.id) throw new Error('拿不到当前标签页');
      state.tab = tab;
      els.tabUrl.textContent = '当前页面: ' + (tab.url || '(无 URL)');

      var frames = [];
      try {
        frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      } catch (e) {
        frames = [{ frameId: 0, url: tab.url }];
      }
      if (!frames || !frames.length) frames = [{ frameId: 0, url: tab.url }];
      state.frames = frames;

      var results = [];
      for (var i = 0; i < frames.length; i++) {
        var fr = frames[i];
        try {
          var injected = await chrome.scripting.executeScript({
            // Chrome MV3 的 InjectionTarget 用的是 frameIds(数组)，不是 frameId(单数)。
            // v1.0 写成单数 → 报 "Unexpected property: 'frameId'"，1 个 frame 都抓不到。
            target: { tabId: tab.id, frameIds: [fr.frameId] },
            func: ykCaptureFrame,
            args: ['full']
          });
          var val = injected && injected[0] && injected[0].result;
          if (!val) throw new Error('无返回数据');
          val.frameId = fr.frameId;
          results.push(val);
        } catch (e) {
          results.push({ error: String(e && e.message ? e.message : e), frameUrl: fr.url, frameId: fr.frameId });
        }
      }
      // 兜底：万一某些 Edge/Chrome 版本对 frameIds 支持有差异、导致所有 frame 都失败，
      // 退化成「不指定 frame」，让浏览器注入到该标签页的所有 frame 并取回全部结果，
      // 避免又出现「成功捕获 0 个」却拿不到任何源码的情况。
      if (results.length && results.every(function (r) { return !!r.error; })) {
        try {
          const fallbackInjected = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: ykCaptureFrame,
            args: ['full']
          });
          const vals = (fallbackInjected || []).map(function (x) { return x && x.result; }).filter(Boolean);
          if (vals.length) {
            results.length = 0;
            vals.forEach(function (v, i) { v.frameId = i; results.push(v); });
            frames = vals.map(function (v, i) { return { frameId: i, url: v.url }; });
            state.frames = frames;
          }
        } catch (e2) { /* 保留原始错误信息用于诊断 */ }
      }

      state.results = results;
      state.capturedAt = nowStr();
      buildTexts();
      renderOutput();
      var okCount = results.filter(function (r) { return !r.error; }).length;
      setStatus('捕获完成：' + okCount + '/' + frames.length + ' 个 frame，完整源码 ' +
        fmtSize(state.fullText.length) + '，诊断摘要 ' + fmtSize(state.summaryText.length), 'ok');
      refreshLogInfo();
    } catch (e) {
      setStatus('捕获失败: ' + (e && e.message ? e.message : e), 'err');
    } finally {
      els.btnSummary.disabled = els.btnFull.disabled = els.btnDownload.disabled = false;
    }
  }

  function renderOutput() {
    var text = state.view === 'full' ? state.fullText : state.summaryText;
    // 文本框只预览前 200KB，完整内容请用复制 / 下载
    if (text.length > 200000) {
      text = text.slice(0, 200000) + '\n\n…[预览仅显示前 200KB，完整内容请用「复制」或「下载」按钮]…';
    }
    els.output.value = text || '（暂无内容，请点「重新捕获」）';
    els.tabViewSummary.classList.toggle('active', state.view === 'summary');
    els.tabViewFull.classList.toggle('active', state.view === 'full');
  }

  // ---------------- 复制 / 下载 ----------------
  async function copyText(text, label) {
    if (!text) { setStatus('没有可复制的内容，请先捕获', 'err'); return; }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已复制' + label + '（' + fmtSize(text.length) + '），可直接粘贴发我', 'ok');
    } catch (e) {
      els.output.value = text;
      els.output.focus();
      els.output.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) {}
      setStatus(ok ? '已复制' + label + '（' + fmtSize(text.length) + '）' :
        '自动复制失败，已把内容放进文本框，请 Ctrl+A / Ctrl+C 手动复制', ok ? 'ok' : 'err');
    }
  }

  function download(text, filename) {
    if (!text) { setStatus('没有可下载的内容，请先捕获', 'err'); return; }
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
      setStatus('已下载 ' + filename + '（' + fmtSize(text.length) + '）', 'ok');
    } catch (e) {
      setStatus('下载失败: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  // ---------------- 自动记录 ----------------
  function storageGet(keys) {
    return new Promise(function (resolve) {
      if (!hasExtApi) return resolve({});
      chrome.storage.local.get(keys, function (r) { resolve(r || {}); });
    });
  }
  function storageSet(obj) {
    return new Promise(function (resolve) {
      if (!hasExtApi) return resolve();
      chrome.storage.local.set(obj, function () { resolve(); });
    });
  }

  async function refreshLogInfo() {
    var r = await storageGet(['yk_snapshots', 'yk_autolog_enabled']);
    var list = r.yk_snapshots || [];
    els.logCount.textContent = list.length + ' 条';
    els.autolog.checked = !!r.yk_autolog_enabled;
  }

  function formatSnapshots(list) {
    var parts = ['===== 操作记录（共 ' + list.length + ' 条）| 导出于 ' + nowStr() + ' ====='];
    list.forEach(function (s, i) {
      parts.push('');
      parts.push('----- 第 ' + (i + 1) + ' 条 | ' + s.time + ' -----');
      parts.push('URL: ' + s.url);
      parts.push('标题: ' + s.title);
      parts.push('点击目标: ' + (s.click || '(无)'));
      parts.push('已被成交大按钮改造的元素数: ' + (s.dealButtonMarkedCount || 0));
      parts.push('html 根元素 data-* 标记: ' + JSON.stringify(s.rootDataAttrs || {}));
      parts.push('「成交」元素片段:');
      (s.dealElements || []).forEach(function (h, j) {
        parts.push('  [' + (j + 1) + '] <' + h.tag + '> ' + h.outerHTML);
        parts.push('      td: ' + h.parentTdHTML);
      });
      if ((s.bareDealTextNodes || []).length) {
        parts.push('裸「成交」文本节点 td: ' + s.bareDealTextNodes[0].tdHTML);
      }
      parts.push('表格: ' + JSON.stringify((s.tables || []).slice(0, 3)));
      parts.push('iframe src: ' + JSON.stringify((s.iframes || []).slice(0, 6)));
    });
    return parts.join('\n');
  }

  // ---------------- 初始化 ----------------
  function init() {
    ['status', 'tabUrl', 'output', 'btnSummary', 'btnFull', 'btnDownload', 'btnRecapture',
      'tabViewSummary', 'tabViewFull', 'autolog', 'logCount', 'btnLogsCopy',
      'btnLogsDownload', 'btnLogsClear'].forEach(function (id) { els[id] = $(id); });

    els.btnSummary.addEventListener('click', function () { copyText(state.summaryText, '诊断摘要'); });
    els.btnFull.addEventListener('click', function () { copyText(state.fullText, '完整源码'); });
    els.btnDownload.addEventListener('click', function () {
      download(state.fullText, '网页完整源码_' + fileStamp() + '.txt');
    });
    els.btnRecapture.addEventListener('click', capture);
    els.tabViewSummary.addEventListener('click', function () { state.view = 'summary'; renderOutput(); });
    els.tabViewFull.addEventListener('click', function () { state.view = 'full'; renderOutput(); });

    els.autolog.addEventListener('change', async function () {
      await storageSet({ yk_autolog_enabled: els.autolog.checked });
      setStatus(els.autolog.checked ? '自动记录已开启：在页面上每次点击都会存一条' : '自动记录已关闭',
        els.autolog.checked ? 'ok' : '');
    });

    els.btnLogsCopy.addEventListener('click', async function () {
      var r = await storageGet(['yk_snapshots']);
      var list = r.yk_snapshots || [];
      if (!list.length) { setStatus('还没有记录，先开启自动记录并在页面上操作', 'err'); return; }
      copyText(formatSnapshots(list), '全部操作记录（' + list.length + ' 条）');
    });
    els.btnLogsDownload.addEventListener('click', async function () {
      var r = await storageGet(['yk_snapshots']);
      var list = r.yk_snapshots || [];
      if (!list.length) { setStatus('还没有记录，先开启自动记录并在页面上操作', 'err'); return; }
      download(formatSnapshots(list), '网页操作记录_' + fileStamp() + '.txt');
    });
    els.btnLogsClear.addEventListener('click', async function () {
      await storageSet({ yk_snapshots: [] });
      await refreshLogInfo();
      setStatus('记录已清空', 'ok');
    });

    if (!hasExtApi) {
      els.tabUrl.textContent = '界面预览模式（非扩展环境）';
      setStatus('请从 Edge 工具栏的扩展图标打开本弹窗后使用。', 'err');
      els.output.value = '安装步骤：\n1. edge://extensions\n2. 打开「开发人员模式」\n3. 「加载解压缩的扩展程序」→ 选本插件文件夹\n4. 把图标固定到工具栏，点开即用';
      ['btnSummary', 'btnFull', 'btnDownload', 'btnRecapture', 'autolog',
        'btnLogsCopy', 'btnLogsDownload', 'btnLogsClear'].forEach(function (id) { els[id].disabled = true; });
      els.logCount.textContent = '需扩展环境';
      return;
    }
    refreshLogInfo();
    capture();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
