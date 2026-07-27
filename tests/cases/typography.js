// B-11 行間の連続値化 ＋ 字間
var lh = document.getElementById('lineh-range');
var ls = document.getElementById('letter-spacing-range');
T('行間がスライダーになった', !!lh && lh.type === 'range');
T('旧セレクトは無い', !document.getElementById('lineh-select'));
T('行間の範囲 1.4〜3.0 / 0.1刻み',
  lh.min === '1.4' && lh.max === '3.0' && lh.step === '0.1',
  lh.min + '-' + lh.max + '/' + lh.step);
T('字間スライダーがある', !!ls && ls.type === 'range');
T('字間の範囲 0〜5', ls.min === '0' && ls.max === '5' && ls.step === '1');
T('LETTER_SPACING_EM は6段階', LETTER_SPACING_EM.length === 6, LETTER_SPACING_EM.join(','));
T('段階0は em を出さない', LETTER_SPACING_EM[0] === 0);

// 既定
T('既定 lineHeight=2.0 / letterSpacing=0',
  state.lineHeight === 2.0 && state.letterSpacing === 0);

// oninput は再描画しない（ラベルだけ）
var renders = 0, origRender = rerenderKeepPos;
window.rerenderKeepPos = function () { renders++; return origRender.apply(this, arguments); };
previewLineHeight(2.7);
T('oninput はラベルだけ更新', renders === 0 && document.getElementById('lineh-val').textContent === '2.7',
  'renders=' + renders + ' label=' + document.getElementById('lineh-val').textContent);
previewLetterSpacing(4);
T('字間 oninput もラベルだけ', renders === 0 && document.getElementById('letter-spacing-val').textContent === '4');
window.rerenderKeepPos = origRender;

// onchange は反映する
changeLineHeight('1.7');
T('中間値 1.7 を取れる（旧4段階では不可）', state.lineHeight === 1.7, String(state.lineHeight));
T('ラベル同期', document.getElementById('lineh-val').textContent === '1.7');
T('永続化', JSON.parse(localStorage.getItem('epub_settings')).lineHeight === 1.7);

changeLetterSpacing('3');
T('字間 3', state.letterSpacing === 3);
T('字間ラベル', document.getElementById('letter-spacing-val').textContent === '3');

// 範囲外は無視
changeLineHeight('1.0'); changeLineHeight('9'); changeLineHeight('ダメ');
T('行間の範囲外は無視', state.lineHeight === 1.7, String(state.lineHeight));
changeLetterSpacing('-1'); changeLetterSpacing('9');
T('字間の範囲外は無視', state.letterSpacing === 3, String(state.letterSpacing));

// 旧4段階の保存値がそのまま通る（移行不要）
[1.6, 2.0, 2.4, 2.8].forEach(function (v) {
  localStorage.setItem('epub_settings', JSON.stringify({ lineHeight: v }));
  state.lineHeight = 2.0;
  loadSettings();
  T('旧値 ' + v + ' がそのまま復元', state.lineHeight === v, String(state.lineHeight));
  T('旧値 ' + v + ' でスライダーも同期', parseFloat(lh.value) === v, lh.value);
});

// 復元の検証
localStorage.setItem('epub_settings', JSON.stringify({ lineHeight: 9, letterSpacing: 99 }));
state.lineHeight = 2.0; state.letterSpacing = 0;
loadSettings();
T('壊れた保存値は無視', state.lineHeight === 2.0 && state.letterSpacing === 0);

// 注入 CSS の検証（実 ePub を開いて srcdoc を見る）
fetch('tests/.fixtures/reflow.epub').then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'r.epub', { type: 'application/epub+zip' })); })
.then(function () {
  hideTapGuide();
  changeLetterSpacing(0);
  return new Promise(function (r) { setTimeout(r, 900); });
})
.then(function () {
  var sd = document.getElementById('content-iframe').srcdoc || '';
  T('字間0では letter-spacing 宣言を注入しない',
    (sd.match(/letter-spacing:[0-9.]+em!important/g) || []).length === 0);
  T('字間0では rt の打ち消しも出さない', sd.indexOf('rt,rp{letter-spacing') < 0);
  changeLetterSpacing(3);
  return new Promise(function (r) { setTimeout(r, 900); });
})
.then(function () {
  var sd = document.getElementById('content-iframe').srcdoc || '';
  var em = LETTER_SPACING_EM[3];
  T('字間3で body に letter-spacing が入る',
    sd.indexOf('letter-spacing:' + em + 'em!important') >= 0, String(em) + 'em');
  T('rt/rp で打ち消す（ルビが間延びしないこと）',
    sd.indexOf('rt,rp{letter-spacing:normal!important;}') >= 0);
  T('html 側には入れない（body だけ）',
    (sd.match(/letter-spacing:[0-9.]+em/g) || []).length === 1,
    JSON.stringify(sd.match(/letter-spacing:[0-9.]+em/g)));
  // 縦中横フィックスは letter-spacing を摂動してレイアウトを dirty にする実装。
  // 字間注入が !important なので、摂動側も important でないと効かなくなる
  T('縦中横フィックスが important で摂動する（字間注入に負けない）',
    sd.indexOf('setProperty("letter-spacing", "0.01px", "important")') >= 0 ||
    sd.indexOf("setProperty('letter-spacing', '0.01px', 'important')") >= 0);
  T('縦中横フィックスが優先度ごと復元する',
    sd.indexOf('getPropertyPriority') >= 0);
  changeLineHeight('2.3');
  return new Promise(function (r) { setTimeout(r, 900); });
})
.then(function () {
  var sd = document.getElementById('content-iframe').srcdoc || '';
  T('行間の中間値が注入される', sd.indexOf('line-height:2.3!important') >= 0);

  // リセット
  window.confirm = function () { return true; };
  resetDisplaySettings();
  T('リセットで行間が 2.0 に', state.lineHeight === 2.0, String(state.lineHeight));
  T('リセットで字間が 0 に', state.letterSpacing === 0);
  T('リセットでスライダーも戻る',
    parseFloat(lh.value) === 2.0 && parseInt(ls.value, 10) === 0,
    lh.value + '/' + ls.value);

  // i18n
  ['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
    setLang(lg);
    var a = document.querySelector('[data-i18n="settings.letterSpacing"]').textContent;
    T('i18n 字間 (' + lg + ')', !!a && a !== 'settings.letterSpacing', a);
  });
  setLang('ja');
  closeBook();
  localStorage.clear();
})
.catch(function (e) { T('例外', false, e && (e.stack || e.message)); });
