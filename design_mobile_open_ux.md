# 設計書：モバイルのファイルオープン改善（Phase 1: キャッシュ拡大 ／ Phase 2: PWA 化＋共有ターゲット）

作成: 2026-07-06 ／ 対象: `yomikake.html` / `yomikake_ios.html` 両ファイル＋新規デプロイファイル
バージョン計画: Phase 1 = v2.5.0、Phase 2 = v2.6.0（独立リリース）

## 0. 目的・ユースケース

Android（および iOS）で「読みたい本を開くまで」の摩擦を減らす。

- 現状、読みかけリストからの直接再開（ワンタップ）は **IndexedDB キャッシュ 3 冊**に入っている本だけ。
  溢れた本はシステムのファイルピッカー（SAF）行きになり、数十個の似た長タイトルの
  Web 小説 ePub から目当てを探すのが苦痛。
- ピッカーに検索語を渡す Web API は**存在しない**（`accept` の拡張子フィルタのみ・適用済み）。
  → ピッカーを「マシにする」のではなく「**出さなくする**」方向で解決する。

| Phase | 内容 | 効果範囲 |
|-------|------|---------|
| **1** | ePub キャッシュを 3 冊 → 20 冊＋総容量バジェット化 | Android・iOS・PC すべて。リストからの再開がほぼ常にワンタップに |
| **2** | PWA 化（manifest＋Service Worker）＋ Web Share Target | Android：ファイラーの「共有」から yomikake で直接開ける。全 OS：オフライン起動 |

## 1. 現状（実装確認済み）

- **キャッシュ**: `EPUB_CACHE_DB='epub_viewer_files'`（IDB v1・store `files`）。値は
  `{ buf: ArrayBuffer, name, size, type, savedAt }` — **`size` は既に保存済み**。
  `EPUB_CACHE_LIMIT = 3`、`cacheEpubFile()` が put 前に while ループで
  `evictOldestEpubCache()`（LRU 基準 = `epub_pos_*` の `lastOpenedAt`）、
  QuotaExceeded 時は 1 件 evict → 1 回リトライ。設定パネル `#cache-group` に件数＋
  `navigator.storage.estimate()` の概算使用量＋クリアボタンあり。
- **Android のピッカー経路**: `showOpenFilePicker` は Android 非対応のため
  `<input type="file" accept=".epub,.kepub">` にフォールバック。
- **PWA 資産**: manifest / Service Worker / アイコンは**未整備**（ゼロから追加）。
- **デプロイ**: `https://www.ayati.com/book/` に HTML 2 枚を置く静的ホスティング。

---

## Phase 1：ePub キャッシュ拡大（件数＋容量バジェット）

### 2.1 方針

- リフロー Web 小説は 1 冊 0.5〜3MB 程度 → 件数を増やしても軽い。
  FXL マンガは 1 冊 50〜300MB → **件数だけ**上げると数冊で数百 MB に膨らむ。
- よって **「件数上限」と「総容量バジェット」の二重制限**にする。どちらかを超えたら LRU 削除。

```js
const EPUB_CACHE_LIMIT     = 20;    // 最大件数（旧: 3）
const EPUB_CACHE_BUDGET_MB = 300;   // 総容量バジェット（MB）
```

- 20 冊 × 小説なら 〜60MB、マンガ混在でも 300MB 止まり。Android Chrome / iOS Safari の
  オリジン別クォータに対して安全圏。

### 2.2 サイズ台帳 `epub_cache_index`（localStorage・新規キー）

総容量の判定に各エントリのサイズが必要だが、IDB から `getAll()` すると全 ArrayBuffer が
メモリに乗ってしまう（最大 300MB）。**IDB スキーマは触らず**、localStorage に軽量な
サイズ台帳を持つ：

```jsonc
// epub_cache_index（同期対象外・端末ローカル）
{ "epub_pos_タイトル__著者": { "size": 1843200 }, ... }
```

- **書込み**: `cacheEpubFile()` の put 成功後に upsert。
- **削除**: `_idbDelete()` を呼ぶ全経路（`evictOldestEpubCache` / `doDeleteBook` /
  `loadEpubFromCache` のステイル削除）＋ `clearEpubCache()` で対応エントリを除去。
- **起動時リコンサイル**: 既存の `_idbGetAllKeys()` 解決時に、台帳にあって IDB に無い
  キーを削除（逆방向 = IDB にあって台帳に無い旧バージョン由来のキーは `size: 0` で仮登録）。
- **遅延バックフィル**: `loadEpubFromCache()` は値を全読みするので、そのとき
  `cached.size` を台帳に書き戻す。旧バージョンからの移行はこれで自己修復
  （size 不明の間はバジェット計算上 0 扱い＝過小評価だが、件数上限 20 が安全弁）。

