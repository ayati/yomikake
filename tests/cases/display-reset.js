// B-3 表示設定リセット
window.confirm = function () { return true; };

// 触ってはいけない設定に印を付ける
state.ttsRate = 1.75; state.ttsVoice = 'VOICE-X';
state.autoOpenLast = false; state.driveAutoSave = true;
localStorage.setItem('epub_pos_TEST__AUTHOR', JSON.stringify({ spineIdx: 3, ratio: 0.5 }));
localStorage.setItem('epub_last_book', JSON.stringify({ title: 'TEST', bookKey: 'epub_pos_TEST__AUTHOR' }));
localStorage.setItem('epub_rl_prefs', JSON.stringify({ view: 'grid' }));
setLang('en');

// 表示設定を一通り既定から動かす
changeTheme('hoshi');
state.themeAuto = true; state.themeLight = 'sakura'; state.themeDark = 'matcha';
document.body.classList.add('theme-auto-on');
changeFontSize(4);
changeLineHeight('2.8');
changeLetterSpacing(4);
changeMargin('none');
changeWritingMode('horizontal');
changeFwdBtnSize('large');
changeTapZone('center');
toggleFontBold();
changeFontStrokeLevel('3');
changeSpreadMode('single');
changeFxlZoomLevel('2.5');
changeFxlRegionOrder('yonkoma');
toggleFxlLtrAutoFlip();
toggleToolbarItem('help');
toggleToolbarItem('drive');
var before = JSON.parse(localStorage.getItem('epub_settings'));
T('変更が保存されている', before.theme === 'hoshi' && before.fontSize !== 100 && before.toolbarHidden.length === 2);

resetDisplaySettings();

// state が既定に戻る
var diffs = [];
Object.keys(DISPLAY_DEFAULTS).forEach(function (k) {
  var d = DISPLAY_DEFAULTS[k], a = state[k];
  // オブジェクト（setGroupsOpen）はコピーされるので参照比較ではなく中身で比べる。
  // 参照が同一だとリセットが既定値そのものを汚すので、そこも弾く。
  var same;
  if (Array.isArray(d))            same = Array.isArray(a) && a.length === 0;
  else if (d && typeof d === 'object') same = (a !== d) && JSON.stringify(a) === JSON.stringify(d);
  else                             same = a === d;
  if (!same) diffs.push(k + '=' + JSON.stringify(a));
});
T('全 state が既定に戻る', diffs.length === 0, diffs.join(' '));

// UI も同期している
T('テーマ丸の active が標準', document.querySelector('.tb-std').classList.contains('active'));
T('body の theme-* が外れる',
  !Array.prototype.some.call(document.body.classList, function (c) { return c.indexOf('theme-') === 0 && c !== 'theme-auto-on'; }),
  document.body.className);
T('theme-auto-on も外れる', !document.body.classList.contains('theme-auto-on'));
T('文字サイズ表示', document.getElementById('font-size-display').textContent === '100%');
T('行間スライダー', parseFloat(document.getElementById('lineh-range').value) === 2.0,
  document.getElementById('lineh-range').value);
T('字間スライダー', parseInt(document.getElementById('letter-spacing-range').value, 10) === 0,
  document.getElementById('letter-spacing-range').value);
T('余白セレクト', document.getElementById('margin-select').value === 'full');
T('組方向セレクト', document.getElementById('writing-mode-select').value === 'vertical');
T('次へボタンセレクト', document.getElementById('fwd-btn-size-select').value === 'small');
T('タップゾーンセレクト', document.getElementById('tap-zone-select').value === 'lshape');
T('tapzones-on 復帰', document.body.classList.contains('tapzones-on'));
T('太字トグル OFF', document.getElementById('font-bold-toggle').textContent === 'OFF');
T('縁取り行が無効化', document.getElementById('font-stroke-row').classList.contains('set-row-disabled'));
T('縁取りセレクト', document.getElementById('font-stroke-select').value === '0');
T('見開きセレクト', document.getElementById('spread-mode-select').value === 'auto');
T('FXL倍率セレクト', document.getElementById('fxl-zoom-level-select').value === '2.0');
T('FXL領域順セレクト', document.getElementById('fxl-region-order-select').value === 'story');
T('LTR反転トグル ON', document.getElementById('fxl-ltr-flip-toggle').textContent === 'ON');
T('ツールバー全表示',
  document.querySelectorAll('.tb-item-toggle.on').length === 7,
  String(document.querySelectorAll('.tb-item-toggle.on').length));
T('余白CSS変数も戻る',
  getComputedStyle(document.documentElement).getPropertyValue('--page-padding').trim() === '12px');

// 触ってはいけないものが無事
T('ttsRate 不変', state.ttsRate === 1.75, String(state.ttsRate));
T('ttsVoice 不変', state.ttsVoice === 'VOICE-X');
T('autoOpenLast 不変', state.autoOpenLast === false);
T('driveAutoSave 不変', state.driveAutoSave === true);
T('しおり不変', !!localStorage.getItem('epub_pos_TEST__AUTHOR'));
T('epub_last_book 不変', !!localStorage.getItem('epub_last_book'));
T('読みかけリスト設定 不変', localStorage.getItem('epub_rl_prefs') === '{"view":"grid"}');
T('言語 不変', localStorage.getItem('epub_lang') === 'en', localStorage.getItem('epub_lang'));

// 永続化されている
var after = JSON.parse(localStorage.getItem('epub_settings'));
T('epub_settings も既定に', after.theme === '' && after.fontSize === 100 &&
  after.toolbarHidden.length === 0 && after.ttsRate === 1.75, JSON.stringify(after.theme) + '/' + after.fontSize);

// キャンセルすると何も起きない
window.confirm = function () { return false; };
changeTheme('dark');
resetDisplaySettings();
T('キャンセル時は変更しない', state.theme === 'dark');

// i18n
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  setLang(lg);
  var b = document.getElementById('settings-reset-btn').textContent;
  T('i18n リセットボタン (' + lg + ')', !!b && b !== 'settings.reset', b);
  T('i18n 確認文 (' + lg + ')', t('settings.resetConfirm').indexOf('settings.') !== 0);
  T('i18n トースト (' + lg + ')', t('toast.settingsReset').indexOf('toast.') !== 0);
});
setLang('ja');
localStorage.clear();
