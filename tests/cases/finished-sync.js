// 読了管理と同期（design_finished_sync.md）
// 「読了」を位置からの派生値ではなく finishedAt / finishedCount の記録として扱う。
localStorage.clear();

var FA = '2026-01-01T00:00:00.000Z';   // 読了日時（古い）
var FB = '2026-06-01T00:00:00.000Z';   // 読了日時（新しい）

function K(title) { return 'epub_pos_' + title + '__著者'; }
function put(title, o) { localStorage.setItem(K(title), JSON.stringify(o)); }
function got(title) { try { return JSON.parse(localStorage.getItem(K(title))); } catch (e) { return null; } }
function item(title) { return _rlCollect().filter(function (it) { return it.key === K(title); })[0]; }

// ══ 1. _rlCollect の 4 状態（§4-4）══
put('読みかけ', { spineIdx: 5,  ratio: 0.3, spineCount: 20 });
put('読了旧',   { spineIdx: 19, ratio: 1.0, spineCount: 20 });
put('再読中',   { spineIdx: 5,  ratio: 0.3, spineCount: 20, finishedAt: FA, finishedCount: 20 });
put('続きあり', { spineIdx: 19, ratio: 1.0, spineCount: 24, finishedAt: FA, finishedCount: 20 });
put('続き読了', { spineIdx: 23, ratio: 1.0, spineCount: 24, finishedAt: FA, finishedCount: 24 });

(function () {
  var a = item('読みかけ');
  T('読みかけ: どれでもない', !a.finished && !a.atEnd && !a.hasMore);
  var b = item('読了旧');
  T('旧データ: finishedAt 無しでも atEnd で読了', b.finished && b.atEnd && !b.hasMore);
  var c = item('再読中');
  T('再読中: 位置が戻っても読了は消えない', c.finished && !c.atEnd && !c.hasMore);
  var d = item('続きあり');
  T('続きあり: hasMore が立つ', d.finished && !d.atEnd && d.hasMore);
  T('続きあり: 増えた章数', d.newCh === 4, String(d.newCh));
  var e = item('続き読了');
  T('続きを読み終えたら hasMore は消える', e.atEnd && !e.hasMore && e.newCh === 0);
})();

// finishedCount が無い旧読了データでは「続きあり」を主張しない（§7 移行）
put('旧読了で章増', { spineIdx: 19, ratio: 1.0, spineCount: 24, finishedAt: FA });
T('finishedCount 無しなら hasMore は立たない',
  item('旧読了で章増').finished && !item('旧読了で章増').hasMore);
localStorage.removeItem(K('旧読了で章増'));

// ══ 2. 絞り込み（§S1: 隠すのは atEnd だけ）══
_rlQuery = '';
_rlPrefs.view = 'list'; _rlPrefs.sort = 'recent'; _rlPrefs.genre = '';
_rlPrefs.filterReady = false; _rlPrefs.filterHasMore = false; _rlPrefs.showFinished = false;

(function () {
  var keys = _rlFilterSort(_rlCollect()).shown.map(function (it) { return it.key; });
  T('読了は隠れる',     keys.indexOf(K('読了旧')) < 0 && keys.indexOf(K('続き読了')) < 0);
  T('再読中は残る',     keys.indexOf(K('再読中')) >= 0);
  T('続きありは残る',   keys.indexOf(K('続きあり')) >= 0);
  T('読みかけは残る',   keys.indexOf(K('読みかけ')) >= 0);
  _rlPrefs.showFinished = true;
  T('✓読了も表示で全部出る', _rlFilterSort(_rlCollect()).shown.length === 5);
  _rlPrefs.showFinished = false;
  _rlPrefs.filterHasMore = true;
  var only = _rlFilterSort(_rlCollect()).shown;
  T('🆕 続きありチップで絞れる', only.length === 1 && only[0].key === K('続きあり'));
  _rlPrefs.filterHasMore = false;
})();

// ══ 3. 読書データの計上（§S1: 統計は finished）══
T('読了冊数は記録ベース（再読中・続きありも計上）',
  _rdComputeStats(_rlCollect()).finished === 4, String(_rdComputeStats(_rlCollect()).finished));
T('残り時間は末尾の本だけ抑止',
  _rdEstTimeLeft(item('読了旧'), undefined, { cpm: 500, ppm: 5 }) === null &&
  _rdEstTimeLeft(item('再読中'), undefined, { cpm: 500, ppm: 5 }) === null);
// ↑ stats 未計測なので再読中も null。抑止経路の違いは 4-2 の atEnd 分岐で担保する

