// 縦書きページ送り（scanH / smartStepH / 端の見切れ行マスク）の実寸検査
//
// yomikake.html 専用（yomikake_ios.html は transform スクロールの別機構）。
// 端で見切れる幅・透明余白だけはみ出す幅・ルビ付き行・画像が端に掛かるケースを
// 実際の iframe で流し、前後ページでの重複 0・読み落とし 0・見切れ 0 を確かめる。

var IS_IOS = (typeof _handleKeys === 'undefined');
T('buildScrollScript がある', typeof buildScrollScript === 'function');

if (IS_IOS) {
  T('iOS版は transform スクロールのため H_PAGING_HELPER を持たない',
    buildScrollScript('start', 'vertical', 1).indexOf('smartStepH') < 0);
} else {
  function runPagingCase(mode, vw, fs, lh, bodyHtml, label) {
    return new Promise(function (resolve) {
      var src = buildScrollScript('start', mode, 1);
      var f = document.createElement('iframe');
      f.style.cssText = 'position:absolute;left:-10000px;top:0;width:' + vw + 'px;height:400px;border:0';
      document.body.appendChild(f);
      f.addEventListener('load', function () {
        setTimeout(function () {
          var doc = f.contentDocument;
          function getMasks() {
            var divs = doc.querySelectorAll('div[aria-hidden="true"]');
            var wL = 0, wR = 0;
            for (var i = 0; i < divs.length; i++) {
              var st = divs[i].style;
              if (st.position === 'fixed' && st.left === '0px') wL = parseFloat(st.width) || 0;
              if (st.position === 'fixed' && st.right === '0px') wR = parseFloat(st.width) || 0;
            }
            return { L: wL, R: wR };
          }
          function visibleLines() {
            var mw = getMasks();
            var visL = mw.L, visR = vw - mw.R;
            var ps = doc.querySelectorAll('p');
            var shown = [], clipped = [];
            for (var i = 0; i < ps.length; i++) {
              var p = ps[i];
              var r = p.getBoundingClientRect();
              if (r.right <= visL + 0.5 || r.left >= visR - 0.5) continue;
              var w = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
              var rng = doc.createRange(), tn, lineMinL = 1e9, lineMaxR = -1e9;
              while ((tn = w.nextNode())) {
                if (!tn.nodeValue || !tn.nodeValue.trim()) continue;
                var pe = tn.parentElement;
                if (pe.tagName === 'RP') continue;
                var cfs = parseFloat(f.contentWindow.getComputedStyle(pe).fontSize) || fs;
                rng.selectNodeContents(tn);
                var rects = rng.getClientRects();
                for (var k = 0; k < rects.length; k++) {
                  var rc = rects[k];
                  if (rc.width <= 0 || rc.height <= 0) continue;
                  var pad = (rc.width > cfs) ? (rc.width - cfs) * 0.5 : 0;
                  var gl = rc.left + pad, gr = rc.right - pad;
                  if (gl < lineMinL) lineMinL = gl;
                  if (gr > lineMaxR) lineMaxR = gr;
                }
              }
              if (lineMaxR > visL + 0.5 && lineMinL < visR - 0.5) {
                shown.push(i + 1);
                if (lineMinL < visL - 1.5 || lineMaxR > visR + 1.5) {
                  clipped.push((i + 1) + '[' + Math.round(lineMinL) + '..' + Math.round(lineMaxR) +
                    ' vs ' + visL + '..' + visR + ']');
                }
              }
            }
            return { shown: shown, clipped: clipped, mw: mw };
          }

          var pages = [];
          function stepFwd(idx) {
            pages.push(visibleLines());
            if (idx >= 3) {
              var dup = 0, skip = 0, clip = 0, details = [];
              for (var p = 0; p < pages.length; p++) {
                clip += pages[p].clipped.length;
                if (p > 0) {
                  var prevLast = pages[p - 1].shown[pages[p - 1].shown.length - 1];
                  var curFirst = pages[p].shown[0];
                  if (curFirst <= prevLast) { dup += (prevLast - curFirst + 1); details.push('p' + p + ':DUP'); }
                  else if (curFirst > prevLast + 1) { skip += (curFirst - prevLast - 1); details.push('p' + p + ':SKIP'); }
                }
                if (pages[p].clipped.length) details.push('p' + p + ':CLIP(' + pages[p].clipped.join(',') + ')');
              }
              var backPages = [pages[pages.length - 1]];
              function stepBack(bidx) {
                if (bidx >= 2) {
                  for (var b = 1; b < backPages.length; b++) {
                    var prevFirst = backPages[b - 1].shown[0];
                    var curLast = backPages[b].shown[backPages[b].shown.length - 1];
                    if (curLast >= prevFirst) { dup += (curLast - prevFirst + 1); details.push('b' + b + ':DUP'); }
                    else if (curLast < prevFirst - 1) { skip += (prevFirst - curLast - 1); details.push('b' + b + ':SKIP'); }
                    if (backPages[b].clipped.length) {
                      clip += backPages[b].clipped.length;
                      details.push('b' + b + ':CLIP(' + backPages[b].clipped.join(',') + ')');
                    }
                  }
                  T(label + ' (' + mode + ' vw=' + vw + ' lh=' + lh + '): 重複0・読み落とし0・見切れ0',
                    dup === 0 && skip === 0 && clip === 0,
                    'dup=' + dup + ' skip=' + skip + ' clip=' + clip + (details.length ? ' ' + details.join(' ') : ''));
                  f.remove();
                  resolve();
                  return;
                }
                f.contentWindow.postMessage({ type: 'EPUB_SCROLL', direction: -1 }, '*');
                setTimeout(function () { backPages.push(visibleLines()); stepBack(bidx + 1); }, 60);
              }
              stepBack(0);
              return;
            }
            f.contentWindow.postMessage({ type: 'EPUB_SCROLL', direction: 1 }, '*');
            setTimeout(function () { stepFwd(idx + 1); }, 60);
          }
          stepFwd(0);
        }, 160);
      });
      var padCss = mode === 'vertical' ? 'padding-left:100vw;' : '';
      var css =
        'html{font-size:' + fs + 'px;line-height:' + lh + ';writing-mode:vertical-rl;' + padCss +
          'height:100%;overflow-y:hidden;margin:0;background:#fff;}' +
        'body{writing-mode:vertical-rl;margin:0;height:100%;overflow-y:hidden;box-sizing:border-box;' +
          'line-height:' + lh + ';background:#fff;}' +
        'p{margin:0;padding:0;}';
      f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css +
        '</style></head><body>' + bodyHtml +
        '<' + 'script>' + src + '<' + '/' + 'script></body></html>';
    });
  }

  // 画像が端に掛かるときマスクが出ないこと
  function runMediaCase() {
    return new Promise(function (resolve) {
      var src = buildScrollScript('start', 'vertical', 1);
      var f = document.createElement('iframe');
      f.style.cssText = 'position:absolute;left:-10000px;top:0;width:400px;height:400px;border:0';
      document.body.appendChild(f);
      f.addEventListener('load', function () {
        setTimeout(function () {
          var doc = f.contentDocument;
          var divs = doc.querySelectorAll('div[aria-hidden="true"]');
          var wL = 0;
          for (var i = 0; i < divs.length; i++) {
            if (divs[i].style.position === 'fixed' && divs[i].style.left === '0px') {
              wL = parseFloat(divs[i].style.width) || 0;
            }
          }
          T('画像が左端に掛かるときはマスクを出さない', wL === 0, 'wL=' + wL);
          f.remove();
          resolve();
        }, 180);
      });
      var css =
        'html{font-size:16px;line-height:2;writing-mode:vertical-rl;padding-left:100vw;height:100%;overflow-y:hidden;margin:0;background:#fff;}' +
        'body{writing-mode:vertical-rl;margin:0;height:100%;overflow-y:hidden;box-sizing:border-box;background:#fff;}' +
        'svg{display:block;width:500px;height:300px;}';
      f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css +
        '</style></head><body><svg width="500" height="300"></svg>' +
        '<' + 'script>' + src + '<' + '/' + 'script></body></html>';
    });
  }

  var plainPs = '';
  for (var i = 1; i <= 140; i++) plainPs += '<p>行' + i + 'あいうえおかきくけこさしすせそ。</p>';
  var rubyPs = '';
  for (var j = 1; j <= 140; j++) rubyPs += '<p>行' + j + '<ruby>漢字<rt>かんじ</rt></ruby>あいうえおかきくけこ。</p>';

  runPagingCase('vertical', 788, 16, 2.0, plainPs, '見切れ幅')
    .then(function () { return runPagingCase('vertical', 792, 16, 2.0, plainPs, '透明余白はみ出し幅'); })
    .then(function () { return runPagingCase('vertical', 400, 16, 1.8, plainPs, '行間1.8'); })
    .then(function () { return runPagingCase('vertical', 788, 16, 2.0, rubyPs, 'ルビ付き'); })
    .then(function () { return runPagingCase('vertical', 900, 16, 2.0, rubyPs, 'ルビ付き右端'); })
    .then(function () { return runPagingCase('publisher', 788, 16, 2.0, plainPs, 'ePub指定縦書き'); })
    .then(runMediaCase)
    .catch(function (e) { T('scroll-paging 例外', false, e && (e.stack || e.message)); });
}
