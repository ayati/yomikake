# KOReader Progress sync（kosync）連携 概要設計書 — 調査と機能概要

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**

関連: `design_finished_sync.md`（読了と同期の合流則）・`design_reading_list_v2.md`（墓標・bookKey）・
`design_tts_background.md` Phase F（「連携先ごとの分岐を書かない」設計判断の前例）

**実装状況: Step 0〜2 完了（転送層・ドキュメントハッシュ・設定 UI）。** 次は Step 3（pull）。
テストは `tests/cases/kosync.js`（両ファイル各 53 assertion）。

調査日: 2026-08-30。外部サーバの実測値は同日 UTC 03:36 のもの。

---

## 1. 何をしたいか

yomikake の既定は「ブラウザに自動記録 ＋ 端末間は Google Drive」。
これに **KOReader の Progress sync サーバとの読み書き**を足す。E-Ink 側のデファクトが KOReader なので、
「KOReader で読んだ続きを yomikake で開く／その逆」を成立させたい。

優先度は本人の指定どおり:

| # | ユースケース | 優先 |
|---|---|---|
| U1 | KOReader が同期サーバに書いたしおりを yomikake が **読み**、そこへジャンプする | **マスト** |
| U2 | yomikake の読書位置を同期サーバに **書き**、KOReader が続きから読める | **マスト**（同期方法 `Filename` で確実に） |
| U3 | 同期方法 `Binary`（KOReader の既定）でも U1 が成立する | 強く希望 |

サーバは自前でも公開のものでもよい。本人が挙げたのは `https://sync.send2ereader.net`。

---

## 2. KOReader 側の仕様（調査結果）

出典: `koreader/plugins/kosync.koplugin/{api.json, main.lua, KOSyncClient.lua}`、`frontend/util.lua`、
および実サーバ実装 `nperez0111/koreader-sync`（`src/index.tsx`・send2ereader が動かしているもの）。

### 2-1. プロトコル（全体で 4 エンドポイントしかない）

`api.json` の実体:

```json
{
  "base_url": "https://sync.koreader.rocks:443/",
  "methods": {
    "register":        { "path": "/users/create",            "method": "POST", "expected_status": [201, 402] },
    "authorize":       { "path": "/users/auth",              "method": "GET",  "expected_status": [200, 401] },
    "update_progress": { "path": "/syncs/progress",          "method": "PUT",  "expected_status": [200, 202, 401] },
    "get_progress":    { "path": "/syncs/progress/:document","method": "GET",  "expected_status": [200, 401] }
  }
}
```

共通ヘッダ:

```
accept: application/vnd.koreader.v1+json
x-auth-user: <username>
x-auth-key:  <md5(平文パスワード) の 16 進小文字>
```

**パスワードは平文を送らない。** `main.lua` は `local userkey = md5(password)` を作り、
登録時も `client.register(username, userkey)` として **md5 を `password` フィールドに載せて**送る。
つまり `x-auth-key` に入る値そのものが登録時のパスワードであり、
**`userkey` を持っている＝そのアカウントを操作できる**（§7-1 のセキュリティ判断の根拠）。

`PUT /syncs/progress` のボディ:

```json
{
  "document":   "<ドキュメントハッシュ 32hex>",
  "progress":   "<位置文字列>",
  "percentage": 0.4213,
  "device":     "<端末名>",
  "device_id":  "<端末ID>",
  "metadata":   { "filename": "...", "title": "...", "authors": "..." }   // 任意
}
```

`GET /syncs/progress/:document` の応答（実サーバ実装で確認）:

```json
{ "document": "...", "progress": "...", "percentage": 0.4213,
  "device": "...", "device_id": "...", "timestamp": 1756524968 }
```

該当なしは `404 {"status":"not found"}`（実装差あり。official 系は 200 + 空を返す実装も存在するので
**「progress が無い」を 404 だけで判定しない**こと）。

### 2-2. `document` — 2 つのハッシュ方式

KOReader の設定「同期方法」に対応する。`main.lua`:

```lua
function KOSync:getFileDigest()      return self.ui.doc_settings:readSetting("partial_md5_checksum") end
function KOSync:getFileNameDigest()  local file_name = self:getFileName(); return md5(file_name) end
```

- **Filename 方式** — `md5(ファイル名)`。ファイル名は**拡張子込みのベース名**（ディレクトリを含まない）。
- **Binary 方式（KOReader の既定）** — ファイル内容の *partial MD5*。`frontend/util.lua`:

```lua
function util.partialMD5(filepath)
    local step, size = 1024, 1024
    local update = md5()
    for i = -1, 10 do
        file:seek("set", lshift(step, 2*i))
        local sample = file:read(size)
        if sample then update(sample) else break end
    end
    return update()
end
```

