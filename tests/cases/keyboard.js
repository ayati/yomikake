// キーボード操作（design_keyboard.md）
// 実 ePub を開いて、読書中／読みかけリストの両方のキー割り当てを検証する。
// fixture: tests/.fixtures/reflow.epub（4章）

// handleKey に渡す疑似イベント。preventDefault が呼ばれたかを返す。
function K(key, opts) {
  var prevented = false;
  var ev = { key: key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
             repeat: false, isComposing: false,
             preventDefault: function () { prevented = true; } };
  if (opts) for (var p in opts) ev[p] = opts[p];
  handleKey(ev);
  return prevented;
}
function cards() { return [].slice.call(document.querySelectorAll('#reading-list-items .rl-card')); }

// ── 土台（本を開く前に確認できるもの）──────────────────
T('handleKey が存在', typeof handleKey === 'function');
T('handleListKey が存在', typeof handleListKey === 'function');
T('openSearchPane が存在', typeof openSearchPane === 'function');
T('reclaimKeyFocus が存在', typeof reclaimKeyFocus === 'function');
T('_rlSyncSelection が存在', typeof _rlSyncSelection === 'function');
T('rlCardOpen が存在', typeof rlCardOpen === 'function');

// iframe へ焼き込まれるキー転送コード（本文クリック後もキーが効くための土台）
var _ss = buildScrollScript('start', 'vertical', 1);
T('iframe に EPUB_KEY 転送が入る', _ss.indexOf('EPUB_KEY') >= 0);
T('転送は IME 変換中を除外', _ss.indexOf('isComposing') >= 0);
T('転送は入力欄を除外', _ss.indexOf('TEXTAREA') >= 0);
T('転送はホワイトリスト方式', _ss.indexOf('_KEYS.indexOf') >= 0);
T('転送は Ctrl/Cmd+F を例外扱い', _ss.indexOf('isFind') >= 0);

// 長押しリピート
T('ページ送りはリピート可', _KEY_REPEATABLE.has('n') && _KEY_REPEATABLE.has(' ') &&
  _KEY_REPEATABLE.has('arrowdown'));
T('パネル系はリピート不可', !_KEY_REPEATABLE.has('t') && !_KEY_REPEATABLE.has('q') &&
  !_KEY_REPEATABLE.has('s'));

// i18n 4 言語
var _kk = Object.keys(I18N.ja).filter(function (k) { return k.indexOf('help.keys.') === 0; });
T('help.keys.* が 20 個以上', _kk.length >= 20, String(_kk.length));
['en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  var missing = _kk.filter(function (k) { return !I18N[lg][k]; });
  T('help.keys.* が ' + lg + ' に揃っている', missing.length === 0, missing.join(',') || 'OK');
});

