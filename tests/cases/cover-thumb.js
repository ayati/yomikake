// 表紙サムネイル（extractCoverThumb → しおりの cover → 読みかけリスト）
// 発端: SVG 表紙の本（novel_downloader 産）が読みかけ一覧で表紙なしになっていた。
// 原因は mime を拡張子の三項演算子で決めていたことで、svg が image/jpeg 扱いになり
// <img> がデコードできず onerror（＝黙って表紙なし）に落ちていた。

T('extractCoverThumb が定義', typeof extractCoverThumb === 'function');
T('EXT_MIME に svg', EXT_MIME.svg === 'image/svg+xml');

// サムネイルの画素を読むヘルパ（JPEG 圧縮のブレを許容して色を比べる）
function _pixOf(uri, x, y) {
  return new Promise(function (res, rej) {
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      var g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      var d = g.getImageData(x, y, 1, 1).data;
      res({ w: im.naturalWidth, h: im.naturalHeight, r: d[0], g: d[1], b: d[2] });
    };
    im.onerror = function () { rej(new Error('thumb decode failed')); };
    im.src = uri;
  });
}
function _near(a, b, tol) { return Math.abs(a - b) <= (tol || 16); }

// ══ SVG 表紙のリフロー本 ═════════════════════════════════════════
fetch('tests/.fixtures/reflow.epub')
.then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'reflow.epub', { type: 'application/epub+zip' })); })
.then(function () {
  var uri = state.bookCoverDataUri;
  T('SVG 表紙から JPEG サムネイルが作られる',
    typeof uri === 'string' && uri.indexOf('data:image/jpeg;base64,') === 0,
    String(uri).slice(0, 40));
  T('サムネイルが空でない', uri.length > 1000, String(uri.length));
  T('localStorage の上限（28000 文字）に収まる', uri.length <= 28000, String(uri.length));
  var val = JSON.parse(localStorage.getItem(state.bookKey) || '{}');
  T('しおりデータに cover が入る', val.cover === uri);
  return _pixOf(uri, 2, 2);
})
.then(function (p) {
  T('サムネイルは 160×224', p.w === 160 && p.h === 224, p.w + 'x' + p.h);
  // 隅が背景色 #1a2b3c ＝ 内在サイズ（viewBox）補完が効いて全面が描かれている。
  // 補完が効かないと <img> 既定の 300×150 に潰れ、左右が白いレターボックスになる。
  T('隅まで表紙が描かれている（viewBox からの内在サイズ補完）',
    _near(p.r, 0x1a) && _near(p.g, 0x2b) && _near(p.b, 0x3c),
    p.r + ',' + p.g + ',' + p.b);
})
.then(function () {
  // 読みかけリストのカードにサムネイルが載る
  closeBook();
  buildReadingList();
  var img = document.querySelector('#reading-list-items .rl-card img');
  T('読みかけリストのカードに表紙 img が出る', !!img);
  T('カードの表紙は保存済みサムネイル',
    !!img && img.getAttribute('src').indexOf('data:image/jpeg;base64,') === 0,
    img ? img.getAttribute('src').slice(0, 30) : '(なし)');
})
// ══ PNG 表紙（FXL 本）が壊れていないこと ═════════════════════════
.then(function () {
  return fetch('tests/.fixtures/fxl.epub')
    .then(function (r) { return r.blob(); })
    .then(function (b) { return loadEpub(new File([b], 'fxl.epub', { type: 'application/epub+zip' })); });
})
.then(function () {
  T('PNG 表紙も従来どおり JPEG 化される',
    state.bookCoverDataUri.indexOf('data:image/jpeg;base64,') === 0,
    state.bookCoverDataUri.slice(0, 40));
  return _pixOf(state.bookCoverDataUri, 80, 112);
})
.then(function (p) {
  // fixture の 1 ページ目は (220,80,80) のベタ塗り
  T('PNG 表紙の色が保たれる', _near(p.r, 220) && _near(p.g, 80) && _near(p.b, 80),
    p.r + ',' + p.g + ',' + p.b);
})
.then(function () {
  closeBook();
  T('本を閉じられる', !state.epub);
  localStorage.clear();
})
.catch(function (e) { T('表紙サムネイル E2E 例外', false, e && (e.stack || e.message)); });
