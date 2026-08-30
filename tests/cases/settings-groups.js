// B-5 設定グループの折りたたみ
var IDS = Object.keys(SET_GROUP_DEFAULT_OPEN);
T('折りたたみ対象は10グループ', IDS.length === 10, String(IDS.length));
T('全て <details> になっている',
  IDS.every(function (id) { var e = document.getElementById(id); return e && e.tagName === 'DETAILS'; }),
  IDS.filter(function (id) {
    var e = document.getElementById(id); return !e || e.tagName !== 'DETAILS';
  }).join(',') || '(すべて)');
T('各 details に summary がある',
  IDS.every(function (id) { return !!document.getElementById(id).querySelector(':scope > summary > h4'); }));

// 折りたたみ対象外
T('FXL グループは details 化しない（レイアウトの続きとして見せる設計）',
  document.getElementById('fxl-settings-group').tagName === 'DIV');
T('リセットグループも details 化しない',
  document.getElementById('reset-group').tagName === 'DIV');

// 既定の開閉
T('既定でカラー/タイポグラフィ/レイアウトが開く',
  document.getElementById('color-group').open &&
  document.getElementById('typography-group').open &&
  document.getElementById('layout-group').open);
T('既定でツールバー/読み上げ/Drive/KOReader/しおり/キャッシュ/言語が閉じる',
  !document.getElementById('toolbar-settings-group').open &&
  !document.getElementById('tts-settings-group').open &&
  !document.getElementById('drive-auto-group').open &&
  !document.getElementById('kosync-group').open &&
  !document.getElementById('bookmark-io-group').open &&
  !document.getElementById('cache-group').open &&
  !document.getElementById('lang-group').open);

// 閉じているグループの中身は見えない
// 中身の可視判定は getClientRects では測れない（閉じた <details> の子孫も
// スキップされたサブツリーとして矩形を返す Chrome がある）。
// 実際にレイアウトへ寄与しているか = details 自身の高さで見る。
(function () {
  var closed = document.getElementById('lang-group');
  var opened = document.getElementById('color-group');
  var ch = closed.getBoundingClientRect().height;
  var oh = opened.getBoundingClientRect().height;
  var sh = closed.querySelector(':scope > summary').getBoundingClientRect().height;
  // 差分は .set-group 自身の padding-bottom:4px ぶんだけ
  var pad = parseFloat(getComputedStyle(closed).paddingBottom) || 0;
  T('閉じたグループは summary の高さしか占めない', Math.abs(ch - sh - pad) < 2,
    'group=' + ch.toFixed(0) + ' summary=' + sh.toFixed(0) + ' pad=' + pad);
  T('開いたグループは中身のぶん高い', oh > ch * 3, oh.toFixed(0) + ' > ' + ch.toFixed(0));
})();

// summary のマーカーを消して自前の ▾ を出している
(function () {
  var sm = document.getElementById('color-group').querySelector(':scope > summary');
  T('summary の既定マーカーを消す', getComputedStyle(sm).listStyleType === 'none',
    getComputedStyle(sm).listStyleType);
  T('▾ を自前で出す', getComputedStyle(sm, '::after').content.indexOf('▾') >= 0,
    getComputedStyle(sm, '::after').content);
})();

// 開閉が永続化される
document.getElementById('cache-group').open = true;
document.getElementById('color-group').open = false;
// toggle イベントは非同期なので少し待つ
setTimeout(function () {
  T('開いた状態が state に入る', state.setGroupsOpen['cache-group'] === true,
    JSON.stringify(state.setGroupsOpen['cache-group']));
  T('閉じた状態も state に入る', state.setGroupsOpen['color-group'] === false);
  var saved = JSON.parse(localStorage.getItem('epub_settings') || '{}').setGroupsOpen || {};
  T('永続化される', saved['cache-group'] === true && saved['color-group'] === false,
    JSON.stringify(saved));

  // 復元
  state.setGroupsOpen = Object.assign({}, SET_GROUP_DEFAULT_OPEN);
  loadSettings();
  T('復元できる', state.setGroupsOpen['cache-group'] === true &&
    document.getElementById('cache-group').open === true);

  // 未知キーは取り込まない
  localStorage.setItem('epub_settings', JSON.stringify({
    setGroupsOpen: { 'cache-group': true, 'NOPE-group': true, 'color-group': 'ダメ' } }));
  state.setGroupsOpen = Object.assign({}, SET_GROUP_DEFAULT_OPEN);
  loadSettings();
  T('未知キーは取り込まない', !('NOPE-group' in state.setGroupsOpen));
  T('boolean 以外は無視', state.setGroupsOpen['color-group'] === true);

  // リセットで既定に戻る（DISPLAY_DEFAULTS の参照を壊さないこと）
  document.getElementById('cache-group').open = true;
  document.getElementById('color-group').open = false;
  window.confirm = function () { return true; };
  resetDisplaySettings();
  T('リセットで既定の開閉に戻る',
    document.getElementById('color-group').open === true &&
    document.getElementById('cache-group').open === false);
  T('リセットが DISPLAY_DEFAULTS を汚さない',
    SET_GROUP_DEFAULT_OPEN['cache-group'] === false &&
    DISPLAY_DEFAULTS.setGroupsOpen['color-group'] === true);
  T('state と DISPLAY_DEFAULTS が別オブジェクト',
    state.setGroupsOpen !== DISPLAY_DEFAULTS.setGroupsOpen);

  // 畳んだぶんパネルが短くなる
  var body = document.querySelector('.pop-body');
  var openAll = 0, closedAll = 0;
  IDS.forEach(function (id) { document.getElementById(id).open = true; });
  openAll = body.scrollHeight;
  IDS.forEach(function (id) { document.getElementById(id).open = false; });
  closedAll = body.scrollHeight;
  T('畳むとパネルが実際に短くなる', closedAll < openAll * 0.6,
    closedAll + ' < ' + openAll);

  // FXL グループの display 制御が details 化後も効く
  document.getElementById('fxl-settings-group').style.display = '';
  document.body.classList.add('mode-fxl');
  T('mode-fxl でタイポグラフィが隠れる（.fxl-hide-group が details でも効く）',
    getComputedStyle(document.getElementById('typography-group')).display === 'none');
  document.body.classList.remove('mode-fxl');
  document.getElementById('fxl-settings-group').style.display = 'none';

  IDS.forEach(function (id) { document.getElementById(id).open = !!SET_GROUP_DEFAULT_OPEN[id]; });
  localStorage.clear();
}, 50);
