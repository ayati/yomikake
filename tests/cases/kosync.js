// KOReader 同期（kosync）Step 1 — ドキュメントハッシュ（design_kosync.md §2-2 / §4-1）
//
// 期待値の出どころ:
//   - MD5 は RFC 1321 のテストベクタ
//   - ファイル名ハッシュ 2 件は KOReader 実機の蔵書名から算出した値
//   - partial MD5 は決定的な合成バッファに対する参照実装（Python hashlib）の値
// KOReader 実機のサイドカー（metadata.epub.lua）と一致することは実 ePub で確認済みだが、
// その ePub は個人の蔵書なので repo には入れない。ここでは合成データで同じ経路を通す。

T('koMd5Bytes が定義',            typeof koMd5Bytes === 'function');
T('koFilenameMd5 が定義',         typeof koFilenameMd5 === 'function');
T('koPartialMd5Offsets が定義',   typeof koPartialMd5Offsets === 'function');
T('koPartialMd5FromBuffer が定義', typeof koPartialMd5FromBuffer === 'function');
T('koPartialMd5FromBlob が定義',  typeof koPartialMd5FromBlob === 'function');
T('koEnsureDocHashes が定義',     typeof koEnsureDocHashes === 'function');
T('_koDocGet / _koDocSet / _koDocDelete が定義',
  typeof _koDocGet === 'function' && typeof _koDocSet === 'function' && typeof _koDocDelete === 'function');

function _u8(s) { return new TextEncoder().encode(s); }

// ── MD5 本体（RFC 1321）────────────────────────────
T('md5("")',               koMd5Bytes(_u8('')) === 'd41d8cd98f00b204e9800998ecf8427e');
T('md5("abc")',            koMd5Bytes(_u8('abc')) === '900150983cd24fb0d6963f7d28e17f72');
T('md5("message digest")', koMd5Bytes(_u8('message digest')) === 'f96b697d7cb7938d525a2f31aaf161d0');
T('md5(a-z)',              koMd5Bytes(_u8('abcdefghijklmnopqrstuvwxyz')) === 'c3fcd3d76192e4007dfb496cca67e13b');

// パディング境界（55/56/64 でブロックの繰り上がり方が変わる）
T('md5("x"*55)', koMd5Bytes(_u8(new Array(56).join('x'))) === '04364420e25c512fd958a70738aa8f72');
T('md5("x"*56)', koMd5Bytes(_u8(new Array(57).join('x'))) === '668a72d5ba17f08e62dabcafad6db14b');
T('md5("x"*64)', koMd5Bytes(_u8(new Array(65).join('x'))) === 'c1bb4f81d892b2d57947682aeb252456');

// 分割して update しても同じ（partial MD5 は飛び飛びのチャンクを順に食わせるため必須の性質）
(function () {
  var m = koMd5Create();
  m.update(_u8('mes')); m.update(_u8('sage ')); m.update(_u8('digest'));
  T('分割 update でも同値', m.hex() === 'f96b697d7cb7938d525a2f31aaf161d0');
})();

// ── Filename 方式 ────────────────────────────────
T('koFilenameMd5（日本語・UTF-8）',
  koFilenameMd5('ねらわれた学園　（新装版）_nodrm.epub') === 'd0488c9ec62b2299c2b76029251fc56b');
T('koFilenameMd5（日本語・その2）',
  koFilenameMd5('AKIRA1_大友克洋.epub') === 'aea6463c857ab41bbd71340b7f476977');
T('パス付きでもベース名だけを見る',
  koFilenameMd5('/mnt/ext1/epub/AKIRA1_大友克洋.epub') === 'aea6463c857ab41bbd71340b7f476977');
T('Windows 区切りでもベース名だけ',
  koFilenameMd5('C:\\books\\AKIRA1_大友克洋.epub') === 'aea6463c857ab41bbd71340b7f476977');
T('空名は空文字', koFilenameMd5('') === '' && koFilenameMd5(null) === '');

