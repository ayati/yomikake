// ePub 由来コードの除去（buildSrcdoc の XSS 対策）
//
// srcdoc の iframe は親と同一オリジンで sandbox も無いため、ePub の中でコードが動くと
// 親オリジンの localStorage（KOReader 同期の資格情報・しおり・読書データ）まで読めてしまう。
// <script> の除去だけでは塞がっていなかった経路を検査する。
// 発端: v2.22.0（KOReader 同期）で localStorage に長期の資格情報が載ったこと。
// それまでは「インライン on* は残す」が意図的なトレードオフだったが、守る資産が増えたので改めた。

T('buildSrcdoc が定義', typeof buildSrcdoc === 'function');

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
})
.catch(function (e) { T('サニタイズ検査が例外なく終わる', false, String(e && e.message || e)); });
