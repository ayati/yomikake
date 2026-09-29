/* yomikake Service Worker — Web Share Target 受信 ＋ アプリシェルのオフラインキャッシュ
 * 役割:
 *  1) Android の共有シートから POST された ePub を退避し、?shared=1 でページへ橋渡し
 *     （退避先は専用 IDB → 駄目なら Cache Storage。失敗時は ?shared=err&r=<理由> で返す）
 *  2) HTML ナビゲーションを network-first（更新即反映・圏外時のみキャッシュ）で提供しオフライン起動を可能にする
 *  3) 本文で使った Google Fonts の書体を丸ごと保存し、オフラインでも同じ書体で読めるようにする（直近 FONT_KEEP 書体）
 * リリースで yomikake.html を更新したら VERSION を上げること（§運用メモ）。
 * ロールバック: このファイルを「全 caches 削除＋self.registration.unregister()」の空実装に差し替える。
 */
const VERSION = 'yomikake-shell-v2.28.0';
const SHELL = [
  './yomikake.html', './yomikake_ios.html',
  './manifest.webmanifest', './manifest_ios.webmanifest',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png'
];

// 共有の受け渡しに使う退避先。IDB が使えない端末／容量不足のとき Cache Storage へ逃がす。
// ページ側（yomikake.html の _SHARE_CACHE / _SHARE_STASH_PATH）と必ず同じ値にすること。
const SHARE_CACHE = 'yomikake-share-stash';
const SHARE_STASH_PATH = '__yomikake_share_stash';

// Web フォントの保存先（tests/probe/offline-fonts.html で 4 環境を実測して決めた方式）。
// VERSION と別の名前にして、リリースのたびに消えないようにする（activate で除外）。
const FONT_CACHE = 'yomikake-fonts';
const FONT_INDEX_PATH = '__yomikake_font_index';  // どの書体の CSS がどのファイルを持つか・最終使用時刻
const FONT_KEEP = 3;                              // 保存しておく書体の数（日本語 1 書体 ≒ 124 ファイル・約 3.5MB）

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    try { const c = await caches.open(VERSION); await c.addAll(SHELL); } catch (e) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    // ⚠ SHARE_CACHE は共有ファイルの退避先、FONT_CACHE は保存したフォント。VERSION と違うからといって消さない
    await Promise.all(keys.filter(k => k !== VERSION && k !== SHARE_CACHE && k !== FONT_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 0) KOReader 同期 API は常にネットワーク直行（design_kosync.md §3-5）。
  //    Apache のリバースプロキシで同一オリジンになったため、放っておくと下の 3) の
  //    cache-first の射程に入る。今は素通しになるが、将来ランタイムキャッシュを足した
  //    瞬間に「しおりが古いまま返る」という壊れ方をするので先に除外しておく。
  if (url.pathname.startsWith('/kosync/')) return;

  // 1) 共有ターゲット受信（POST .../share-receive）: File を退避してから ?shared=1 へリダイレクト。
  //    失敗したら ?shared=err&r=<理由> で返す。理由コードはページ側がトーストに出す。
  //    ここを黙って err にすると、実機で「どこで切れたか」を調べる手段が無くなる。
  if (req.method === 'POST' && url.pathname.endsWith('share-receive')) {
    ev.respondWith((async () => {
      let reason = 'unknown';
      try {
        const got = await shareExtractFile(req);
        if (got.file) {
          const stash = await shareStash(got.file);
          if (stash === true) return shareRedirect('yomikake.html?shared=1');
          reason = stash;
        } else {
          reason = got.reason;
        }
      } catch (e) {
        reason = 'post:' + errName(e);
      }
      return shareRedirect('yomikake.html?shared=err&r=' + encodeURIComponent(reason));
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // 1.5) Google Fonts（本文 iframe の @import もここを通る — srcdoc の iframe は親の SW の管轄。4 環境で実測）
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    if (url.hostname === 'fonts.googleapis.com') {
      // 本文用の 1 書体の CSS だけを扱う。フォント選びの見本（22 書体まとめて 1 本）は
      // 丸ごと保存すると 22 書体ぶん落としに行くので、今までどおりネットに任せる
      if (!fontIsReadingCss(url)) return;
      ev.respondWith(fontCss(ev, req.url));
    } else {
      ev.respondWith(fontFile(req.url));
    }
    return;
  }

  // 2) ナビゲーション（HTML）: network-first → 失敗時にキャッシュ（圏外でもアプリ起動）
  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: true });
        return cached || (await caches.match('./yomikake.html')) || Response.error();
      }
    })());
    return;
  }

  // 3) 同一オリジンの静的資産（manifest / icon）: cache-first
  if (url.origin === self.location.origin) {
    ev.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try { return await fetch(req); } catch (e) { return Response.error(); }
    })());
  }
});