// ── partial MD5 のオフセット ───────────────────────
// KOReader は lshift(1024, 2*i) を i=-1..10 で回す。32bit の BitOp なので i=-1 は 0。
// 「先頭は 256」という二次情報は誤りで、実機 3 件との照合で 0 と確定している。
T('先頭オフセットは 0（256 ではない）', koPartialMd5Offsets(99999)[0] === 0);
T('2 番目は 1024', koPartialMd5Offsets(99999)[1] === 1024);
T('3 番目は 4096（4 倍ずつ）', koPartialMd5Offsets(99999)[2] === 4096);
T('最大 12 個', koPartialMd5Offsets(1e12).length === 12);
T('最後は 1073741824', koPartialMd5Offsets(1e12)[11] === 1073741824);
// EOF 打ち切り。実蔵書のサイズで検算（AKIRA 159403432B → 10 個 / ねらわれた学園 15884076B → 8 個）
T('EOF で打ち切る（159403432B → 10 個）', koPartialMd5Offsets(159403432).length === 10);
T('EOF で打ち切る（15884076B → 8 個）',  koPartialMd5Offsets(15884076).length === 8);
T('size 0 なら空', koPartialMd5Offsets(0).length === 0);
T('off === size は読まない', koPartialMd5Offsets(1024).length === 1);

// ── partial MD5 の値（参照実装と一致）──────────────
function _mk(n) { var b = new Uint8Array(n); for (var i = 0; i < n; i++) b[i] = (i * 7 + 3) & 255; return b; }
var _WANT = { 500: '5663227df4c12e3be6581b3294c87eb1', 1024: 'a66351d9c8f941b70a02eaf9c41e69c3',
              5000: '0f483c3b1984e43962e4e95f554b18c4', 2000000: '6f50fffb89716241b7da5f559c48ac34' };
Object.keys(_WANT).forEach(function (n) {
  var got = koPartialMd5FromBuffer(_mk(+n).buffer);
  T('partialMd5(buffer ' + n + 'B)', got === _WANT[n], got);
});

// ── 対応表（epub_kosync_docs）────────────────────
(function () {
  var k = 'epub_pos_テスト本__テスト著者';
  _koDocDelete(k);
  var v = _koDocSet(k, { bin: 'a'.repeat(32), fn: 'b'.repeat(32), name: 'x.epub', size: 123 });
  T('_koDocSet が値を返す', !!v && v.bin === 'a'.repeat(32));
  T('_koDocSet が t を打つ', typeof v.t === 'number' && v.t > 0);
  T('_koDocGet で読み戻せる', (_koDocGet(k) || {}).fn === 'b'.repeat(32));
  _koDocSet(k, { size: 456 });
  T('触った項目だけ更新（bin は残る）', (_koDocGet(k) || {}).bin === 'a'.repeat(32));
  T('触った項目は更新される', (_koDocGet(k) || {}).size === 456);
  _koDocDelete(k);
  T('_koDocDelete で消える', _koDocGet(k) === null);
  // プロトタイプ汚染よけ（CLAUDE.md の hasOwnKey 規約）
  T('constructor は拾わない', _koDocGet('constructor') === null);
  T('toString は拾わない', _koDocGet('toString') === null);
  T('bookKey なしは null', _koDocGet('') === null && _koDocGet(null) === null);
})();

// ── しおりデータに混ざらないこと（設計 S6・最重要）──
// 認証情報も対応表も端末ローカルに閉じる。Drive 同期・JSON 書き出しに載ってはいけない。
(function () {
  _koDocSet('epub_pos_混入検査__著者', { bin: 'c'.repeat(32), name: 'z.epub', size: 1 });
  var json = JSON.stringify(collectBookmarks());
  T('collectBookmarks に epub_kosync_docs が載らない', json.indexOf('epub_kosync') < 0);
  T('collectBookmarks にハッシュ値が載らない', json.indexOf('c'.repeat(32)) < 0);
  _koDocDelete('epub_pos_混入検査__著者');
})();


// ══ Step 2: 設定・接続 ═══════════════════════════════════
T('koBaseUrl が定義',      typeof koBaseUrl === 'function');
T('koFetch が定義',        typeof koFetch === 'function');
T('koTestConnection が定義', typeof koTestConnection === 'function');
T('koRegister が定義',     typeof koRegister === 'function');
T('updateKosyncUI が定義', typeof updateKosyncUI === 'function');
T('_kosync が存在',        _kosync && typeof _kosync === 'object');

// 既定値
T('同期方法の既定は binary（KOReader と同じ）', _kosync.method === 'binary');
T('自動同期の既定は OFF', _kosync.autoSync === false);
T('端末 ID が 32hex で生成される', /^[0-9a-f]{32}$/.test(_kosync.deviceId), String(_kosync.deviceId));
T('端末名の既定は yomikake', _kosync.deviceName === 'yomikake');

