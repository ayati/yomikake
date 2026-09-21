// 空行の詰め方（design_blank_lines.md）
//
// fixture: tests/.fixtures/blank.epub（Web 小説にありがちな空行と、詰めてはいけないものを
// 1章に混ぜてある）。**実際に本を開いて iframe の中の実寸を測る** —— クラスの有無だけを
// 見ると「クラスは正しいのに表示が変わっていない」を取り逃がす
// （2026-09-21 の「よく読む著者」の棒グラフが、まさにその形で幅 0 だった）。

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function idoc() {
  var f = document.getElementById('content-iframe');
  return f && f.contentDocument;
}
function vis(el) { return !!el && el.getBoundingClientRect().width > 0; }
// 本文の長さ。iOS 版は body を position:fixed + transform で動かすので
// documentElement.scrollWidth は viewport 幅のままで、本文の長さは body 側に出る
// （注入コードの maxS() と同じ見方）。両ファイルで単調に比べられるよう大きい方を採る
function contentLen(d) {
  return Math.max(d.documentElement.scrollWidth, d.body.offsetWidth);
}

// ── 本を開く前だけ確かめられること ─────────────────────
// #page-container は本を開くまで display:none。おまかせの判定はその時点で走るので、
// ここで 0 を返すと必ず「狭い画面」＝すべて詰める になり、広い画面の分岐が死ぬ
T('本を開く前でも画面の行数を測れる', linesPerScreen() > 0, linesPerScreen().toFixed(1));

// 本を開いていないときに会話アキを触っても、ライブラリ全体の「おまかせ」を壊さない
// （固定する先の本が無いので state.blankLines を書き換えてはいけない）
state.blankLines = 'auto'; saveSettings();
toggleDialogueGap();
T('本未オープンで会話アキを触ってもおまかせは残る', _savedBlankLines() === 'auto',
  _savedBlankLines());
toggleDialogueGap();
state.blankLines = 'off'; state.dialogueGap = false; saveSettings();

