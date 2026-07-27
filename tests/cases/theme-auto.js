// A-1 OS テーマ連動のテスト
var mqDark = matchMedia('(prefers-color-scheme: dark)').matches;
T('環境: prefers-color-scheme', true, mqDark ? 'dark' : 'light');

// 基本：関数が生えている
T('applyThemeClass 定義', typeof applyThemeClass === 'function');
T('applyAutoTheme 定義', typeof applyAutoTheme === 'function');
T('_darkMQ 生成', !!_darkMQ);

// 既定は連動 OFF
T('既定 themeAuto=false', state.themeAuto === false);
T('既定 body に theme-auto-on 無し', !document.body.classList.contains('theme-auto-on'));
T('連動OFF時は明暗セレクトが非表示',
  getComputedStyle(document.querySelector('.theme-auto-only')).display === 'none');

// meta theme-color がテーマ紙色に追従
changeTheme('dark');
var mc = document.querySelector('meta[name="theme-color"]').getAttribute('content');
T('theme-color がダークの紙色に', mc === THEME_CONTENT.dark.paper, mc);
T('body に theme-dark', document.body.classList.contains('theme-dark'));

// mode-fxl を保持したままテーマだけ差し替わる（旧 className 代入バグの回帰テスト）
document.body.classList.add('mode-fxl');
changeTheme('sepia');
T('テーマ変更で mode-fxl が消えない', document.body.classList.contains('mode-fxl'));
T('theme-dark が外れ theme-sepia に',
  !document.body.classList.contains('theme-dark') && document.body.classList.contains('theme-sepia'));
document.body.classList.remove('mode-fxl');

// 連動 ON
state.themeLight = 'sepia'; state.themeDark = 'hoshi'; syncAutoThemeUI();
toggleThemeAuto();
T('連動ONで theme-auto-on 付与', document.body.classList.contains('theme-auto-on'));
T('連動ONで明暗セレクトが表示',
  getComputedStyle(document.querySelector('.theme-auto-only')).display !== 'none');
T('連動ONトグルのラベル', document.getElementById('theme-auto-toggle').textContent === 'ON');
// ONにした時点の見た目（sepia）が該当側に引き継がれる
T('ON時に現テーマを該当側へ引継ぎ',
  (mqDark ? state.themeDark : state.themeLight) === 'sepia',
  'light=' + state.themeLight + ' dark=' + state.themeDark);

// 明暗の割当を変えると即反映される
changeAutoTheme(mqDark ? 'dark' : 'light', 'matcha');
T('割当変更で実効テーマが追従', state.theme === 'matcha', state.theme);
T('body クラスも追従', document.body.classList.contains('theme-matcha'));

// 連動中にチップを押すと連動が外れる
changeTheme('tsuki');
T('チップ操作で連動OFF', state.themeAuto === false);
T('チップ操作で class も外れる', !document.body.classList.contains('theme-auto-on'));
T('チップ操作でトグル表示も OFF', document.getElementById('theme-auto-toggle').textContent === 'OFF');
T('チップのテーマが適用', state.theme === 'tsuki');

// 永続化と復元
var saved = JSON.parse(localStorage.getItem('epub_settings'));
T('epub_settings に themeAuto/Light/Dark',
  saved.themeAuto === false && typeof saved.themeLight === 'string' && typeof saved.themeDark === 'string',
  JSON.stringify({a: saved.themeAuto, l: saved.themeLight, d: saved.themeDark}));

// マップ存在チェックがプロトタイプチェーンを拾わないこと（hasOwnKey）
T('hasOwnKey は own property のみ通す',
  hasOwnKey(THEME_CONTENT, '') && hasOwnKey(THEME_CONTENT, 'dark') &&
  !hasOwnKey(THEME_CONTENT, 'constructor') && !hasOwnKey(THEME_CONTENT, 'toString') &&
  !hasOwnKey(THEME_CONTENT, '__proto__'));
T('hasOwnKey は文字列以外を弾く', !hasOwnKey(THEME_CONTENT, 0) && !hasOwnKey(THEME_CONTENT, null));
localStorage.setItem('epub_settings', JSON.stringify(
  Object.assign({}, JSON.parse(localStorage.getItem('epub_settings') || '{}'),
                { themeLight: 'constructor', themeDark: 'toString' })));
state.themeLight = ''; state.themeDark = 'dark';
loadSettings();
T('プロトタイプ由来のテーマキーは採用しない',
  state.themeLight === '' && state.themeDark === 'dark',
  state.themeLight + '/' + state.themeDark);
changeAutoTheme('light', 'constructor');
T('changeAutoTheme もプロトタイプ由来を弾く', state.themeLight === '');

// 不正値は弾く
localStorage.setItem('epub_settings', JSON.stringify(
  Object.assign({}, saved, {themeAuto: true, themeLight: 'NOPE', themeDark: 'hoshi'})));
state.themeLight = ''; state.themeDark = 'dark'; state.themeAuto = false;
loadSettings();
T('不正テーマキーは無視', state.themeLight === '', state.themeLight);
T('正当テーマキーは採用', state.themeDark === 'hoshi');
T('themeAuto 復元', state.themeAuto === true);
T('復元後 body クラス同期', document.body.classList.contains('theme-auto-on'));
T('復元後セレクト同期', document.getElementById('theme-dark-select').value === 'hoshi');

// 起動時適用
applyAutoTheme(false);
T('起動時に OS 側のテーマが実効に', state.theme === (mqDark ? 'hoshi' : ''), state.theme);

// i18n 4言語ぶんキーがある
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  setLang(lg);
  var lbl = document.querySelector('[data-i18n="settings.themeAuto"]').textContent;
  T('i18n settings.themeAuto (' + lg + ')', !!lbl && lbl !== 'settings.themeAuto', lbl);
  var opt = document.querySelector('#theme-dark-select option[value="hoshi"]').textContent;
  T('i18n セレクト option (' + lg + ')', !!opt && opt !== 'theme.hoshi', opt);
});
setLang('ja');
localStorage.clear();