function errName(e) {
  if (!e) return 'null';
  return String((e && e.name) || e).slice(0, 60);
}

// どの段で固まったのかを実機で見分けられるようにする（黙って無応答にしない）
function shareTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(
    () => rej(new DOMException(label, 'TimeoutError')), ms))]);
}

function shareRedirect(path) {
  return Response.redirect(new URL(path, self.registration.scope).href, 303);
}

// 共有された File を取り出す。標準の formData() が使えない環境のために
// multipart/form-data を自前で解析する経路も持つ（body は clone しておく）。
// 取れなかったときは「何が届いていたか」（パート一覧・生の長さ）まで理由に載せる。
// 実機では POST は届くのにファイルパートだけ無い状態が起きていて、それが
// 「Chrome が実体を読めていない」のか「body ごと空」なのかを区別する必要がある。
async function shareExtractFile(req) {
  let clone = null;
  try { clone = req.clone(); } catch (e) {}
  let why = '', note = '';
  try {
    const form = await shareTimeout(req.formData(), 20000, 'formData');
    const f = form.get('epub') || shareFirstFile(form);
    if (f && typeof f !== 'string' && f.size) return { file: f, reason: '' };
    note = '/' + shareFormNote(form);
    why = f ? 'nofile:empty' : 'nofile:absent';
  } catch (e) {
    why = 'form:' + errName(e);
  }
  // フォールバック: 生の body から epub パートを切り出す
  if (clone) {
    try {
      const ct = (clone.headers.get('content-type') || '');
      const buf = await shareTimeout(clone.arrayBuffer(), 20000, 'raw');
      note += '/len=' + buf.byteLength +
              '/ct=' + (/multipart/i.test(ct) ? 'mp' : ((ct.split(';')[0] || 'none').slice(0, 24)));
      const f = shareParseMultipartBytes(new Uint8Array(buf), ct);
      if (f) return { file: f, reason: '' };
      why += '/raw:nopart';
      // 実機では「本文 75 バイト・パート 0 個」という形で届いた。枠だけ送られているのか、
      // 名前の無いパートを取り落としているのかは中身を見るしかない。
      // ⚠ 何も解釈できなかった小さい body のときだけ出す（利用者の共有内容を晒さない）。
      if (buf.byteLength <= 512 && /keys=none/.test(note))
        note += '/' + shareBodyPeek(new Uint8Array(buf));
    } catch (e) {
      why += '/raw:' + errName(e);
    }
  }
  return { file: null, reason: (why || 'nofile') + note };
}

// 解釈できなかった body の見た目（制御文字は記号に置き換える）。診断専用。
function shareBodyPeek(bytes) {
  try {
    return 'body=' + new TextDecoder().decode(bytes.subarray(0, 512))
      .replace(/\r/g, '<CR>').replace(/\n/g, '<LF>')
      .replace(/[^\x20-\x7e<>]/g, '.').slice(0, 200);
  } catch (e) { return 'body=?'; }
}

// 届いたフォームの中身の要約（名前:s=文字列長 / f=ファイルの長さ）。
// 'keys=none' なら body にパートが 1 つも無い＝Chrome が何も載せていない。
function shareFormNote(form) {
  const out = [];
  try {
    for (const e of form.entries()) {
      const v = e[1];
      out.push(e[0] + ':' + (typeof v === 'string' ? 's' + v.length : 'f' + v.size));
      if (out.length >= 4) break;
    }
  } catch (e) { return 'keys=?'; }
  return 'keys=' + (out.length ? out.join(',') : 'none');
}

// 名前が 'epub' でなくても、File らしきものが1つだけ来ていれば拾う
function shareFirstFile(form) {
  try {
    for (const v of form.values()) if (v && typeof v !== 'string' && v.size) return v;
  } catch (e) {}
  return null;
}

