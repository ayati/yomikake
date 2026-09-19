// Web Share Target（Android の共有シート受け取り）の検査
//
// 発端: 実機で「共有されたファイルを開けませんでした」だけが出て、3 箇所ある失敗点の
//      どれで切れたのか分からなかった（2026-09）。理由コードを持ち帰れるようにした。
//
// ここで見るのは (1) sw.js とページ側の定数が一致しているか (2) multipart の自前パーサ
// (3) 失敗告知が理由と次の一手を出すか (4) iOS 版に受信コードが紛れ込んでいないか。
// **実 SW を通した往復は file:// では動かない**（SW も Cache Storage もセキュアコンテキスト
// 限定）ので tests/lib/share-e2e.sh が localhost で別途担保する。

var IS_IOS = (typeof _handleKeys === 'undefined');

// ── i18n（4 言語・両ファイル） ───────────────────────────────
['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lg) {
  ['toast.shareFailed', 'toast.shareFailedPick', 'toast.shareFailedRetry'].forEach(function (k) {
    var v = I18N[lg] && I18N[lg][k];
    T(lg + ': ' + k + ' がある', typeof v === 'string' && v.length > 0);
    T(lg + ': ' + k + ' が理由を差し込める', typeof v === 'string' && v.indexOf('{reason}') >= 0);
  });
});

// ── iOS 版には受信コードを入れない（design_mobile_open_ux.md §Phase 2） ──
if (IS_IOS) {
  T('iOS 版は共有受信コードを持たない',
    typeof _shareTake === 'undefined' && typeof showShareFailToast === 'undefined');
}

// ── sw.js を読み込んで中身を検査する ────────────────────────
fetch('sw.js').then(function (r) { return r.text(); }).then(function (src) {
  T('sw.js を読める', src.length > 500);

  // 失敗理由を返す形になっているか（黙って err にしない）
  T('sw: 失敗理由を URL に載せる', src.indexOf('shared=err&r=') > 0);
  T('sw: 退避は IDB → Cache Storage の二段', /shareStash/.test(src) && /SHARE_CACHE/.test(src));
  T('sw: formData が駄目なら自前で multipart を解く', /shareParseMultipart/.test(src));
  T('sw: 各段にタイムアウトがある', /shareTimeout\(/.test(src));
  // ⚠ activate は VERSION 以外のキャッシュを消す。退避先を除外し忘れると
  //   共有の直後に SW が更新されただけでファイルが消える
  T('sw: activate が退避キャッシュを消さない', /k !== VERSION && k !== SHARE_CACHE/.test(src));

  var sw;
  try {
    sw = new Function(src + '\n; return {p: shareParseMultipart, idx: shareBytesIndexOf,' +
                            ' note: shareFormNote,' +
                            ' C: SHARE_CACHE, P: SHARE_STASH_PATH, V: VERSION};')();
  } catch (e) { sw = null; }
  T('sw.js をページ内で評価できる', !!sw, sw ? '' : '評価に失敗');
  if (!sw) return;

  T('sw: 退避キャッシュ名が VERSION と別',  sw.C !== sw.V && sw.C.length > 0);

  // 「何が届いていたか」の要約。実機では POST は届くのにファイルパートだけ
  // 無い状態が起きていて、keys= が空か否かがその切り分けの材料になる
  var fd = new FormData();
  T('note: 空のフォームは keys=none', sw.note(fd) === 'keys=none', sw.note(fd));
  fd.append('title', 'abc');
  fd.append('epub', new File([new Uint8Array(5)], 'x.epub'));
  T('note: 文字列とファイルを区別する', sw.note(fd) === 'keys=title:s3,epub:f5', sw.note(fd));

  // ページ側との定数一致。ここがずれると受け渡しが黙って壊れる
  if (!IS_IOS) {
    T('定数一致: キャッシュ名',   _SHARE_CACHE === sw.C,      _SHARE_CACHE + ' / ' + sw.C);
    T('定数一致: 退避パス',       _SHARE_STASH_PATH === sw.P, _SHARE_STASH_PATH + ' / ' + sw.P);
  }

  // ── multipart パーサ ────────────────────────────────
  var enc = new TextEncoder();
  function body(parts) {  // parts: [{head, bytes}]
    var B = '----yomikakeTest123';
    var chunks = [];
    parts.forEach(function (p) {
      chunks.push(enc.encode('--' + B + '\r\n' + p.head + '\r\n\r\n'));
      chunks.push(p.bytes);
      chunks.push(enc.encode('\r\n'));
    });
    chunks.push(enc.encode('--' + B + '--\r\n'));
    var n = 0; chunks.forEach(function (c) { n += c.length; });
    var out = new Uint8Array(n), o = 0;
    chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return { buf: out.buffer, ct: 'multipart/form-data; boundary=' + B };
  }
  function fakeReq(b) {
    return { headers: { get: function (k) { return /content-type/i.test(k) ? b.ct : null; } },
             arrayBuffer: function () { return Promise.resolve(b.buf); } };
  }

  var NAME = '学校を休みたかった俺に嘘告した結果、仕掛けた側が大炎上した.epub';
  var data = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 8, 7, 0x0d, 0x0a, 0x2d, 0x2d, 6]); // CRLF/-- を含む
  var one = body([{ head: 'Content-Disposition: form-data; name="epub"; filename="' + NAME + '"\r\n' +
                          'Content-Type: application/epub+zip', bytes: data }]);

  return sw.p(fakeReq(one)).then(function (f) {
    T('parse: File が返る', !!f && typeof f.arrayBuffer === 'function');
    T('parse: ファイル名を保つ', !!f && f.name === NAME, f && f.name);
    T('parse: MIME を保つ', !!f && f.type === 'application/epub+zip', f && f.type);
    T('parse: 長さが一致する', !!f && f.size === data.length, f && f.size);
    return f.arrayBuffer();
  }).then(function (ab) {
    var got = new Uint8Array(ab), same = got.length === data.length;
    for (var i = 0; same && i < data.length; i++) if (got[i] !== data[i]) same = false;
    T('parse: 中身が 1 バイトも変わらない', same);

    // 前にテキストパートがあっても epub を拾う
    var two = body([
      { head: 'Content-Disposition: form-data; name="title"', bytes: enc.encode('hello') },
      { head: 'Content-Disposition: form-data; name="epub"; filename="b.epub"\r\n' +
              'Content-Type: application/octet-stream', bytes: data }
    ]);
    return sw.p(fakeReq(two));
  }).then(function (f) {
    T('parse: テキストパートを飛ばして epub を拾う', !!f && f.name === 'b.epub' && f.size === data.length);
    // boundary が無ければ null（例外にしない）
    return sw.p({ headers: { get: function () { return 'application/octet-stream'; } },
                  arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(0)); } });
  }).then(function (f) {
    T('parse: boundary が無ければ null', f === null);
    // 実体が空のパートは拾わない（0 バイトを掴んで「開けない本」にしない）
    return sw.p(fakeReq(body([{ head: 'Content-Disposition: form-data; name="epub"; filename="e.epub"',
                                bytes: new Uint8Array(0) }])));
  }).then(function (f) {
    T('parse: 空の実体は拾わない', f === null);
  });
}).catch(function (e) {
  T('sw.js の検査が例外で落ちない', false, String(e));
});

