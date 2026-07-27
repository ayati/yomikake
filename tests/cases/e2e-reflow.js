// リフロー本を実際に開き、表示設定の変更が読書経路を壊さないか確認する。
// fixture: tests/.fixtures/reflow.epub（4章）
fetch('tests/.fixtures/reflow.epub')
.then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'reflow.epub', { type: 'application/epub+zip' })); })
.then(function () {
  T('本が開けた', !!state.epub, state.bookTitle + ' / spine=' + state.spine.length);
  T('リフローとして開いた', state.renderMode === 'reflow', state.renderMode);
  T('目次を読めた', state.toc.length === 4, String(state.toc.length));
  T('読書中はツールバーが「リストへ」', document.getElementById('open-btn').classList.contains('reading'));
  return renderPage(2, 0.5);
})
.then(function () {
  var before = state.currentSpineIdx;
  T('章移動できた', before === 2, String(before));

  // テーマ変更は rerenderKeepPos 経由。位置が保たれること
  changeTheme('hoshi');
  T('テーマ変更後も章が保持', state.currentSpineIdx === before, String(state.currentSpineIdx));

  // 再描画は非同期なので待ってから srcdoc を見る
  return new Promise(function (rs) { setTimeout(rs, 1200); }).then(function () {
    T('iframe の紙色がテーマに追従',
      (document.getElementById('content-iframe') || { srcdoc: '' }).srcdoc
        .indexOf(THEME_CONTENT.hoshi.paper) >= 0);

    // OS 連動での自動切替（読書中に prefers-color-scheme が変わった相当）
    state.themeAuto = true; state.themeLight = 'sepia'; state.themeDark = 'sepia';
    var ok = applyAutoTheme(true);
    T('読書中の自動テーマ切替', ok && state.theme === 'sepia' && state.currentSpineIdx === before,
      state.theme + ' idx=' + state.currentSpineIdx);

    // ツールバー項目を隠しても読書は継続する
    toggleToolbarItem('fullscreen');
    T('項目を隠しても本は開いたまま', !!state.epub &&
      getComputedStyle(document.getElementById('page-container')).display !== 'none');

    // リセットしても本は閉じない
    window.confirm = function () { return true; };
    resetDisplaySettings();
    T('リセット後も本は開いたまま', !!state.epub && state.currentSpineIdx === before);
    T('リセットでテーマが標準に', state.theme === '' && !state.themeAuto);

    // 全画面 HUD：本を開いた実レイアウトで、次へボタンと重ならないこと
    state.tapZone = 'center'; updateTapZoneBodyClass();   // ボタンが実在する設定にする
    state.fullscreen = true; document.body.classList.add('fullscreen'); syncFsHud();
    var hud = document.getElementById('fs-hud').getBoundingClientRect();
    var fwd = document.getElementById('btn-scroll-fwd').getBoundingClientRect();
    T('全画面HUDが実寸を持つ', hud.width > 0 && hud.height > 0,
      Math.round(hud.width) + 'x' + Math.round(hud.height));
    T('次へボタンも実寸を持つ', fwd.width > 0 && fwd.height > 0,
      Math.round(fwd.width) + 'x' + Math.round(fwd.height));
    T('全画面HUDが次へボタンと重ならない',
      (hud.right < fwd.left || hud.left > fwd.right || hud.bottom < fwd.top || hud.top > fwd.bottom),
      'hud=' + Math.round(hud.left) + ',' + Math.round(hud.top) + '-' +
      Math.round(hud.right) + ',' + Math.round(hud.bottom) +
      ' fwd=' + Math.round(fwd.left) + ',' + Math.round(fwd.top) + '-' +
      Math.round(fwd.right) + ',' + Math.round(fwd.bottom));
    T('全画面HUDに進捗が入る', /%$/.test(document.getElementById('fs-hud-pct').textContent),
      document.getElementById('fs-hud-pct').textContent);
    state.fullscreen = false; document.body.classList.remove('fullscreen'); syncFsHud();

    closeBook();
    T('closeBook できる', !state.epub);
    T('closeBook でツールバーが「開く」に戻る',
      !document.getElementById('open-btn').classList.contains('reading'));
    localStorage.clear();
  });
})
.catch(function (e) { T('E2E 例外', false, e && (e.stack || e.message)); });