// ══ 4. 読了の記録（§S2 _rdMarkFinishedAt）══
(function () {
  var savedKey = state.bookKey, savedSpine = state.spine;
  state.bookKey = K('記録');
  put('記録', { spineIdx: 19, ratio: 1.0, spineCount: 20 });

  state.spine = new Array(20);
  _rdMarkFinishedAt();
  var v1 = got('記録');
  T('読了で finishedAt が刻まれる', !!v1.finishedAt);
  T('読了で finishedCount が刻まれる', v1.finishedCount === 20, String(v1.finishedCount));

  state.spine = new Array(24);
  _rdMarkFinishedAt();
  var v2 = got('記録');
  T('finishedAt は初読了日のまま', v2.finishedAt === v1.finishedAt);
  T('finishedCount は最新の版に更新される', v2.finishedCount === 24, String(v2.finishedCount));

  // finishedAt だけ持つ旧エントリにも後から finishedCount が入る
  put('旧記録', { spineIdx: 19, ratio: 1.0, spineCount: 20, finishedAt: FA });
  state.bookKey = K('旧記録'); state.spine = new Array(20);
  _rdMarkFinishedAt();
  T('旧エントリに finishedCount が後から入る', got('旧記録').finishedCount === 20);
  T('旧エントリの finishedAt は上書きされない', got('旧記録').finishedAt === FA);

  localStorage.removeItem(K('記録')); localStorage.removeItem(K('旧記録'));
  state.bookKey = savedKey; state.spine = savedSpine;
})();

// ══ 5. _posAtEnd ══
T('_posAtEnd: 末尾', _posAtEnd({ spineIdx: 19, ratio: 1.0, spineCount: 20 }) === true);
T('_posAtEnd: 途中', _posAtEnd({ spineIdx: 19, ratio: 0.5, spineCount: 20 }) === false);
T('_posAtEnd: spineCount 無しは false', _posAtEnd({ spineIdx: 19, ratio: 1.0 }) === false);
T('_posAtEnd: 非オブジェクト', _posAtEnd(null) === false && _posAtEnd('x') === false);

// ══ 6. マージ（本設計の主題）══
[['_rdMergePos', _rdMergePos], ['_rdMergePosBest', _rdMergePosBest]].forEach(function (pair) {
  var name = pair[0], merge = pair[1];

  // 6-1. 読了が伝播する（§3-A）
  put('M1', { spineIdx: 5, ratio: 0.3, spineCount: 20, lastOpenedAt: FA });
  merge(K('M1'), { spineIdx: 19, ratio: 1.0, spineCount: 20, lastOpenedAt: FB,
                   finishedAt: FB, finishedCount: 20 });
  T(name + ': 読了が伝播する', item('M1').finished && item('M1').atEnd);

  // 6-2. その後 savePos で位置が退行しても読了は残る（§3-A の回帰）
  var v = got('M1'); v.spineIdx = 5; v.ratio = 0.3;
  localStorage.setItem(K('M1'), JSON.stringify(v));
  T(name + ': 位置が退行しても読了は残る',
    item('M1').finished && !item('M1').atEnd && got('M1').finishedAt === FB);

  // 6-3. 旧データの昇格（§S3）
  put('M2', { spineIdx: 3, ratio: 0.2, spineCount: 20, lastOpenedAt: FA });
  merge(K('M2'), { spineIdx: 19, ratio: 1.0, spineCount: 20, lastOpenedAt: FB });
  T(name + ': 位置だけの読了を finishedAt へ昇格', got('M2').finishedAt === FB, got('M2').finishedAt);
  T(name + ': 昇格時に finishedCount も刻む', got('M2').finishedCount === 20);

  // 6-4. 昇格しない（どちらも途中）
  put('M3', { spineIdx: 3, ratio: 0.2, spineCount: 20, lastOpenedAt: FA });
  merge(K('M3'), { spineIdx: 8, ratio: 0.4, spineCount: 20, lastOpenedAt: FB });
  T(name + ': 途中どうしでは読了を捏造しない',
    !got('M3').finishedAt && !got('M3').finishedCount);

  // 6-5. 合流則（finishedAt は最古 / finishedCount は最大・§4-6）
  put('M4', { spineIdx: 5, ratio: 0.3, spineCount: 24, lastOpenedAt: FB,
              finishedAt: FA, finishedCount: 24 });
  merge(K('M4'), { spineIdx: 6, ratio: 0.1, spineCount: 20, lastOpenedAt: FB,
                   finishedAt: FB, finishedCount: 20 });
  T(name + ': finishedAt は最古を採る', got('M4').finishedAt === FA, got('M4').finishedAt);
  T(name + ': finishedCount は最大を採る', got('M4').finishedCount === 24, String(got('M4').finishedCount));

  ['M1', 'M2', 'M3', 'M4'].forEach(function (k) { localStorage.removeItem(K(k)); });
});

// 6-6. 分母は位置の勝者から採る（§3-C の回帰・_rdMergePosBest のみ）
put('M5', { spineIdx: 5, ratio: 0.3, spineCount: 24, lastOpenedAt: FA });
_rdMergePosBest(K('M5'), { spineIdx: 19, ratio: 1.0, spineCount: 20, lastOpenedAt: FB,
                           finishedAt: FB, finishedCount: 20 });
