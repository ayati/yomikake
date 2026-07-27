fetch('tests/.fixtures/fxl.epub').then(function(r){return r.blob();})
.then(function(b){ return loadEpub(new File([b],'h.epub')); })
.then(function(){
  T('FXL として開いた', state.renderMode === 'fxl', state.renderMode + ' spine=' + state.spine.length);
  T('body.mode-fxl', document.body.classList.contains('mode-fxl'));
  T('FXL ズームボタンが見える', getComputedStyle(document.getElementById('btn-fxl-zoom')).display !== 'none');
  T('mode-fxl では tts ボタンが隠れる', getComputedStyle(document.getElementById('tts-btn')).display === 'none');
  // ツールバー設定で FXL ズームを隠せる
  toggleToolbarItem('fxlZoom');
  T('fxlZoom を隠せる', getComputedStyle(document.getElementById('btn-fxl-zoom')).display === 'none');
  toggleToolbarItem('fxlZoom');
  T('戻せる', getComputedStyle(document.getElementById('btn-fxl-zoom')).display !== 'none');
  // FXL でテーマ変更しても mode-fxl が外れない（applyThemeClass の回帰）
  changeTheme('dark');
  T('テーマ変更で mode-fxl 維持', document.body.classList.contains('mode-fxl'));
  T('FXL コンテナが表示されたまま',
    getComputedStyle(document.getElementById('fxl-container')).display !== 'none');
  // リセットも FXL 中で安全
  window.confirm = function(){ return true; };
  resetDisplaySettings();
  T('リセット後も mode-fxl 維持', document.body.classList.contains('mode-fxl') && !!state.epub);
  T('リセットで見開き設定が既定に', state.spreadMode === 'auto');
  localStorage.clear();
})
.catch(function(e){ T('例外', false, e && (e.stack||e.message)); });