`lshift` は 32bit の LuaJIT BitOp なので `i = -1` は `1024 << 30` が 32bit で溢れて **0** になる。
KOReader メンテナ（Frenzie）が discussion #14448 に出した Go 版も `int64(1024) << uint(2*i)` で
`i=-1` はシフト量が 64 以上となり同じく 0 になる。したがって実際に読む位置は:

```
0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
16777216, 67108864, 268435456, 1073741824          （各 1024 バイト、EOF で打ち切り）
```

**✅ 実データで確定済み（2026-08-30）。** KOReader 実機 2 台（Android / PocketBook）の
サイドカー 3 件と照合し、**すべて先頭オフセット 0 の計算値と完全一致**した。
二次情報にある「先頭は 256」説（`lshift(x,-2)` を右シフト 2 と読んだ誤り）は**棄却**。

| ファイル | サイズ | KOReader 実機の値 | 先頭 0 説 | 先頭 256 説 |
|---|---|---|---|---|
| `ねらわれた学園…_nodrm.epub`（Android） | 15.9 MB | `de94e8c1…f312a54` | **一致 ✅** | `6d7274e4…` ✗ |
| `ねらわれた学園…_nodrm.epub`（PocketBook） | 同上 | `de94e8c1…f312a54` | **一致 ✅** | 〃 |
| `AKIRA1_大友克洋.epub`（PocketBook） | 159 MB | `78ed375e…41fa3f` | **一致 ✅** | `30ee11d2…` ✗ |

ここから 2 つ言える:

- **同じファイルなら端末をまたいでハッシュが一致する**（Android と PocketBook で同値）。
  Binary 方式が端末間で機能する前提が実証された。
- **EOF での打ち切りも正しい**。AKIRA は 159 MB なのでオフセット 268435456（256 MB）以降は
  ファイル外＝読めずに `break` する。この打ち切りを含めて一致した。

参考: `md5(ファイル名)` は `d0488c9e…1fc56b` / `aea6463c…476977`。

**重要**: yomikake は**両方のハッシュを計算できる**。ePub の実体（`ArrayBuffer`）とファイル名は
すでに IDB キャッシュ（`epub_viewer_files`）の値 `{buf, name, size, type}` に揃っているからだ。
新しい取得経路は要らない。partial MD5 は先頭から最大 12KB しか読まないので 20 冊分まとめて
ハッシュしても一瞬で終わる。**ただし MD5 は WebCrypto に無い**ので、JSZip と同じく
小さな MD5 実装（~2KB）をインライン同梱する必要がある（§6-1）。

### 2-3. `progress` — リフローは XPointer、ページ物はページ番号

受信側の適用はこれだけ:

```lua
function KOSync:syncToProgress(progress)
    if self.ui.document.info.has_pages then
        self.ui:handleEvent(Event:new("GotoPage", tonumber(progress)))
    else
        self.ui:handleEvent(Event:new("GotoXPointer", progress))
    end
end
```

**ePub は FXL でも「ページ物」ではない** — `has_pages` が真になるのは PDF / CBZ / DjVu で、
固定レイアウトの ePub にも XPointer が飛んでくる（§4-5）。実機から採取した実例:

```
/body/DocFragment[7]/body/div/p[88]/ruby[6]/rt/text().0
```

- `DocFragment[N]` … crengine が読み込んだ **N 番目の spine アイテム（1 始まり）**
- 以降 … そのアイテム内の要素パス（同名兄弟の中での 1 始まり添字）
- `text().N` … テキストノード内の文字オフセット

**`DocFragment[N]` → yomikake の `state.spine[N-1]`** が写像の中核になる。

**✅ この XPointer は実 ePub に対して素朴な解決で当たることを検証済み**（§2-5）。

### 2-4. 競合解決 — サーバの `timestamp` が正

```lua
local self_older
if body.timestamp ~= nil then
    self_older = (body.timestamp > self.last_page_turn_timestamp)
else
    self_older = (body.percentage > percentage)
end
```

リモートが新しければ `sync_forward` 戦略（無音 / 確認 / 無効 のいずれか）、
逆なら `sync_backward` 戦略。**`percentage` は timestamp が無い実装向けの保険**であって、
主判定ではない。yomikake もこの順序に合わせる（§5-4）。

`percentage` は `Math.roundPercent()` で丸めた 0〜1 の実数。桁数は要確認（§9-3）だが、
判定に使わないので実害はない。

### 2-5. XPointer の解決可能性 — 実機 2 台・3 例で検証済み（重要）

実機の `last_xpointer` を、同じ ePub の中身に対して**素朴な規則**
（`DocFragment[N]` → spine[N-1]、以降は「同名兄弟の中での 1 始まり添字」）で辿った。**3 例すべて一致**:

