// B-9 全画面時の時計・進捗 HUD
var hud = document.getElementById('fs-hud');
T('#fs-hud が存在', !!hud);
T('body 直下', hud && hud.parentElement === document.body);

var cs = getComputedStyle(hud);
T('通常時は非表示', cs.display === 'none', cs.display);
T('タップを吸わない（下端のページ送り帯と重なるため必須）',
  cs.pointerEvents === 'none', cs.pointerEvents);
T('z-index 45', cs.zIndex === '45', cs.zIndex);
T('既定は時刻＋進捗', state.fsHud === 'both');

// 全画面に入ると出る
state.fullscreen = true;
document.body.classList.add('fullscreen');
syncFsHud();
T('全画面で表示される', getComputedStyle(hud).display === 'flex',
  getComputedStyle(hud).display);
T('時刻が入る', /^\d{1,2}[:：]\d{2}/.test(document.getElementById('fs-hud-time').textContent),
  document.getElementById('fs-hud-time').textContent);

// 位置：右下で、下端中央の #btn-scroll-fwd と重ならない
(function () {
  var r = hud.getBoundingClientRect();
  T('画面の右側にいる', r.left > innerWidth / 2, 'left=' + Math.round(r.left) + '/' + innerWidth);
  T('画面の下端にいる', r.bottom <= innerHeight + 1 && r.bottom > innerHeight - 60,
    'bottom=' + Math.round(r.bottom) + '/' + innerHeight);
  // 次へボタンとの重なりは本を開かないと位置が信用できないので e2e-reflow.js で見る
})();

// 進捗は本を開いていないと出さない
T('本が無ければ進捗は空', document.getElementById('fs-hud-pct').textContent === '');

// 進捗の式が進捗バーと一致する
state.spine = [{}, {}, {}, {}, {}];   // 5章ぶんのダミー
state.currentSpineIdx = 2;
_intraChapterRatio = 0.5;
updateFsHudPct();
T('進捗の式が進捗バーと一致', document.getElementById('fs-hud-pct').textContent === '63%',
  document.getElementById('fs-hud-pct').textContent + ' (期待 63% = (2+0.5)/4)');

// 「時刻のみ」
changeFsHud('clock');
T('時刻のみで進捗が消える', document.getElementById('fs-hud-pct').textContent === '');
T('時刻のみでも HUD は出る', getComputedStyle(hud).display === 'flex');

// 「表示しない」
changeFsHud('off');
T('offで非表示', getComputedStyle(hud).display === 'none');
T('offで body に fs-hud-off', document.body.classList.contains('fs-hud-off'));

// 全画面を抜けたらタイマーを止める
changeFsHud('both');
T('全画面中はタイマーが動く', _fsHudTimer !== null);
state.fullscreen = false;
document.body.classList.remove('fullscreen');
syncFsHud();
T('全画面を抜けるとタイマーを止める', _fsHudTimer === null);
T('全画面を抜けると非表示', getComputedStyle(hud).display === 'none');

// 保存・復元
changeFsHud('clock');
T('永続化', JSON.parse(localStorage.getItem('epub_settings')).fsHud === 'clock');
state.fsHud = 'both';
loadSettings();
T('復元', state.fsHud === 'clock');
T('復元でセレクトも同期', document.getElementById('fs-hud-select').value === 'clock');

// 不正値は無視
changeFsHud('でたらめ');
T('不正値は無視', state.fsHud === 'clock');
localStorage.setItem('epub_settings', JSON.stringify({ fsHud: 'NOPE' }));
state.fsHud = 'both';
loadSettings();
T('保存側の不正値も無視', state.fsHud === 'both');

// リセットで戻る
changeFsHud('off');
window.confirm = function () { return true; };
resetDisplaySettings();
T('リセットで既定に戻る', state.fsHud === 'both');
T('リセットで fs-hud-off が外れる', !document.body.classList.contains('fs-hud-off'));

// i18n
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  setLang(lg);
  var lbl = document.querySelector('[data-i18n="settings.fsHud"]').textContent;
  var opt = document.querySelector('#fs-hud-select option[value="clock"]').textContent;
  T('i18n (' + lg + ')', lbl && opt && lbl !== 'settings.fsHud' && opt !== 'fsHud.clock',
    lbl + ' / ' + opt);
});
setLang('ja');
state.spine = []; state.currentSpineIdx = 0; _intraChapterRatio = 0;
localStorage.clear();
