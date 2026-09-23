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

  function resetAuth() {
    _tokenClient = null; _driveToken = null; _driveTokenExpiry = 0; _authPromise = null;
    clearTimeout(_refreshTimer);
    gis.calls.length = 0; gis.seq.length = 0; gis.cfg = null;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function settle(p) {
    try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e: e }; }
  }

  // ── §3-3 認証ポップアップを閉じても固まらない ──
  resetAuth();
  gis.seq.push('closed');
  var r1 = await settle(driveAuth());
  T('閉じたら reject される（固まらない）', !r1.ok && r1.e.message === 'popup_closed', r1.e && r1.e.message);
  T('閉じたあと _authPromise が残らない', _authPromise === null);
  T('initTokenClient に error_callback を渡している', !!gis.cfg && typeof gis.cfg.error_callback === 'function');

  var r2 = await settle(driveAuth());
  T('閉じたあとの次の driveAuth は新しい認証を始める', gis.calls.length === 2, 'calls=' + gis.calls.length);
  T('その認証は成功する', r2.ok && r2.v === 'tok2', r2.ok ? r2.v : r2.e.message);

  resetAuth();
  gis.seq.push('failopen');
  var r3 = await settle(driveAuth());
  T('開けなかったら reject される', !r3.ok && r3.e.message === 'popup_failed_to_open');
  T('開けなかったあと _authPromise が残らない', _authPromise === null);

  T('_isDrivePopupError: 閉じた／開けなかったはポップアップ由来',
    _isDrivePopupError(new Error('popup_closed')) && _isDrivePopupError(new Error('popup_failed_to_open')));
  T('_isDrivePopupError: それ以外は違う',
    !_isDrivePopupError(new Error('access_denied')) && !_isDrivePopupError(null));

  // 同時に呼んでも認証は 1 回（既存の作法を壊していない）
  resetAuth();
  var pa = driveAuth(), pb = driveAuth();
  T('同時呼び出しは同じ Promise', pa === pb);
  await settle(pa);
  T('同時呼び出しでも requestAccessToken は 1 回', gis.calls.length === 1);

  // ── 自動保存: ポップアップ由来の失敗では自動同期を止めない ──
  var _origUpload = driveUploadCore, _origSaveSettings = saveSettings;
  saveSettings = function () {};
  var uploads = 0;
  driveUploadCore = async function () { uploads++; if (uploads === 1) throw new Error('401 Unauthorized'); return 1; };
  resetAuth();
  state.driveAutoSave = true; _autoSaveBusy = false;
  gis.seq.push('ok', 'failopen');   // 1 回目は取れる → 401 → 取り直しは開けない
  await runAutoSave();
  clearTimeout(_autoSaveTimer);
  T('取り直しが開けなくても自動同期は ON のまま', state.driveAutoSave === true);
  T('未送信は持ち越し', _autoSaveDirty === true);

  uploads = 0; resetAuth();
  state.driveAutoSave = true; _autoSaveBusy = false;
  gis.seq.push('ok', 'ok');
  driveUploadCore = async function () { uploads++; throw new Error('401 Unauthorized'); };
  await runAutoSave();
  clearTimeout(_autoSaveTimer);
  T('回復不能（取り直しても 401）なら従来どおり自動同期を止める', state.driveAutoSave === false);

  driveUploadCore = _origUpload; saveSettings = _origSaveSettings;
  state.driveAutoSave = false; _autoSaveDirty = false;
  resetAuth();
  localStorage.clear();
})();
