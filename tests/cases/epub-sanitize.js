// ePub 由来コードの隔離（iframe の sandbox ＋ CSP ＋ buildSrcdoc の除去）
//
// srcdoc の iframe は親と同一オリジンなので、ePub の中でコードが動くと
// 親オリジンの localStorage（KOReader 同期の資格情報・しおり・読書データ）まで読めてしまう。
// 発端: v2.22.0（KOReader 同期）で localStorage に長期の資格情報が載ったこと。
// それまでは「インライン on* は残す」が意図的なトレードオフだったが、守る資産が増えたので改めた。
//
// 守りは 3 層（design_browser_translation.md §3）:
//   1. サニタイザ（列挙型・このファイルの後半）
//   2. nonce つき CSP（種類ごと止まる・このファイルの前半）
//   3. sandbox の残りの制限（フォーム送信・トップナビゲーション・モーダルの禁止）
// v2.23.0 は 2 の代わりに不透明オリジンで隔離していたが、Chrome/Edge のページ翻訳が
// 不透明オリジンのフレームに届かず本文だけ訳されないため、同一オリジンに戻した。

T('buildSrcdoc が定義', typeof buildSrcdoc === 'function');

// ══ iframe の sandbox（design_iframe_sandbox.md / design_browser_translation.md）════════
(function () {
  var fr = document.getElementById('content-iframe');
  T('本文 iframe がある', !!fr);
  var sb = fr.getAttribute('sandbox');
  T('sandbox 属性が付いている', typeof sb === 'string' && sb.length > 0, String(sb));
  var tok = String(sb || '').split(/\s+/);
  // ★ここが要。不透明オリジンのフレームは Chrome/Edge のページ翻訳が届かず本文だけ訳されない。
  //   同一オリジンに戻した代わりに、ePub のコードは CSP（下の検査）で動かさない
  T('allow-same-origin がある（翻訳を本文に届かせるため）', tok.indexOf('allow-same-origin') >= 0, String(sb));
  T('allow-scripts がある（注入したスクロール制御に要る）', tok.indexOf('allow-scripts') >= 0);
  T('allow-popups がある（外部リンクの window.open に要る）', tok.indexOf('allow-popups') >= 0);
  T('allow-popups-to-escape-sandbox がある（開いた先まで sandbox にしない）',
    tok.indexOf('allow-popups-to-escape-sandbox') >= 0);
  // allow-same-origin を足しても外れない制限＝万一コードが動いたときの持ち出し経路
  T('allow-forms を与えていない', tok.indexOf('allow-forms') < 0, String(sb));
  T('allow-modals を与えていない', tok.indexOf('allow-modals') < 0, String(sb));
  T('allow-top-navigation を与えていない',
    tok.join(' ').indexOf('allow-top-navigation') < 0, String(sb));
})();

// ローカルフォントは blob: を使わない（不透明オリジンから読めないため）
(function () {
  T('cfGetFontSrc がある', typeof cfGetFontSrc === 'function');
  var src = cfGetFontSrc.toString();
  T('blob URL を作らない', src.indexOf('createObjectURL') < 0);
  T('プロトコルで分岐しない', src.indexOf("'file:'") < 0);
  T('data URI 経路である', src.indexOf('readAsDataURL') >= 0);
  var gone = false;
  try { _cfBlobUrlCache; } catch (e) { gone = true; }
  T('_cfBlobUrlCache を撤去した', gone);
})();


// ══ ヘルプの「ブラウザの翻訳で読む」節（design_browser_translation.md §4）════
//    4 言語 × 両ファイル。片方だけ直した事故をその場で出す
(function () {
  ['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
    var body = (I18N[lg] || {})['help.body'] || '';
    T('help.body に翻訳の節がある（' + lg + '）', body.indexOf('🌐') >= 0);
    // 章送りで外れるのは Edge だけ。この一文が無いと利用者は「壊れた」と読む
    T('Edge の制限に触れている（' + lg + '）', body.indexOf('Edge') >= 0);
    T('ルビで訳文が崩れることに触れている（' + lg + '）',
      /ruby|ルビ|假名/.test(body));
  });
})();

