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
T('FXL の行は独立したグループではない（div・set-group クラスなし）',
  document.getElementById('fxl-settings-group').tagName === 'DIV' &&
  !document.getElementById('fxl-settings-group').classList.contains('set-group'));
// 「レイアウト」の外にあった頃は、FXL 本でレイアウトを閉じても FXL の行だけが見出しなしで残っていた
T('FXL の行は「レイアウト」の中にある',
  document.getElementById('layout-group').contains(document.getElementById('fxl-settings-group')));
(function () {
  var lg = document.getElementById('layout-group'), fx = document.getElementById('fxl-settings-group');
  var wasOpen = lg.open;
  fx.style.display = 'block';
  lg.open = true;
  var hOpen = fx.getBoundingClientRect().height;
  lg.open = false;
  var lgClosedH = lg.getBoundingClientRect().height;
  var sumH = lg.querySelector(':scope > summary').getBoundingClientRect().height;
  T('FXL 表示中でも「レイアウト」を閉じると FXL の行も隠れる',
    hOpen > 60 && lgClosedH - sumH < 8,
    'open=' + hOpen.toFixed(0) + ' closedGroup=' + lgClosedH.toFixed(0) + ' summary=' + sumH.toFixed(0));
  fx.style.display = 'none';
  lg.open = wasOpen;
})();
T('リセットグループも details 化しない',
  document.getElementById('reset-group').tagName === 'DIV');

// 既定の開閉：すべて閉じる（design_settings_groups.md §3-3）
T('既定ですべてのカテゴリが閉じている',
  IDS.every(function (id) { return SET_GROUP_DEFAULT_OPEN[id] === false && !document.getElementById(id).open; }),
  IDS.filter(function (id) { return document.getElementById(id).open; }).join(',') || '(すべて閉)');
T('markup にも open 属性が無い（ちらつき防止の open を外した）',
  IDS.every(function (id) { return !document.getElementById(id).hasAttribute('open'); }));

// 見出しは「押せる帯」（§3-1）
(function () {
  var g = document.getElementById('color-group');
  var sm = g.querySelector(':scope > summary'), h = sm.querySelector('h4');
  var cs = getComputedStyle(h);
  T('帯の高さが 44px 以上（タッチの推奨サイズ）', sm.getBoundingClientRect().height >= 44 - 0.5,
    sm.getBoundingClientRect().height.toFixed(1));
  T('見出しは 14px・不透明・大文字化なし',
    cs.fontSize === '14px' && cs.opacity === '1' && cs.textTransform === 'none',
    cs.fontSize + ' / ' + cs.opacity + ' / ' + cs.textTransform);
  T('カテゴリの下に区切り線', parseFloat(getComputedStyle(g).borderBottomWidth) >= 1,
    getComputedStyle(g).borderBottomWidth);
  T('閉じたカテゴリ 1 つの高さが 48px 以下（以前の余白 20px＋見出しより短い）',
    g.getBoundingClientRect().height <= 48, g.getBoundingClientRect().height.toFixed(1));
  var bgClosed = getComputedStyle(sm).backgroundColor;
  var beforeClosed = getComputedStyle(g, '::before').content;
  g.open = true;
  var bgOpen = getComputedStyle(sm).backgroundColor;
  var bf = getComputedStyle(g, '::before');
  T('開いたカテゴリは帯の色が変わる', bgOpen !== bgClosed, bgClosed + ' → ' + bgOpen);
  T('開いたカテゴリは左端に線（閉じると出ない）',
    (beforeClosed === 'none' || beforeClosed === 'normal') && bf.position === 'absolute' && bf.width === '3px',
    beforeClosed + ' → ' + bf.position + ' ' + bf.width);
  // 中身を字下げしない＝スマホ幅で select を窮屈にしない
  var row = g.querySelector('.set-row');
  var pb = document.querySelector('.pop-body').getBoundingClientRect();
  var pl = parseFloat(getComputedStyle(document.querySelector('.pop-body')).paddingLeft) || 0;
  T('中身の行は字下げしない', Math.abs(row.getBoundingClientRect().left - (pb.left + pl)) < 1,
    'row=' + row.getBoundingClientRect().left.toFixed(1) + ' body=' + (pb.left + pl).toFixed(1));
  g.open = false;
})();

// 閉じているグループの中身は見えない
// 中身の可視判定は getClientRects では測れない（閉じた <details> の子孫も
// スキップされたサブツリーとして矩形を返す Chrome がある）。
// 実際にレイアウトへ寄与しているか = details 自身の高さで見る。
(function () {
  var closed = document.getElementById('lang-group');
  var opened = document.getElementById('color-group');
  opened.open = true;
  var ch = closed.getBoundingClientRect().height;
  var oh = opened.getBoundingClientRect().height;
  var sh = closed.querySelector(':scope > summary').getBoundingClientRect().height;
  // 差分は .set-group 自身の padding-bottom:4px ぶんだけ
  var pad = parseFloat(getComputedStyle(closed).paddingBottom) || 0;
  T('閉じたグループは summary の高さしか占めない', Math.abs(ch - sh - pad) < 2,
    'group=' + ch.toFixed(0) + ' summary=' + sh.toFixed(0) + ' pad=' + pad);
  T('開いたグループは中身のぶん高い', oh > ch * 3, oh.toFixed(0) + ' > ' + ch.toFixed(0));
  opened.open = false;
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
  T('boolean 以外は無視', state.setGroupsOpen['color-group'] === false);

  // リセットで既定に戻る（DISPLAY_DEFAULTS の参照を壊さないこと）
  document.getElementById('cache-group').open = true;
  document.getElementById('color-group').open = true;
  state.setGroupsOpen['cache-group'] = true;
  state.setGroupsOpen['color-group'] = true;
  window.confirm = function () { return true; };
  resetDisplaySettings();
  T('リセットで既定の開閉（すべて閉）に戻る',
    document.getElementById('color-group').open === false &&
    document.getElementById('cache-group').open === false);
  T('リセットが DISPLAY_DEFAULTS を汚さない',
    SET_GROUP_DEFAULT_OPEN['cache-group'] === false &&
    DISPLAY_DEFAULTS.setGroupsOpen['color-group'] === false);
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