LRU の順序判定は**現行どおり** `epub_pos_*` の `lastOpenedAt`（台帳は size 専用。
時刻の二重管理をしない）。

### 2.3 eviction アルゴリズム（`cacheEpubFile()` の変更）

```js
// put 前:
const newSize = file.size || 0;
while (
  hasEvictable() && (
    (!_cachedKeys.has(bookKey) && _cachedKeys.size >= EPUB_CACHE_LIMIT) ||
    (indexTotalSize(excluding bookKey) + newSize > EPUB_CACHE_BUDGET_MB * 1048576)
  )
) { await evictOldestEpubCache(bookKey); }
```

- **今開いた本が最優先**：`newSize` 単体がバジェット超過でも**キャッシュする**
  （他を全部 evict してでも。ユーザーが今読んでいる本が最も価値が高い）。
- QuotaExceeded リトライは現行の「1 回」から「**evict できる限りループ**」に変更
  （バジェットよりブラウザ実クォータが小さい端末への防御）。
- `evictOldestEpubCache()` 自体は無変更（台帳の削除だけ追記）。

### 2.4 UI・その他

- 設定パネル `#cache-group` の説明文に上限を反映（例:「直近 20 冊・最大 300MB」）。
  i18n 既存キーの文言更新 ×4 言語 ×2 ファイル。
- iOS 注意（挙動変更なし・README 記載のみ）: Safari は 7 日間未使用オリジンの
  ストレージを破棄することがある（ホーム画面追加 or `storage.persist()` 許諾で緩和）。
  キャッシュが増えるぶん「消えたときの再取得」も増えるが、しおりは localStorage
  ＋Drive 同期で守られており実害は再ピッカーのみ。

### 2.5 Phase 1 チェックリスト（✅ 実装済み 2026-07-06・未コミット）

両ファイル同一適用（PC=CRLF / iOS=LF）：

- [x] 定数変更 `EPUB_CACHE_LIMIT=20`・新設 `EPUB_CACHE_BUDGET_MB=300`・`EPUB_CACHE_INDEX_KEY`
- [x] `epub_cache_index` 台帳ヘルパ（load/save/set/remove/total/reconcile/`_cacheNeedsEvict`）
- [x] `cacheEpubFile()` eviction 条件を二重制限に変更＋Quota リトライのループ化
- [x] 台帳の削除を **`_idbDelete()`／`_idbClear()` に集約**（全削除経路を自動カバー）。put 成功時に `_cacheIdxSet`
- [x] 起動時リコンサイル（`_cacheIdxReconcile`）＋`loadEpubFromCache()` でのサイズバックフィル
- [x] `cache.help` 文言更新（i18n ×4 言語 ×2 ファイル・iOS は独自文言を保持しつつ上限追記）
- [x] README・CLAUDE.md 更新＋`epub_cache_index` を localStorage キー表に追加

**実装メモ**：削除経路を個別に触る代わりに `_idbDelete`（ePubキャッシュ専用）冒頭で `_cacheIdxRemove` を呼ぶ集約方式にした（evict/doDeleteBook/_rlPurgeLocalData/loadEpubFromCache catch を一括カバー）。純関数 `_cacheNeedsEvict` は単体テスト10件、eviction＋台帳の結合シミュレーションは12件通過。構文チェック両ファイル0エラー。ブラウザ実機未確認。

テスト観点（eviction 判定は純関数に切り出して node 単体テスト）：
件数超過 evict ／ バジェット超過 evict ／ 巨大 1 冊はそれでもキャッシュ ／
size 不明(0) エントリ混在 ／ 台帳リコンサイル（IDB⇔台帳の片側欠落）／
doDeleteBook・clear での台帳同期。実機：4 冊目でも「⚡すぐ開ける」が維持されること。

---

## Phase 2：PWA 化＋ Web Share Target（Android の「共有から開く」）

### 3.1 新規デプロイファイル（`/book/` 直下・ビルドレス維持）

| ファイル | 役割 |
|---------|------|
| `manifest.webmanifest` | PC/Android 用（`yomikake.html` が参照）。`share_target` 宣言を含む |
| `manifest_ios.webmanifest` | iOS 用（`yomikake_ios.html` が参照）。share_target なし |
| `sw.js` | 共有 POST の受領＋アプリシェルのオフラインキャッシュ |
| `icon-192.png` / `icon-512.png` / `icon-512-maskable.png` / `apple-touch-icon.png`(180px) | インストール要件のアイコン。**作者自作フォントの「読」1 文字**（温白背景 `#f8f6f2`）。マスター画像 `myfont-icon-512.png` を PIL で各サイズにリサイズ生成。maskable はグリフを 0.88 倍に縮小配置してセーフゾーン内（半対角 ≒37% < 40%）に収める |