// 細工した章。実 ePub と同じ経路（DOMParser → 加工 → srcdoc 文字列）を通す
var EVIL = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>' +
  '<p>ふつうの本文</p>' +
  '<img src="x" onerror="STOLE(1)"/>' +
  '<div ONLOAD="STOLE(2)">大文字の属性</div>' +
  '<span onclick="STOLE(3)" onmouseover="STOLE(4)">複数</span>' +
  '<body onload="STOLE(5)"/>' +
  '<iframe srcdoc="&lt;script&gt;STOLE(6)&lt;/script&gt;"></iframe>' +
  '<object data="evil.swf"></object>' +
  '<embed src="evil.swf"/>' +
  '<a href="javascript:STOLE(7)">リンク</a>' +
  '<a href="  javascript:STOLE(8)">前空白</a>' +
  '<a href="JaVaScRiPt:STOLE(9)">大小混在</a>' +
  '<svg><a xlink:href="javascript:STOLE(10)"><text>SVG</text></a></svg>' +
  '<scr' + 'ipt>STOLE(11)<\/scr' + 'ipt>' +   // ← このファイル自体が HTML へ差し込まれるので直書きしない
  '<p><a href="ch1.xhtml#top">正当な内部リンク</a></p>' +
  '<p><a href="https://example.com/">正当な外部リンク</a></p>' +
  '</body></html>';