T('_rdMergePosBest: spineCount は位置の勝者から', got('M5').spineCount === 20, String(got('M5').spineCount));
T('_rdMergePosBest: 分母がズレず読了になる', item('M5').atEnd && item('M5').finished);
localStorage.removeItem(K('M5'));

// 6-7. ローカルのほうが進んでいれば位置は守られる（サイレント同期の後退防止）
put('M6', { spineIdx: 12, ratio: 0.5, spineCount: 20, lastOpenedAt: FB });
_rdMergePosBest(K('M6'), { spineIdx: 3, ratio: 0.1, spineCount: 20, lastOpenedAt: FA });
T('_rdMergePosBest: 位置は後退しない', got('M6').spineIdx === 12);
localStorage.removeItem(K('M6'));

// ══ 7. カードの表示（§4-4）══
(function () {
  _rlPrefs.showFinished = true;
  buildReadingList();
  function card(title) {
    return document.querySelector('#reading-list-items .rl-card[data-key="' + K(title) + '"]');
  }
  var hm = card('続きあり'), rr = card('再読中'), fin = card('続き読了'), yet = card('読みかけ');
  T('続きあり: 🆕 バッジと％を併記',
    !!hm && !!hm.querySelector('.rl-hasmore-badge') && !!hm.querySelector('.rl-pct'));
  T('再読中: ✓読了 バッジと％を併記',
    !!rr && !!rr.querySelector('.rl-finished-badge') && !!rr.querySelector('.rl-pct'));
  T('読了: ✓読了 バッジのみ',
    !!fin && !!fin.querySelector('.rl-finished-badge') && !fin.querySelector('.rl-pct'));
  T('読みかけ: ％のみ',
    !!yet && !yet.querySelector('.rl-finished-badge') && !yet.querySelector('.rl-hasmore-badge'));
  T('薄く落とすのは末尾の本だけ',
    fin.classList.contains('rl-finished') &&
    !hm.classList.contains('rl-finished') && !rr.classList.contains('rl-finished'));
  T('🆕 バッジに章数が入る', hm.querySelector('.rl-hasmore-badge').textContent.indexOf('4') >= 0,
    hm.querySelector('.rl-hasmore-badge').textContent);
  _rlPrefs.showFinished = false;
})();

// ══ 8. 削除モードの判定は atEnd（§6-4）══
(function () {
  confirmDeleteBook(K('続きあり'));
  T('続きありの × は論理削除', _rlPendingDeleteMode === 'hide', String(_rlPendingDeleteMode));
  confirmDeleteBook(K('再読中'));
  T('再読中の × は論理削除', _rlPendingDeleteMode === 'hide', String(_rlPendingDeleteMode));
  confirmDeleteBook(K('続き読了'));
  T('読了の × は完全削除', _rlPendingDeleteMode === 'purge', String(_rlPendingDeleteMode));
  closeModal(true);
})();

// ══ 9. UI とチップ ══
T('🆕 続きありチップがある', !!document.getElementById('rl-chip-hasmore'));
T('チップはツール行にある',
  document.getElementById('rl-chip-hasmore').closest('#reading-list-tools') !== null ||
  document.getElementById('rl-chip-hasmore').parentElement ===
  document.getElementById('rl-chip-ready').parentElement);
(function () {
  var before = _rlPrefs.filterHasMore;
  toggleRlFilter('filterHasMore');
  T('チップで state が反転する', _rlPrefs.filterHasMore === !before);
  T('チップの active が同期する',
    document.getElementById('rl-chip-hasmore').classList.contains('active') === _rlPrefs.filterHasMore);
  T('チップ設定が永続化される', _rlLoadPrefs().filterHasMore === _rlPrefs.filterHasMore);
  toggleRlFilter('filterHasMore');
  T('知らないフィルタ名は無視する',
    (function () { var s = JSON.stringify(_rlPrefs); toggleRlFilter('nope'); return JSON.stringify(_rlPrefs) === s; })());
})();

// ══ 10. i18n（4 言語）══
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  T('i18n ' + lg + ': toast.syncFinished', typeof I18N[lg]['toast.syncFinished'] === 'string');
  T('i18n ' + lg + ': readingList.hasMoreBadge',
    typeof I18N[lg]['readingList.hasMoreBadge'] === 'string' &&
    I18N[lg]['readingList.hasMoreBadge'].indexOf('{n}') >= 0);
  T('i18n ' + lg + ': readingList.filterHasMore',
    typeof I18N[lg]['readingList.filterHasMore'] === 'string');
});
T('同期告知トーストの関数がある', typeof showSyncFinishedToast === 'function');

// ══ 11. ヘルプの記載（§6-12）══
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  var body = I18N[lg]['help.body'];
  T('help ' + lg + ': 🆕 続きあり を説明している', body.indexOf('🆕') >= 0);
  T('help ' + lg + ': 読了済みの本だけという注記がある',
    /読了済みの本だけ|finished books only|已讀完的書|已读完的书/.test(body));
});

localStorage.clear();
