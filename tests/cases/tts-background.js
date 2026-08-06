// 読み上げのバックグラウンド強化（design_tts_background.md Phase A / B）
// 実機でしか確かめられないもの（キープアライブが実際に効くか・ロック画面の操作子）は対象外。
// ここで見張るのは「設計上の罠を踏み戻していないか」の回帰。

// ══ Phase A: キープアライブ音声 ══════════════════════════════════
T('_ttsMakeKeepAliveUri が定義', typeof _ttsMakeKeepAliveUri === 'function');
T('_ttsKeepAliveStart が定義', typeof _ttsKeepAliveStart === 'function');
T('_ttsKeepAliveStop が定義', typeof _ttsKeepAliveStop === 'function');

(function () {
  var PREFIX = 'data:audio/wav;base64,';
  var uri = _ttsMakeKeepAliveUri();
  T('WAV の data URI を返す', uri.indexOf(PREFIX) === 0, uri.slice(0, 30));
  var b = atob(uri.slice(PREFIX.length));
  T('RIFF/WAVE ヘッダ', b.slice(0, 4) === 'RIFF' && b.slice(8, 12) === 'WAVE',
    b.slice(0, 4) + '/' + b.slice(8, 12));
  T('PCM 16bit モノラル', b.charCodeAt(20) === 1 && b.charCodeAt(22) === 1 && b.charCodeAt(34) === 16);

  // ⚠ ここが本命の回帰テスト。完全な無音にすると Chrome の AudioStreamMonitor が
  //   タブを audible と判定せず、キープアライブとして機能しなくなる。
  var nonZero = 0;
  for (var i = 44; i + 1 < b.length && i < 44 + 4000; i += 2) {
    if (b.charCodeAt(i) !== 0 || b.charCodeAt(i + 1) !== 0) nonZero++;
  }
  T('波形が無音でない（audible 判定に必須）', nonZero > 0, String(nonZero));
})();

T('振幅定数が 0 でない', TTS_KEEPALIVE_AMP > 0, String(TTS_KEEPALIVE_AMP));
T('振幅は控えめ（-20dBFS 以下）', TTS_KEEPALIVE_AMP <= 0.1, String(TTS_KEEPALIVE_AMP));
T('周波数は可聴域の上端', TTS_KEEPALIVE_HZ >= 15000, String(TTS_KEEPALIVE_HZ));
T('ナイキスト（22050Hz）未満', TTS_KEEPALIVE_HZ < 22050, String(TTS_KEEPALIVE_HZ));

// ── 設定トグル
(function () {
  var tgl = document.getElementById('tts-keepalive-toggle');
  T('キープアライブのトグルがある', !!tgl);
  T('🔊 グループ内にある', tgl && tgl.closest('#tts-settings-group') !== null);
  T('既定は ON', state.ttsKeepAlive === true, String(state.ttsKeepAlive));

  toggleTtsKeepAlive();
  T('OFF にできる', state.ttsKeepAlive === false, String(state.ttsKeepAlive));
  T('ラベルが同期', tgl.textContent === 'OFF', tgl.textContent);
  T('永続化される',
    JSON.parse(localStorage.getItem('epub_settings')).ttsKeepAlive === false);

  state.ttsKeepAlive = true;
  loadSettings();
  T('保存値から復元', state.ttsKeepAlive === false, String(state.ttsKeepAlive));

  // 表示設定リセットの対象外（ttsRate / ttsVoice と同じ扱い）
  window.confirm = function () { return true; };
  resetDisplaySettings();
  T('リセットで ttsKeepAlive は変わらない', state.ttsKeepAlive === false,
    String(state.ttsKeepAlive));

  toggleTtsKeepAlive();
  T('ON に戻せる', state.ttsKeepAlive === true && tgl.textContent === 'ON');
})();

// OFF のときは鳴らさない（_ttsKeepAliveStart が state を見ている）
(function () {
  state.ttsKeepAlive = false;
  _ttsKeepAliveStart();
  T('OFF なら音声要素を作らない', _ttsKeepAudio === null);
  state.ttsKeepAlive = true;
})();

// i18n（4 言語）
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  setLang(lg);
  var lbl = document.querySelector('[data-i18n="settings.ttsKeepAlive"]').textContent;
  var hlp = document.querySelector('[data-i18n="settings.ttsKeepAliveHelp"]').textContent;
  T('i18n ラベル (' + lg + ')', !!lbl && lbl !== 'settings.ttsKeepAlive', lbl);
  T('i18n 説明 (' + lg + ')', !!hlp && hlp !== 'settings.ttsKeepAliveHelp');
});
setLang('ja');

// ══ Phase A: Media Session ═══════════════════════════════════════
(function () {
  var handlers = {}, meta = null, pbState = '';
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: {
      setActionHandler: function (a, h) { handlers[a] = h; },
      get metadata() { return meta; },      set metadata(v) { meta = v; },
      get playbackState() { return pbState; }, set playbackState(v) { pbState = v; }
    }
  });

  _ttsInitMediaSession();
  ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward']
    .forEach(function (a) {
      T('Media Session ハンドラ: ' + a, typeof handlers[a] === 'function');
    });

  _ttsMsSpine = -1;
  _tts.active = true; _tts.paused = false;
  ttsSyncMediaSession();
  T('再生中は playbackState=playing', pbState === 'playing', pbState);
  T('メタデータが入る', !!meta);
  T('メタデータは章ごとに 1 回だけ組み直す', _ttsMsSpine === state.currentSpineIdx,
    _ttsMsSpine + ' / ' + state.currentSpineIdx);

  _tts.paused = true;  ttsSyncMediaSession();
  T('一時停止中は paused', pbState === 'paused', pbState);
  _tts.active = false; _tts.paused = false; ttsSyncMediaSession();
  T('停止中は none', pbState === 'none', pbState);
})();