// URL の正規化（末尾スラッシュを残すと //users/auth になって 404 になる）
(function () {
  var keep = _kosync.server;
  koSetServer('https://www.ayati.com/kosync/');
  T('末尾スラッシュを落とす', koBaseUrl() === 'https://www.ayati.com/kosync');
  koSetServer('https://www.ayati.com/kosync///');
  T('末尾スラッシュが複数でも落とす', koBaseUrl() === 'https://www.ayati.com/kosync');
  koSetServer('www.ayati.com/kosync');
  T('スキームが無ければ https を補う', koBaseUrl() === 'https://www.ayati.com/kosync');
  koSetServer('  https://x.example/k  ');
  T('前後の空白を落とす', koBaseUrl() === 'https://x.example/k');
  koSetServer('');
  T('空なら空文字', koBaseUrl() === '');
  koSetServer(keep || '');
})();

// パスワードは平文で持たない（md5 だけを保存する）
(function () {
  koSetUsername('tester');
  koSetPassword('p@ssw0rd-平文');
  T('userkey は md5', _kosync.userkey === koMd5Bytes(new TextEncoder().encode('p@ssw0rd-平文')));
  T('userkey は 32hex', /^[0-9a-f]{32}$/.test(_kosync.userkey));
  var raw = localStorage.getItem(KOSYNC_CONF_KEY) || '';
  T('平文パスワードを保存しない', raw.indexOf('p@ssw0rd') < 0, raw.slice(0, 80));
  T('_kosync に password フィールドを作らない', _kosync.password === undefined);
  koSetPassword('');
  T('空入力で userkey を消せる', _kosync.userkey === '');
})();

// 揃っているかの判定
(function () {
  koSetServer(''); koSetUsername(''); koSetPassword('');
  T('未設定なら koConfigured は false', koConfigured() === false);
  koSetServer('https://x.example/k');
  T('サーバだけでは false', koConfigured() === false);
  koSetUsername('u'); koSetPassword('pw');
  T('サーバ＋資格情報で true', koConfigured() === true);
})();

// 保存形式の検証（壊れた値・不正な方式を拾わない）
(function () {
  var keep = localStorage.getItem(KOSYNC_CONF_KEY);
  localStorage.setItem(KOSYNC_CONF_KEY, '{壊れた JSON');
  T('壊れた設定は既定値に戻る', _koConfLoad().method === 'binary');
  localStorage.setItem(KOSYNC_CONF_KEY, JSON.stringify({ method: 'evil', userkey: 'ダメ', deviceId: '!!' }));
  var c = _koConfLoad();
  T('不正な同期方法は採用しない', c.method === 'binary');
  T('32hex でない userkey は採用しない', c.userkey === '');
  T('不正な端末 ID は作り直す', /^[0-9a-f]{32}$/.test(c.deviceId));
  if (keep === null) localStorage.removeItem(KOSYNC_CONF_KEY); else localStorage.setItem(KOSYNC_CONF_KEY, keep);
  _kosync = _koConfLoad();
})();

// UI
T('設定に KOReader 同期グループがある', !!document.getElementById('kosync-group'));
T('Drive グループの直後に置く',
  (document.getElementById('drive-auto-group').nextElementSibling || {}).id === 'kosync-group');
T('サーバ URL 欄がある',   !!document.getElementById('kosync-server'));
T('パスワード欄は type=password',
  (document.getElementById('kosync-pass') || {}).type === 'password');
T('同期方法のセレクトがある', !!document.getElementById('kosync-method'));
T('自動同期トグルがある',   !!document.getElementById('kosync-auto-toggle'));
(function () {
  koSetServer('https://x.example/k'); koSetUsername('u'); koSetPassword('pw');
  _kosync.autoSync = false; updateKosyncUI();
  T('トグルが OFF を表示', document.getElementById('kosync-auto-toggle').textContent === 'OFF');
  toggleKosyncAutoSync();
  T('押すと ON になる', _kosync.autoSync === true &&
    document.getElementById('kosync-auto-toggle').textContent === 'ON');
  toggleKosyncAutoSync();
  T('もう一度押すと OFF に戻る', _kosync.autoSync === false);
  T('設定が揃えば接続テストが押せる', document.getElementById('kosync-test-btn').disabled === false);
  koSetUsername('');
  T('資格情報が欠けたら押せない', document.getElementById('kosync-test-btn').disabled === true);
  koSetUsername('u');
  T('入力欄に保存値が入る', document.getElementById('kosync-server').value === 'https://x.example/k');
  T('パスワード欄は保存済みを示すだけ',
    document.getElementById('kosync-pass').value === '' &&
    document.getElementById('kosync-pass').placeholder === t('kosync.passwordSaved'));
})();

