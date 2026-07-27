/* yomikake Service Worker — Web Share Target 受信 ＋ アプリシェルのオフラインキャッシュ
 * 役割:
 *  1) Android の共有シートから POST された ePub を専用 IDB に一時保存し、?shared=1 でページへ橋渡し
 *  2) HTML ナビゲーションを network-first（更新即反映・圏外時のみキャッシュ）で提供しオフライン起動を可能にする
 * リリースで yomikake.html を更新したら VERSION を上げること（§運用メモ）。
 * ロールバック: このファイルを「全 caches 削除＋self.registration.unregister()」の空実装に差し替える。
 */
const VERSION = 'yomikake-shell-v2.15.0';
const SHELL = [
  './yomikake.html', './yomikake_ios.html',
  './manifest.webmanifest', './manifest_ios.webmanifest',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    try { const c = await caches.open(VERSION); await c.addAll(SHELL); } catch (e) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 1) 共有ターゲット受信（POST .../share-receive）: File を専用 IDB に保存し ?shared=1 へリダイレクト
  if (req.method === 'POST' && url.pathname.endsWith('share-receive')) {
    ev.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.get('epub');
        if (file && file.size) {
          await shareIdbPut(file);
          return Response.redirect(new URL('yomikake.html?shared=1', self.registration.scope).href, 303);
        }
      } catch (e) {}
      return Response.redirect(new URL('yomikake.html?shared=err', self.registration.scope).href, 303);
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
    req.onsuccess = () => {
      try {
        const db = req.result;
        const tx = db.transaction('pending', 'readwrite');
        tx.objectStore('pending').put({ file, savedAt: Date.now() }, 'file');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    };
  });
}