| 端末 | XPointer | 辿った先 |
|---|---|---|
| Android | `/body/DocFragment[7]/body/div/p[88]/ruby[6]/rt/text().0` | spine[6]=`kd814497_0007.xhtml` → `<rt>`「おく」<br>本文「　楠本和美が立ちあがり、…拍手を送ったのだ。」 |
| PocketBook | `/body/DocFragment[7]/body/div/p[83]/span[1]/text().26` | 同 spine[6] → `<span>`「そりゃ、いたずらはよくないだろう。しかし、ぼくたちのクラスから」<br>その **26 文字目**＝「のクラスから」 |
| PocketBook | `/body/DocFragment[26]/body/div/svg.0` | spine[25]=`p-025.xhtml` → `<svg>` → `<image href="../image/i-025.jpg">`<br>（AKIRA＝FXL マンガの 25 ページ目） |

**解決器の仕様として確定した点**:

- 添字は**同名兄弟の中での 1 始まり**。添字なし（`div`・`rt`・`svg`）は 1 番目。
- **名前空間は無視してローカル名で照合する。** `svg` は SVG 名前空間の要素だが、
  crengine のパスには裸の `svg` として出る。`getElementsByTagName` 相当（名前空間非依存）で辿ること。
- 末尾の `text().N` / `.N` は**テキストノード内の文字オフセット**。`.26` が実際に文字位置を指すことを確認した。
  **yomikake ではここまで再現しない**（段落単位で十分・§4-2）。
- `<ruby>` / `<rt>` / `<span>` がそのまま経路に出る＝**crengine はインライン構造を保ったまま索引している**。

**`autoBoxing` の危険度も測った。** crengine が `autoBoxing` を挿入するのは
「ブロック要素の直下にブロックとテキスト/インラインが混在」した場合だが、手元 3 冊を全 spine 走査した結果:

| ePub | spine 数 | 混在のある親要素 | パース失敗 |
|---|---|---|---|
| ねらわれた学園（新装版） | 46 | **0** / 52 | 0 |
| RAIL＿WARS！ | 306 | **0** / 0 | 0 |
| AKIRA1 | 366 | **0** / 0 | 0 |

→ **章内位置の要素解決は、当初 Phase 2 に置いていたが実現性が高い。**
初版では「crengine の DOM 正規化で当たらない恐れがあるので章頭に落とす」としていたが、
この実測を受けて **§4-2 / §4-3 を格上げした**。ただし乱れた ePub では崩れうるので
**フォールバックは必ず残す**。

### 2-6. `percentage` を位置の推定に使ってはいけない（端末間の実測で決定的）

同じ本・ほぼ同じ位置（どちらも `DocFragment[7]` の p[83]〜p[88]）を、2 台の実機がこう記録していた:

| 端末 | `doc_pages` | `percent_finished` |
|---|---|---|
| Android | 187 | **0.0695** |
| PocketBook | 281 | **0.0569** |

**同じ本の同じ場所なのに 22% ずれる。** 画面サイズとフォントで組版後のページ数が変わるからだ。
さらに yomikake の式 `(spineIdx + ratio)/(spineCount-1)` では spine[6] の章頭が **6/45 = 13.3%** で、
KOReader の倍近い。

→ `percentage` は **KOReader 端末間ですら一致しない量**であって、位置の情報源にならない。
使うのは「`DocFragment[N]` が spine 範囲外」等の**ずれの検算**に限り、
**章内位置の推定にも、本の同定にも使わない**（§4-2）。

---

## 3. 決定的な障害 — CORS（ここが本設計の全部）

### 3-1. 実測

```
$ curl -i -X OPTIONS https://sync.send2ereader.net/syncs/progress \
    -H 'Origin: https://www.ayati.com' -H 'Access-Control-Request-Method: PUT' \
    -H 'Access-Control-Request-Headers: x-auth-user,x-auth-key,content-type'
HTTP/2 404                       ← プリフライトに応答しない

$ curl -i https://sync.send2ereader.net/users/auth -H 'Origin: https://www.ayati.com'
HTTP/2 401
cross-origin-resource-policy: same-origin
（Access-Control-Allow-Origin ヘッダは無い）

$ curl -i https://sync.koreader.rocks/users/auth
HTTP/2 522                       ← Cloudflare の origin down。公式サーバは調査時点で応答なし
```

サーバ実装（`nperez0111/koreader-sync` の `src/index.tsx` 全 978 行）にも
`cors` ミドルウェアの記述は無い。`secureHeaders()` は入っているが CORS は入っていない。

### 3-2. これは回避できない

- `PUT` ＋ 独自ヘッダ（`x-auth-user` / `x-auth-key`）＝ **必ずプリフライトが飛ぶ**。単純リクエストにならない。
- `mode:'no-cors'` は応答を読めないので U1（pull）が原理的に成立しない。
  U2（push）も独自ヘッダを付けられないので成立しない。
- JSONP 相当の逃げ道も無い（`GET` すら `x-auth-key` ヘッダが要る）。

**つまり「ブラウザから公開 kosync サーバへ直接」は今日は不可能。**
先行事例もこれと整合する — kosync を実装した Readest は Tauri（ネイティブ HTTP）、
crosspoint-reader は E-Ink 端末。**ブラウザから直接叩けている実装は見つからなかった。**