function shareBytesIndexOf(hay, needle, from) {
  const n0 = needle[0], last = hay.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    if (hay[i] !== n0) continue;
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

// multipart/form-data の最小パーサ。目的は「epub パートの実体を取り出す」ことだけで、
// 汎用実装ではない（quoted-printable も base64 も来ない前提＝共有ターゲットの仕様）。
async function shareParseMultipart(req) {
  const ct = (req.headers && req.headers.get('content-type')) || '';
  return shareParseMultipartBytes(new Uint8Array(await req.arrayBuffer()), ct);
}

function shareParseMultipartBytes(buf, ct) {
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct || '');
  if (!bm) return null;
  const boundary = (bm[1] || bm[2]).trim();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const delim = enc.encode('\r\n--' + boundary);
  let pos = shareBytesIndexOf(buf, enc.encode('--' + boundary), 0);
  if (pos < 0) return null;
  pos += boundary.length + 2;
  const crlfcrlf = enc.encode('\r\n\r\n');
  while (pos < buf.length) {
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break;          // '--' = 終端
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;       // 区切りの後ろの CRLF
    const hEnd = shareBytesIndexOf(buf, crlfcrlf, pos);
    if (hEnd < 0) break;
    const head = dec.decode(buf.subarray(pos, hEnd));
    const bStart = hEnd + 4;
    const next = shareBytesIndexOf(buf, delim, bStart);
    if (next < 0) break;
    const nameM = /name="([^"]*)"/i.exec(head);
    const fnM = /filename\*?=(?:UTF-8'')?"?([^";\r\n]*)"?/i.exec(head);
    if (fnM && (!nameM || nameM[1] === 'epub') && next > bStart) {
      const typeM = /content-type:\s*([^\r\n]+)/i.exec(head);
      let filename = fnM[1] || 'shared.epub';
      try { filename = decodeURIComponent(filename); } catch (e) {}
      return new File([buf.subarray(bStart, next)], filename,
                      { type: (typeM ? typeM[1].trim() : 'application/octet-stream') });
    }
    pos = next + delim.length;
  }
  return null;
}

// 退避: IDB → 失敗したら Cache Storage。true か、失敗理由の文字列を返す。
async function shareStash(file) {
  let e1 = null;
  try { await shareTimeout(shareIdbPut(file), 20000, 'idbPut'); return true; } catch (e) { e1 = e; }
  try {
    const c = await caches.open(SHARE_CACHE);
    const res = new Response(file, { headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-yomikake-name': encodeURIComponent(file.name || ''),
      'x-yomikake-saved': String(Date.now())
    } });
    const key = new URL(SHARE_STASH_PATH, self.registration.scope).href;
    await shareTimeout(c.put(key, res), 20000, 'cachePut');
    return true;
  } catch (e2) {
    return 'idb:' + errName(e1) + '/cache:' + errName(e2);
  }
}

// 共有受信用 IDB（ページ側が get+delete する）。ePub キャッシュの epub_viewer_files とは別 DB。
function shareIdbPut(file) {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open('epub_viewer_share', 1); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = ev => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending');
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new DOMException('blocked', 'InvalidStateError'));
    req.onsuccess = () => {
      try {
        const db = req.result;
        const tx = db.transaction('pending', 'readwrite');
        tx.objectStore('pending').put({ file, savedAt: Date.now() }, 'file');
        tx.oncomplete = () => { try { db.close(); } catch (e) {} resolve(); };
        tx.onerror = () => { try { db.close(); } catch (e) {} reject(tx.error); };
      } catch (e) { reject(e); }
    };
  });
}

// ══════════════════════════════════════════
//  Web フォントの保存（オフラインでも同じ書体で読む）
// ══════════════════════════════════════════
// 方式: 本文で書体を使ったら、その CSS が指すファイルを全部取っておく（日本語は 124 分割・約 3.5MB）。
//   使った分だけにすると、オフラインで初めて出る漢字だけ端末のフォントになって字体が混ざる。
//   直近 FONT_KEEP 書体を超えたら、いちばん長く使っていない書体から消す。
// ⚠ 取得は必ず mode:'cors' で取り直す。CSS は <link>/@import から、フォントは iOS だと no-cors
//   （中身の見えない opaque 応答）で来る。opaque のまま保存すると Chrome は 1 件ごとに数 MB 水増しして
//   容量を数える。Google Fonts は ACAO:* を返すので、CORS の応答を no-cors の要求に返してよい（実測済み）。