// ══ Phase B: 先読みキュー ════════════════════════════════════════
T('TTS_LOOKAHEAD が定義', typeof TTS_LOOKAHEAD === 'number' && TTS_LOOKAHEAD >= 2,
  String(TTS_LOOKAHEAD));
T('_tts.queuedTo を持つ', typeof _tts.queuedTo === 'number');
T('ttsRestartQueue が定義', typeof ttsRestartQueue === 'function');
T('ttsFillQueue が定義', typeof ttsFillQueue === 'function');
T('ttsSpeakNext は廃止', typeof window.ttsSpeakNext === 'undefined');

(function () {
  var spoken = [], canceled = 0;
  var origSpeech = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak: function (u) { spoken.push(u); },
      cancel: function () { canceled++; },
      getVoices: function () { return []; },
      addEventListener: function () {},
      speaking: false, pending: false
    }
  });
  var saved = [];
  var origSavePos = savePos, origAdvance = ttsAdvanceChapter;
  savePos = function (r) { saved.push(r); };
  var advanced = 0;
  ttsAdvanceChapter = function () { advanced++; };

  _tts.active = true; _tts.paused = false;
  _tts.chunks = ['あ。', 'い。', 'う。', 'え。', 'お。'];
  _tts.idx = 0; _tts.queuedTo = 0;

  ttsFillQueue();
  T('先読み分だけ積む', spoken.length === TTS_LOOKAHEAD, String(spoken.length));
  T('queuedTo が積んだ数と一致', _tts.queuedTo === TTS_LOOKAHEAD, String(_tts.queuedTo));
  T('積んだだけでは idx は動かない', _tts.idx === 0, String(_tts.idx));
  T('しおりも書かない', saved.length === 0, String(saved.length));

  // ⚠ 設計の核心: 現在地の確定としおり保存は onstart のみ。
  //    onend で idx を進めると先読み分だけしおりが先へ飛ぶ。
  spoken[1].onstart();
  T('onstart で idx が実際の再生位置になる', _tts.idx === 1, String(_tts.idx));
  T('onstart でしおりを保存', saved.length === 1 && saved[0] === 1 / 5,
    JSON.stringify(saved));
  T('onstart からも補充される（キューが枯れない）', spoken.length === TTS_LOOKAHEAD + 1,
    String(spoken.length));

  var before = _tts.idx;
  spoken[0].onend();
  T('onend では idx が先読み分飛ばない', _tts.idx === before, String(_tts.idx));
  T('onend ではしおりを書かない', saved.length === 1, String(saved.length));

  // onstart が発火しないエンジン向けの保険が効くこと
  _tts.idx = 2;
  spoken[2].onend();
  T('onstart 未発火なら onend が idx を進める（保険）', _tts.idx === 3, String(_tts.idx));

  // 章送りは最終チャンクの onend でだけ・1 回だけ
  advanced = 0;
  _ttsMakeUtterance(2, null, 1).onend();
  T('途中のチャンクでは章送りしない', advanced === 0, String(advanced));
  _ttsMakeUtterance(_tts.chunks.length - 1, null, 1).onend();
  T('最終チャンクの onend で章送り', advanced === 1, String(advanced));

  // 組み直し
  spoken.length = 0; canceled = 0;
  _tts.idx = 1; _tts.queuedTo = 4;
  ttsRestartQueue();
  T('restart は cancel する', canceled === 1, String(canceled));
  T('restart は idx から積み直す', _tts.queuedTo === 1 + TTS_LOOKAHEAD, String(_tts.queuedTo));
  T('restart で先読み分積まれる', spoken.length === TTS_LOOKAHEAD, String(spoken.length));

  // fill は cancel しない（これをやると先読みの意味が消える）
  canceled = 0; _tts.idx = 0; _tts.queuedTo = 0; spoken.length = 0;
  ttsFillQueue();
  T('fill は cancel しない', canceled === 0, String(canceled));

  // ガード
  spoken.length = 0; _tts.queuedTo = _tts.idx; _tts.paused = true;
  ttsFillQueue();
  T('一時停止中は積まない', spoken.length === 0, String(spoken.length));
  _tts.paused = false;

  spoken.length = 0; _tts.queuedTo = _tts.idx; _ttsAdvancing = true;
  ttsFillQueue();
  T('章送り中は積まない', spoken.length === 0, String(spoken.length));
  _ttsAdvancing = false;

  // 停止で状態が片付く
  ttsAdvanceChapter = origAdvance;
  ttsStop();
  T('stop で queuedTo が 0', _tts.queuedTo === 0, String(_tts.queuedTo));
  T('stop で chunks が空', _tts.chunks.length === 0);
  T('stop で Media Session の章キャッシュが戻る', _ttsMsSpine === -1, String(_ttsMsSpine));

  savePos = origSavePos;
  if (origSpeech) Object.defineProperty(window, 'speechSynthesis', origSpeech);
})();

// ══ 一時停止中のシーク（キープアライブを掛け直す経路） ══════════════
T('_ttsUnpauseForSeek が定義', typeof _ttsUnpauseForSeek === 'function');
(function () {
  _tts.active = true; _tts.paused = true;
  _ttsUnpauseForSeek();
  T('シークで一時停止が解ける', _tts.paused === false, String(_tts.paused));
  _tts.active = false;
})();

localStorage.clear();
