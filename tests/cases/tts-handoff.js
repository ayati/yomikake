// 外部の読み上げアプリへの受け渡し（design_tts_background.md Phase F）
// 実機でしか確かめられないもの（共有シートに @Voice が出るか・実際に読めるか）は対象外。
// ここでは「何を・どこから切り出して・どう届けるか」を fixture の実本で検証する。

// ══ 純粋関数（本を開く前に確かめられるもの） ══════════════════════
T('ttsHandoffText が定義', typeof ttsHandoffText === 'function');
T('showTtsHandoff が定義', typeof showTtsHandoff === 'function');
T('ttsHandoffRun が定義', typeof ttsHandoffRun === 'function');
T('_handoffSliceFrom が定義', typeof _handoffSliceFrom === 'function');
T('_handoffStartChunk が定義', typeof _handoffStartChunk === 'function');

(function () {
  var text = 'いち。\nに。\nさん。\nよん。';
  var chunks = ttsSplitChunks(text);
  T('チャンク分割の前提', chunks.length === 4, chunks.join('/'));
  T('開始 0 なら全文', _handoffSliceFrom(text, chunks, 0) === text);
  T('途中からは段落構造を保って切り出す',
    _handoffSliceFrom(text, chunks, 2) === 'さん。\nよん。',
    JSON.stringify(_handoffSliceFrom(text, chunks, 2)));
  T('範囲外は空', _handoffSliceFrom(text, chunks, 9) === '');
  // 目印の文が本文中に見つからないときは章まるごと（読み飛ばしより安全側）
  T('目印が見つからなければ全文フォールバック',
    _handoffSliceFrom(text, ['いち。', 'ほんぶんに無い文'], 1) === text,
    JSON.stringify(_handoffSliceFrom(text, ['いち。', 'ほんぶんに無い文'], 1)));
})();

(function () {
  T('ファイル名から禁止文字を落とす',
    _handoffFilename('book', '.txt').indexOf('/') < 0 &&
    _handoffFilename('book', '.txt').indexOf(':') < 0);
  T('拡張子が付く', /\.txt$/.test(_handoffFilename('book', '.txt')));
})();

// 本が開いていないときは何も開かない
showTtsHandoff();
T('本が無ければモーダルを開かない',
  !document.getElementById('modal-overlay').classList.contains('show'));

// UI エントリ
T('プレイヤーバーに受け渡しボタン', !!document.getElementById('tts-handoff-btn'));
T('受け渡しボタンは tts-bar の中',
  document.getElementById('tts-handoff-btn').closest('#tts-bar') !== null);
T('設定の 🔊 グループに入口がある',
  !!document.querySelector('#tts-settings-group [data-i18n="settings.ttsHandoff"]'));

['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  setLang(lg);
  T('i18n handoff.title (' + lg + ')', t('handoff.title') !== 'handoff.title', t('handoff.title'));
  T('i18n handoff.note (' + lg + ')', t('handoff.note') !== 'handoff.note');
  T('i18n toast.handoffDone に {chapter} (' + lg + ')',
    t('toast.handoffDone', { chapter: 'X' }).indexOf('X') >= 0,
    t('toast.handoffDone', { chapter: 'X' }));
});
setLang('ja');