// 本文用の CSS か（family が 1 つだけ・text= による部分集合でない）
function fontIsReadingCss(url) {
  return url.pathname === '/css2' &&
         url.searchParams.getAll('family').length === 1 &&
         !url.searchParams.has('text');
}

// CSS が指すフォントファイルの URL（重複なし）
function fontCssUrls(cssText) {
  return Array.from(new Set(String(cssText || '').match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || []));
}

// 何を消すか。idx.fam = { cssUrl: { t: 最終使用, files: [...] } }。
// 新しい順に keep 書体を残し、残りの CSS と「残す書体が使っていない」ファイルを返す（純関数）
function fontEvictPlan(idx, keep) {
  const fam = (idx && idx.fam) || {};
  const order = Object.keys(fam).sort((a, b) => (fam[b].t || 0) - (fam[a].t || 0));
  const kept = order.slice(0, keep), dropCss = order.slice(keep);
  const keptFiles = new Set();
  for (const k of kept) for (const f of (fam[k].files || [])) keptFiles.add(f);
  const dropFiles = new Set();
  for (const k of dropCss) for (const f of (fam[k].files || [])) if (!keptFiles.has(f)) dropFiles.add(f);
  return { dropCss, dropFiles: Array.from(dropFiles) };
}

function fontIndexKey() { return new URL(FONT_INDEX_PATH, self.registration.scope).href; }
async function fontIndexLoad(cache) {
  try {
    const r = await cache.match(fontIndexKey());
    const j = r ? await r.json() : null;
    if (j && j.fam && typeof j.fam === 'object') return j;
  } catch (e) {}
  return { v: 1, fam: {} };
}
async function fontIndexSave(cache, idx) {
  try {
    await cache.put(fontIndexKey(), new Response(JSON.stringify(idx),
                    { headers: { 'content-type': 'application/json' } }));
  } catch (e) {}
}

// 保存対象のファイルか（どれかの書体の CSS に載っている）。SW が起きるたびに索引から作り直す
let _fontTracked = null;
function fontSetTracked(idx) {
  _fontTracked = new Set();
  for (const k of Object.keys(idx.fam)) for (const f of (idx.fam[k].files || [])) _fontTracked.add(f);
}
async function fontIsTracked(cache, url) {
  if (!_fontTracked) fontSetTracked(await fontIndexLoad(cache));
  return _fontTracked.has(url);
}

// 索引の読み書きは 1 本ずつ（章をめくるたびに CSS が来るので、並ぶと書き戻しで先祖返りする）
let _fontQueue = Promise.resolve();
function fontSerial(fn) {
  const p = _fontQueue.then(fn, fn);
  _fontQueue = p.catch(() => {});
  return p;
}

const FONT_PREFETCH_DELAY = 8000;   // 書体を選んでから丸ごと先読みを始めるまで（見比べている間は落とさない）
const FONT_TOUCH_MIN = 60000;       // 「最近使った」の書き戻しの最小間隔（毎章索引を書き直さない）
const _fontPrefetched = new Set();  // この SW の寿命の中で先読みを済ませた CSS（毎章 124 件を照合しない）
const _fontPending = new Set();     // 先読みを待っている CSS（章送りのたびに予約を重ねない）
const _fontRevalidated = new Set(); // この SW の寿命の中で CSS を取り直した（Google 側の更新を拾う）

function fontSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 書体を使った（CSS をネットから取れた）: 索引を更新 → 溢れた書体・版上げで外れたファイルを消す
async function fontTrack(cache, cssUrl, cssText) {
  const idx = await fontIndexLoad(cache);
  const files = fontCssUrls(cssText);
  const before = (idx.fam[cssUrl] && idx.fam[cssUrl].files) || [];
  idx.fam[cssUrl] = { t: Date.now(), files };
  const plan = fontEvictPlan(idx, FONT_KEEP);
  for (const k of plan.dropCss) { delete idx.fam[k]; _fontPrefetched.delete(k); }
  await fontIndexSave(cache, idx);
  fontSetTracked(idx);
  // Google が書体の版を上げると CSS の指すファイル URL が丸ごと変わる。古い版は
  // どの書体の一覧にも載らなくなり追い出しの対象からも外れるので、ここで消す
  const stale = before.filter(f => !_fontTracked.has(f));
  if (stale.length) _fontPrefetched.delete(cssUrl);
  await Promise.all(plan.dropCss.concat(plan.dropFiles, stale).map(k => cache.delete(k).catch(() => {})));
}

