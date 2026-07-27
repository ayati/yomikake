// B-1 明るさ調整 / B-2 暖色フィルタ
var el = document.getElementById('screen-filter');
T('#screen-filter が存在', !!el);
T('#reading-area の子', el && el.parentElement.id === 'reading-area', el && el.parentElement.id);

var cs = getComputedStyle(el);
T('クリックを吸わない', cs.pointerEvents === 'none', cs.pointerEvents);
T('z-index 15', cs.zIndex === '15', cs.zIndex);
T('inset:0 で全面', cs.position === 'absolute');

// 重ね順の根拠: #screen-filter から body までの祖先が「スタッキングコンテキストを作らない」こと。
// ここが崩れると z-index:15 の意味（本文の上・操作系 UI の下）が壊れる。
(function () {
  var bad = [], n = el.parentElement;
  while (n && n !== document.body) {
    var s = getComputedStyle(n);
    var makesCtx = (s.transform !== 'none') || (s.filter !== 'none') || (parseFloat(s.opacity) < 1) ||
      (s.isolation === 'isolate') || (s.mixBlendMode !== 'normal') ||
      (s.contain.indexOf('paint') >= 0 || s.contain.indexOf('layout') >= 0) ||
      (s.willChange.indexOf('transform') >= 0 || s.willChange.indexOf('opacity') >= 0) ||
      (s.position !== 'static' && s.zIndex !== 'auto');
    if (makesCtx) bad.push('#' + n.id + '(' + s.position + '/z=' + s.zIndex + '/tf=' + s.transform.slice(0, 12) + ')');
    n = n.parentElement;
  }
  T('祖先がスタッキングコンテキストを作らない', bad.length === 0, bad.join(' ') || '(なし)');
})();

// 操作系 UI より下・本文より上にいること（同一スタッキングコンテキスト内の z-index 比較）
(function () {
  var z = parseInt(getComputedStyle(el).zIndex, 10);
  var above = [['page-overlay', 10]];
  var below = [['btn-prev', 20], ['mobile-progress', 25], ['fxl-region-pill', 28],
               ['tts-bar', 40], ['tap-guide-overlay', 60], ['tap-menu', 70], ['finished-banner', 50]];
  var ng = [];
  above.forEach(function (p) {
    var e = document.getElementById(p[0]); if (!e) return;
    if (!(parseInt(getComputedStyle(e).zIndex, 10) < z)) ng.push(p[0] + ' が上に来ている');
  });
  below.forEach(function (p) {
    var e = document.getElementById(p[0]); if (!e) return;
    if (!(parseInt(getComputedStyle(e).zIndex, 10) > z)) ng.push(p[0] + ' が下に来ている');
  });
  T('本文の上・操作系UIの下', ng.length === 0, ng.join(' / ') || 'z=' + z);
})();

// 既定は完全に透明
T('既定 brightness=100 / warmth=0', state.brightness === 100 && state.warmth === 0);
applyScreenFilter();
var rs = document.documentElement.style;
T('既定は dim=0', parseFloat(rs.getPropertyValue('--dim-a')) === 0, rs.getPropertyValue('--dim-a'));
T('既定は warm=0', parseFloat(rs.getPropertyValue('--warm-a')) === 0);
T('既定は ⚙ に目印が付かない', !document.getElementById('settings-btn').classList.contains('filter-on'));
T('目印は角丸を変えない（.icon-btn の 6px を上書きしない）',
  getComputedStyle(document.getElementById('settings-btn')).borderTopLeftRadius === '6px',
  getComputedStyle(document.getElementById('settings-btn')).borderTopLeftRadius);

// 明るさを下げる
changeBrightness(30);
T('最暗でも真っ黒にしない', parseFloat(rs.getPropertyValue('--dim-a')) > 0.4 &&
  parseFloat(rs.getPropertyValue('--dim-a')) <= 0.55, rs.getPropertyValue('--dim-a'));
T('数値表示', document.getElementById('brightness-val').textContent === '30%');
T('強く暗くすると ⚙ に目印が付く', document.getElementById('settings-btn').classList.contains('filter-on'));
T('目印が付いても角丸は変わらない',
  getComputedStyle(document.getElementById('settings-btn')).borderTopLeftRadius === '6px',
  getComputedStyle(document.getElementById('settings-btn')).borderTopLeftRadius);
T('永続化', JSON.parse(localStorage.getItem('epub_settings')).brightness === 30);

// 目印のしきい値：軽い調整では出さない（画面が暗いことは見れば分かるため）
function hint() { return document.getElementById('settings-btn').classList.contains('filter-on'); }
changeBrightness(100);
changeBrightness(65); T('明るさ65%では目印なし', !hint());
changeBrightness(FILTER_HINT_BRIGHTNESS); T('明るさ60%（しきい値）で目印あり', hint());
changeBrightness(95);  T('明るさ95%では目印なし', !hint());
changeWarmth(2);       T('暖色2では目印なし', !hint());
changeWarmth(FILTER_HINT_WARMTH); T('暖色3（しきい値）で目印あり', hint());
changeWarmth(0);
T('しきい値の定数', FILTER_HINT_BRIGHTNESS === 60 && FILTER_HINT_WARMTH === 3,
  FILTER_HINT_BRIGHTNESS + '/' + FILTER_HINT_WARMTH);

// 暖色
changeWarmth(5);
T('暖色 最大', parseFloat(rs.getPropertyValue('--warm-a')) === 0.25, rs.getPropertyValue('--warm-a'));
T('暖色 数値表示', document.getElementById('warmth-val').textContent === '5');

// 戻すと目印も消える
changeBrightness(100); changeWarmth(0);
T('戻すと目印が消える', !document.getElementById('settings-btn').classList.contains('filter-on'));

// 範囲外は無視
changeBrightness(10); changeBrightness(500); changeWarmth(-1); changeWarmth(99);
T('範囲外は無視', state.brightness === 100 && state.warmth === 0,
  state.brightness + '/' + state.warmth);

// 保存・復元（55% はしきい値以下なので目印あり）
localStorage.setItem('epub_settings', JSON.stringify({ brightness: 55, warmth: 3 }));
state.brightness = 100; state.warmth = 0;
loadSettings();
T('復元 brightness', state.brightness === 55, String(state.brightness));
T('復元 warmth', state.warmth === 3, String(state.warmth));
T('復元でスライダーも同期',
  document.getElementById('brightness-range').value === '55' &&
  document.getElementById('warmth-range').value === '3');
T('復元で目印も付く', document.getElementById('settings-btn').classList.contains('filter-on'));

// 不正値は無視
localStorage.setItem('epub_settings', JSON.stringify({ brightness: 'ダメ', warmth: 999 }));
state.brightness = 100; state.warmth = 0;
loadSettings();
T('不正値は無視', state.brightness === 100 && state.warmth === 0);

// リセットで戻る
changeBrightness(40); changeWarmth(4);
window.confirm = function () { return true; };
resetDisplaySettings();
T('リセットで既定に戻る', state.brightness === 100 && state.warmth === 0);
T('リセットで CSS 変数も戻る', parseFloat(rs.getPropertyValue('--dim-a')) === 0);
T('リセットで目印も消える', !document.getElementById('settings-btn').classList.contains('filter-on'));

// i18n
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  setLang(lg);
  var a = document.querySelector('[data-i18n="settings.brightness"]').textContent;
  var b = document.querySelector('[data-i18n="settings.warmth"]').textContent;
  T('i18n (' + lg + ')', a && b && a !== 'settings.brightness' && b !== 'settings.warmth', a + ' / ' + b);
});
setLang('ja');
localStorage.clear();