### 3-3. 選択肢

| 案 | 中身 | 長所 | 短所 |
|---|---|---|---|
| **A. 上流に CORS を入れてもらう** | `nperez0111/koreader-sync` に Hono の `cors()` を足す PR（実質 3 行）。send2ereader はこれで動いている | 本人の名指しサーバがそのまま使える。他の Web リーダーも救われる | 相手次第・時期が読めない |
| **B. 自前 kosync を建てる** | docker で kosync＋CORS を付けたリバースプロキシ | 完全に自分の管理下 | 常時稼働の面倒を見る必要 |
| **C. 自前の薄いリレー** | `www.ayati.com` 側に `/kosync/*` を透過中継するパスを 1 本。**同一オリジンになるので CORS 自体が消える** | 実装が最小。認証情報が他人を通らない | Apache の設定変更が要る（**可能と確認済み** §3-5） |
| **D. Cloudflare Worker** | 本人所有の Worker 25 行で中継 | 今日から動く。無料枠で足りる。C が使えなくても成立 | デプロイ先が 1 つ増える |
| E. 公開 CORS プロキシ | corsproxy.io 等 | ゼロ工数 | **`userkey` が他人のサーバを通る＝アカウント奪取可能。却下** |

### 3-4. yomikake 側の設計判断 — 「中継先ごとの分岐を書かない」

どれを選んでも **yomikake 本体のコードは同じ**にする。設定に**サーバ URL のテキスト欄を 1 つ**持ち、
yomikake はそこへ kosync プロトコルを喋るだけにする。A が通れば `https://sync.send2ereader.net`、
通らなければ C/D のリレー URL を貼る。**yomikake は相手が本家か中継かを知らない。**

これは v2.19.0 の外部読み上げアプリ連携で採った判断と同じ形で、あのときと同じ効果が出る
—— 転送層が後から変わっても**直すのは設定欄に入れる文字列だけ**で、コードは 1 行も変わらない。

**したがって §3 の決着を待たずに実装を始められる。** 開発中はローカルに kosync を立てて検証する。

### 3-5. 転送層の決定 — Apache で `/kosync/` を中継する（案 C1・決定済み）

`www.ayati.com` は **Apache/2.4.58 (Ubuntu)** で、設定を変更できることを本人に確認済み（2026-08-30）。
したがって **案 C を採る**。`/kosync/` を kosync サーバへ透過中継すれば
yomikake（`/book/yomikake.html`）から見て**同一オリジン**になり、CORS の問題自体が消滅する。

**採用: C1（send2ereader を中継する）**（2026-08-30 決定）。サーバを自前で持たずに始められる。
将来 C2（同じ箱で kosync 本体を動かす）へ移す場合も、**yomikake のコードは 1 行も変わらない**
（§3-4）。変えるのは Apache の転送先だけで、KOReader / yomikake から見た URL は同じままにできる。

```apache
# sudo a2enmod proxy proxy_http ssl && sudo systemctl reload apache2
# <VirtualHost *:443> の中（www.ayati.com のもの）に置く
SSLProxyEngine On
ProxyPreserveHost Off
ProxyPass        /kosync/ https://sync.send2ereader.net/
ProxyPassReverse /kosync/ https://sync.send2ereader.net/
```

**KOReader の「カスタム同期サーバ」にも同じ URL を入れる** — `https://www.ayati.com/kosync`
（末尾スラッシュなし）。KOReader と yomikake が同じ入口を見るので経路が 1 本に畳まれ、
上流を差し替えても両方いっぺんに切り替わる。

将来 C2 に移すときの差分は転送先の 1 行だけ:

```apache
ProxyPass        /kosync/ http://127.0.0.1:3000/     # docker の kosync
ProxyPassReverse /kosync/ http://127.0.0.1:3000/
```

**✅ 稼働確認済み（2026-08-30）**: Android・PocketBook の両実機の KOReader で
カスタム同期サーバに `https://www.ayati.com/kosync` を設定し、**同期成功**。
`https://www.ayati.com/kosync/users/auth` が上流の 401（`content-type: text/plain` ＋
send2ereader の CSP ヘッダ）を返すことも確認した。

⚠ **設置は `<VirtualHost *:443>` に。** 最初 `*:80` の vhost にだけ書いていたため、
443 では Apache 素の 404（存在しないパスと**バイト単位で同一**の応答）が返っていた。
yomikake も KOReader も https で叩くので 443 が必須。切り分けは
「返ってきた 404 が Apache の HTML エラーページか、上流の `text/plain` か」を見るのが速い。

**注意点**:

- `ProxyPreserveHost Off`（既定）にしておく。`On` にすると上流へ `Host: www.ayati.com` が飛び、
  上流のルーティングによっては 404 になる。
