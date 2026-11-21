// ============================================================
// 网页完整代码捕获插件 - 捕获核心（纯函数，可注入页面 / 可单独测试）
//
// ykCaptureFrame(mode) 会被 chrome.scripting.executeScript 序列化后注入到
// 每一个 frame 里执行，所以函数体必须完全自包含，不能引用外部变量。
//   mode = 'full'    → 返回完整 HTML（含 doctype）+ 诊断摘要
//   mode = 'summary' → 只返回诊断摘要（自动记录用，轻量）
// ============================================================
function ykCaptureFrame(mode) {
  var d = document;
  var win = window;

  function trunc(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + ' ...[截断]' : s;
  }
  function norm(s) {
    return String(s == null ? '' : s).replace(/[\s\u00a0\u3000]+/g, '');
  }
  function absUrl(u) {
    try { return new URL(u, win.location.href).href; } catch (e) { return u; }
  }

  // ---------- 完整 HTML ----------
  var doctype = '';
  try {
    if (d.doctype) doctype = new XMLSerializer().serializeToString(d.doctype) + '\n';
  } catch (e) {
    if (d.doctype) doctype = '<!DOCTYPE ' + d.doctype.name + '>\n';
  }
  var html = '';
  if (mode !== 'summary' && d.documentElement) {
    html = doctype + d.documentElement.outerHTML;
  }

  // ---------- 诊断摘要 ----------
  var rootAttrs = {};
  try {
    if (d.documentElement) {
      var attrs = d.documentElement.attributes;
      for (var a = 0; a < attrs.length; a++) {
        if (attrs[a].name.indexOf('data-') === 0) rootAttrs[attrs[a].name] = trunc(attrs[a].value, 200);
      }
    }
  } catch (e) {}

  var dealBtnCount = 0;
  try { dealBtnCount = d.querySelectorAll('[data-yk-deal-btn]').length; } catch (e) {}

  // 所有文字精确等于「成交」的元素
  var dealHits = [];
  try {
    var all = d.querySelectorAll('a, span, font, b, strong, u, em, div, button, li, td, input');
    for (var i = 0; i < all.length && dealHits.length < 20; i++) {
      var el = all[i];
      var txt = norm(el.tagName === 'INPUT' ? (el.value || '') : (el.textContent || ''));
      if (txt !== '成交') continue;
      // 嵌套时只记最内层，避免 <a><font>成交</font></a> 记两条
      if (el.children && el.children.length) {
        var inner = el.querySelectorAll('*');
        var isInner = false;
        for (var q = 0; q < inner.length; q++) {
          if (norm(inner[q].textContent) === '成交') { isInner = true; break; }
        }
        if (isInner) continue;
      }
      var td = null;
      try { td = el.closest ? el.closest('td') : null; } catch (e2) {}
      dealHits.push({
        tag: el.tagName.toLowerCase(),
        text: trunc(el.textContent || el.value || '', 60),
        outerHTML: trunc(el.outerHTML, 700),
        parentTdHTML: td ? trunc(td.outerHTML, 1600) : '(不在 td 内)',
        parentTdText: td ? trunc(norm(td.textContent), 200) : '',
        markedByDealButton: el.hasAttribute ? el.hasAttribute('data-yk-deal-btn') : false
      });
    }
  } catch (e) {}

  // td 里没有任何元素包裹的裸「成交」文本节点
  var bareDealHits = [];
  try {
    var tds = d.querySelectorAll('td');
    for (var t = 0; t < tds.length && bareDealHits.length < 10; t++) {
      var walker = d.createTreeWalker(tds[t], win.NodeFilter.SHOW_TEXT, null, false);
      while (walker.nextNode()) {
        var node = walker.currentNode;
        if (norm(node.nodeValue) !== '成交') continue;
        var p = node.parentElement;
        if (p && p !== tds[t] && norm(p.textContent) === '成交') continue;
        bareDealHits.push({ tdHTML: trunc(tds[t].outerHTML, 1600), tdText: trunc(norm(tds[t].textContent), 200) });
        break;
      }
    }
  } catch (e) {}

  // 表格结构（表头文字 + 行数）
  var tables = [];
  try {
    var tbls = d.querySelectorAll('table');
    for (var k = 0; k < tbls.length && k < 12; k++) {
      var firstRow = tbls[k].querySelector('tr');
      tables.push({
        index: k,
        rows: tbls[k].rows ? tbls[k].rows.length : 0,
        headText: firstRow ? trunc(norm(firstRow.textContent), 240) : ''
      });
    }
  } catch (e) {}

  // iframe 列表（是否同源可读）
  var iframes = [];
  try {
    var ifr = d.querySelectorAll('iframe');
    for (var m = 0; m < ifr.length && m < 20; m++) {
      var readable = false;
      try { readable = !!ifr[m].contentDocument; } catch (e3) { readable = false; }
      iframes.push({
        id: ifr[m].id || '',
        name: ifr[m].name || '',
        src: ifr[m].getAttribute('src') || '',
        absUrl: absUrl(ifr[m].getAttribute('src') || ''),
        sameOriginReadable: readable
      });
    }
  } catch (e) {}

  // 外部 script / css 资源
  var resources = [];
  try {
    var rs = d.querySelectorAll('script[src], link[rel~="stylesheet"][href]');
    for (var r = 0; r < rs.length && r < 30; r++) {
      resources.push(rs[r].tagName.toLowerCase() + ': ' + absUrl(rs[r].getAttribute('src') || rs[r].getAttribute('href') || ''));
    }
  } catch (e) {}

  return {
    url: win.location.href,
    title: d.title || '',
    isTop: (win.top === win),
    readyState: d.readyState,
    charset: d.characterSet || '',
    htmlLength: html.length,
    bodyLength: d.body ? d.body.innerHTML.length : 0,
    html: html,
    summary: {
      rootDataAttrs: rootAttrs,
      dealButtonMarkedCount: dealBtnCount,
      dealElements: dealHits,
      bareDealTextNodes: bareDealHits,
      tables: tables,
      iframes: iframes,
      resources: resources,
      forms: d.forms ? d.forms.length : 0
    }
  };
}