var CHAIN = fetch('tests/.fixtures/blank.epub')
.then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'blank.epub', { type: 'application/epub+zip' })); })
.then(function () {
  T('本が開けた', !!state.epub && state.renderMode === 'reflow', state.bookTitle);
  T('既定は「そのまま」', state.blankLines === 'off' && state.dialogueGap === false);
  return wait(900);
})
// ── そのまま: 走査そのものを行わない ──
.then(function () {
  var d = idoc();
  T('iframe の中を読める', !!d && !!d.body);
  T('off では印を付けない', d.querySelectorAll('.yk-bl,.yk-gap').length === 0,
    '印=' + d.querySelectorAll('.yk-bl,.yk-gap').length);
  window.__swOff = contentLen(d);
  T('空行が場所を取っている', window.__swOff > 0, 'scrollWidth=' + window.__swOff);
  changeBlankLines('collapse');
  return wait(900);
})
// ── 連続空行を1行に ──
.then(function () {
  var d = idoc();
  var all = d.querySelectorAll('.yk-bl');
  var ext = d.querySelectorAll('.yk-bl-x');
  T('空行を9つ見つけた', all.length === 9, String(all.length));
  T('連続の2つ目以降は5つ', ext.length === 5, String(ext.length));

  var hidden = 0, shown = 0;
  [].forEach.call(all, function (el) {
    if (el.classList.contains('yk-bl-x')) { if (!vis(el)) hidden++; }
    else if (vis(el)) shown++;
  });
  T('連続の2つ目以降が実際に消えている', hidden === 5, String(hidden) + '/5');
  T('連続の1つ目は残っている（場面転換のアキ）', shown === 4, String(shown) + '/4');

  var idBlank = d.getElementById('anchor-blank');
  T('id 付きの空行は詰めない', vis(idBlank) && !idBlank.classList.contains('yk-bl'));

  window.__swCollapse = contentLen(d);
  T('本文が実際に短くなった', window.__swCollapse < window.__swOff,
    window.__swOff + ' → ' + window.__swCollapse);
  changeBlankLines('all');
  return wait(900);
})
// ── すべて詰める ──
.then(function () {
  var d = idoc();
  var all = d.querySelectorAll('.yk-bl');
  var live = [].filter.call(all, vis).length;
  T('すべての空行が消えている', live === 0, '残り=' + live);
  T('id 付きの空行はここでも残る', vis(d.getElementById('anchor-blank')));
  T('画像だけの段落は空行ではない',
    vis(d.querySelector('img') && d.querySelector('img').parentNode));
  // 子孫に id を持つ段落＝目次・脚注の戻り先。隠すと scrollIntoView が効かず章頭に落ちる
  // 空なので幅は 0 だが、display:none にされていないこと（されると scrollIntoView が効かない）
  var anchorP = d.getElementById('note-anchor').parentNode;
  T('アンカーだけの段落は詰めない',
    getComputedStyle(anchorP).display !== 'none' && !anchorP.classList.contains('yk-bl'),
    getComputedStyle(anchorP).display + ' / ' + anchorP.className);
  // 空セルを display:none にすると行から消えて以降の列が1つずれる
  T('空のテーブルセルは詰めない', vis(d.getElementById('cell-empty')));
  var sw = contentLen(d);
  T('いちばん短くなる', sw < window.__swCollapse, window.__swCollapse + ' → ' + sw);
  window.__swAll = sw;
  return wait(0);
})
// ── 会話の前後を半行 ──
.then(function () {
  var d = idoc();
  T('会話アキ OFF では印だけ付いて余白は無い',
    d.querySelectorAll('.yk-gap').length === 2 &&
    parseFloat(getComputedStyle(d.querySelector('.yk-gap')).paddingRight || 0) === 0,
    '印=' + d.querySelectorAll('.yk-gap').length);
  toggleDialogueGap();
  T('トグルが ON になった', state.dialogueGap === true);
  return wait(900);
})
.then(function () {
  var d = idoc();
  var gaps = d.querySelectorAll('.yk-gap');
  T('境目は2箇所だけ', gaps.length === 2, String(gaps.length));

  // 会話どうしの間には入れない（前後の両方に入れると詰めたのに間延びする）
  var lines = [].filter.call(d.querySelectorAll('p'), function (p) {
    return p.textContent.replace(/[\s 　]/g, '') !== '';
  });
  var talk2 = lines.filter(function (p) { return p.textContent.indexOf('続けて会話') >= 0; })[0];
  T('会話どうしの間は詰めたまま', !!talk2 && !talk2.classList.contains('yk-gap'));

  // 縦書きなので block-start = 物理の右。実際に余白が付いたかを px で見る
  var pad = parseFloat(getComputedStyle(gaps[0]).paddingRight || 0);
  T('半行ぶんの余白が実際に付く', pad > 0, 'padding-right=' + pad + 'px');
  T('半行＝行間の半分（行間2.0 なら 1em=16px 前後）', pad > 10 && pad < 24, String(pad));
  T('余白のぶんだけ長くなる', contentLen(d) > window.__swAll,
    window.__swAll + ' → ' + contentLen(d));

  return wait(0);
})
// ── 会話の半行アキは「新しい本は必ず OFF」──
// ほかの項目と違って前の本の設定を持ち越すと、組版済みの紙の本の組版を黙って変えてしまう
.then(function () {
  T('この本では ON のまま', state.dialogueGap === true);
  return fetch('tests/.fixtures/reflow.epub').then(function (r) { return r.blob(); })
    .then(function (b) {
      return loadEpub(new File([b], 'reflow.epub', { type: 'application/epub+zip' }));
    });
})
.then(function () { return wait(900); })
.then(function () {
  T('別の本を開くと会話アキは OFF に戻る', state.dialogueGap === false);
  T('トグルの見た目も OFF',
    (document.getElementById('dialogue-gap-toggle') || {}).textContent === 'OFF');
  T('空行の詰め方は持ち越す（最後に使った設定が新しい本の既定）', state.blankLines === 'all',
    state.blankLines);
  // 記録のある本に戻れば復元される
  return fetch('tests/.fixtures/blank.epub').then(function (r) { return r.blob(); })
    .then(function (b) {
      return loadEpub(new File([b], 'blank.epub', { type: 'application/epub+zip' }));
    });
})
.then(function () { return wait(900); })
.then(function () {
  T('ONにした本に戻ると復元される', state.dialogueGap === true);
  // 後始末（他のケースは別プロセスなので実害は無いが、状態を残さない）
  toggleDialogueGap();
  changeBlankLines('off');
  T('設定を戻せた', state.blankLines === 'off' && state.dialogueGap === false);
})
.catch(function (e) { T('例外', false, e && (e.stack || e.message)); });