- Apache は既定でリクエストヘッダをそのまま転送するので、`x-auth-user` / `x-auth-key` /
  `accept: application/vnd.koreader.v1+json` はそのまま通る。**特別な設定は不要**。
- **`x-auth-key` をログに出さないこと。** Apache の既定ログはリクエストヘッダを記録しないので
  そのままでよい。`LogFormat` に `%{x-auth-key}i` の類を足さない。
- 上流が返す `Content-Security-Policy` / `cross-origin-resource-policy: same-origin` は
  そのまま中継されるが、**同一オリジンになった後なので無害**。気になるなら
  `<Location /kosync/> Header unset Content-Security-Policy </Location>` で落とせる。

**⚠ サービスワーカーに除外を入れること（必須）。** 同一オリジンにした副作用として、
kosync の `GET` が `sw.js` のルール 3（同一オリジン静的資産・cache-first）の射程に入る。
現状の実装は `caches.match()` が外れたら `fetch()` に素通しするので**今は害が無い**が、
将来ここにランタイムキャッシュを足した瞬間に「しおりが古いまま返る」という最悪の壊れ方をする。
先に防ぐ:

```js
// sw.js の fetch ハンドラ冒頭（POST 分岐より前）
if (url.pathname.startsWith('/kosync/')) return;   // 同期 API は常にネットワーク直行
```

---

## 4. yomikake 側への写像

### 4-1. 本の同定 — `bookKey` ↔ `document`

yomikake は `epub_pos_{title}__{creator}` で本を同定し、KOReader はファイルのハッシュで同定する。
**2 つの ID 空間は別物**なので、対応表を持つ。

```
epub_kosync_docs = { [bookKey]: { bin, fn, name, size, lastPullAt, lastPushAt, remoteTs } }
```

- `bin` / `fn` … 2 方式のハッシュ。IDB キャッシュの `{buf, name}` から算出して**キャッシュする**
  （毎回 12KB 読み直す必要は無いし、実体が消えた後も push を続けられる）
- **`epub_pos_*` の値には入れない。** しおりは Drive 同期・JSON 書き出し・墓標マージの対象で、
  そこにファイル固有のハッシュを混ぜると端末ごとに実体が違う場合に壊れる。
  `epub_book_prefs` と同じ理由で**別キーであること自体が保証**になる（`design_per_book_settings.md`）。

**ハッシュが一致する条件**:
- Binary … KOReader 側と**バイト単位で同じファイル**であること。同じ `.epub` を両方へ入れれば一致する。
  再ダウンロードや `.kepub` 変換をすると一致しない。
- Filename … 拡張子込みのベース名が一致すること。リネームすると一致しない。

→ **pull は Binary → Filename の順に両方試す**（U3 を無償で拾える）。**push は設定した方式のみ**
（両方に書くと使っていない側に古い記録が残り、後でそれを pull して後退する経路ができる）。

### 4-2. 位置の写像 — pull（KOReader → yomikake）

```
/body/DocFragment[7]/body/div/p[88]/ruby[6]/rt/text().0
        └─ 7 → state.spine[6] へ renderPage(6, ...)
```

章内位置は 3 段で落とす:

1. **要素解決**（既定・§2-5 で実測検証済み）— レンダリング後の iframe DOM を
   `body → div → p[88] → ruby[6] → rt` と「同名兄弟の 1 始まり添字」で辿り、
   その要素の位置から `ratio` を算出する。yomikake は章を丸ごと iframe に描いているので直接できる。
   **照合はローカル名で行う**（名前空間を見ない。SVG 要素が裸の `svg` として出るため・§2-5）。
   末尾の `text().N` / `.N`（文字オフセット）は**無視する** — 段落単位で十分で、
   文字位置まで再現しても `ratio` の精度は実質変わらない。
2. **ブロック祖先へ丸める**（保険）— 末端が解決できなければ、パスを後ろから削って
   最初に解決できた要素（多くは `p[K]`）で妥協する。行単位の誤差で済む。
3. **章頭**（最後の砦）— `ratio = 0`。

**`percentage` は章内位置の推定に使わない**（§2-6 の実測。モデルが違い約 2 倍ずれる）。
使うのは「`DocFragment[N]` が spine 範囲外」「ハッシュが Filename 一致だけで中身が違う疑い」
といった**ずれの検算**に限る。

⚠ 1 が外れる主因は **crengine の DOM 正規化**（インライン内容を `<autoBoxing>` で包む等）。
手元 3 冊では混在ゼロ＝発生しない見込みだが（§2-5）、乱れた ePub では起きうる。
**`buildSrcdoc()` 側の加工は索引に影響しない** — `<script>` 除去も `<base>` 差し替えも
`<style>` 注入も、同名兄弟の添字を動かさないため（crengine も script は落とす）。

### 4-3. 位置の写像 — push（yomikake → KOReader）

`progress` に何を書くか。crengine が解決できる XPointer でなければならない。
**外すと KOReader 側が変な位置へ飛ぶ**ので、pull より慎重に組む。