> **「2 ファイル構成」からの変更点**はこの 7 ファイル追加のみ。ビルドステップは引き続き無し。
> `file://`・未インストール・SW 非対応環境では従来動作のまま（すべて漸進的強化）。

### 3.2 `manifest.webmanifest`

```jsonc
{
  "name": "yomikake — ePub 縦書きリーダー",
  "short_name": "yomikake",
  "start_url": "./yomikake.html?src=pwa",
  "scope": "./",
  "display": "standalone",
  "background_color": "#fdf8f0",
  "theme_color": "#fdf8f0",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "share_target": {
    "action": "./share-receive",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": { "files": [ {
      "name": "epub",
      "accept": ["application/epub+zip", "application/zip", "application/octet-stream", ".epub", ".kepub"]
    } ] }
  }
}
```

- **`application/octet-stream` を含める理由**: サードパーティのファイラーは ePub を
  octet-stream で共有してくることが多く、外すと肝心のユースケースで yomikake が
  共有先に出ない。副作用として「あらゆるバイナリの共有先」に yomikake が並ぶノイズが
  あるが、実利優先（外すのは 1 行の変更）。**受け側でコンテンツ検証**する（§3.4）。
- `manifest_ios.webmanifest` は `start_url: "./yomikake_ios.html?src=pwa"`・
  share_target なし・他は同一。

### 3.3 `sw.js`

```js
const VERSION = 'yomikake-shell-v1';   // リリースごとに更新（§4）
const SHELL = ['./yomikake.html', './yomikake_ios.html',
               './manifest.webmanifest', './manifest_ios.webmanifest',
               './icon-192.png', './icon-512.png', './icon-512-maskable.png'];
```

- **install**: `SHELL` をプリキャッシュ → `skipWaiting()`。
- **activate**: 旧バージョンの Cache 削除 → `clients.claim()`。
- **fetch**:
  1. `POST` かつ pathname が `share-receive` で終わる →
     `formData()` から `epub` フィールドの File を取り出し、**専用 IDB**
     （DB `epub_viewer_share` v1 / store `pending` / 固定キー `'file'`）に
     `{ file, savedAt: Date.now() }` を put →
     `Response.redirect('./yomikake.html?shared=1', 303)`。
     File が無い/失敗 → `?shared=err` へリダイレクト。
     ※ File はそのまま構造化複製で保存する。この経路は **Android Chrome 限定**なので
     iOS の「IDB 内 Blob 失効」バグ（CLAUDE.md 記載）は関係しない。
     ※ ePub キャッシュの `epub_viewer_files` とは**別 DB** — ページ側コードとの
     バージョン競合を避けるため共有しない。
  2. `GET` のナビゲーション（HTML）→ **network-first**、失敗時に Cache フォールバック
     （= 圏外でもアプリが起動する。更新は通常時に即時反映）。
  3. その他の `GET`（manifest / icon）→ cache-first。

### 3.4 ページ側の変更（`yomikake.html`）

- `<head>` に `<link rel="manifest" href="manifest.webmanifest">`・
  `<meta name="theme-color" content="#fdf8f0">`・
  `<link rel="apple-touch-icon" href="apple-touch-icon.png">` を追加。
- Init ブロックで SW 登録（ガード付き）:
  ```js
  if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
    navigator.serviceWorker.register('sw.js').catch(() => {});
  ```
- **共有ファイルの受取り**（Init・読みかけリスト構築より前に判定）:
  1. `new URLSearchParams(location.search)` の `shared` を見る。
  2. `shared=1` → `history.replaceState` でクエリを除去 → 共有 IDB から `'file'` を
     get＋delete → **鮮度ガード**（`savedAt` が 10 分超過なら破棄）→
     `showLoading(file.name, file.size)` → `loadEpub(file)`。
     以降は通常オープンと同一（しおり復元・`cacheEpubFile` で Phase 1 キャッシュにも
     入る → 次回からリストでワンタップ）。
  3. `shared=err` またはエントリ無し → エラートースト（i18n 新キー）→ 通常のウェルカム画面。
  4. **コンテンツ検証**: octet-stream を受けるため、`loadEpub` 失敗時のトーストを
     「ePub ではないファイル」向けの文言に分岐（先頭 2 バイト `PK` チェックを
     `loadEpub` 冒頭に追加し、非 ZIP は即時に専用トースト）。
- i18n 新キー（×4 言語）: `toast.sharedNotEpub`（共有されたファイルが ePub でない）、
  `toast.shareFailed`（受け取りに失敗）。

### 3.5 ページ側の変更（`yomikake_ios.html`）

- `<link rel="manifest" href="manifest_ios.webmanifest">`・theme-color・
  apple-touch-icon・SW 登録（同じ `sw.js`。シェルキャッシュの恩恵のみ）。
- 共有受取りコードは**入れない**（iOS Safari は Web Share Target 非対応。
  受け皿だけ入れても発火しない）。