// 少し待ってから丸ごと先読みする。待っている間に別の書体へ切り替えられたら落とさない
// （フォントを見比べるたびに 1 書体 3.5MB を取りに行かないように）
async function fontPrefetchLater(cache, cssUrl) {
  if (_fontPrefetched.has(cssUrl) || _fontPending.has(cssUrl)) return;
  _fontPending.add(cssUrl);
  try {
    await fontSleep(FONT_PREFETCH_DELAY);
    const idx = await fontIndexLoad(cache);
    const me = idx.fam[cssUrl];
    if (!me) return;
    for (const k of Object.keys(idx.fam)) if ((idx.fam[k].t || 0) > (me.t || 0)) return;
    _fontPrefetched.add(cssUrl);
    await fontPrefetch(cache, me.files || []);
  } finally {
    _fontPending.delete(cssUrl);
  }
}

// 足りないファイルを 4 本並行で取る。失敗しても次に書体を使ったとき（SW の再起動後）にまた埋める
async function fontPrefetch(cache, files) {
  const q = [];
  for (const f of files) if (!(await cache.match(f))) q.push(f);
  async function worker() {
    while (q.length) {
      const f = q.shift();
      try {
        const r = await fetch(f, { mode: 'cors', credentials: 'omit' });
        // 先読みの間に追い出された書体のファイルは置かない（索引に載らない孤児になる）
        if (r.ok && _fontTracked && _fontTracked.has(f)) await cache.put(f, r);
      } catch (e) {
        // 通信断・容量不足。残りも同じ結果になるので打ち切る
        q.length = 0;
        _fontPrefetched.clear();
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// CSS をネットから取って保存し、索引を更新する
async function fontCssFetch(cache, cssUrl) {
  const res = await fetch(cssUrl, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) return res;
  const text = await res.clone().text();
  try { await cache.put(cssUrl, res.clone()); } catch (e) {}
  await fontSerial(() => fontTrack(cache, cssUrl, text));
  return res;
}

// CSS: 保存分があればそれを即座に返し（章送りのたびに待たせない・つながらない Wi-Fi でも固まらない）、
// Google 側の更新は SW の寿命ごとに 1 回だけ裏で取り直す。保存分が無ければネットから
async function fontCss(ev, cssUrl) {
  let cache = null;
  try { cache = await caches.open(FONT_CACHE); } catch (e) {}
  const hit = cache && await cache.match(cssUrl);
  if (hit) {
    ev.waitUntil((async () => {
      await fontSerial(async () => {
        const idx = await fontIndexLoad(cache);
        const me = idx.fam[cssUrl];
        // オフラインで使った書体も「最近使った」に数える（機内モードの間に追い出されないように）
        if (me && Date.now() - (me.t || 0) > FONT_TOUCH_MIN) { me.t = Date.now(); await fontIndexSave(cache, idx); }
        if (!_fontTracked) fontSetTracked(idx);
      });
      if (!_fontRevalidated.has(cssUrl)) {
        _fontRevalidated.add(cssUrl);
        try { await fontCssFetch(cache, cssUrl); } catch (e) { _fontRevalidated.delete(cssUrl); }
      }
      await fontPrefetchLater(cache, cssUrl);
    })().catch(() => {}));
    return hit;
  }
  try {
    if (!cache) return await fetch(cssUrl, { mode: 'cors', credentials: 'omit' });
    const res = await fontCssFetch(cache, cssUrl);
    if (res.ok) {
      _fontRevalidated.add(cssUrl);
      ev.waitUntil(fontPrefetchLater(cache, cssUrl).catch(() => {}));
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}

// フォントファイル: cache-first（URL に版が入っていて中身は変わらない）。
// 保存するのは保存対象の書体のものだけ（見本の 22 書体ぶんが溜まらないように）
async function fontFile(fileUrl) {
  let cache = null;
  try { cache = await caches.open(FONT_CACHE); } catch (e) {}
  const hit = cache && await cache.match(fileUrl);
  if (hit) return hit;
  try {
    const res = await fetch(fileUrl, { mode: 'cors', credentials: 'omit' });
    if (res.ok && cache && await fontIsTracked(cache, fileUrl)) {
      try { await cache.put(fileUrl, res.clone()); } catch (e) {}
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}