**ブロック要素どまりの XPointer を生成する**:

```
/body/DocFragment[N]/body/div/p[K]        ← N = currentSpineIdx + 1
```

`ruby[6]/rt/text().0` のような深い末端までは作らない。**深くするほど当たる確率が下がる一方、
得られる精度は 1 行分しか変わらない**ので割に合わない。ブロック要素どまりなら
crengine 側でも構造が保たれている可能性が高い（§2-5）。

**生成したパスは自分で検算してから送る** — 作った XPointer を自分の iframe DOM に対して
§4-2 の解決器へ流し、**元の要素に戻ってくることを確認する**。戻らなければ 1 段浅くして再試行し、
それでも駄目なら章頭 `/body/DocFragment[N]/body` に落とす。この形は必ず解決できる。

末尾に `/text().0` を付けるかは、対象要素が**直下にテキストノードを持つときだけ**にする
（持たない要素に付けると解決に失敗する）。**実機で当たり方を確認するのは Step 4**。

`percentage` は yomikake 自身の進捗（進捗バーと同じ式）を送る。
KOReader の percentage は組版後のページ数比、yomikake は `(spineIdx + ratio)/(spineCount-1)` なので
**モデルが違い数値は一致しない**。判定には使われない（§2-4）ので実害は無いが、
KOReader の一覧に出る数字が yomikake の表示と少しずれることは仕様として飲む。

### 4-4. 先行事例が踏んだ地雷（Readest issue #5625）

そのまま yomikake にも当てはまるので明記しておく:

1. XPointer の解決に失敗しても**黙って失敗**し、
2. **5 秒後の自動保存が自分のローカル位置をリモートへ上書きして**、リモートの正しい位置を破壊した。

→ **鉄則: pull が完了する（または「リモートに記録なし」が確定する）まで push を武装しない。**
本を開いてから pull 完了までの間は auto-push を止める。これは S5 に仕様として書く。

### 4-5. FXL（固定レイアウト）本は kosync と相性が最も良い

**KOReader は ePub をすべて rolling（リフロー）として扱う** — `has_pages` が真になるのは
PDF / CBZ / DjVu で、FXL の ePub も XPointer が飛んでくる（§2-5 の AKIRA の例）。

FXL では **1 spine アイテム = 1 ページ**なので:

- **pull** … `DocFragment[N]` → `state.spine[N-1]` を `renderFxlPair(N-1)` へ渡すだけ。
  章内位置の概念が無いので**取りこぼしがゼロ**。見開きペアは既存の `buildFxlPairs()` が吸収する。
- **push** … `/body/DocFragment[N]/body` （章頭）で**損失なく**表せる。
  §4-3 の要素パス生成も自己検算も要らない。

つまり **FXL 本はリフロー本より簡単で、しかも完全に無損失**。マンガの続きを
KOReader ↔ yomikake で往復するのは、この設計でそのまま成立する。

⚠ ただし `state.fxlZoom` の状態（コマ読み位置・領域 idx）は kosync に載せない。
ズーム状態は「本を開くたび OFF」が既存の方針で、端末をまたいで持ち回るものではない。

---

## 5. 機能仕様（案）

### S1. 設定 — 新グループ「📖 KOReader 同期」

`#drive-auto-group` の直後、`#bookmark-io-group` の前に `<details class="set-group">` を 1 つ。

| 項目 | 既定 | 備考 |
|---|---|---|
| サーバ URL | 空 | 空なら機能ごと無効（ツールバーにも出さない） |
| ユーザー名 / パスワード | 空 | 「接続テスト」ボタンで `GET /users/auth` |
| 新規登録 | — | `POST /users/create`。既存アカウントがあるなら使わない |
| 同期方法 | `binary` | `binary` / `filename`。**pull は常に両方試す**ので、この設定が効くのは push 先だけ |
| 自動同期 | OFF | ON で「開いたら pull・読んだら push」。既定 OFF は Drive 自動保存と同じ考え方 |
| 端末名 | `yomikake` | KOReader の一覧に出る名前 |

`file://` では Drive と同じく機能ごと隠す（クロスオリジン fetch が使えないため）。

### S2. 手動操作 — 本を開いている間だけ

ツールバーに増やさない（`design_display_settings.md` の「隠せない 4 ボタン」の外を増やすと
モバイルの横スクロールが伸びる）。設定パネル内に「⬇ KOReader から取得」「⬆ KOReader へ送信」の 2 ボタンを置く。

### S3. 本を開いたときの pull

`loadEpub()` の `state.bookKey` 確定後・`applyBookPrefs()` の隣で:

1. `epub_kosync_docs[bookKey]` にハッシュがあれば使う。無ければ IDB の `{buf, name}` から計算して保存
2. `GET /syncs/progress/{bin}` → 404/空なら `GET /syncs/progress/{fn}`
3. 得られた `progress` を §4-2 で `(spineIdx, ratio)` に変換
4. **ローカルより前に進んでいるときだけ**提案する

