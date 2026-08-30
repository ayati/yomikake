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


// ══ Step 3: XPointer の解釈 ═════════════════════════════
T('koParseXPointer が定義',   typeof koParseXPointer === 'function');
T('koResolveSteps が定義',    typeof koResolveSteps === 'function');
T('koTargetFromProgress が定義', typeof koTargetFromProgress === 'function');
T('koPullForCurrentBook が定義', typeof koPullForCurrentBook === 'function');
T('koMarkXPointerTarget が定義', typeof koMarkXPointerTarget === 'function');

// KOReader 実機（Android / PocketBook）から採取した 3 例をそのままベクタにする
(function () {
  var a = koParseXPointer('/body/DocFragment[7]/body/div/p[88]/ruby[6]/rt/text().0');
  T('実機例1: spine を 0 始まりに直す', a && a.spineIdx === 6, JSON.stringify(a && a.spineIdx));
  T('実機例1: 経路は body/div/p/ruby/rt',
    a && a.steps.map(function (x) { return x.tag; }).join('/') === 'body/div/p/ruby/rt',
    a && JSON.stringify(a.steps));
  T('実機例1: 添字なしは 1、添字ありはその値',
    a && a.steps[1].idx === 1 && a.steps[2].idx === 88 && a.steps[3].idx === 6 && a.steps[4].idx === 1);

  var b = koParseXPointer('/body/DocFragment[7]/body/div/p[83]/span[1]/text().26');
  T('実機例2: 文字オフセット .26 は落とす',
    b && b.steps.map(function (x) { return x.tag; }).join('/') === 'body/div/p/span',
    b && JSON.stringify(b.steps));
  T('実機例2: span[1]', b && b.steps[3].idx === 1);

  var c = koParseXPointer('/body/DocFragment[26]/body/div/svg.0');
  T('実機例3（FXL）: svg.0 のドット記法を落とす',
    c && c.spineIdx === 25 && c.steps.map(function (x) { return x.tag; }).join('/') === 'body/div/svg',
    c && JSON.stringify(c));
})();

// 壊れた入力を拾わない
T('DocFragment が無い', koParseXPointer('/body/p[1]') === null);
T('数値だけ', koParseXPointer('123') === null);
T('空文字', koParseXPointer('') === null);
T('null', koParseXPointer(null) === null);
T('DocFragment[0] は無効', koParseXPointer('/body/DocFragment[0]/body') === null);
T('添字 0 は無効', koParseXPointer('/body/DocFragment[1]/body/p[0]') === null);
T('不正なタグ名', koParseXPointer('/body/DocFragment[1]/body/<p>') === null);
T('DocFragment だけでも通る（章頭）',
  (function () { var x = koParseXPointer('/body/DocFragment[3]'); return x && x.spineIdx === 2 && x.steps.length === 0; })());

// 解決器（同名兄弟の 1 始まり添字・名前空間はローカル名で照合）
// ⚠ div.innerHTML に <body> は入らない（HTML パーサが落とす）ので、
//    実際の使われ方と同じく DOMParser で文書ごと組んで documentElement を渡す
(function () {
  var doc = new DOMParser().parseFromString(
    '<html><body><h1>t</h1><p>1</p><p>2</p><p>3</p>' +
    '<div><span>a</span><span>b</span></div></body></html>', 'text/html');
  var rootEl = doc.documentElement, body = doc.body;
  var r1 = koResolveSteps(rootEl, [{ tag: 'body', idx: 1 }, { tag: 'p', idx: 3 }]);
  T('同名兄弟の 3 番目を取る', !!r1 && r1.el.textContent === '3' && r1.matched === 2,
    r1 && (r1.el.textContent + '/' + r1.matched));
  var r2 = koResolveSteps(rootEl, [{ tag: 'body', idx: 1 }, { tag: 'div', idx: 1 }, { tag: 'span', idx: 2 }]);
  T('入れ子も辿れる', !!r2 && r2.el.textContent === 'b' && r2.matched === 3,
    r2 && (r2.el.textContent + '/' + r2.matched));
  var r3 = koResolveSteps(rootEl, [{ tag: 'body', idx: 1 }, { tag: 'p', idx: 99 }]);
  T('外れたら辿れたところまで返す', !!r3 && r3.matched === 1 && r3.total === 2 && r3.el === body,
    r3 && (r3.matched + '/' + r3.total));
  // SVG は SVG 名前空間の要素だが crengine のパスには裸の svg として出る
  var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  body.appendChild(svg);
  var r4 = koResolveSteps(rootEl, [{ tag: 'body', idx: 1 }, { tag: 'svg', idx: 1 }]);
  T('名前空間を無視してローカル名で照合する', !!r4 && r4.el === svg && r4.matched === 2,
    r4 && String(r4.matched));
  // head も body と同じ階層にあるが、経路が body から始まるので取り違えない
  var r5 = koResolveSteps(rootEl, [{ tag: 'body', idx: 1 }]);
  T('body は 1 番目の body を取る', !!r5 && r5.el === body);
})();


