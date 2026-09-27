/* offline-fonts.html 専用の検査用 Service Worker（本番の sw.js とは無関係）
 * スコープは tests/probe/ 配下だけ。yomikake 本体（/book/ 直下）の SW には触れない。
 * やること:
 *  - 見えたリクエストを全部ページへ報告する（どのクライアント＝親か srcdoc iframe か も添える）
 *  - Google Fonts を保存する（sw.js に入れる予定の方式そのもの）
 *      fonts.googleapis.com（CSS）: network-first → 失敗したら保存分
 *      fonts.gstatic.com（woff2）  : cache-first（URL に版が入っていて中身が変わらない）
 *    CSS は <link> や @import からだと no-cors（中身の見えない opaque 応答）で来る。
 *    opaque のまま保存すると Chrome は 1 件あたり数 MB の水増しで容量を数えるので、
 *    mode:'cors' で取り直して保存する（Google Fonts は ACAO:* を返す）。
 *  - 検査ページ自身も保存して、機内モードでも開けるようにする
 */
const FONT_CACHE = 'probe-offline-fonts';
const PAGE_CACHE = 'probe-offline-page';

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    try { const c = await caches.open(PAGE_CACHE); await c.addAll(['./offline-fonts.html']); } catch (e) {}
    self.skipWaiting();
  })());
});
self.addEventListener('activate', ev => { ev.waitUntil(self.clients.claim()); });

async function report(ev, info) {
  try {
    let cu = '';
    const id = ev.clientId || ev.resultingClientId;
    if (id) { const c = await self.clients.get(id); cu = c ? c.url : '(不明)'; }
    const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    const msg = Object.assign({ type: 'probe-fetch', client: cu,
                                dest: ev.request.destination, mode: ev.request.mode }, info);
    for (const c of all) c.postMessage(msg);
  } catch (e) {}
}

function isFontHost(u) { return u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com'; }

self.addEventListener('message', ev => {
  const d = ev.data || {};
  if (d.type === 'clear-fonts') {
    ev.waitUntil(caches.delete(FONT_CACHE).then(() => ev.source && ev.source.postMessage({ type: 'cleared' })));
  }
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  let url; try { url = new URL(req.url); } catch (e) { return; }

  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try { const r = await fetch(req); report(ev, { url: req.url, via: 'net' }); return r; }
      catch (e) {
        const c = await caches.match('./offline-fonts.html', { ignoreSearch: true });
        report(ev, { url: req.url, via: c ? 'cache' : 'fail' });
        return c || Response.error();
      }
    })());
    return;
  }

  if (!isFontHost(url) || req.method !== 'GET') return;

  ev.respondWith((async () => {
    const cache = await caches.open(FONT_CACHE);
    const key = req.url;
    if (url.hostname === 'fonts.gstatic.com') {
      const hit = await cache.match(key);
      if (hit) { report(ev, { url: key, via: 'cache' }); return hit; }
      try {
        const res = await fetch(key, { mode: 'cors', credentials: 'omit' });
        if (res.ok) await cache.put(key, res.clone());
        report(ev, { url: key, via: 'net', size: Number(res.headers.get('content-length')) || 0 });
        return res;
      } catch (e) { report(ev, { url: key, via: 'fail', err: String(e && e.name) }); return Response.error(); }
    }
    // fonts.googleapis.com（CSS）
    try {
      const res = await fetch(key, { mode: 'cors', credentials: 'omit' });
      if (res.ok) await cache.put(key, res.clone());
      report(ev, { url: key, via: 'net' });
      return res;
    } catch (e) {
      const hit = await cache.match(key);
      report(ev, { url: key, via: hit ? 'cache' : 'fail', err: String(e && e.name) });
      return hit || Response.error();
    }
  })());
});