- **README/ヘルプに明記**: iOS の「ホーム画面に追加」版は Safari と**ストレージが別枠**。
  しおりは Drive 読込で移行できる。ePub キャッシュ・ローカルフォントは開き直しが必要。

### 3.6 制約・既知の限界

| 項目 | 内容 |
|------|------|
| iOS の共有シート | Web Share Target 非対応（現行 iOS）。Phase 2 の主効果は Android 限定。iOS はオフライン起動＋standalone 表示の改善のみ |
| SW 不在時の共有 | ユーザーがサイトデータを消すと SW が未登録になり、共有 POST が静的ホストに直撃して 404/405。**アプリを一度開けば SW が再登録され復旧**（既知の限界として README 記載） |
| octet-stream ノイズ | あらゆるバイナリ共有で候補に並ぶ。受け側検証でエラートースト対応 |
| 巨大マンガの共有 | 数百 MB の File の IDB put が一拍かかるが、SW 内で完結するので UI は既存 Loading オーバーレイが吸収 |
| `.webmanifest` の MIME | サーバーが `application/manifest+json` を返さない場合は Chrome が警告することがある。ayati.com で問題が出たら `manifest.json` に改名（`link` の href 変更のみ） |

### 3.7 Phase 2 チェックリスト（✅ 実装済み 2026-07-06・未コミット）

- [x] `manifest.webmanifest` / `manifest_ios.webmanifest` 新規作成
- [x] アイコン 4 点生成（**作者自作フォントの「読」** マスター `myfont-icon-512.png` を PIL でリサイズ・maskable は 0.88 倍でセーフゾーン内）
- [x] `sw.js` 新規作成（share-receive / network-first シェル / VERSION 管理）
- [x] `yomikake.html`: link/meta 追加・SW 登録・shared=1 受取り（`_shareIdbTake`＋鮮度10分ガード）・PK ヘッダ検証・i18n 2 キー ×4 言語
- [x] `yomikake_ios.html`: link/meta 追加・SW 登録＋**PK 検証と i18n も追加**（loadEpub 同期のため。共有受信は入れない）
- [x] README: インストール手順（Android/iOS）・共有から開く手順・iOS ストレージ別枠・SW 再登録の注意・配置ファイル表
- [x] CLAUDE.md: 新ファイル構成・SW の役割・「2 ファイル＋PWA 資産」への記述更新
- [x] **ヘルプ画面（help.body）に「📲 アプリとして入れる」節を追加**（4言語×2ファイル・ファイル形式節の直前・Android Chrome/iOS Safari の手順を番号付きで平易に。PC版は Android 先頭・iOS版は iOS 先頭に並べ替え）

**実装メモ**：`Response.redirect` はスコープ基準の絶対URL（`new URL('yomikake.html?shared=1', self.registration.scope)`）で構築。共有IDBは `epub_viewer_share`/`pending`/key`'file'`（ePubキャッシュ `epub_viewer_files` とは別DB）。PK検証は設計では yomikake.html のみだったが、loadEpub は両ファイル共通関数のため iOS 版にも入れて同期（i18n 2キーも両方）。構文チェック（HTML内JS×2・sw.js `node --check`・manifest JSON）全OK・URL構築/PKロジック/共有IDBキー一致を確認。**実機テスト（§3.7 の 7 項目）は未実施**。

テスト観点（実機必須）：
1. Android: Chrome メニューに「アプリをインストール」が出る／インストール後、
   Files by Google と サードパーティファイラー双方から `.epub` 共有 → 直接開く
2. octet-stream で来た正規 ePub が開く／非 ePub（PDF 等）共有 → 専用トースト
3. 共有で開いた本が Phase 1 キャッシュに入り、次回リストからワンタップ
4. 機内モードでインストール済みアプリが起動し、キャッシュ済みの本が読める
5. `VERSION` 更新後、オンライン起動でシェルが更新される
6. 未インストールのブラウザタブ・`file://`・PC で従来動作に変化がないこと
7. iOS: ホーム画面追加で standalone 起動／Drive 読込でしおり移行が案内どおり動くこと

---

## 4. 運用メモ

- **デプロイ**: 新規 7 ファイルを `https://www.ayati.com/book/` に HTML と同居で配置。
  OAuth の Authorized JavaScript origins は変更不要（同一オリジン）。
- **リリース時の手順追加**: HTML を更新したら `sw.js` の `VERSION` も上げる
  （上げ忘れるとシェルキャッシュが旧 HTML を返し続ける…ことは network-first なので
  起きないが、プリキャッシュ更新の確実化のため習慣にする）。
- **ロールバック**: `sw.js` を「全キャッシュ削除＋自己 unregister」する空実装に
  差し替えれば PWA 化前の状態に戻せる。
