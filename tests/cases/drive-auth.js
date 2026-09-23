// Google Drive 認証（design_drive_silent_auth.md）
//
// GIS（google.accounts.oauth2）を差し替えて、driveAuth() がどう requestAccessToken を呼ぶか・
// 失敗したときに固まらないかを見る。実際にポップアップが出るか・チラつきの程度・
// iOS でブロックされるかは headless では測れない（実機で確認する）。

(async function () {
  // ── GIS のモック ──
  // seq に 'ok' / 'failopen' / 'closed' を積むと、requestAccessToken のたびに先頭から消費して応答する
  var gis = { cfg: null, calls: [], seq: [] };
  window.google = { accounts: { oauth2: {
    initTokenClient: function (c) {
      gis.cfg = c;
      return { requestAccessToken: function (o) {
        gis.calls.push(o === undefined ? null : o);
        var mode = gis.seq.length ? gis.seq.shift() : 'ok';
        setTimeout(function () {
          if (mode === 'ok') gis.cfg.callback({ access_token: 'tok' + gis.calls.length, expires_in: 3600 });
          else if (mode === 'failopen') gis.cfg.error_callback({ type: 'popup_failed_to_open' });
          else if (mode === 'closed') gis.cfg.error_callback({ type: 'popup_closed' });
        }, 5);
      } };
    },
  } } };

  // about.get（メールアドレス取得）のモック。aboutMode: 'ok' / 'fail'
  var aboutMode = 'ok', aboutCalls = 0, _origFetch = window.fetch;
  window.fetch = function (url, opt) {
    if (String(url).indexOf('/drive/v3/about') >= 0) {
      aboutCalls++;
      if (aboutMode === 'fail') return Promise.resolve(new Response('{}', { status: 403 }));
      return Promise.resolve(new Response(JSON.stringify({ user: { emailAddress: 'reader@example.com' } }), { status: 200 }));
    }
    if (String(url).indexOf('/drive/v3/files') >= 0)   // driveFindFile（ON にするときの接続確認）
      return Promise.resolve(new Response(JSON.stringify({ files: [{ id: 'abcdefghij0123' }] }), { status: 200 }));
    return Promise.reject(new Error('unexpected fetch ' + url));
  };

  // 前のケースで走り出した about の書き込み（非同期）が、リセット後に割り込まないよう待ってから消す
  async function resetAuth() {
    await wait(30);
    _tokenClient = null; _driveToken = null; _driveTokenExpiry = 0; _authPromise = null;
    _driveAuthedOnce = false; localStorage.removeItem('epub_drive_account'); aboutMode = 'ok'; aboutCalls = 0;
    clearTimeout(_refreshTimer);
    gis.calls.length = 0; gis.seq.length = 0; gis.cfg = null;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function settle(p) {
    try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e: e }; }
  }

  // ── §3-3 認証ポップアップを閉じても固まらない ──
  await resetAuth();
  gis.seq.push('closed');
  var r1 = await settle(driveAuth());
  T('閉じたら reject される（固まらない）', !r1.ok && r1.e.message === 'popup_closed', r1.e && r1.e.message);
  T('閉じたあと _authPromise が残らない', _authPromise === null);
  T('initTokenClient に error_callback を渡している', !!gis.cfg && typeof gis.cfg.error_callback === 'function');

  var r2 = await settle(driveAuth());
  T('閉じたあとの次の driveAuth は新しい認証を始める', gis.calls.length === 2, 'calls=' + gis.calls.length);
  T('その認証は成功する', r2.ok && r2.v === 'tok2', r2.ok ? r2.v : r2.e.message);

  await resetAuth();
  gis.seq.push('failopen');
  var r3 = await settle(driveAuth());
  T('開けなかったら reject される', !r3.ok && r3.e.message === 'popup_failed_to_open');
  T('開けなかったあと _authPromise が残らない', _authPromise === null);

  T('_isDrivePopupError: 閉じた／開けなかったはポップアップ由来',
    _isDrivePopupError(new Error('popup_closed')) && _isDrivePopupError(new Error('popup_failed_to_open')));
  T('_isDrivePopupError: それ以外は違う',
    !_isDrivePopupError(new Error('access_denied')) && !_isDrivePopupError(null));

  // 同時に呼んでも認証は 1 回（既存の作法を壊していない）
  await resetAuth();
  var pa = driveAuth(), pb = driveAuth();
  T('同時呼び出しは同じ Promise', pa === pb);
  await settle(pa);
  T('同時呼び出しでも requestAccessToken は 1 回', gis.calls.length === 1);

  // ── §3-1 一度許可した端末ではアカウント選択を出さない ──
  await resetAuth();
  await settle(driveAuth());
  T('初回（記憶なし）は prompt 未指定で呼ぶ＝アカウント選択', gis.calls[0] === null, JSON.stringify(gis.calls[0]));
  await wait(30);
  var acct = JSON.parse(localStorage.getItem('epub_drive_account') || 'null');
  T('トークン取得後にアカウントを覚える', !!acct && acct.email === 'reader@example.com', JSON.stringify(acct));
  T('メールアドレスは about で 1 回だけ取る', aboutCalls === 1);

  // ページを開き直した想定（TokenClient もトークンもメモリから消える・記憶は残る）
  _tokenClient = null; _driveToken = null; _driveTokenExpiry = 0; _driveAuthedOnce = false; gis.calls.length = 0;
  await settle(driveAuth());
  T('開き直し: prompt:\'\' で呼ぶ（タップ不要）', !!gis.calls[0] && gis.calls[0].prompt === '', JSON.stringify(gis.calls[0]));
  T('開き直し: login_hint に覚えたアドレスを渡す', !!gis.calls[0] && gis.calls[0].login_hint === 'reader@example.com');
  T("prompt:'none' は使わない", !gis.calls.some(function (c) { return c && c.prompt === 'none'; }));
  await wait(30);
  T('アドレスを覚えていれば about を読み直さない', aboutCalls === 1, 'aboutCalls=' + aboutCalls);

  // about が失敗しても「許可済み」の印は残り、prompt:'' だけで動く
  await resetAuth();
  aboutMode = 'fail';
  await settle(driveAuth());
  await wait(30);
  acct = JSON.parse(localStorage.getItem('epub_drive_account') || 'null');
  T('about が失敗しても許可済みの印は残る', !!acct && acct.email === '', JSON.stringify(acct));
  _tokenClient = null; _driveToken = null; _driveTokenExpiry = 0; _driveAuthedOnce = false; gis.calls.length = 0;
  await settle(driveAuth());
  T('アドレス無しの印でも prompt:\'\'（login_hint は付けない）',
    !!gis.calls[0] && gis.calls[0].prompt === '' && !('login_hint' in gis.calls[0]), JSON.stringify(gis.calls[0]));

  // 失敗した認証では覚えない
  await resetAuth();
  gis.seq.push('closed');
  await settle(driveAuth());
  await wait(30);
  T('認証に失敗したらアカウントを覚えない', localStorage.getItem('epub_drive_account') === null);

  // 書き出し・Drive に載らない
  await resetAuth();
  await settle(driveAuth()); await wait(30);
  var exported = JSON.stringify(collectBookmarks());
  T('しおりの書き出しにアカウントが載らない',
    exported.indexOf('epub_drive_account') < 0 && exported.indexOf('reader@example.com') < 0);

  // ── §3-2 自動同期 OFF で記憶を消す ──
  var _origSS = saveSettings; saveSettings = function () {};
  state.driveAutoSave = true;
  await toggleDriveAutoSave();   // ON → OFF
  T('OFF で自動同期が止まる', state.driveAutoSave === false);
  T('OFF でアカウントの記憶が消える', localStorage.getItem('epub_drive_account') === null);
  T('OFF でメモリ上のトークンも捨てる', _driveToken === null);
  gis.calls.length = 0;
  await toggleDriveAutoSave();   // OFF → ON
  T('OFF のあと ON にするとアカウント選択から（prompt 未指定）', gis.calls[0] === null, JSON.stringify(gis.calls[0]));
  T('ON に戻る', state.driveAutoSave === true);
  state.driveAutoSave = false;
  saveSettings = _origSS;

  // ── §3-4 起動時に開けなかったら最初の操作で取り直す ──
  var _origPull = driveSyncPull, pulls = [];
  driveSyncPull = function (o) { pulls.push(o); return Promise.resolve(); };
  state.driveAutoSave = true;

  await resetAuth(); _driveGestureRetry = false;
  gis.seq.push('closed');
  await settle(driveAuth());
  T('閉じた（popup_closed）では取り直しを仕掛けない', _driveGestureRetry === false);

  await resetAuth(); _driveGestureRetry = false;
  state.driveAutoSave = false;
  gis.seq.push('failopen');
  await settle(driveAuth());
  T('自動同期 OFF なら取り直しを仕掛けない', _driveGestureRetry === false);
  state.driveAutoSave = true;

  // 実際の場面: 許可済みの端末で起動した直後（iOS はここで必ず開けない）
  await resetAuth(); _driveGestureRetry = false;
  _driveAccountSet('reader@example.com');
  gis.seq.push('failopen');
  await settle(driveAuth());
  T('開けなかったら取り直しを仕掛ける', _driveGestureRetry === true);

  var n0 = gis.calls.length;
  document.body.dispatchEvent(new Event('touchend', { bubbles: true }));
  T('touchend では取り直さない（iOS では開けない）', gis.calls.length === n0);

  // click → requestAccessToken まで同期で届くこと（await を挟むとユーザー操作の文脈が切れる）
  pulls.length = 0;
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  T('最初の click で requestAccessToken が同期で呼ばれる', gis.calls.length === n0 + 1, 'calls=' + gis.calls.length);
  T('取り直しは prompt:\'\'（アカウント選択を出さない）', gis.calls[n0] && gis.calls[n0].prompt === '');
  T('仕掛けは外れる', _driveGestureRetry === false);
  await wait(30);
  T('取れたら同期（force）を走らせる', pulls.length === 1 && pulls[0] && pulls[0].force === true);
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  T('2 回目の click では何もしない', gis.calls.length === n0 + 1);

  // また開けなければ仕掛け直す（最初の操作がスワイプ等だった場合に次の操作で取れるように）
  await resetAuth(); _driveGestureRetry = false;
  gis.seq.push('failopen', 'failopen');
  await settle(driveAuth());
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(30);
  T('取り直しも開けなければ仕掛け直す', _driveGestureRetry === true);

  // keydown
  await resetAuth(); _driveGestureRetry = false;
  gis.seq.push('failopen');
  await settle(driveAuth());
  n0 = gis.calls.length;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
  T('keydown でも取り直す', gis.calls.length === n0 + 1);
  await wait(30);

  // 本文 iframe からの EPUB_TAP / EPUB_KEY（yomikake の本文タップの経路）
  var ifr = document.getElementById('content-iframe');
  var origRunTap = runTapAction, origHandleKey = handleKey;
  runTapAction = function () {}; handleKey = function () {};
  ['EPUB_TAP', 'EPUB_KEY'].forEach(function (type) {
    _driveGestureRetry = true; _driveToken = null; _authPromise = null;
    var before = gis.calls.length;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: type, xr: 0.5, yr: 0.5, key: 'Shift' }, source: ifr.contentWindow }));
    T(type + ' の受信で取り直す', gis.calls.length === before + 1, 'calls ' + before + '→' + gis.calls.length);
  });
  runTapAction = origRunTap; handleKey = origHandleKey;
  await wait(30);

  driveSyncPull = _origPull;
  state.driveAutoSave = false; _driveGestureRetry = false;

  // ── 自動保存: ポップアップ由来の失敗では自動同期を止めない ──
  var _origUpload = driveUploadCore, _origSaveSettings = saveSettings;
  saveSettings = function () {};
  var uploads = 0;
  driveUploadCore = async function () { uploads++; if (uploads === 1) throw new Error('401 Unauthorized'); return 1; };
  await resetAuth();
  state.driveAutoSave = true; _autoSaveBusy = false;
  gis.seq.push('ok', 'failopen');   // 1 回目は取れる → 401 → 取り直しは開けない
  await runAutoSave();
  clearTimeout(_autoSaveTimer);
  T('取り直しが開けなくても自動同期は ON のまま', state.driveAutoSave === true);
  T('未送信は持ち越し', _autoSaveDirty === true);

  uploads = 0; await resetAuth();
  state.driveAutoSave = true; _autoSaveBusy = false;
  gis.seq.push('ok', 'ok');
  driveUploadCore = async function () { uploads++; throw new Error('401 Unauthorized'); };
  await runAutoSave();
  clearTimeout(_autoSaveTimer);
  T('回復不能（取り直しても 401）なら従来どおり自動同期を止める', state.driveAutoSave === false);
  T('回復不能で止めたらアカウントの記憶も消す', localStorage.getItem('epub_drive_account') === null);

  driveUploadCore = _origUpload; saveSettings = _origSaveSettings;
  state.driveAutoSave = false; _autoSaveDirty = false;
  await resetAuth();
  window.fetch = _origFetch;
  localStorage.clear();
})();