### S4. 競合の見せ方 — 既存の作法に合わせる

`design_finished_sync.md` で決めた形を踏襲する。**無断でジャンプしない**:

- リモートが先 → 「KOReader（端末名）は N% まで進んでいます」トースト＋「移動」アクション
- ローカルが先 → 何も出さない（push 側で解決する）
- **リモートが末尾** → 位置は動かさず `finishedAt` の取り込みだけ行う。
  これは既存の `showSyncFinishedToast()` の条件（`isAhead && !isNotFinal && !_bookFinished`）と同じ扱いにする

### S5. push のタイミングと安全弁

- `EPUB_POS` から Drive 自動保存と同じ **60 秒デバウンス**（`AUTO_SAVE_INTERVAL` を共有）
- `finalizeCurrentBook()`（＝`closeBook()` と `loadEpub()` 冒頭）でも 1 回
- **`_koPullDone[bookKey]` が立つまで push しない**（§4-4 の鉄則）
- **位置が実際に進んだときだけ push する。** 同じ位置の再送はしない
  （KOReader 側の `timestamp` を無意味に更新して、あちらの正しい位置を「古い」と誤判定させないため）

### S6. しおりデータとの関係 — 混ぜない

- KOReader 同期は **Drive 同期・JSON 書き出し・墓標マージのどれにも関与しない**
- 認証情報（`epub_kosync`）は `collectBookmarks()` の対象外。**`userkey` は絶対に書き出さない**
- 完全削除（`_rlPurgeLocalData`）では `epub_kosync_docs[bookKey]` も消す。
  リモートの記録は消さない（他端末の正）

### S7. 触らないもの

`epub_settings` / `epub_book_prefs` / `DISPLAY_DEFAULTS`（＝表示設定リセットの対象外）/
サービスワーカー。SW は同一オリジン GET と `share-receive` POST しか触らないので、
kosync の PUT / クロスオリジン GET は素通りする（実装確認済み）。

---

## 6. 実装上の要点

### 6-1. MD5 をインラインする

WebCrypto に MD5 は無い。JSZip と同じ方式で小さな実装（~2KB）を両ファイルへインラインする。
バイト列 API（`update(Uint8Array)` を複数回 → `hex()`）が要る。partial MD5 は
飛び飛びの 12 チャンクを順に食わせるので、**一括ハッシュ関数では書けない**。

### 6-2. ハッシュ計算は ArrayBuffer のスライスだけ

```js
function koPartialMd5(buf) {           // buf: ArrayBuffer
  const md5 = new MD5(); const n = buf.byteLength;
  for (let i = -1; i <= 10; i++) {
    const off = i < 0 ? 0 : (1024 * Math.pow(4, i));
    if (off >= n) break;               // KOReader の「read が nil なら break」と同義
    md5.update(new Uint8Array(buf, off, Math.min(1024, n - off)));
  }
  return md5.hex();
}
```

`1024 << (2*i)` は i=10 で 2^30 なので、JS の `<<`（32bit）でも足りるが
`Math.pow(4,i)` にしておくほうが将来の桁上げに安全。

### 6-3. 両ファイル共通

すべて共通実装。`yomikake.html` 専用にする要素は無い（FSA も iframe スクロール機構も関係しない）。
**片方だけ直す事故が起きやすい規模なので、`tests/cases/kosync.js` を最初から書く**（§8 Step 1 に含める）。

### 6-4. i18n

新規キーは 4 言語（`ja` / `en` / `zh-TW` / `zh-CN`）ぶん要る。
サーバ URL・ユーザー名などのラベルと、S4 のトースト文言。

---

## 7. リスクと判断

### 7-1. 認証情報を localStorage に置くこと

`userkey`（= md5 パスワード）は **API に対してパスワードと等価**（§2-1）。自動同期には永続化が要る。

判断: **置く。ただし (a) Drive にも JSON にも絶対に出さない (b) 設定画面に「この端末に保存されます」と明記
(c) 平文パスワードは保存せず md5 だけ持つ (d) 空欄化で即削除できる**。
`_driveToken` を localStorage に置かない既存方針と矛盾するように見えるが、あちらは
**短命トークンなのでメモリで足りる**のに対し、こちらは長期資格情報で毎回入力させると自動同期が成立しない。
**kosync 専用アカウントを作ることを設定画面で勧める**（他サービスと使い回さない）。

### 7-2. Binary 方式は「同じファイル」を要求する

yomikake で開いている ePub が KOReader のものとバイト単位で違えば Binary は当たらない。
連載小説を再ダウンロードすると当然変わる。**これは仕様であって不具合ではない**ので、
設定画面と、pull が空振りしたときのトーストで説明する（「同じファイルですか／Filename 方式も試しますか」）。