// ── 本を開いてから ────────────────────────────────
fetch('tests/.fixtures/reflow.epub')
.then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'reflow.epub', { type: 'application/epub+zip' })); })
.then(function () {
  T('本が開けた', !!state.epub, state.bookTitle + ' / spine=' + state.spine.length);
  // 初回オープンではタップ操作ガイドが自動で出る（epub_tap_guide_v1）。
  // ガイド表示中は「任意キーで閉じる」が優先されるので、先に畳んでおく。
  T('初回はタップ操作ガイドが出ている', _tapGuideOpen);
  T('任意キーでガイドが閉じる', K('n') && !_tapGuideOpen);

  // ブラウザ／OS のダイアログ（Android の FSA 許可プロンプト等）が閉じた直後に
  // フォーカスがページ外へ抜けたままだと、キーが 1 つも効かない。
  // 読書領域が programmatic focus を受けられることを確認する。
  document.body.focus();
  reclaimKeyFocus();
  var pc = document.getElementById('page-container');
  T('読書領域が focus を受けられる', document.activeElement === pc,
    document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '(なし)');
  T('読書領域に tabindex=-1 が付く', pc.getAttribute('tabindex') === '-1');
  T('focus しても本は開いたまま', !!state.epub && pc.classList.contains('visible'));

  // ── 修飾キーガード（Ctrl+F がブラウザ検索を奪われていた不具合）──
  var fsCalls = 0, _fs = toggleFullscreen;
  toggleFullscreen = function () { fsCalls++; };
  T('f で全画面', K('f') && fsCalls === 1);
  T('Ctrl+F は全画面にならない', fsCalls === 1);
  K('f', { ctrlKey: true });
  T('Ctrl+F 後も全画面は呼ばれない', fsCalls === 1, String(fsCalls));
  K('f', { metaKey: true });
  T('Cmd+F 後も全画面は呼ばれない', fsCalls === 1, String(fsCalls));
  K('f', { altKey: true });
  T('Alt+F は無視', fsCalls === 1, String(fsCalls));
  toggleFullscreen = _fs;

  // Ctrl+F は読書中だけ奪ってアプリの全文検索へ
  T('Ctrl+F は preventDefault する（読書中）', K('f', { ctrlKey: true }));
  T('Ctrl+F で検索タブが開く', state.sidebarOpen && _sidebarTab === 'search');
  toggleSidebar();  // 閉じる

  // ── ページ送り ──
  var sp = [], _scroll = scrollPage;
  scrollPage = function (d) { sp.push(d); };
  ['n', 'j', 'ArrowDown', 'PageDown'].forEach(function (k) { K(k); });
  T('n / j / ↓ / PageDown が次ページ', sp.join() === '1,1,1,1', sp.join());
  sp = [];
  ['p', 'b', 'k', 'ArrowUp', 'PageUp', 'Backspace'].forEach(function (k) { K(k); });
  T('p / b / k / ↑ / PageUp / Backspace が前ページ', sp.join() === '-1,-1,-1,-1,-1,-1', sp.join());
  sp = [];
  K(' '); K(' ', { shiftKey: true });
  T('Space / Shift+Space', sp.join() === '1,-1', sp.join());
  sp = [];
  K('N'); K('P');
  T('大文字でも効く', sp.join() === '1,-1', sp.join());
  sp = [];
  K('n', { repeat: true });
  T('ページ送りは長押しリピート可', sp.length === 1);
  sp = [];
  K('n', { isComposing: true });
  T('IME 変換中は無視', sp.length === 0);
  scrollPage = _scroll;

  // ── 章送りが書字方向に連動するか（旧実装は ← 固定だった）──
  var ch = [], _nc = nextChapter, _pc = prevChapter;
  nextChapter = function () { ch.push('next'); };
  prevChapter = function () { ch.push('prev'); };
  var _wm = state.writingMode;
  state.writingMode = 'vertical';
  K('ArrowLeft'); K('ArrowRight');
  T('縦書きは ← が次章 / → が前章', ch.join() === 'next,prev', ch.join());
  ch = [];
  state.writingMode = 'horizontal';
  K('ArrowLeft'); K('ArrowRight');
  T('横書きは → が次章 / ← が前章', ch.join() === 'prev,next', ch.join());
  ch = [];
  K(']'); K('[');
  T('] / [ は書字方向に依らない', ch.join() === 'next,prev', ch.join());
  state.writingMode = _wm;
  nextChapter = _nc; prevChapter = _pc;

  // ── 文字サイズ ──
  var sz = state.fontSize;
  K('+'); T('+ で拡大', state.fontSize > sz, String(state.fontSize));
  K('-'); K('-');
  T('- で縮小', state.fontSize < sz, String(state.fontSize));
  changeFontSize(0); state.fontSize = sz;
  var _rm = state.renderMode;
  state.renderMode = 'fxl';
  T('FXL では文字サイズキーを握らない', !K('+') && state.fontSize === sz);
  state.renderMode = _rm;

  // ── パネル ──
  T('t で目次サイドバー', K('t') && state.sidebarOpen && _sidebarTab === 'toc');
  T('t をもう一度で閉じる', K('t') && !state.sidebarOpen);
  T('t は長押しリピートしない', !K('t', { repeat: true }) && !state.sidebarOpen);
  T('/ で検索ペイン', K('/') && state.sidebarOpen && _sidebarTab === 'search');
  toggleSidebar();

  // ── Escape 優先度チェーン（1打で1つだけ閉じる）──
  showHelp();
  T('モーダル表示中は裏のページ送りを止める', !K('n'));
  T('Escape でモーダルが閉じる',
    K('Escape') && !document.getElementById('modal-overlay').classList.contains('show'));
  hideTapGuide(); hideTapMenu();   // closeModal → showNavHint の後始末

  toggleSettings();
  T('Escape で設定が閉じる',
    K('Escape') && !document.getElementById('settings-popover').classList.contains('show'));
  toggleSidebar();
  T('Escape でサイドバーが閉じる', K('Escape') && !state.sidebarOpen);
  state.fullscreen = false;
  document.body.classList.add('fullscreen'); state.fullscreen = true;
  T('Escape で全画面解除', K('Escape') && !state.fullscreen);

  // ── 読みかけリスト用に 2 冊ぶん積む ──
  [['キーテストA', '著者A'], ['キーテストB', '著者B']].forEach(function (p, i) {
    localStorage.setItem('epub_pos_' + makeBookKey(p[0], p[1]), JSON.stringify({
      spineIdx: 1, ratio: 0.3, lastOpenedAt: Date.now() - (i + 1) * 60000,
      creator: p[1], spineCount: 8,
    }));
  });

  // ── q で本を閉じてリストへ（フォーカスが誤爆しないこと）──
  var closedKey = state.bookKey;
  T('q で本が閉じる', K('q') && !state.epub);

  var sel = document.querySelector('#reading-list-items .rl-card.rl-sel');
  T('閉じた本のカードが選択される', !!sel && sel.dataset.key === closedKey,
    sel ? sel.dataset.key : '(なし)');
  T('選択カードにフォーカスが載る', document.activeElement === sel,
    document.activeElement ? document.activeElement.className : '(なし)');
  T('開くボタンにフォーカスが残らない',
    document.activeElement !== document.getElementById('open-btn'));

  // ローミング tabindex
  var all = cards();
  T('カードが3枚以上ある', all.length >= 3, String(all.length));
  T('tabindex=0 はちょうど1枚',
    all.filter(function (c) { return c.tabIndex === 0; }).length === 1);
  T('残りは tabindex=-1',
    all.filter(function (c) { return c.tabIndex === -1; }).length === all.length - 1);
  T('リストビューのカードも role=button',
    all.every(function (c) { return c.getAttribute('role') === 'button'; }));
  T('inline onkeydown は置かない（Enter 二重発火の防止）',
    all.every(function (c) { return !c.getAttribute('onkeydown'); }));

  // ── 選択移動 ──
  var first = cards()[0].dataset.key;
  _rlSelKey = first; _rlSyncSelection(false);
  K('ArrowDown');
  T('↓ で次の本へ', _rlSelKey === cards()[1].dataset.key);
  K('ArrowUp');
  T('↑ で前の本へ', _rlSelKey === first);
  K('n');
  T('n でも次の本へ', _rlSelKey === cards()[1].dataset.key);
  K('p');
  T('p でも前の本へ', _rlSelKey === first);
  K('End');
  T('End で末尾の本', _rlSelKey === cards()[cards().length - 1].dataset.key);
  K('Home');
  T('Home で先頭の本', _rlSelKey === first);
  K('ArrowUp');
  T('先頭で ↑ は検索欄へ戻る', document.activeElement === document.getElementById('rl-search'));

  // ── 再レンダーをまたいで選択が残るか（検索1文字ごとに innerHTML が作り直される）──
  var keep = cards()[1].dataset.key;
  _rlSelKey = keep;
  buildReadingList();
  T('再レンダー後も選択が残る', _rlSelKey === keep);
  T('再レンダー後もリングが1つ',
    document.querySelectorAll('#reading-list-items .rl-card.rl-sel').length === 1);
  _rlSelKey = 'epub_pos_存在しない本__誰か';
  buildReadingList();
  T('選択が消えたらフォールバックする',
    _rlSelKey === (cards()[0] || {}).dataset.key ||
    !!document.querySelector('#reading-list-items .rl-card.rl-sel.rl-last'));

  // ── Enter / q で開く ──
  var opened = [], _open = rlCardOpen;
  rlCardOpen = function (el) { opened.push(el.dataset.key); };
  _rlSelKey = keep; _rlSyncSelection(true);
  T('Enter は選択カードを開く', K('Enter') && opened.join() === keep, opened.join());
  opened = [];
  T('q でも選択カードを開く（読書中の q と対）', K('q') && opened.join() === keep, opened.join());
  opened = [];
  document.getElementById('reading-list-new-btn').focus();
  K('Enter');
  T('ボタン上の Enter は奪わない（二重発火の防止）', opened.length === 0);
  rlCardOpen = _open;

  // ── リストでは Ctrl+F を奪わない（ブラウザ検索に任せる）──
  T('リストの Ctrl+F は素通し', !K('f', { ctrlKey: true }));

  // ── リストの Escape ──
  _rlQuery = 'キーテスト';
  document.getElementById('rl-search').value = 'キーテスト';
  buildReadingList();
  T('Escape で絞り込み解除', K('Escape') && _rlQuery === '');

  // ── 再オープンはキャッシュ優先（FSA の許可プロンプトを出さないため）──
  // Android Chrome の権限プロンプトは閉じた後もフォーカスをブラウザ UI 側に残し、
  // ページの keydown が発火しなくなる。プロンプト自体を出さないのが唯一の対策。
  var lc = [], pk = 0;
  var _lfc = loadEpubFromCache;
  loadEpubFromCache = function (k) { lc.push(k); return Promise.resolve(); };
  openFilePicker = function () { pk++; };   // 以降このケースでは復元しない（実ピッカーを開かせない）
  _cachedKeys.add('KEYTEST');
  if (typeof _handleKeys !== 'undefined') _handleKeys.add('KEYTEST');
  openFilePickerForBook('KEYTEST');
  T('再オープンはキャッシュ優先（許可プロンプトを出さない）',
    lc.join() === 'KEYTEST' && pk === 0, 'cache=' + lc.join() + ' picker=' + pk);
  _cachedKeys.delete('KEYTEST');
  if (typeof _handleKeys !== 'undefined') _handleKeys.delete('KEYTEST');
  loadEpubFromCache = _lfc;
  hideLoading();

  // ── ヘルプのショートカット一覧 ──
  _kbSeen = true;
  showHelp();
  var body = document.getElementById('modal-body').innerHTML;
  T('ヘルプにショートカット一覧が出る', body.indexOf(t('help.keys.title')) >= 0);
  T('一覧に前ページのキーが載る', body.indexOf(t('help.keys.prevPage')) >= 0);
  T('一覧にリスト操作が載る', body.indexOf(t('help.keys.listOpen')) >= 0);
  T('Ctrl+F の注記がある', body.indexOf(t('help.keys.noteFind')) >= 0);
  closeModal(true);

  localStorage.clear();
});
