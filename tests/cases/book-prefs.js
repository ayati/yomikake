// B-7 本ごとの表示設定
localStorage.clear();

T('既定は ON', state.bookPrefsEnabled === true);
T('トグル UI がある', !!document.getElementById('book-prefs-toggle'));
T('レイアウトグループ内にある',
  document.getElementById('book-prefs-toggle').closest('#layout-group') !== null);

// ── 永続層 ──
T('壊れた JSON は黙って初期化', (function () {
  localStorage.setItem('epub_book_prefs', '{壊れている');
  var o = _bpLoad();
  return o && o.books && Object.keys(o.books).length === 0;
})());
localStorage.removeItem('epub_book_prefs');

state.bookKey = 'epub_pos_本A__著者A';
_bpSet('writingMode', 'horizontal');
T('_bpSet で書ける', _bpGet('epub_pos_本A__著者A').writingMode === 'horizontal');
T('更新時刻が入る', typeof _bpGet('epub_pos_本A__著者A').t === 'number');
T('触っていない項目は載らない', !('fontSize' in _bpGet('epub_pos_本A__著者A')),
  JSON.stringify(_bpGet('epub_pos_本A__著者A')));

_bpSet('fontSize', 130);
T('部分的に足せる',
  _bpGet('epub_pos_本A__著者A').writingMode === 'horizontal' &&
  _bpGet('epub_pos_本A__著者A').fontSize === 130);

state.bookKey = '';
_bpSet('writingMode', 'vertical');
T('本を開いていなければ書かない', Object.keys(_bpLoad().books).length === 1);

state.bookKey = 'epub_pos_本A__著者A';
state.bookPrefsEnabled = false;
_bpSet('fontMode', 'gothic');
T('OFF のときは書かない', !('fontMode' in _bpGet('epub_pos_本A__著者A')));
state.bookPrefsEnabled = true;

// 剪定
(function () {
  var all = { v: 1, books: {} };
  var now = Date.now();
  for (var i = 0; i < 310; i++) all.books['k' + i] = { fontSize: 100, t: now - i * 1000 };
  all.books['ancient'] = { fontSize: 100, t: now - 800 * 24 * 60 * 60 * 1000 };
  _bpSave(all);
  var after = _bpLoad().books;
  T('300冊で打ち切る', Object.keys(after).length === 300, String(Object.keys(after).length));
  T('新しいものが残る', !!after['k0'] && !after['k309']);
  T('730日超は落ちる', !after['ancient']);
})();
localStorage.removeItem('epub_book_prefs');

// ── 適用の値域検証 ──
state.bookKey = 'epub_pos_検証__X';
_bpSave({ v: 1, books: { 'epub_pos_検証__X': {
  writingMode: 'ダメ', fontSize: 9999, fontMode: '存在しない書体',
  spreadMode: 'ダメ', fxlRegionOrder: 'ダメ', t: Date.now() } } });
state.writingMode = 'vertical'; state.fontSize = 100; state.fontMode = 'publisher';
state.spreadMode = 'auto'; state.fxlRegionOrder = 'story';
applyBookPrefs('epub_pos_検証__X');
T('壊れた値は一切採用しない',
  state.writingMode === 'vertical' && state.fontSize === 100 &&
  state.fontMode === 'publisher' && state.spreadMode === 'auto' &&
  state.fxlRegionOrder === 'story');

// 実体の無いローカルフォントは採用しない（端末ごとに有無が違うため）
_bpSave({ v: 1, books: { 'epub_pos_検証__X': { fontMode: 'custom:nope', t: Date.now() } } });
state.fontMode = 'publisher';
applyBookPrefs('epub_pos_検証__X');
T('実体の無いローカルフォントは採用しない', state.fontMode === 'publisher', state.fontMode);
state.customFonts = [{ id: 'nope', name: 'ダミー' }];
applyBookPrefs('epub_pos_検証__X');
T('実体があれば採用する', state.fontMode === 'custom:nope', state.fontMode);
state.customFonts = []; state.fontMode = 'publisher';

// プロトタイプ由来のキー（FONTS['constructor'] は関数を返す）を弾くこと。
// 通すと CSS へ関数のソース文字列が流れ込む
['constructor', 'toString', '__proto__'].forEach(function (bad) {
  _bpSave({ v: 1, books: { 'epub_pos_検証__X': { fontMode: bad, t: Date.now() } } });
  state.fontMode = 'publisher';
  applyBookPrefs('epub_pos_検証__X');
  T('フォント名 "' + bad + '" は採用しない', state.fontMode === 'publisher', state.fontMode);
});
localStorage.removeItem('epub_book_prefs');

