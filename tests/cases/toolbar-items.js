// A-2 ツールバー項目の表示切替
var ALL = TOOLBAR_ITEMS.reduce(function (a, it) { return a.concat(it.ids); }, []);
T('対象ボタンが全て存在', ALL.every(function (id) { return !!document.getElementById(id); }),
  ALL.filter(function (id) { return !document.getElementById(id); }).join(',') || 'すべて有り');

// 既定は全表示
T('既定 toolbarHidden 空', state.toolbarHidden.length === 0);
T('既定は全ボタン表示', ALL.every(function (id) {
  return getComputedStyle(document.getElementById(id)).display !== 'none' ||
         id === "btn-fxl-zoom" || id.indexOf("drive-") === 0;  // .fxl-only / file:// の Drive は別条件
}));
T('トグルUIが7行', document.querySelectorAll('.tb-item-toggle').length === 7);

// 個別に隠せる
toggleToolbarItem('readingData');
T('隠すと display:none', getComputedStyle(document.getElementById('reading-data-btn')).display === 'none');
T('トグル表示 OFF',
  document.querySelector('.tb-item-toggle[data-tbkey="readingData"]').textContent === 'OFF');
T('永続化された',
  (JSON.parse(localStorage.getItem('epub_settings')).toolbarHidden || []).indexOf('readingData') >= 0);

// drive は2ボタンで1キー
toggleToolbarItem('drive');
T('drive で 2 ボタンとも隠れる',
  getComputedStyle(document.getElementById('drive-upload-btn')).display === 'none' &&
  getComputedStyle(document.getElementById('drive-download-btn')).display === 'none');

// 戻せる
toggleToolbarItem('readingData');
T('戻すと再表示', getComputedStyle(document.getElementById('reading-data-btn')).display !== 'none');

// 全部隠しても必須ボタンは残る
TOOLBAR_ITEMS.forEach(function (it) { if (state.toolbarHidden.indexOf(it.key) < 0) toggleToolbarItem(it.key); });
T('全隠し後も開くボタンが残る', getComputedStyle(document.getElementById('open-btn')).display !== 'none');
T('全隠し後も目次が残る', getComputedStyle(document.getElementById('toc-btn')).display !== 'none');
T('全隠し後も設定が残る', getComputedStyle(document.getElementById('settings-btn')).display !== 'none');

// mode-fxl との相互作用：解除しても mode-fxl の非表示ルールが生きている
document.body.classList.add('mode-fxl');
toggleToolbarItem('tts');   // 表示に戻す
T('mode-fxl 中は tts が隠れたまま',
  getComputedStyle(document.getElementById('tts-btn')).display === 'none');
document.body.classList.remove('mode-fxl');
T('mode-fxl 解除で tts 復帰',
  getComputedStyle(document.getElementById('tts-btn')).display !== 'none');

// 全部戻す
state.toolbarHidden = []; applyToolbarPrefs(); updateToolbarPrefsUI();

// 不正キーは無視して落ちない
toggleToolbarItem('nope');
T('不正キーは無視', state.toolbarHidden.length === 0);

// loadSettings の検証
localStorage.setItem('epub_settings', JSON.stringify({ toolbarHidden: ['help', 'BAD', 'drive'] }));
state.toolbarHidden = [];
loadSettings();
T('不正キーを除去して復元',
  state.toolbarHidden.length === 2 && state.toolbarHidden.indexOf('BAD') < 0,
  JSON.stringify(state.toolbarHidden));

// updateToolbarFade が呼ばれている（右端フェード判定の再実行）
var tb = document.getElementById('toolbar');
var fadeCalls = 0, orig = updateToolbarFade;
window.updateToolbarFade = function () { fadeCalls++; return orig.apply(this, arguments); };
applyToolbarPrefs();
T('applyToolbarPrefs が updateToolbarFade を呼ぶ', fadeCalls === 1, String(fadeCalls));
window.updateToolbarFade = orig;

// i18n
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  setLang(lg);
  var missing = [];
  ['toolbarGroup', 'tbFlash', 'tbTts', 'tbReadingData', 'tbFullscreen', 'tbHelp', 'tbDrive', 'tbFxlZoom', 'toolbarHelp']
    .forEach(function (k) {
      var el = document.querySelector('[data-i18n="settings.' + k + '"]');
      if (!el || !el.textContent || el.textContent === 'settings.' + k) missing.push(k);
    });
  T('i18n 揃っている (' + lg + ')', missing.length === 0, missing.join(','));
});
setLang('ja');
localStorage.clear();
T('file:// では Drive の設定行も隠す',
  location.protocol === 'file:'
    ? document.getElementById('tbitem-drive').style.display === 'none'
    : true,
  location.protocol);
