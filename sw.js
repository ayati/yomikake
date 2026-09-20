/* yomikake Service Worker — Web Share Target 受信 ＋ アプリシェルのオフラインキャッシュ
 * 役割:
 *  1) Android の共有シートから POST された ePub を退避し、?shared=1 でページへ橋渡し
 *     （退避先は専用 IDB → 駄目なら Cache Storage。失敗時は ?shared=err&r=<理由> で返す）
 *  2) HTML ナビゲーションを network-first（更新即反映・圏外時のみキャッシュ）で提供しオフライン起動を可能にする
 * リリースで yomikake.html を更新したら VERSION を上げること（§運用メモ）。
 * ロールバック: このファイルを「全 caches 削除＋self.registration.unregister()」の空実装に差し替える。
 */
const VERSION = 'yomikake-shell-v2.24.0';
const SHELL = [
  './yomikake.html', './yomikake_ios.html',
  './manifest.webmanifest', './manifest_ios.webmanifest',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png'
];

// 共有の受け渡しに使う退避先。IDB が使えない端末／容量不足のとき Cache Storage へ逃がす。
// ページ側（yomikake.html の _SHARE_CACHE / _SHARE_STASH_PATH）と必ず同じ値にすること。
const SHARE_CACHE = 'yomikake-share-stash';
const SHARE_STASH_PATH = '__yomikake_share_stash';

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    try { const c = await caches.open(VERSION); await c.addAll(SHELL); } catch (e) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    // ⚠ SHARE_CACHE は共有ファイルの退避先。VERSION と違うからといって消さない
    await Promise.all(keys.filter(k => k !== VERSION && k !== SHARE_CACHE).map(k => caches.delete(k)));
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