// しおり JSON / Drive 同期に載らないこと
localStorage.setItem('epub_pos_本A__著者A', JSON.stringify({ spineIdx: 1, ratio: 0.2 }));
state.bookKey = 'epub_pos_本A__著者A';
_bpSet('writingMode', 'horizontal');
(function () {
  var dump = JSON.stringify(collectBookmarks());
  T('しおり書き出しに本ごと設定を含めない',
    dump.indexOf('epub_book_prefs') < 0 && dump.indexOf('writingMode') < 0);
})();

// 完全削除では消える／論理削除では消えない
_rlPurgeLocalData('epub_pos_本A__著者A');
T('完全削除で本ごと設定も消える', _bpGet('epub_pos_本A__著者A') === null);
localStorage.clear();

// ── 2冊を実際に開いて往復する ──
function open(url, name) {
  return fetch(url).then(function (r) { return r.blob(); })
    .then(function (b) { return loadEpub(new File([b], name, { type: 'application/epub+zip' })); })
    .then(function () { hideTapGuide(); });
}

open('tests/.fixtures/reflow.epub', 'a.epub')
.then(function () {
  T('1冊目を開いた', !!state.epub, state.bookTitle);
  var keyA = state.bookKey;
  changeWritingMode('horizontal');
  changeFontSize(2);   // 100 → 120
  T('本ごとに記録された',
    _bpGet(keyA).writingMode === 'horizontal' && _bpGet(keyA).fontSize === 120,
    JSON.stringify(_bpGet(keyA)));
  T('グローバルにも書く（次に開く新しい本の既定になる）',
    JSON.parse(localStorage.getItem('epub_settings')).writingMode === 'horizontal');
  window.__keyA = keyA;
  return open('tests/.fixtures/reflow2.epub', 'b.epub');
})
.then(function () {
  T('2冊目は別の bookKey', state.bookKey !== window.__keyA, state.bookKey);
  T('2冊目はグローバル（＝最後に使った設定）を引き継ぐ',
    state.writingMode === 'horizontal' && state.fontSize === 120,
    state.writingMode + '/' + state.fontSize);
  changeWritingMode('vertical');
  changeFontSize(-4);   // 120 → 80
  window.__keyB = state.bookKey;
  return open('tests/.fixtures/reflow.epub', 'a.epub');
})
.then(function () {
  T('1冊目に戻ると1冊目の設定が復元される',
    state.bookKey === window.__keyA && state.writingMode === 'horizontal' && state.fontSize === 120,
    state.writingMode + '/' + state.fontSize);
  T('設定パネルの表示も追従',
    document.getElementById('writing-mode-select').value === 'horizontal' &&
    document.getElementById('font-size-display').textContent === '120%');
  return open('tests/.fixtures/reflow2.epub', 'b.epub');
})
.then(function () {
  T('2冊目に戻ると2冊目の設定が復元される',
    state.writingMode === 'vertical' && state.fontSize === 80,
    state.writingMode + '/' + state.fontSize);

  // OFF にすると読み込まない
  state.bookPrefsEnabled = false;
  state.writingMode = 'publisher';
  applyBookPrefs(window.__keyB);
  T('OFF のときは読み込まない', state.writingMode === 'publisher');
  state.bookPrefsEnabled = true;

  // リセットで全消し
  T('リセット前は記録がある', Object.keys(_bpLoad().books).length >= 2,
    String(Object.keys(_bpLoad().books).length));
  window.confirm = function () { return true; };
  resetDisplaySettings();
  T('リセットで本ごと設定を全消し', Object.keys(_bpLoad().books).length === 0);
  // 確認文が「本ごとの設定も消える」ことを 4 言語とも伝えているか
  (function () {
    var need = { ja: '本ごと', en: 'per-book', 'zh-TW': '依書籍', 'zh-CN': '按书籍' };
    var ng = [];
    Object.keys(need).forEach(function (lg) {
      setLang(lg);
      if (t('settings.resetConfirm').toLowerCase().indexOf(need[lg].toLowerCase()) < 0) ng.push(lg);
    });
    setLang('ja');
    T('リセット確認文に本ごと設定への言及がある（4言語）', ng.length === 0, ng.join(',') || '(すべて)');
  })();

  // i18n
  ['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
    setLang(lg);
    var a = document.querySelector('[data-i18n="settings.bookPrefs"]').textContent;
    var b = document.querySelector('[data-i18n="settings.bookPrefsHelp"]').textContent;
    T('i18n (' + lg + ')', a && b && a !== 'settings.bookPrefs' && b !== 'settings.bookPrefsHelp', a);
  });
  setLang('ja');
  closeBook();
  localStorage.clear();
})
.catch(function (e) { T('例外', false, e && (e.stack || e.message)); });
