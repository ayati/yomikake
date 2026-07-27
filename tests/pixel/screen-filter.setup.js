// リフロー本を開き、明るさ最暗＋暖色最大にしてから撮影する。
// 固定待ちだけだと、読み込みオーバーレイが残った状態で撮影されてフレークする
// （実際にツールバー帯が 247 → 134 になる誤検知が出た）。「撮ってよい状態」を条件で待つ。
function waitUntil(cond, timeoutMs) {
  var t0 = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      if (cond()) return resolve();
      if (Date.now() - t0 > (timeoutMs || 15000)) return reject(new Error('waitUntil timeout'));
      setTimeout(poll, 50);
    })();
  });
}

function settled() {
  var lo = document.getElementById('loading-overlay');
  var pc = document.getElementById('page-container');
  var tb = document.getElementById('toolbar');
  return !!state.epub &&
    getComputedStyle(lo).display === 'none' &&   // 読み込みオーバーレイが消えている
    getComputedStyle(pc).display !== 'none' &&   // 本文が出ている
    tb.getBoundingClientRect().height > 20 &&    // ツールバーが実寸を持っている
    document.getElementById('tap-guide-overlay').style.display !== 'block';
}

fetch('tests/.fixtures/reflow.epub').then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'reflow.epub', { type: 'application/epub+zip' })); })
.then(function () {
  hideTapGuide();          // 初回オープンの操作ガイドが本文を覆うので消す
  changeTheme('white');    // 紙 #ffffff を基準にすると減光量が読みやすい
  return waitUntil(settled);
})
.then(function () {
  if (location.hash === '#dim') { changeBrightness(30); changeWarmth(5); }
  // フィルタは CSS 変数の反映（transition .15s）を待てば足りる
  return new Promise(function (r) { setTimeout(r, 400); });
})
.then(function () { return waitUntil(settled); })
.then(function () { window.__READY = true; })
.catch(function (e) { console.error('setup failed:', e); });