// ══ Step 4: XPointer の生成 ═════════════════════════════
T('koBuildProgress が定義',       typeof koBuildProgress === 'function');
T('koPathToElement が定義',       typeof koPathToElement === 'function');
T('koStepsToXPointer が定義',     typeof koStepsToXPointer === 'function');
T('koPickElementForRatio が定義', typeof koPickElementForRatio === 'function');
T('koPushForCurrentBook が定義',  typeof koPushForCurrentBook === 'function');

// 書式（添字 1 は省く。KOReader の実データにも両方の形が出る）
T('章頭の形', koStepsToXPointer(6, [{ tag: 'body', idx: 1 }]) === '/body/DocFragment[7]/body');
T('段落つきの形',
  koStepsToXPointer(2, [{ tag: 'body', idx: 1 }, { tag: 'div', idx: 1 }, { tag: 'p', idx: 88 }]) ===
  '/body/DocFragment[3]/body/div/p[88]');

// 生成 → 解釈 → 解決の往復（生成規則と解決規則が同じであることの担保）
(function () {
  var doc = new DOMParser().parseFromString(
    '<html><body><h1>t</h1><div><p>a</p><p>b</p><p>c</p></div></body></html>', 'text/html');
  var body = doc.body, target = doc.querySelectorAll('p')[2];
  var steps = koPathToElement(body, target);
  T('経路を組み立てられる',
    steps.map(function (x) { return x.tag + x.idx; }).join('/') === 'body1/div1/p3',
    JSON.stringify(steps));
  var xp = koStepsToXPointer(4, steps);
  T('XPointer 文字列になる', xp === '/body/DocFragment[5]/body/div/p[3]', xp);
  var back = koParseXPointer(xp);
  T('解釈して spine が戻る', back && back.spineIdx === 4);
  var r = koResolveSteps(doc.documentElement, back.steps);
  T('往復して同じ要素に戻る', !!r && r.el === target && r.matched === back.steps.length);
})();

// 章内位置 → ブロック要素（文字数で按分する）
(function () {
  var doc = new DOMParser().parseFromString(
    '<html><body><p>' + new Array(101).join('あ') + '</p>' +
    '<p>' + new Array(101).join('い') + '</p>' +
    '<p>' + new Array(101).join('う') + '</p></body></html>', 'text/html');
  var body = doc.body, ps = doc.querySelectorAll('p');
  T('ratio 0 は先頭ブロック',   koPickElementForRatio(body, 0)   === ps[0]);
  T('ratio 0.5 は真ん中',       koPickElementForRatio(body, 0.5) === ps[1]);
  T('ratio 1 は末尾ブロック',   koPickElementForRatio(body, 1)   === ps[2]);
  T('範囲外は丸める', koPickElementForRatio(body, -5) === ps[0] && koPickElementForRatio(body, 9) === ps[2]);
  T('テキストが無ければ null',
    koPickElementForRatio(new DOMParser().parseFromString('<html><body></body></html>', 'text/html').body, 0.5) === null);
})();

// いちばん内側のブロックを選ぶ（外側の div を選ばない）
(function () {
  var doc = new DOMParser().parseFromString(
    '<html><body><div><p>あ</p><p>い</p></div></body></html>', 'text/html');
  var blocks = koTextBlocks(doc.body);
  T('内側の p を集める', blocks.length === 2 && blocks[0].el.localName === 'p', String(blocks.length));
  T('外側の div は含めない', blocks.every(function (b) { return b.el.localName !== 'div'; }));
})();