// ══ 実本での受け渡し ═════════════════════════════════════════════
fetch('tests/.fixtures/reflow.epub')
.then(function (r) { return r.blob(); })
.then(function (b) { return loadEpub(new File([b], 'reflow.epub', { type: 'application/epub+zip' })); })
.then(function () {
  T('本が開けた', !!state.epub, state.bookTitle + ' / spine=' + state.spine.length);
  return renderPage(2, 0);
})
.then(function () {
  _intraChapterRatio = 0;
  return ttsHandoffText('chapter');
})
.then(function (chapter) {
  T('書名と著者のヘッダが付く',
    chapter.indexOf('『テスト用リフロー』') === 0 && chapter.indexOf('テスト作者') > 0,
    chapter.slice(0, 40));
  T('章の見出し行が入る', chapter.indexOf('──── 第3章 ────') >= 0);
  // ルビは rt 優先で解決済み（ttsExtractText の再利用がそのまま効いている）
  T('ルビは読みに置き換わる', chapter.indexOf('ほんぶん') >= 0);
  T('親字は残らない（二重読みしない）', chapter.indexOf('本文') < 0);
  T('この章だけ渡す＝次章は含まない', chapter.indexOf('第4章') < 0);
  T('段落が 1 行 1 文に潰れていない', chapter.split('\n').length < 200,
    String(chapter.split('\n').length));

  // しおり位置から切り出せているか
  _intraChapterRatio = 0.5;
  return ttsHandoffText('chapter').then(function (half) {
    T('しおり位置から始まるので短くなる', half.length < chapter.length,
      half.length + ' < ' + chapter.length);
    T('先頭の段落は含まれない', half.indexOf('00行目') < 0);
    T('章の見出しは残る', half.indexOf('──── 第3章 ────') >= 0);
    _intraChapterRatio = 0;
  });
})
.then(function () { return ttsHandoffText('toEnd'); })
.then(function (toEnd) {
  T('ここから最後まで＝現在章と次章を含む',
    toEnd.indexOf('第3章') >= 0 && toEnd.indexOf('第4章') >= 0);
  T('ここから最後まで＝前の章は含まない', toEnd.indexOf('──── 第1章 ────') < 0);
  return ttsHandoffText('book');
})
.then(function (book) {
  T('全文＝4章すべて含む',
    ['第1章', '第2章', '第3章', '第4章'].every(function (c) { return book.indexOf(c) >= 0; }));
  T('全文は本の頭から（しおり位置で切らない）', book.indexOf('00行目') >= 0);
})
.then(function () {
  // モーダル
  showTtsHandoff();
  T('本があればモーダルが開く',
    document.getElementById('modal-overlay').classList.contains('show'));
  var radios = document.querySelectorAll('input[name="handoff-range"]');
  T('範囲の選択肢がある', radios.length >= 3, String(radios.length));
  T('既定は「この章」',
    document.querySelector('input[name="handoff-range"]:checked').value === 'chapter');

  // 「しおりを進める」は 1 章のときだけ意味がある
  var adv = document.getElementById('handoff-advance');
  T('この章なら進めるチェックが使える', adv.disabled === false);
  document.querySelector('input[name="handoff-range"][value="book"]').checked = true;
  _handoffSyncUI();
  T('全文では進めるチェックが無効', adv.disabled === true);
  T('無効化と同時にチェックも外れる', adv.checked === false);
  document.querySelector('input[name="handoff-range"][value="chapter"]').checked = true;
  _handoffSyncUI();
  closeModal(true);
})
.then(function () {
  // 設定パネルから開いたときにモーダルが後ろへ隠れないこと。
  // #settings-popover は z-index:500、#modal-overlay は 200 なので、
  // 設定を開いたままだとモーダルが背後に描画されて「押しても何も起きない」ように見える
  var pop = document.getElementById('settings-popover');
  if (!pop.classList.contains('show')) toggleSettings();
  T('設定パネルが開いた（前提）', pop.classList.contains('show'));
  showTtsHandoff();
  T('受け渡しを開くと設定パネルが閉じる', !pop.classList.contains('show'));
  T('モーダルは開いている',
    document.getElementById('modal-overlay').classList.contains('show'));
  closeModal(true);
})
.then(function () {
  // 狭幅端末でプレイヤーバーからボタンがはみ出さないこと（Android で 📤 が切れた回帰）。
  //
  // ⚠ headless Chrome はウィンドウを 500px 未満に縮められない（--window-size を渡しても
  //   innerWidth は 500 で頭打ち）。実機の不具合は 343px 相当で起きたので、幾何だけでは
  //   この回帰を再現できない。そこで「溢れを構造的に不可能にしている仕組み」＝
  //   flex-wrap:wrap そのものを検査する。これが外れたら幅に関係なく再発しうる。
  document.body.classList.add('tts-active');
  var bar = document.getElementById('tts-bar');
  T('バーは折り返す（どの幅でも溢れない保証）',
    getComputedStyle(bar).flexWrap === 'wrap', getComputedStyle(bar).flexWrap);
  var barRect = bar.getBoundingClientRect();
  T('プレイヤーバーが表示されている', barRect.width > 0, String(Math.round(barRect.width)));
  T('バーが画面幅に収まる',
    barRect.left >= -1 && barRect.right <= window.innerWidth + 1,
    Math.round(barRect.left) + '-' + Math.round(barRect.right) + ' / ' + window.innerWidth);
  var out = [];
  Array.prototype.forEach.call(bar.children, function (el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0) return;
    if (r.left < barRect.left - 1 || r.right > barRect.right + 1) {
      out.push((el.id || el.className || el.tagName) + '@' + Math.round(r.left) + '-' + Math.round(r.right));
    }
  });
  T('バーの中身が枠からはみ出さない', out.length === 0, out.join(' '));
  var hb = document.getElementById('tts-handoff-btn').getBoundingClientRect();
  T('受け渡しボタンが枠内に収まる',
    hb.right <= barRect.right + 1 && hb.left >= barRect.left - 1,
    Math.round(hb.left) + '-' + Math.round(hb.right) + ' / 枠 ' +
    Math.round(barRect.left) + '-' + Math.round(barRect.right));
  T('受け渡しボタンが画面内にある', hb.right <= window.innerWidth + 1,
    Math.round(hb.right) + ' / ' + window.innerWidth);
  document.body.classList.remove('tts-active');
})
.then(function () {
  // 共有経路：File として渡っているか・BOM が付いているか
  var shared = null;
  Object.defineProperty(navigator, 'canShare', {
    configurable: true, value: function () { return true; }
  });
  Object.defineProperty(navigator, 'share', {
    configurable: true, value: function (d) { shared = d; return Promise.resolve(); }
  });
  showTtsHandoff();
  return ttsHandoffRun('share').then(function () {
    T('共有が呼ばれた', !!shared);
    T('ファイルとして渡している', !!(shared && shared.files && shared.files.length === 1));
    var f = shared.files[0];
    T('text/plain で渡す', f.type === 'text/plain', f.type);
    T('ファイル名は .txt', /\.txt$/.test(f.name), f.name);
    return f.arrayBuffer();
  }).then(function (buf) {
    // BOM が無いと一部の Android リーダーが Shift_JIS と誤判定する。
    // Blob.text() は仕様どおり BOM を剥がすので、生バイトで確かめること
    var b = new Uint8Array(buf);
    T('BOM 付き UTF-8', b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF,
      [b[0], b[1], b[2]].join(','));
    T('中身が本文',
      new TextDecoder().decode(buf).indexOf('『テスト用リフロー』') >= 0);
  });
})
.then(function () {
  // 「渡したあと次の章へ」
  var before = state.currentSpineIdx;
  _handoffAdvance();
  T('しおりが次の章へ進む', state.currentSpineIdx === before + 1,
    before + ' -> ' + state.currentSpineIdx);
  // 最終章では進めない
  state.currentSpineIdx = state.spine.length - 1;
  _handoffAdvance();
  T('最終章では進めない', state.currentSpineIdx === state.spine.length - 1,
    String(state.currentSpineIdx));
})
.then(function () {
  // 共有できない環境ではダウンロードに落ちる（章以外はテキスト直接共有を許さない）
  Object.defineProperty(navigator, 'canShare', {
    configurable: true, value: function () { return false; }
  });
  var clicked = 0;
  var origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = origCreate(tag);
    if (tag === 'a') el.click = function () { clicked++; };
    return el;
  };
  return ttsHandoffRun('download').then(function () {
    document.createElement = origCreate;
    T('ダウンロード経路が動く', clicked === 1, String(clicked));
  });
})
.then(function () {
  closeBook();
  T('本を閉じられる', !state.epub);
  localStorage.clear();
})
.catch(function (e) { T('受け渡し E2E 例外', false, e && (e.stack || e.message)); });
