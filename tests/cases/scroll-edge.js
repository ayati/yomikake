// 章末判定（EPUB_EDGE）が 1px の丸め誤差で壊れないことの検査
//
// 発端: Windows の拡大表示（125%/150%）だと 100vw が小数になり、
//       scrollWidth（切り上げ）− 2×clientWidth（切り捨て）が 1–2px の正値になる。
//       本文がちょうど 1 画面ぶんの全画面画像ページでは、この誤差だけの「余白ゾーン」が
//       生まれ、次へを押すと章が変わらず真っ白なページが 1 枚挟まっていた。
//       （実機: Chrome だけ再現・Edge/Firefox は窓幅の丸めが偶然噛み合っていただけ）
//
// ここでは padding を calc(100vw + 1px) にして誤差を再現し、
// 「1px の余りは誤差として畳んで EPUB_EDGE を出す」ことを確かめる。
// 併せて、本物の複数画面ぶんの本文では即 EDGE しないこと（畳みすぎ）も見る。

var IS_IOS = (typeof _handleKeys === 'undefined');
T('buildScrollScript がある', typeof buildScrollScript === 'function');

function mkFrame(css, inner, src) {
  return new Promise(function (resolve) {
    var f = document.createElement('iframe');
    f.style.cssText = 'position:absolute;left:-10000px;top:0;width:400px;height:300px;border:0';
    document.body.appendChild(f);
    f.addEventListener('load', function () { resolve(f); });
    f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css +
      '</style></head><body>' + inner +
      '<' + 'script>' + src + '<' + '/' + 'script></body></html>';
  });
}

// EPUB_SCROLL を投げて、返ってくる EPUB_EDGE の有無を見る
function scrollOnce(f) {
  return new Promise(function (resolve) {
    var edge = false;
    function onMsg(e) {
      if (e.source === f.contentWindow && e.data && e.data.type === 'EPUB_EDGE') edge = true;
    }
    window.addEventListener('message', onMsg);
    f.contentWindow.postMessage({ type: 'EPUB_SCROLL', direction: 1 }, '*');
    setTimeout(function () {
      window.removeEventListener('message', onMsg);
      resolve(edge);
    }, 250);
  });
}

// ── 縦書き（h 軸）──
// 本体: html に padding-left:100vw、iOS 版: body を transform で動かす
var V_CSS_PC =
  'html{writing-mode:vertical-rl;height:100%;width:100%;overflow-y:hidden;margin:0;' +
    'padding-left:calc(100vw + {SURPLUS}px)}' +
  'body{writing-mode:vertical-rl;margin:0;height:100%;width:{PANES}00%;overflow-y:hidden;' +
    'box-sizing:border-box}' +
  'div.pane{width:100%;height:100%}';
var V_CSS_IOS =
  'html{height:100%;overflow:hidden;writing-mode:horizontal-tb;margin:0}' +
  'body{position:fixed;top:0;bottom:0;left:0;writing-mode:vertical-rl;width:max-content;margin:0}' +
  'div.pane{width:calc({PANES}00vw + {SURPLUS}px);height:100%}';

function vcss(panes, surplus) {
  return (IS_IOS ? V_CSS_IOS : V_CSS_PC)
    .replace(/\{PANES\}/g, String(panes)).replace(/\{SURPLUS\}/g, String(surplus));
}

var src = buildScrollScript('start', 'vertical', 1);

// (1) 本文ちょうど 1 画面 + 1px の丸め誤差 → 誤差として畳んで EDGE
mkFrame(vcss(1, 1), '<div class="pane"></div>', src).then(function (f) {
  var d = f.contentDocument.documentElement, b = f.contentDocument.body;
  var surplus = IS_IOS ? (b.offsetWidth - f.contentWindow.innerWidth)
                       : (d.scrollWidth - 2 * d.clientWidth);
  T('縦書き: 1px の余りを再現できている', surplus >= 1 && surplus <= 3, '余り=' + surplus);
  return scrollOnce(f).then(function (edge) {
    T('縦書き: 1画面+誤差1px なら空白を挟まず章が終わる', edge,
      '余り=' + surplus + ' / EPUB_EDGE=' + edge);
    f.remove();
  });
}).then(function () {
  // (2) 本文が 3 画面ぶんある本では即 EDGE しない（畳みすぎ検出）
  return mkFrame(vcss(3, 0), '<div class="pane"></div>', src).then(function (f) {
    return scrollOnce(f).then(function (edge) {
      T('縦書き: 本文が複数画面あるときは畳まずスクロールする', !edge);
      f.remove();
    });
  });
}).catch(function (e) {
  T('縦書きの検査が例外', false, e && (e.stack || e.message));
});

// ── 横書き（v 軸）──
var H_CSS_PC =
  'html{writing-mode:horizontal-tb;margin:0;padding-bottom:calc(100vh + {SURPLUS}px)}' +
  'body{margin:0}' +
  'div.pane{height:{PANES}00vh}';
var H_CSS_IOS =
  'html{height:100%;overflow:hidden;margin:0}' +
  'body{position:fixed;left:0;right:0;top:0;height:max-content;margin:0}' +
  'div.pane{height:calc({PANES}00vh + {SURPLUS}px)}';
function hcss(panes, surplus) {
  return (IS_IOS ? H_CSS_IOS : H_CSS_PC)
    .replace(/\{PANES\}/g, String(panes)).replace(/\{SURPLUS\}/g, String(surplus));
}
var hsrc = buildScrollScript('start', 'horizontal', 1);

mkFrame(hcss(1, 1), '<div class="pane"></div>', hsrc).then(function (f) {
  var d = f.contentDocument.documentElement, b = f.contentDocument.body;
  var surplus = IS_IOS ? (b.offsetHeight - f.contentWindow.innerHeight)
                       : (d.scrollHeight - 2 * d.clientHeight);
  T('横書き: 1px の余りを再現できている', surplus >= 1 && surplus <= 3, '余り=' + surplus);
  return scrollOnce(f).then(function (edge) {
    T('横書き: 1画面+誤差1px なら空白を挟まず章が終わる', edge,
      '余り=' + surplus + ' / EPUB_EDGE=' + edge);
    f.remove();
  });
}).then(function () {
  return mkFrame(hcss(3, 0), '<div class="pane"></div>', hsrc).then(function (f) {
    return scrollOnce(f).then(function (edge) {
      T('横書き: 本文が複数画面あるときは畳まずスクロールする', !edge);
      f.remove();
    });
  });
}).catch(function (e) {
  T('横書きの検査が例外', false, e && (e.stack || e.message));
});

// 3 モードとも同じ許容値を持つこと（片方だけ直す事故の検知）
['vertical', 'horizontal', 'publisher'].forEach(function (mode) {
  var s = buildScrollScript('start', mode, 1);
  T(mode + ': 丸め誤差の許容値を持つ', s.indexOf('EDGE_EPS') > 0);
});