fetch('tests/.fixtures/reflow.epub')
.then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'reflow.epub', { type: 'application/epub+zip' })); })
.then(function () {
  return buildSrcdoc(EVIL, state.spine[0].absPath, 'start', _renderSeq);
})
.then(function (html) {
  var low = html.toLowerCase();

  // ── (1) インライン on* ハンドラ ──────────────
  T('onerror が消える',      low.indexOf('onerror') < 0);
  T('大文字の ONLOAD も消える', low.indexOf('onload') < 0);
  T('onclick が消える',      low.indexOf('onclick') < 0);
  T('同一要素の 2 個目（onmouseover）も消える', low.indexOf('onmouseover') < 0);
  T('ハンドラの中身が残らない', html.indexOf('STOLE(1)') < 0 && html.indexOf('STOLE(3)') < 0 &&
    html.indexOf('STOLE(4)') < 0 && html.indexOf('STOLE(5)') < 0);

  // ── (2) 入れ子の実行コンテナ（オリジンを継承する）──
  T('入れ子 iframe が消える', low.indexOf('<iframe') < 0);
  T('その srcdoc も残らない', html.indexOf('STOLE(6)') < 0);
  T('object が消える',       low.indexOf('<object') < 0);
  T('embed が消える',        low.indexOf('<embed') < 0);

  // ── (3) javascript: スキーム ─────────────
  T('javascript: が一切残らない', low.indexOf('javascript:') < 0, low.slice(low.indexOf('javascript:') - 40, 60));
  T('前後に空白があっても消える', html.indexOf('STOLE(8)') < 0);
  T('大小混在でも消える',        html.indexOf('STOLE(9)') < 0);
  T('SVG の xlink:href でも消える', html.indexOf('STOLE(10)') < 0);

  // ── 既存の <script> 除去（退行していないこと）──
  // ⚠ buildSrcdoc は自前のスクロールスクリプトを <script> で注入するので、
  //    「<script が無いこと」では検査できない。ePub 側の中身が消えたことだけを見る
  T('ePub の script 要素の中身は従来どおり消える', low.indexOf('stole(11)') < 0);

  // ── 正当な内容は壊さない ────────────────
  T('本文は残る', html.indexOf('ふつうの本文') >= 0);
  T('内部リンクは残る', html.indexOf('ch1.xhtml#top') >= 0);
  T('外部リンクは残る', html.indexOf('https://example.com/') >= 0);
  T('リンクの文字は残る', html.indexOf('正当な内部リンク') >= 0);
  T('属性を消しても要素自体は残る', html.indexOf('大文字の属性') >= 0 && html.indexOf('複数') >= 0);

  // ── 注入した自前のスクロールスクリプトは生きている（除去に巻き込まれない）──
  T('注入コードは残る', html.indexOf('EPUB_READY') >= 0 && html.indexOf('applyInit') >= 0);

  // ── (4) CSP（design_browser_translation.md §3）────
  //    列挙型のサニタイザと違い、ePub 由来の実行経路を種類ごと止める層
  var m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i);
  T('CSP の meta が入る', !!m);
  var csp = m ? m[1] : '';
  T('CSP が <head> の先頭にある',
    /<head[^>]*>\s*<meta http-equiv="Content-Security-Policy"/i.test(html));
  T("default-src 'none' である", /default-src 'none'/.test(csp), csp);

  var sm = csp.match(/script-src ([^;]*)/);
  T('script-src がある', !!sm, csp);
  var srcList = sm ? sm[1].trim() : '';
  T('script-src は nonce ひとつだけ', /^'nonce-[0-9a-f]{32}'$/.test(srcList), srcList);
  // ★これを緩めると ePub のスクリプトまで動いて CSP の層が丸ごと無意味になる
  T("script-src に 'unsafe-inline' が無い", srcList.indexOf('unsafe-inline') < 0, srcList);

  var nonce = /^'nonce-([0-9a-f]+)'$/.test(srcList) ? srcList.slice(7, -1) : '';
  T('注入スクリプトに同じ nonce が付く', !!nonce && html.indexOf('nonce="' + nonce + '"') >= 0);
  T('nonce を持つ要素はひとつだけ', (html.match(/nonce="/g) || []).length === 1,
    String((html.match(/nonce="/g) || []).length));

  // 持ち出し経路（注入コードは postMessage しか使わない）
  T("connect-src 'none'", /connect-src 'none'/.test(csp), csp);
  T("form-action 'none'", /form-action 'none'/.test(csp), csp);
  T("object-src 'none' / frame-src 'none'",
    /object-src 'none'/.test(csp) && /frame-src 'none'/.test(csp), csp);

  // 本を壊さないための許可
  T('style は inline と Google Fonts を許す',
    /style-src [^;]*'unsafe-inline'/.test(csp) && /style-src [^;]*fonts\.googleapis\.com/.test(csp), csp);
  T('img は data: を許す', /img-src [^;]*data:/.test(csp), csp);
  T('font は data: とローカル以外の実体を許す',
    /font-src [^;]*data:/.test(csp) && /font-src [^;]*fonts\.gstatic\.com/.test(csp), csp);

  // ⚠ base-uri を入れると <base href="about:blank"> が無効になり、
  //   ePub の未解決の相対 URL が親ページに解決されるようになる
  T('base-uri を入れていない', csp.indexOf('base-uri') < 0, csp);
  T('<base href="about:blank"> が CSP の直後にある',
    /Content-Security-Policy[^>]*>\s*<base href="about:blank">/i.test(html));

  // nonce は 1 描画ごとに作り直す（固定値だと ePub 側に書けてしまう）
  return buildSrcdoc(EVIL, state.spine[0].absPath, 'start', _renderSeq)
    .then(function (html2) {
      var n2 = (html2.match(/nonce="([0-9a-f]+)"/) || [])[1] || '';
      T('nonce は描画ごとに変わる', !!n2 && n2 !== nonce, nonce + ' / ' + n2);
    });
})
// ── (5) CSP が自前のスクロール制御まで止めていないこと ────────
//    ここを間違えると本文は出るが一切めくれない（＝実質ブランク）。EPUB_READY は
//    注入スクリプトからしか飛ばないので、_isRendering が降りていれば実行された証拠になる
.then(function () { return renderPage(0, 'start'); })
.then(function () { return new Promise(function (rs) { setTimeout(rs, 1500); }); })
.then(function () {
  T('CSP 下でも注入スクリプトが動く（EPUB_READY が届く）', _isRendering === false);
  var idoc = null;
  try { idoc = document.getElementById('content-iframe').contentDocument; } catch (e) {}
  // 同一オリジンであること自体がブラウザ翻訳の前提（不透明オリジンだと本文が訳されない）
  T('親から iframe の中を読める（＝ページ翻訳が本文に届く）', !!idoc && !!idoc.body);
  T('本文が iframe に描かれている', !!idoc && idoc.body.textContent.trim().length > 0,
    idoc ? idoc.body.textContent.trim().slice(0, 30) : '');
})
.catch(function (e) { T('サニタイズ検査が例外なく終わる', false, String(e && e.message || e)); });