// ══ Step 5: 自動同期の安全弁 ═══════════════════════════
T('koAutoPullOnOpen が定義',   typeof koAutoPullOnOpen === 'function');
T('koScheduleAutoPush が定義', typeof koScheduleAutoPush === 'function');
T('koRunAutoPush が定義',      typeof koRunAutoPush === 'function');
T('koFlushAutoPush が定義',    typeof koFlushAutoPush === 'function');
T('Drive 自動保存と同じ間隔を使う', AUTO_SAVE_INTERVAL === 60000, String(AUTO_SAVE_INTERVAL));

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
  // 初回オープンでは自動 pull がハッシュ確定より先に走りうる。待てるようにしてある
  T('ハッシュ確定を待てる promise がある', !!_koHashReady && typeof _koHashReady.then === 'function');
  T('binary と filename は別値', d.bin !== d.fn);
  return koPartialMd5FromBlob(f).then(function (h) {
    T('binary ハッシュが実体から再計算した値と一致', d.bin === h, String(d.bin) + ' / ' + h);
  });
})
.then(function () {
  // ══ Step 3: 実 ePub に対する着地 ════════════════════
  // fixture は <body><h1 id="top">…</h1><p>×40</p></body>。
  // p の中身は <ruby>本文<rt>ほんぶん</rt></ruby>…<span class="tcy">NN</span>行目。
  T('fixture は 4 章以上', state.spine.length >= 4, String(state.spine.length));
  return koTargetFromProgress('/body/DocFragment[3]/body/p[12]/span[1]/text().3');
})
.then(function (tgt) {
  T('要素まで解決できたら anchor 経路に載せる',
    tgt && tgt.spineIdx === 2 && tgt.target === '#' + KO_TARGET_ID, JSON.stringify(tgt));
  T('全段解決なら depth=exact', tgt && tgt.depth === 'exact', tgt && tgt.depth);
  T('ジャンプ用に steps を持ち帰る', tgt && tgt.steps && tgt.steps.length === 3);
  return koTargetFromProgress('/body/DocFragment[3]/body/div/p[99]/em[2]');
})
.then(function (tgt) {
  // fixture の body 直下に <div> は無い → body までしか辿れない＝章頭へ落ちる
  T('解決できなければ章頭へ落とす',
    tgt && tgt.spineIdx === 2 && tgt.target === 'start' && tgt.depth === 'chapter', JSON.stringify(tgt));
  return koTargetFromProgress('/body/DocFragment[999]/body/p[1]');
})
.then(function (tgt) {
  T('spine の範囲外は採用しない', tgt === null, JSON.stringify(tgt));
  return koTargetFromProgress('/body/DocFragment[3]/body/p[12]/ruby[1]/rt/text().0');
})
.then(function (tgt) {
  T('ルビの rt まで辿れる', tgt && tgt.target === '#' + KO_TARGET_ID && tgt.depth === 'exact',
    JSON.stringify(tgt));
  // buildSrcdoc が着地点に id を打つ
  _koPendingTarget = { spineIdx: state.currentSpineIdx, steps: tgt.steps };
  var item = state.spine[state.currentSpineIdx];
  return state.epub.file(item.absPath).async('text').then(function (txt) {
    return buildSrcdoc(txt, item.absPath, '#' + KO_TARGET_ID, _renderSeq);
  });
})
.then(function (html) {
  T('buildSrcdoc が着地点に id を打つ', html.indexOf(KO_TARGET_ID) >= 0);
  T('id は 1 箇所だけ', html.split(KO_TARGET_ID).length - 1 <= 2, String(html.split(KO_TARGET_ID).length - 1));
  T('一回限りで消費される（次の章へ漏れない）', _koPendingTarget === null);
  // spine が違えば消費しない
  _koPendingTarget = { spineIdx: state.currentSpineIdx + 1, steps: [{ tag: 'body', idx: 1 }, { tag: 'p', idx: 1 }] };
  var item = state.spine[state.currentSpineIdx];
  return state.epub.file(item.absPath).async('text').then(function (txt) {
    return buildSrcdoc(txt, item.absPath, 'start', _renderSeq);
  });
})
.then(function (html) {
  T('別の章あての着地点は打たない', html.indexOf(KO_TARGET_ID) < 0);
  T('別の章あての着地点は残す', _koPendingTarget !== null);
  _koPendingTarget = null;
  // 設定が無ければ通信せずに終わる
  koSetServer(''); koSetUsername(''); koSetPassword('');
  return koPullForCurrentBook({ silent: true });
})
.then(function (ok) {
  T('未設定なら pull は何もしない', ok === false);
})
.then(function () {
  // ══ Step 4: 実 ePub に対する生成 ════════════════════
  // fixture の 1 章は <body><h1 id="top">第N章</h1><p>×40</p></body>。
  // p の中身は <ruby>…</ruby> と <span class="tcy"> を含むので、
  // 深く潜る実装だと ruby/span まで経路に入ってしまう
  _intraChapterRatio = 1;
  return koBuildProgress(2, 1);
})
.then(function (xp) {
  T('章末は最後の段落を指す', xp === '/body/DocFragment[3]/body/p[40]', String(xp));
  T('ブロック要素どまり（ruby/rt/span へ潜らない）',
    xp.indexOf('ruby') < 0 && xp.indexOf('span') < 0 && xp.indexOf('rt') < 0, String(xp));
  // 生成したものを自分で解決できる＝KOReader へ渡す前の最低条件
  return koTargetFromProgress(xp);
})
.then(function (tgt) {
  T('自分で生成した XPointer を自分で解決できる',
    tgt && tgt.spineIdx === 2 && tgt.depth === 'exact', JSON.stringify(tgt));
  return koBuildProgress(2, 0);
})
.then(function (xp) {
  T('章頭は最初のブロック（見出し）を指す', xp === '/body/DocFragment[3]/body/h1', String(xp));
  return koBuildProgress(1, 0.5);
})
.then(function (xp) {
  T('中ほどは中ほどの段落', /^\/body\/DocFragment\[2\]\/body\/p\[\d+\]$/.test(xp), String(xp));
  var n = parseInt(/p\[(\d+)\]/.exec(xp)[1], 10);
  T('真ん中あたりの段落を選ぶ', n > 10 && n < 30, String(n));
  return koBuildProgress(999, 0.5);
})
.then(function (xp) {
  T('spine 範囲外は null', xp === null, String(xp));
  // 進捗の式（進捗バーと同じ）
  state.currentSpineIdx = 2; _intraChapterRatio = 0;
  // 小数第 4 位に丸めて送るので、比較の許容差もそれに合わせる
  T('percentage は (spineIdx + ratio) / (spineCount - 1)',
    Math.abs(koCurrentPercentage() - 2 / (state.spine.length - 1)) < 1e-4,
    String(koCurrentPercentage()));
  T('小数第 4 位に丸める', String(koCurrentPercentage()).replace(/^\d+\.?/, '').length <= 4,
    String(koCurrentPercentage()));
  _intraChapterRatio = 1;
  T('章末なら 1 段ぶん進む',
    Math.abs(koCurrentPercentage() - 3 / (state.spine.length - 1)) < 1e-4,
    String(koCurrentPercentage()));
  T('0〜1 に丸める', koCurrentPercentage() <= 1);
  // push 先のハッシュは設定した方式のもの（両方には書かない）
  var d = _koDocGet(state.bookKey);
  _kosync.method = 'binary';
  T('binary 設定なら bin を使う', koDocHashForPush(state.bookKey) === d.bin);
  _kosync.method = 'filename';
  T('filename 設定なら fn を使う', koDocHashForPush(state.bookKey) === d.fn);
  _kosync.method = 'binary';
  T('対応表が無ければ null', koDocHashForPush('epub_pos_無い本__誰か') === null);
  // 設定が無ければ通信しない
  koSetServer(''); koSetUsername(''); koSetPassword('');
  return koPushForCurrentBook({ silent: true });
})
.then(function (ok) {
  T('未設定なら push は何もしない', ok === false);
  T('送信ボタンがある', !!document.getElementById('kosync-push-btn'));
  T('取得ボタンと同じ行に並ぶ',
    document.getElementById('kosync-pull-btn').parentElement ===
    document.getElementById('kosync-push-btn').parentElement);
})
.then(function () {
  // ══ Step 5: 実際に飛ぶリクエストを検査する ═══════════
  // window.fetch を差し替えて、koFetch が組み立てるヘッダと本文をそのまま覗く。
  // ここを見ておけば、サーバへ何が届くかは実機を待たずに確かめられる
  window.__koCalls = [];
  window.__koRealFetch = window.fetch;
  window.__koRes = function (status, obj) {
    return { status: status, ok: status >= 200 && status < 300,
             json: function () { return Promise.resolve(obj); } };
  };
  window.fetch = function (url, init) {
    window.__koCalls.push({ url: url, init: init });
    return Promise.resolve(window.__koRes(200, { status: 'success' }));
  };
  koSetServer('https://ex.example/kosync'); koSetUsername('u'); koSetPassword('pw');
  _kosync.method = 'binary';
  state.currentSpineIdx = 2; _intraChapterRatio = 0.5;
  return koPushForCurrentBook({});
})
.then(function (ok) {
  var c = window.__koCalls[0];
  T('push が成功を返す', ok === true);
  T('PUT /syncs/progress へ送る',
    !!c && c.init.method === 'PUT' && c.url === 'https://ex.example/kosync/syncs/progress',
    c && (c.init.method + ' ' + c.url));
  T('accept ヘッダは KOReader と同じ',
    c.init.headers['accept'] === 'application/vnd.koreader.v1+json');
  T('x-auth-user を送る', c.init.headers['x-auth-user'] === 'u');
  T('x-auth-key は md5（平文ではない）',
    c.init.headers['x-auth-key'] === koMd5Bytes(new TextEncoder().encode('pw')));
  var b = JSON.parse(c.init.body);
  T('document は設定した方式のハッシュ', b.document === _koDocGet(state.bookKey).bin);
  T('progress は XPointer', /^\/body\/DocFragment\[3\]\/body/.test(b.progress), b.progress);
  T('percentage は 0〜1', b.percentage >= 0 && b.percentage <= 1, String(b.percentage));
  T('device / device_id を送る',
    b.device === _kosync.deviceName && b.device_id === _kosync.deviceId);
  T('metadata に書名と著者', !!b.metadata && b.metadata.title === state.bookTitle &&
    b.metadata.authors === state.bookCreator, JSON.stringify(b.metadata));
  T('平文パスワードは一切送らない', JSON.stringify(c).indexOf('pw"') < 0 && c.init.headers['x-auth-key'] !== 'pw');

  // pull: binary → filename の順に試す
  window.__koCalls = [];
  var d = _koDocGet(state.bookKey);
  window.fetch = function (url, init) {
    window.__koCalls.push({ url: url, init: init });
    if (url.indexOf(d.bin) > 0) return Promise.resolve(window.__koRes(404, { status: 'not found' }));
    return Promise.resolve(window.__koRes(200,
      { progress: '/body/DocFragment[3]/body/p[5]', percentage: 0.5, device: 'PocketBook', timestamp: 1 }));
  };
  return koPullForCurrentBook({});
})
.then(function (ok) {
  var calls = window.__koCalls, d = _koDocGet(state.bookKey);
  T('pull が提案を出す', ok === true);
  T('binary を先に試す', calls[0].url.indexOf(d.bin) > 0, calls[0].url);
  T('空振りしたら filename に落ちる', calls.length === 2 && calls[1].url.indexOf(d.fn) > 0,
    String(calls.length));
  T('GET で取りに行く', calls[0].init.method === 'GET');
  var el = document.getElementById('toast');
  T('アクショントーストで提案する', el.classList.contains('toast-action'));
  T('端末名と進捗を見せる',
    el.textContent.indexOf('PocketBook') >= 0 && el.textContent.indexOf('50') >= 0, el.textContent);

  // 方式を filename にすると順序が入れ替わる
  _kosync.method = 'filename';
  window.__koCalls = [];
  window.fetch = function (url, init) {
    window.__koCalls.push({ url: url, init: init });
    return Promise.resolve(window.__koRes(404, { status: 'not found' }));
  };
  return koPullForCurrentBook({ silent: true });
})
.then(function (ok) {
  var calls = window.__koCalls, d = _koDocGet(state.bookKey);
  T('filename 設定なら filename を先に試す', calls[0].url.indexOf(d.fn) > 0, calls[0].url);
  T('どちらも空振りなら提案しない', ok === false);
  _kosync.method = 'binary';

  // 記録なしを 200＋空で返す実装もある
  window.__koCalls = [];
  window.fetch = function (url) {
    window.__koCalls.push({ url: url });
    return Promise.resolve(window.__koRes(200, { document: 'x' }));   // progress が無い
  };
  return koPullForCurrentBook({ silent: true });
})
.then(function (ok) {
  T('200＋progress 無しも「記録なし」として扱う', ok === false);

  // 認証エラー
  window.fetch = function () { return Promise.resolve(window.__koRes(401, { error: 'x' })); };
  return koPullForCurrentBook({ silent: true });
})
.then(function (ok) {
  T('401 なら提案しない', ok === false);
  T('401 は認証エラーとして知らせる',
    document.getElementById('toast').textContent === t('toast.kosyncAuthFail'),
    document.getElementById('toast').textContent);

  // ── 自動同期の安全弁 ──────────────────
  window.fetch = function (url, init) {
    window.__koCalls.push({ url: url, init: init });
    return Promise.resolve(window.__koRes(200, { status: 'success' }));
  };
  _kosync.autoSync = false; window.__koCalls = [];
  return koRunAutoPush();
})
.then(function () {
  T('自動同期 OFF なら送らない', window.__koCalls.length === 0, String(window.__koCalls.length));
  // 鉄則: pull が済むまで push を武装しない
  _kosync.autoSync = true;
  _koPullDone.delete(state.bookKey);
  window.__koCalls = [];
  return koRunAutoPush();
})
.then(function () {
  T('pull が済むまで自動 push は動かない', window.__koCalls.length === 0, String(window.__koCalls.length));
  _koPullDone.add(state.bookKey);
  _koLastPushed = null;
  window.__koCalls = [];
  return koRunAutoPush();
})
.then(function () {
  T('pull 済みなら自動 push が動く', window.__koCalls.length === 1, String(window.__koCalls.length));
  window.__koCalls = [];
  return koRunAutoPush();     // 位置は動いていない
})
.then(function () {
  T('同じ位置は送り直さない', window.__koCalls.length === 0, String(window.__koCalls.length));
  _intraChapterRatio = 0.05;  // 位置が戻る＝別の位置になった
  window.__koCalls = [];
  return koRunAutoPush();
})
.then(function () {
  T('位置が動けば送る', window.__koCalls.length === 1, String(window.__koCalls.length));
  // 読み上げ中は送らない（しおり保護と同じ理由。TTS は文単位で savePos するので、
  // 無意識スクロール由来の位置を KOReader へ流し込むと、あちらが読み上げ位置とずれる）
  // ⚠ 予約は setTimeout なので「fetch が飛んでいない」では検査にならない。
  //    タイマーが張られたかどうかを見る
  clearTimeout(_koAutoPushTimer); _koAutoPushTimer = null;
  _tts.active = true;
  koScheduleAutoPush();
  T('読み上げ中は push を予約しない', _koAutoPushTimer === null);
  _tts.active = false;
  koScheduleAutoPush();
  T('読み上げていなければ予約する', _koAutoPushTimer !== null);
  clearTimeout(_koAutoPushTimer); _koAutoPushTimer = null;
  // 鉄則の側も同じ見かたで確かめる
  _koPullDone.delete(state.bookKey);
  koScheduleAutoPush();
  T('pull 前は予約もしない', _koAutoPushTimer === null);
  _koPullDone.add(state.bookKey);
  // 本を開いたときの自動 pull も設定に従う
  _kosync.autoSync = false; window.__koCalls = [];
  koAutoPullOnOpen();
  T('自動同期 OFF なら開いても取りに行かない', window.__koCalls.length === 0);
  _kosync.autoSync = false;
  window.fetch = window.__koRealFetch;   // 必ず戻す
})
.then(function () {
  // 完全削除で対応表からも消える（論理削除では消さない）
  var k = state.bookKey;
  _rlPurgeLocalData(k);
  T('完全削除で対応表からも消える', _koDocGet(k) === null);
})
.catch(function (e) {
  if (window.__koRealFetch) window.fetch = window.__koRealFetch;
  T('kosync 統合テストが例外なく終わる', false, String(e && e.message || e));
});