// ══ おまかせ（自動判定・design_blank_lines.md §5）══════════════
// しきい値は蔵書13冊の実測から決めてある（紙・新書 空行/本文 0.02〜0.34 /
// Web 装飾 0.62〜1.99）。まず純関数の判定を直接、次に実際に本を開いて通しで見る。

var W = { ratio: 1.2, dlg: 1.0, nn: 0.04, n: 400 };   // 会話の前後だけ空ける Web 小説型
var E = { ratio: 1.9, dlg: 1.0, nn: 0.95, n: 400 };   // ほぼ毎行に空行がある型
var P = { ratio: 0.26, dlg: 0.15, nn: 0.23, n: 400 }; // 紙・新書型

T('判定: 紙の本はそのまま', decideBlankAuto(P, 12).level === 'off');
T('判定: 材料不足ならそのまま', decideBlankAuto(null, 12).level === 'off');
T('判定: Web小説＋狭い画面はすべて詰める', decideBlankAuto(W, 12).level === 'all');
T('判定: Web小説＋広い画面は連続を1行に', decideBlankAuto(W, 59).level === 'collapse');
T('判定: 会話の前後だけの本は半行アキON', decideBlankAuto(W, 12).gap === true);
T('判定: 毎行に空行がある本は半行アキOFF', decideBlankAuto(E, 12).gap === false);
T('判定: 連続を1行にしたときは半行アキを足さない', decideBlankAuto(W, 59).gap === false);
T('判定: 境界（1画面25行）は狭い側', decideBlankAuto(W, 25).level === 'all' &&
  decideBlankAuto(W, 26).level === 'collapse');
