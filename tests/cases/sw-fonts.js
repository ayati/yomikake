// Web フォントのオフライン保存（sw.js）と、ヘルプの「オフラインで使うとき」
//
// sw.js を読み込んで判定関数を直接叩く（share-receive.js と同じ作法）。
// 実際に SW が srcdoc の iframe の要求を拾うか・機内モードで保存分が使われるかは
// tests/probe/offline-fonts.html で 4 環境を実測済み（headless では Google へ出られるとは限らない）。

(async function () {
  var src = '';
  try { src = await (await fetch('sw.js')).text(); } catch (e) {}
  T('sw.js を読める', src.length > 500);

  // ⚠ activate は VERSION 以外のキャッシュを消す。除外し忘れるとリリースのたびにフォントが消える
  T('sw: activate が保存したフォントを消さない', /k !== FONT_CACHE/.test(src));
  // 見本（22 書体まとめて 1 本の CSS）まで丸ごと先読みすると 22 書体ぶん落としに行く
  T('sw: 本文用の CSS だけを扱う', /if \(!fontIsReadingCss\(url\)\) return;/.test(src));
  // opaque のまま保存すると Chrome は 1 件ごとに数 MB 水増しして容量を数える（iOS はフォントも no-cors で来る）
  T('sw: フォントは CORS で取り直して保存する', (src.match(/mode: 'cors', credentials: 'omit'/g) || []).length >= 3);

  var sw = null;
  try {
    sw = new Function(src + '\n; return {isCss: fontIsReadingCss, urls: fontCssUrls, plan: fontEvictPlan,' +
                            ' F: FONT_CACHE, K: FONT_KEEP, C: SHARE_CACHE, V: VERSION};')();
  } catch (e) { sw = null; }
  T('sw.js をページ内で評価できる', !!sw);
  if (!sw) return;

  T('sw: フォントの保存先は VERSION・共有の退避先と別', sw.F !== sw.V && sw.F !== sw.C && sw.F.length > 0);
  T('sw: 保存する書体は 3', sw.K === 3);

  // 本文が使う URL はすべて「本文用」と判定される（FONT_URLS を増やしたときの歯止め）
  var keys = Object.keys(FONT_URLS), bad = keys.filter(function (k) { return !sw.isCss(new URL(FONT_URLS[k])); });
  T('FONT_URLS の全 ' + keys.length + ' 書体が本文用の CSS と判定される', keys.length > 10 && bad.length === 0, bad.join(','));
  T('見本用のまとめ CSS は対象外',
    !sw.isCss(new URL('https://fonts.googleapis.com/css2?family=Klee+One&family=Lora&display=swap')));
  T('text= の部分集合 CSS は対象外',
    !sw.isCss(new URL('https://fonts.googleapis.com/css2?family=Klee+One&text=abc')));
  T('css2 以外のパスは対象外', !sw.isCss(new URL('https://fonts.googleapis.com/css?family=Klee+One')));

  var css = "@font-face{src:url(https://fonts.gstatic.com/s/a/v1/x.0.woff2) format('woff2')}\n" +
            "@font-face{src:url(https://fonts.gstatic.com/s/a/v1/x.1.woff2) format('woff2')}\n" +
            "@font-face{src:url(https://fonts.gstatic.com/s/a/v1/x.0.woff2) format('woff2')}";
  var u = sw.urls(css);
  T('CSS からファイル URL を重複なしで拾う', u.length === 2 && u[0].indexOf('x.0.woff2') > 0 && u[1].indexOf('x.1.woff2') > 0, JSON.stringify(u));
  T('空の CSS は空配列', sw.urls('').length === 0 && sw.urls(null).length === 0);

  // 追い出し: 新しい順に 3 書体を残す。残す書体と共有しているファイルは消さない
  var idx = { fam: {
    A: { t: 1, files: ['a1', 'shared'] },
    B: { t: 4, files: ['b1'] },
    C: { t: 3, files: ['c1', 'shared'] },
    D: { t: 2, files: ['d1'] },
  } };
  var p = sw.plan(idx, 3);
  T('いちばん古い書体の CSS を消す', p.dropCss.length === 1 && p.dropCss[0] === 'A', JSON.stringify(p.dropCss));
  T('消すのはその書体だけのファイル', p.dropFiles.length === 1 && p.dropFiles[0] === 'a1', JSON.stringify(p.dropFiles));
  var p2 = sw.plan({ fam: { A: { t: 1, files: ['a'] } } }, 3);
  T('3 書体以下なら何も消さない', p2.dropCss.length === 0 && p2.dropFiles.length === 0);
  T('索引が壊れていても落ちない', sw.plan(null, 3).dropCss.length === 0 && sw.plan({}, 3).dropFiles.length === 0);

  // ── ヘルプ: オフラインでの制限（4 言語） ──
  // 本の目印はファイルごとに違う（本体は ✈ バッジ、iOS 版は「📂 続きから（直接）」）ので、
  // そのファイルで実際に出るラベルを引用していることまで見る
  ['ja', 'en', 'zh-TW', 'zh-CN'].forEach(function (lang) {
    var b = I18N[lang]['help.body'] || '';
    var mark = I18N[lang]['readingList.offline'] || I18N[lang]['readingList.openCached'];
    T('help(' + lang + '): オフラインの節がある', b.indexOf('📴') >= 0);
    T('help(' + lang + '): 本の目印がこのファイルの表示と一致', !!mark && b.indexOf(mark) >= 0, mark);
    T('help(' + lang + '): Web フォントは直近 3 書体', /Noto Serif JP/.test(b) && /3/.test(b.slice(b.indexOf('📴'))));
    T('help(' + lang + '): ネット経由の音声が出ないことを書く', b.indexOf('Google 日本語') >= 0);
    T('help(' + lang + '): Drive は接続が戻ってから送る', /Google Drive/.test(b.slice(b.indexOf('📴'))));
  });

  // ── 保存の中身（self / caches / fetch を差し替えて、偽のキャッシュで動かす） ──
  function fakeCache() {
    var m = new Map();
    return { m: m,
      match: function (k) { k = typeof k === 'string' ? k : k.url; return Promise.resolve(m.has(k) ? m.get(k).clone() : undefined); },
      put: function (k, r) { m.set(typeof k === 'string' ? k : k.url, r); return Promise.resolve(); },
      delete: function (k) { return Promise.resolve(m.delete(k)); } };
  }
  var fc = fakeCache(), fetches = [], fetchMode = 'hang';
  var fakeSelf = { registration: { scope: 'https://example.test/book/' }, addEventListener: function () {},
                   location: { origin: 'https://example.test' } };
  var fakeCaches = { open: function () { return Promise.resolve(fc); } };
  var fakeFetch = function (u) {
    fetches.push(String(u));
    if (fetchMode === 'hang') return new Promise(function () {});
    return Promise.reject(new TypeError('Failed to fetch'));
  };
  var s2 = null;
  try {
    s2 = new Function('self', 'caches', 'fetch', src + '\n; return {track: fontTrack, css: fontCss, load: fontIndexLoad,' +
      ' save: fontIndexSave, pf: _fontPrefetched, key: fontIndexKey};')(fakeSelf, fakeCaches, fakeFetch);
  } catch (e) { s2 = null; }
  T('sw.js を差し替えた環境で評価できる', !!s2);
  if (!s2) return;

  function cssOf(files) { return files.map(function (f) { return '@font-face{src:url(' + f + ')}'; }).join('\n'); }
  var G = 'https://fonts.gstatic.com/s/';
  var A = 'https://fonts.googleapis.com/css2?family=A', B = 'https://fonts.googleapis.com/css2?family=B';

  // 版上げ: 同じ CSS が別のファイル群を指すようになったら、古い版のファイルを消す（共有中のものは残す）
  // 使用時刻（ミリ秒）で新旧を決めるので、記録の間を空ける
  function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }
  await s2.track(fc, B, cssOf([G + 'b/v1/1.woff2', G + 'shared.woff2']));
  await tick();
  await s2.track(fc, A, cssOf([G + 'a/v1/1.woff2', G + 'a/v1/2.woff2', G + 'shared.woff2']));
  [G + 'a/v1/1.woff2', G + 'a/v1/2.woff2', G + 'shared.woff2', G + 'b/v1/1.woff2'].forEach(function (f) { fc.m.set(f, new Response('x')); });
  s2.pf.add(A);
  await tick();
  await s2.track(fc, A, cssOf([G + 'a/v2/1.woff2', G + 'shared.woff2']));
  T('版上げで外れた古いファイルを消す', !fc.m.has(G + 'a/v1/1.woff2') && !fc.m.has(G + 'a/v1/2.woff2'));
  T('ほかの書体と共有しているファイルは残す', fc.m.has(G + 'shared.woff2') && fc.m.has(G + 'b/v1/1.woff2'));
  T('版上げしたら先読みをやり直す', !s2.pf.has(A));
  var ix = await s2.load(fc);
  T('索引は新しい版のファイルを持つ', ix.fam[A].files.length === 2 && ix.fam[A].files[0].indexOf('/v2/') > 0);

  // 追い出した書体は「先読み済み」から外す（同じ SW の寿命の中で戻ってきたら丸ごと取り直す）
  var C = 'https://fonts.googleapis.com/css2?family=C', D = 'https://fonts.googleapis.com/css2?family=D';
  s2.pf.add(B);
  await tick();
  await s2.track(fc, C, cssOf([G + 'c.woff2']));
  await tick();
  await s2.track(fc, D, cssOf([G + 'd.woff2']));
  ix = await s2.load(fc);
  T('4 書体目で最も古い書体を追い出す', !ix.fam[B] && !!ix.fam[A] && !!ix.fam[C] && !!ix.fam[D], Object.keys(ix.fam).join(','));
  T('追い出した書体は先読み済みから外す', !s2.pf.has(B));
  T('追い出した書体だけのファイルを消す', !fc.m.has(G + 'b/v1/1.woff2'));

  // 保存分がある CSS は、ネットが固まっていても（つながらない Wi-Fi）待たずに返す
  fc.m.set(A, new Response('@font-face{}', { headers: { 'content-type': 'text/css' } }));
  fetchMode = 'hang'; fetches.length = 0;
  var waits = [];
  var got = await Promise.race([
    s2.css({ waitUntil: function (p) { waits.push(p); } }, A).then(function (r) { return r ? 'hit' : 'none'; }),
    new Promise(function (r) { setTimeout(function () { r('timeout'); }, 1000); })]);
  T('保存分の CSS は通信を待たずに返す', got === 'hit', got);

  // 保存分が無く通信も失敗 → エラー応答（保存分をでっち上げない）
  fetchMode = 'fail';
  var r5 = await s2.css({ waitUntil: function () {} }, 'https://fonts.googleapis.com/css2?family=Z');
  T('保存分が無くオフラインならエラー応答', r5 && r5.type === 'error');
  T('先読みは待ってから（見比べ中に落とさない）', /await fontSleep\(FONT_PREFETCH_DELAY\)/.test(src));
  T('先読み中に追い出された書体のファイルは置かない', /_fontTracked\.has\(f\)\) await cache\.put/.test(src));
})();