### 7-3. 押し戻す XPointer が crengine で解決される保証は無い

§2-5 の実測で「crengine → ブラウザ」の解決は確認できたが、**逆方向（ブラウザ → crengine）は
KOReader 実機でしか確かめられない**。そこで §4-3 のとおり
**(a) ブロック要素どまり (b) 送る前に自分で検算 (c) 駄目なら章頭へ落とす** の 3 段で守る。
章頭へ落ちた場合は長い章で位置が戻るので、**自動同期の説明文にその可能性を書いておく**。

### 7-4. 公式サーバが調査時点で落ちている

`sync.koreader.rocks` は 522。恒久的な話かは不明だが、**既定サーバを埋め込まない**理由にはなる。
サーバ URL は必ずユーザーが入れる（プレースホルダで例示するだけ）。

---

## 8. 段階実装（案）

| Step | 中身 | 検証 |
|---|---|---|
| **0** | ~~C1 プロキシ ＋ KOReader 側 URL 設定~~ **✅ 完了（2026-08-30）** / 残: `sw.js` に除外 1 行（Step 1 と同時に入れる） | **Android・PocketBook の両実機で同期成功**。`https://www.ayati.com/kosync/users/auth` が上流の 401 を返すことも確認済み |
| **1** | MD5 インライン ＋ `koPartialMd5` / `koFilenameMd5` ＋ `epub_kosync_docs` ＋ `sw.js` 除外 | **✅ 完了（2026-08-30）** — 実蔵書 2 冊で KOReader 実機のサイドカーと一致。`tests/cases/kosync.js`（両ファイル各 53 assertion）|
| **2** | 設定 UI・認証・接続テスト・登録。i18n 4 言語 | **✅ 完了（2026-08-30）** — 接続テストの実通信は **ayati.com にデプロイしないと試せない**（localhost には `/kosync/` が無く、直接 send2ereader を指すと CORS で弾かれる）。Step 5 まで通してから 1 度デプロイして確認する |
| **3** | **pull**（U1・U3）: 手動ボタン → §4-2 の 3 段解決でジャンプ・S4 のトースト | 実測 XPointer をテストベクタに入れる（`tests/cases/kosync.js`）＋ 実機 |
| **4** | **push**（U2）: §4-3 の生成＋自己検算＋章頭フォールバック | **KOReader 実機で送った位置が開くこと**（ここだけは実機でしか確かめられない） |
| **5** | 自動同期（S5 の安全弁込み） | 実機・2 端末 |
| **6** | 乱れた ePub での解決失敗を実データで詰める（`autoBoxing` 実例の収集） | 実機 |

Step 3 と 4 が本人のマスト（U1 / U2）。**Step 5 までで一区切り**にして、Step 6 は別リリースにする。

**§2-5 の実測により Step 6 は「精度向上」から「例外潰し」に格下げされた** — 精度は Step 3/4 で出る見込み。

---

## 9. 未確定・確認したいこと

### 9-1. ~~partial MD5 の先頭オフセット~~ → 決着済み（2026-08-30）

KOReader 実機のサイドカーと照合し **先頭オフセット 0 で確定**。§2-2 参照。
ついでに §2-5（XPointer の解決可能性）と §2-6（percentage のずれ）も同じサイドカーで実測できた。

### 9-2. ~~`www.ayati.com` で動的処理が回せるか~~ → 決着済み（2026-08-30）

Apache/2.4.58 (Ubuntu) で設定変更が可能。**§3-5 の案 C（`/kosync/` リバースプロキシ）で確定。**
残りは C1 と C2 のどちらにするかだけで、これは yomikake のコードに影響しない（§3-4）。

### 9-3. 細部

- `Math.roundPercent()` の桁数（判定に使わないので実害なし）。なお**サイドカーの
  `percent_finished` は丸められていない生値**（実測 `0.06951871657754`）で、丸めは kosync 送信時に掛かる
- 公式サーバ以外の実装で `GET /syncs/progress` が「記録なし」に何を返すか（404 / 200＋空）の網羅
- KOReader 側「同期方法」の設定と `metadata` 送信の有無が、サーバの一覧表示にどう出るか

### 9-4. 決定事項（2026-08-30 に全件決着）

1. **使うサーバ** → **C1（Apache で send2ereader を中継）**。§3-5・稼働確認済み
2. **自動同期の既定** → **OFF**。Drive 自動保存と揃える。KOReader 側にも自動/手動の設定があり、
   両方が勝手に動くと「どちらが位置を書いたか」を追えなくなる。まず手動で挙動を掴んでから ON にできる
3. **リリース単位** → **Step 1〜5 をまとめて 1 リリース**。マスト要件 U1/U2 が揃って初めて
   実機テストが意味を持つため、途中で出すと検証の手間が増えるだけになりやすい
4. ~~Phase 1 の push が「章頭まで」で許容できるか~~ → §2-5 の実測で不要になった
