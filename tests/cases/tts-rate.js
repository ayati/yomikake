// B-12 読み上げ速度を設定パネルにも
var sel = document.getElementById('tts-rate-select');
var bar = document.getElementById('tts-rate-label');
T('速度セレクトがある', !!sel);
T('🔊 グループ内にある', sel && sel.closest('#tts-settings-group') !== null);
T('音声セレクトより上にある（使用頻度順）',
  sel && (sel.compareDocumentPosition(document.getElementById('tts-voice-select')) &
          Node.DOCUMENT_POSITION_FOLLOWING) !== 0);

// option の value が toFixed(2) と一致していること
// （'1' だとセレクトが空欄になる。v2.13.0 の行間セレクトと同じ罠）
(function () {
  var bad = [];
  Array.prototype.forEach.call(sel.options, function (o) {
    if (o.value !== parseFloat(o.value).toFixed(2)) bad.push(o.value);
  });
  T('option の value が toFixed(2) 形式', bad.length === 0, bad.join(',') || '(すべて)');
  T('0.5〜2.0 の7段階', sel.options.length === 7, String(sel.options.length));
})();

// 絶対値セッター
T('setTtsRate が定義', typeof setTtsRate === 'function');
setTtsRate(1.5);
T('state に入る', state.ttsRate === 1.5, String(state.ttsRate));
T('セレクトが同期', sel.value === '1.50', sel.value);
T('バーのラベルも同期', bar.textContent === '1.5x', bar.textContent);
T('永続化', JSON.parse(localStorage.getItem('epub_settings')).ttsRate === 1.5);

// 範囲外は無視
setTtsRate(0.1); setTtsRate(5); setTtsRate('でたらめ');
T('範囲外は無視', state.ttsRate === 1.5, String(state.ttsRate));

// バー ⇄ セレクトの相互同期（両方向）
changeTtsRate(0.25);
T('バーの＋でセレクトが追従', state.ttsRate === 1.75 && sel.value === '1.75',
  state.ttsRate + ' / ' + sel.value);
changeTtsRate(-0.25);
T('バーの－でもセレクトが追従', state.ttsRate === 1.5 && sel.value === '1.50');
setTtsRate(0.5);
T('セレクトからバーへも追従', bar.textContent === '0.5x', bar.textContent);

// バーは上下限で頭打ちになる
setTtsRate(2); changeTtsRate(0.25);
T('上限 2.0 で頭打ち', state.ttsRate === 2, String(state.ttsRate));
setTtsRate(0.5); changeTtsRate(-0.25);
T('下限 0.5 で頭打ち', state.ttsRate === 0.5, String(state.ttsRate));

// 保存・復元
setTtsRate(1.25);
state.ttsRate = 1;
loadSettings();
T('復元', state.ttsRate === 1.25, String(state.ttsRate));

// 表示設定リセットでは変わらない（読み上げ設定は対象外を維持）
setTtsRate(1.75);
window.confirm = function () { return true; };
resetDisplaySettings();
T('リセットで ttsRate は変わらない', state.ttsRate === 1.75, String(state.ttsRate));
T('リセット後もセレクトが一致', sel.value === '1.75', sel.value);

// i18n
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  setLang(lg);
  var lbl = document.querySelector('[data-i18n="settings.ttsRate"]').textContent;
  T('i18n (' + lg + ')', !!lbl && lbl !== 'settings.ttsRate', lbl);
});
setLang('ja');

// 読み上げ非対応環境ではグループごと隠す
T('_ttsSupported の値', true, String(_ttsSupported));
T('対応環境ではグループが出る',
  _ttsSupported ? document.getElementById('tts-settings-group').style.display !== 'none' : true);

localStorage.clear();