// ── 実際に開いて通しで見る（前半の鎖が終わってから。同時に走らせると本を取り合う）──
CHAIN
.then(function () {
  T('1画面の行数を計算できる', linesPerScreen() > 0 && linesPerScreen() < 500,
    linesPerScreen().toFixed(1));
  localStorage.removeItem('epub_book_prefs');   // 「告知済み」を消して初回オープンにする
  state.blankLines = 'auto'; saveSettings();
  return fetch('tests/.fixtures/blankweb.epub');
})
.then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'blankweb.epub', { type: 'application/epub+zip' })); })
.then(function () { return wait(900); })
.then(function () {
  T('おまかせのまま（設定欄は auto）', state.blankLines === 'auto', state.blankLines);
  T('実効値が決まっている', !!_blankAuto && _blankAuto.level !== 'off',
    _blankAuto && (_blankAuto.level + (_blankAuto.gap ? '+半行' : '')));
  T('会話の前後だけの本なので半行アキが入る', _blankAuto.gap === true);

  var d = idoc();
  var hidden = [].filter.call(d.querySelectorAll('.yk-bl'), function (el) { return !vis(el); }).length;
  T('空行が実際に消えている', hidden > 0, '消えた数=' + hidden);
  T('会話の境目に余白が実際に付く',
    parseFloat(getComputedStyle(d.querySelector('.yk-gap')).paddingRight || 0) > 0);

  // 設定パネルに「いま何になっているか」が出る（無いとおまかせの結果が分からない）
  var note = document.getElementById('blank-auto-note');
  T('おまかせの結果が設定に出る', note.style.display !== 'none' && note.textContent.length > 0,
    note.textContent);

  // 黙って変えない：告知トーストが出ている
  var toast = document.getElementById('toast');
  T('告知トーストが出ている', toast.classList.contains('show') &&
    toast.classList.contains('toast-action'), toast.textContent.slice(0, 20));

  // タップ＝「そのままに戻す」。その本だけ固定され、方針（グローバル）は auto のまま
  toast.click();
  return wait(900);
})
.then(function () {
  T('タップでその本だけ「そのまま」に固定', state.blankLines === 'off', state.blankLines);
  // ⚠ セレクトが 'auto' のまま残ると、同じ値を選んでも change が飛ばず
  //    「おまかせに戻す」道が消える（トーストから changeBlankLines を呼ぶ経路の落とし穴）
  T('設定のセレクトも「そのまま」に追従する',
    document.getElementById('blank-lines-select').value === 'off',
    document.getElementById('blank-lines-select').value);
  T('固定中であることが設定に出る',
    document.getElementById('blank-auto-note').textContent.length > 0,
    document.getElementById('blank-auto-note').textContent);
  // もう一度「おまかせ」を選べば自動に戻る
  changeBlankLines('auto');
  return wait(900);
})
.then(function () {
  T('「おまかせ」を選び直すと自動に戻る', state.blankLines === 'auto' &&
    !!_blankAuto && _blankAuto.level !== 'off', _blankAuto && _blankAuto.level);
  T('その本の記録も auto になる', (_bpGet(state.bookKey) || {}).blankLines === 'auto');

  // 会話アキのトグルでその本を固定したときも、セレクトが追従しないと戻す導線が消える
  toggleDialogueGap();
  T('会話アキで固定したときもセレクトが追従する',
    state.blankLines !== 'auto' &&
    document.getElementById('blank-lines-select').value === state.blankLines,
    state.blankLines + ' / ' + document.getElementById('blank-lines-select').value);
  T('固定してもおまかせの方針は残る', _savedBlankLines() === 'auto');

  // 表示設定リセットは固定の印ごと落とす（残ると保存値に 'auto' が書き戻される）
  window.confirm = function () { return true; };
  resetDisplaySettings();
  T('リセットで「空行の詰め方」も既定に戻る',
    _savedBlankLines() === 'off' && state.blankLines === 'off', _savedBlankLines());
  T('リセットで固定の印も消える', _blankPinned === false && _blankAuto === null);
  state.blankLines = 'auto'; saveSettings();
  changeBlankLines('auto');
  return wait(900);
})
.then(function () {
  changeBlankLines('off');   // 以降の検査のため戻しておく
  return wait(900);
})
.then(function () {
  T('おまかせの方針は解除されない（グローバルは auto）', _savedBlankLines() === 'auto',
    _savedBlankLines());
  // ⚠ 固定中に他の設定を触っても方針が消えないこと（saveSettings がグローバルを書き戻す穴）
  changeTheme('sepia');
  T('他の設定を触ってもおまかせの方針は残る', _savedBlankLines() === 'auto', _savedBlankLines());
  changeTheme('');
  // 本を開いていないときの変更は「方針そのもの」の変更として扱う
  T('読書中の固定は本ごと（グローバルは auto のまま）', state.blankLines === 'off' &&
    _savedBlankLines() === 'auto');
  T('戻したので空行が見えている',
    [].filter.call(idoc().querySelectorAll('.yk-bl'), vis).length > 0 ||
    idoc().querySelectorAll('.yk-bl').length === 0);
  // 材料が足りない本（fixture の blank.epub は本文ブロックが 150 未満）
  state.blankLines = 'auto'; saveSettings();
  return fetch('tests/.fixtures/blank.epub').then(function (r) { return r.blob(); })
    .then(function (b) {
      return loadEpub(new File([b], 'blank.epub', { type: 'application/epub+zip' }));
    });
})
.then(function () { return wait(900); })
.then(function () {
  T('材料が足りない本は判定せず「そのまま」', _blankAuto && _blankAuto.level === 'off',
    _blankAuto && _blankAuto.level);
  T('印も付かない', idoc().querySelectorAll('.yk-bl').length === 0);
  // FXL は概念が無いので測らない
  return fetch('tests/.fixtures/fxl.epub').then(function (r) { return r.blob(); })
    .then(function (b) {
      return loadEpub(new File([b], 'fxl.epub', { type: 'application/epub+zip' }));
    });
})
.then(function () { return wait(900); })
.then(function () {
  T('FXL では判定しない', state.renderMode === 'fxl' && _blankAuto === null);
  T('FXL でも実効値は安全側', effBlankLines() === 'off' && effDialogueGap() === false);
  state.blankLines = 'off'; saveSettings();
})
.catch(function (e) { T('おまかせの検査が例外', false, e && (e.stack || e.message)); });