// 認証情報が同期・書き出しに載らないこと（設計 S6・最重要）
(function () {
  koSetServer('https://x.example/k'); koSetUsername('himitsu-user'); koSetPassword('himitsu-pass');
  var json = JSON.stringify(collectBookmarks());
  T('collectBookmarks に epub_kosync が載らない', json.indexOf('epub_kosync') < 0);
  T('collectBookmarks にユーザー名が載らない',   json.indexOf('himitsu-user') < 0);
  T('collectBookmarks に userkey が載らない',    json.indexOf(_kosync.userkey) < 0);
  var settings = localStorage.getItem('epub_settings') || '';
  T('epub_settings にも混ざらない', settings.indexOf('himitsu-user') < 0 && settings.indexOf('userkey') < 0);
})();

// 表示設定リセットは認証情報を消さない（DISPLAY_DEFAULTS の範囲外）
T('リセット対象に kosync が入っていない',
  DISPLAY_DEFAULTS.kosync === undefined && DISPLAY_DEFAULTS.autoSync === undefined);

// i18n 4 言語
(function () {
  var keys = Object.keys(I18N.ja).filter(function (k) {
    return k.indexOf('kosync.') === 0 || k.indexOf('toast.kosync') === 0 || k === 'settings.kosyncGroup';
  });
  T('kosync の i18n キーがある', keys.length >= 25, String(keys.length));
  ['en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
    var missing = keys.filter(function (k) { return !I18N[lg][k]; });
    T('i18n ' + lg + ' に欠けが無い', missing.length === 0, missing.join(','));
  });
  T('{user} プレースホルダが 4 言語に残っている',
    ['ja', 'en', 'zh-TW', 'zh-CN'].every(function (lg) {
      return I18N[lg]['kosync.registerConfirm'].indexOf('{user}') >= 0;
    }));
  T('{msg} プレースホルダが 4 言語に残っている',
    ['ja', 'en', 'zh-TW', 'zh-CN'].every(function (lg) {
      return I18N[lg]['toast.kosyncNetFail'].indexOf('{msg}') >= 0;
    }));
})();

// 設定が無い状態で押しても落ちない（通信は起きない）
(function () {
  koSetServer(''); koSetUsername(''); koSetPassword('');
  var threw = false;
  try { koTestConnection(); koRegister(); } catch (e) { threw = true; }
  T('未設定で押しても例外にならない', !threw);
  // async 関数なので同期例外にはならず Promise が reject される。必ず受け止めること
  koFetch('GET', '/users/auth').then(
    function () { T('サーバ未設定なら koFetch は reject する', false, 'resolve してしまった'); },
    function (e) { T('サーバ未設定なら koFetch は reject する', String(e.message) === 'no-server', String(e.message)); }
  );
})();

// ── 本を開いたら対応表ができる（loadEpub 統合）────
fetch('tests/.fixtures/reflow.epub')
.then(function (r) { return r.blob(); })
.then(function (b) {
  var f = new File([b], 'reflow.epub', { type: 'application/epub+zip' });
  return loadEpub(f).then(function () { return f; });
})
.then(function (f) {
  // koEnsureDocHashes は fire-and-forget なので少し待つ
  return new Promise(function (res) { setTimeout(function () { res(f); }, 300); });
})
.then(function (f) {
  var d = _koDocGet(state.bookKey);
  T('本を開くと対応表に載る', !!d, String(state.bookKey));
  if (!d) return;
  T('ファイル名を覚える', d.name === 'reflow.epub', String(d.name));
  T('サイズを覚える', d.size === f.size, String(d.size) + ' / ' + f.size);
  T('filename ハッシュが 32hex',  /^[0-9a-f]{32}$/.test(d.fn || ''), String(d.fn));
  T('filename ハッシュが md5(名前) と一致', d.fn === koFilenameMd5('reflow.epub'));
  T('binary ハッシュが 32hex', /^[0-9a-f]{32}$/.test(d.bin || ''), String(d.bin));
  T('binary と filename は別値', d.bin !== d.fn);
  return koPartialMd5FromBlob(f).then(function (h) {
    T('binary ハッシュが実体から再計算した値と一致', d.bin === h, String(d.bin) + ' / ' + h);
  });
})
.then(function () {
  // 完全削除で対応表からも消える（論理削除では消さない）
  var k = state.bookKey;
  _rlPurgeLocalData(k);
  T('完全削除で対応表からも消える', _koDocGet(k) === null);
})
.catch(function (e) { T('kosync 統合テストが例外なく終わる', false, String(e && e.message || e)); });