// ── 失敗告知（yomikake.html のみ） ─────────────────────────
if (!IS_IOS) {
  T('_shareTake がある',        typeof _shareTake === 'function');
  T('_shareClear がある',       typeof _shareClear === 'function');
  T('_shareOpen がある',        typeof _shareOpen === 'function');
  T('showShareFailToast がある', typeof showShareFailToast === 'function');
  // 退避を覗くだけで消さない（消してから開くと、失敗した共有を再試行できない）
  T('_shareIdbPeek は readonly で読む', /readonly/.test(String(_shareIdbPeek)));
  T('_shareIdbPeek は delete しない',  !/delete\(/.test(String(_shareIdbPeek)));

  var el = document.getElementById('toast');
  _sharedPendingFile = null;
  showShareFailToast('form:TypeError');
  T('失敗トーストが出る', el.classList.contains('show'));
  T('理由コードが文面に出る', el.textContent.indexOf('form:TypeError') >= 0, el.textContent);
  T('実体が無いときはファイル選択を促す',
    el.textContent === t('toast.shareFailedPick', { reason: 'form:TypeError' }), el.textContent);
  T('タップできる', el.classList.contains('toast-action') && !!el._actionHandler);

  _sharedPendingFile = new File([new Uint8Array([0x50, 0x4b])], 'x.epub');
  showShareFailToast('load:Error');
  T('実体があるときは再試行を促す',
    el.textContent === t('toast.shareFailedRetry', { reason: 'load:Error' }), el.textContent);
  _sharedPendingFile = null;
  _clearToastAction(el); el.classList.remove('show');
}
