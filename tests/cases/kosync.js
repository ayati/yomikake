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
