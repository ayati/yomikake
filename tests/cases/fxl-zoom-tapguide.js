// FXL ズーム中のタップガイド整合性
// ズーム中はタップ帯が無効（handleFxlTap が early return し、Next/Back ボタンが
// ZoomStep の操作子になる）。ガイドがそれを反映しないと「反応すると示した場所が
// 無反応」になり、タップ UX の保証（ガイド＝実挙動）が崩れる。
fetch('tests/.fixtures/fxl.epub').then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'f.epub', { type: 'application/epub+zip' })); })
.then(function () {
  hideTapGuide();
  var ov = document.getElementById('tap-guide-overlay');
  T('FXL で開いた', state.renderMode === 'fxl');
  T('tapZone は既定の lshape', state.tapZone === 'lshape');

  // ── 非ズーム時は従来どおり帯ガイド ──
  showNavHint();
  T('非ズーム時は帯ガイドが出る',
    ov.style.display === 'block' && ov.querySelectorAll('.tg-zone').length > 0,
    'zones=' + ov.querySelectorAll('.tg-zone').length);
  hideTapGuide();

  // ── ズーム中はボタンを示す ──
  enableFxlZoom(0);
  T('ズーム ON', state.fxlZoomEnabled && document.body.classList.contains('fxl-zoomed'));
  T('ズーム中は Next/Back ボタンが実在する（ZoomStep の操作子）',
    getComputedStyle(document.getElementById('btn-scroll-fwd')).display !== 'none');

  showNavHint();
  T('ズーム中は帯ガイドを出さない', ov.style.display !== 'block',
    'display=' + (ov.style.display || '(空)'));
  T('ズーム中はナビボタンを点滅させる',
    document.getElementById('btn-scroll-fwd').classList.contains('nav-hint'));

  // showTapGuide を直接呼んでも出ない（二重の防御）
  showTapGuide();
  T('showTapGuide 直呼びでも出ない', ov.style.display !== 'block');

  // ── ガイド表示中にズームへ入ったら掃除する ──
  disableFxlZoom();
  showNavHint();
  T('ズーム解除後は帯ガイドが戻る', ov.style.display === 'block');
  enableFxlZoom(0);
  T('ガイド表示中にズームへ入ると掃除される', ov.style.display !== 'block',
    'display=' + (ov.style.display || '(空)'));

  // ── 帯が実際に無反応であること（ガイドを出さない根拠） ──
  var acted = null, origAct = runTapAction;
  window.runTapAction = function (a) { acted = a; return origAct.apply(this, arguments); };
  handleFxlTap(10, 10);
  return new Promise(function (r) { setTimeout(r, 400); }).then(function () {
    T('ズーム中の帯タップは無反応（ガイドを出さない根拠）', acted === null, 'runTapAction=' + acted);
    window.runTapAction = origAct;

    // 非ズームでは帯タップが効く（回帰確認）
    disableFxlZoom();
    acted = null;
    window.runTapAction = function (a) { acted = a; return origAct.apply(this, arguments); };
    handleFxlTap(10, 10);
    return new Promise(function (r2) { setTimeout(r2, 400); });
  }).then(function () {
    T('非ズームでは帯タップが効く', acted !== null, 'runTapAction=' + acted);
    window.runTapAction = origAct;

    // 「ボタン」設定では従来どおりズームに関係なくボタン点滅
    state.tapZone = 'center'; updateTapZoneBodyClass();
    showNavHint();
    T('ボタン設定では帯ガイドを出さない', ov.style.display !== 'block');
    state.tapZone = 'lshape'; updateTapZoneBodyClass();

    hideTapGuide();
    closeBook();
    localStorage.clear();
  });
})
.catch(function (e) { T('例外', false, e && (e.stack || e.message)); });
