// B-13 画面の向きロック
// screen.orientation.lock は環境差が大きい API なので、実挙動ではなく
// 「どう呼ぶか・失敗したらどうするか」を検査する。実機の実挙動は対象外。
var row = document.getElementById('orientation-lock-row');
var sel = document.getElementById('orientation-lock-select');
T('設定行がある', !!row && !!sel);
T('レイアウトグループ内にある', row && row.closest('#layout-group') !== null);
// UI 自身に「全画面のときだけ効く」制約を語らせているか（4言語とも）
(function () {
  var need = { ja: '全画面', en: 'fullscreen', 'zh-TW': '全螢幕', 'zh-CN': '全屏' };
  var ng = [];
  Object.keys(need).forEach(function (lg) {
    setLang(lg);
    var txt = document.querySelector('[data-i18n="settings.orientationLock"]').textContent.toLowerCase();
    if (txt.indexOf(need[lg].toLowerCase()) < 0) ng.push(lg + ':' + txt);
  });
  setLang('ja');
  T('ラベルに「全画面時」の但し書きがある（4言語）', ng.length === 0, ng.join(' / ') || '(すべて)');
})();
T('既定は固定しない', state.orientationLock === 'off');
T('選択肢は3つ', sel.options.length === 3);

// 非対応環境では行ごと隠す（押しても何も起きない設定を出さない）
T('対応判定と行の表示が一致',
  _orientationLockSupported ? row.style.display !== 'none' : row.style.display === 'none',
  'supported=' + _orientationLockSupported + ' display=' + (row.style.display || '(空)'));

// ── ここから screen.orientation をモックして呼び出しを検査する ──
var calls = [];
var mock = {
  lock: function (o) { calls.push('lock:' + o); return mock._result || Promise.resolve(); },
  unlock: function () { calls.push('unlock'); },
  _result: null
};
var origOrientation = Object.getOwnPropertyDescriptor(screen, 'orientation');
try {
  Object.defineProperty(screen, 'orientation', { value: mock, configurable: true });
  T('モックを差し込めた', screen.orientation === mock);

  // 本体は _orientationLockSupported を定数で見るため、非対応環境では
  // applyOrientationLock が何もしない。その場合はここまでで打ち切る。
  if (!_orientationLockSupported) {
    T('非対応環境なので呼び出し検査はスキップ', true, '(_orientationLockSupported=false)');
  } else {
    // 全画面でないときは掛けない
    state.fullscreen = false;
    calls = []; changeOrientationLock('portrait');
    T('全画面でなければ lock しない', calls.indexOf('lock:portrait') < 0, calls.join(','));
    T('全画面でなければ unlock する', calls.indexOf('unlock') >= 0, calls.join(','));

    // 全画面なら掛ける
    state.fullscreen = true;
    calls = []; applyOrientationLock();
    T('全画面なら lock する', calls.join(',') === 'lock:portrait', calls.join(','));

    // off なら解除する
    calls = []; changeOrientationLock('off');
    T('off で unlock する', calls.join(',') === 'unlock', calls.join(','));

    // 全画面を抜けると解除する
    changeOrientationLock('landscape');
    calls = [];
    state.fullscreen = false; applyOrientationLock();
    T('全画面を抜けると unlock', calls.join(',') === 'unlock', calls.join(','));

    // 失敗したら設定ごと off に戻してトーストを出す
    var toasted = null, origToast = showToast;
    window.showToast = function (m) { toasted = m; };
    mock._result = Promise.reject(new Error('NotSupportedError'));
    state.fullscreen = true;
    changeOrientationLock('portrait');
    // reject の処理はマイクロタスクなので待つ
    Promise.resolve().then(function () {}).then(function () {
      T('失敗したら設定が off に戻る', state.orientationLock === 'off', state.orientationLock);
      T('失敗したらセレクトも off', sel.value === 'off', sel.value);
      T('失敗を伝えるトーストを出す', toasted === t('toast.orientationFailed'), String(toasted));
      T('失敗した設定は永続化されない',
        JSON.parse(localStorage.getItem('epub_settings')).orientationLock === 'off');
      window.showToast = origToast;

      // lock() が同期例外を投げる実装でも落ちない
      mock._result = null;
      mock.lock = function () { throw new Error('sync throw'); };
      window.showToast = function () {};
      state.orientationLock = 'portrait'; state.fullscreen = true;
      var threw = false;
      try { applyOrientationLock(); } catch (e) { threw = true; }
      T('同期例外でも落ちない', !threw);
      window.showToast = origToast;
      finish();
    });
  }
} finally {
  if (!_orientationLockSupported) finish();
}

function finish() {
  if (origOrientation) Object.defineProperty(screen, 'orientation', origOrientation);
  else try { delete screen.orientation; } catch (e) {}

  // 不正値は無視
  state.orientationLock = 'off';
  changeOrientationLock('でたらめ');
  T('不正値は無視', state.orientationLock === 'off');
  localStorage.setItem('epub_settings', JSON.stringify({ orientationLock: 'NOPE' }));
  loadSettings();
  T('保存側の不正値も無視', state.orientationLock === 'off');

  // 保存・復元
  localStorage.setItem('epub_settings', JSON.stringify({ orientationLock: 'landscape' }));
  loadSettings();
  T('復元', state.orientationLock === 'landscape');
  T('復元でセレクトも同期', sel.value === 'landscape', sel.value);

  // リセット
  window.confirm = function () { return true; };
  resetDisplaySettings();
  T('リセットで off に戻る', state.orientationLock === 'off');

  // i18n
  ['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
    setLang(lg);
    var lbl = document.querySelector('[data-i18n="settings.orientationLock"]').textContent;
    var opt = document.querySelector('#orientation-lock-select option[value="portrait"]').textContent;
    T('i18n (' + lg + ')', lbl && opt && lbl !== 'settings.orientationLock' && opt !== 'orient.portrait',
      lbl + ' / ' + opt);
    T('i18n 失敗トースト (' + lg + ')', t('toast.orientationFailed').indexOf('toast.') !== 0);
  });
  setLang('ja');
  state.fullscreen = false;
  localStorage.clear();
}
