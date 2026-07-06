# 設計書：読みかけリスト「残り時間が短い順」ソート＋残り時間常時表示

作成: 2026-07-06 ／ 対象: `yomikake.html` / `yomikake_ios.html` 両ファイル ／ バージョン候補: v2.4.0

## 0. 目的・ユースケース

「**2時間くらいで読み終わりそうな本を探す**」を可能にする。

Web 小説（なろう・カクヨム）は数百章（書籍数十冊分）の作品と連載途上数十章の作品が混在し、
進捗率は残り時間の指標にならない（進捗 50% でも残り 40 時間の本と残り 30 分の本がある）。
紙書籍前提の「進捗率ソート」しかない有償ストア付属リーダーとの差別化点であり、
残り時間はソート時だけでなく**リストカードに常時表示**する。

## 1. 前提（既存インフラ・v2.0.0/v1.14.0 で構築済み）

| 資産 | 内容 |
|------|------|
| `epub_book_stats`（localStorage 1キー） | `bookKey → { ms:{dev:ms}, chars, total, firstAt }`。ms=デバイス別読書時間、chars=既読文字数（max 単調増加）、total=本文総文字数（max） |
| `_rdSpeed(stat)` | `chars ÷ (Σms/60000)`〔字/分〕。ms>1分ガード |
| `_rdTimeToFinish(stat)` | `(total−chars) ÷ 速度`。読書データ画面で表示済み |
| `_rdFmtDuration(ms)` | 「1時間20分」形式の i18n 整形 |
| Drive 同期 | `collectBookmarks()` が `bookStats` としてマップ丸ごと同梱。`_rdMergeBookStats()` がフィールド別 max マージ。墓標・purge は `_rlPurgeLocalData()` でエントリ削除済み |
| ソート基盤 | `_RL_SORTS` ホワイトリスト＋ `_rlFilterSort()` の cmp テーブル＋ `#rl-sort-menu` ボタン＋i18n |

**ギャップ**：(1) FXL は chars/total が無い（時間 ms のみ計測）、(2) `total` は新ビルドで開いた本にしか無い、(3) 読み始め直後の本の実測速度はノイズ。

## 2. 基本方針

- **速度・残り時間は保存しない**。保存は生の蓄積値（ms / chars / total）のみ、表示のたびに導出（既存方針踏襲。max マージ規則を崩さない）。
- **FXL は単位を「ページ」に読み替えて同じフィールドに入れる**：`chars` = 到達最大ページ数、`total` = spineCount。max マージ・連載巻数増への追従・エクスポート・墓標がすべて既存インフラのまま成立する。
- 単位判別のため stats エントリに **`fxl: true` フラグを追加**（唯一のスキーマ拡張）。
- 速度は **3段フォールバック**：本ごと実測 → 全体平均（reflow/FXL 別プール）→ 既定値定数。

## 3. データモデル変更

### 3.1 `epub_book_stats` エントリ（FXL 本のみ拡張）

```jsonc
"epub_pos_ワンピース__尾田栄一郎": {
  "ms":    { "abc123": 720000 },
  "chars": 42,        // FXL: 到達最大ページ（spineIdx+1 の max）
  "total": 198,       // FXL: spineCount
  "fxl":   true,      // ★新規。単位がページであることを示す
  "firstAt": "..."
}
```

reflow 本のエントリは**無変更**（`fxl` フィールド無し＝reflow）。

### 3.2 書込みポイント（FXL 分岐の追加）

- **`_rdComputeBookChars()`** — 現在 `state.renderMode === 'fxl'` で early return している箇所に FXL 分岐を追加：
  `e.total = max(e.total, state.spine.length)`、`e.fxl = true` を書込み（墓標ガード
  `localStorage.getItem(key) !== null` は reflow 側と同一）。バックグラウンド文字数計測は不要なので同期的に即書き。
- **`_rdUpdateReadChars()`** — 現在 FXL で early return。FXL 分岐を追加：
  `pages = state.currentSpineIdx + 1` を `e.chars` に **max 書込み**（reflow の chars と同じ規則）。
  呼び出しタイミングは既存のまま（`_rdFlush()` 冒頭から毎回）。

### 3.3 マージ規則（`_rdMergeBookStats()` の修正・**必須**）

現行実装は `merged = { ms, chars, total, firstAt }` を**明示フィールドで再構築**するため、
修正しないと `fxl` フラグが同期のたびに消える。追加規則：

| フィールド | マージ |
|-----------|--------|
| `fxl` | **truthy 優先**（`cur.fxl || r.fxl` なら `true`、どちらも無ければフィールド自体を付けない） |

エクスポート／Drive アップロードは `bookStats` マップ丸ごとなので**変更不要**。

旧ビルド互換：旧ビルドは `fxl` を無視（マージで落とす）が、新ビルドはローカルの `cur.fxl` を
温存するため、リモートにフラグが無くても消えない。旧ビルド端末側は本を開き直せば自己修復。

## 4. 残り時間の推定アルゴリズム

### 4.1 定数

```js
const _RD_EST_MIN_MS = 600000; // 本ごと実測速度を信頼する最小累計読書時間（10分）
const _RD_DEF_CPM    = 500;    // 既定速度: reflow〔字/分〕（日本語平均 400-600 の中庸）
const _RD_DEF_PPM    = 6;      // 既定速度: FXL〔頁/分〕（マンガ 10秒/頁）
```

※ 既存 `_rdSpeed()` の 1 分ガードは読書データ画面用にそのまま残す。ソート用の採用判定は
10 分（`_RD_EST_MIN_MS`）とより保守的にする — 開いて 90 秒の本の実測はノイズのため。

### 4.2 全体平均速度 `_rdGlobalSpeeds(statsMap)`

reflow（字/分）と FXL（頁/分）を**別プール**で集計：

```js
function _rdGlobalSpeeds(m) {
  let rc = 0, rm = 0, fc = 0, fm = 0;
  for (const k in m) {
    const e = m[k], ms = _rdBookTime(e);
    if (!(+e.chars > 0) || ms < 60000) continue;      // 実質未読エントリは除外
    if (e.fxl) { fc += +e.chars; fm += ms; } else { rc += +e.chars; rm += ms; }
  }
  return { cpm: rm >= _RD_EST_MIN_MS ? rc / (rm / 60000) : 0,   // プール合計10分未満は不採用
           ppm: fm >= _RD_EST_MIN_MS ? fc / (fm / 60000) : 0 };
}
```

### 4.3 本ごとの推定 `_rdEstTimeLeft(item, stat, glob)` → ms | null

```js
function _rdEstTimeLeft(item, stat, glob) {
  if (item.finished) return null;                       // 読了は対象外（末尾グループ）
  const fxl = !!(stat && stat.fxl);
  const total = fxl ? Math.max(+(stat.total) || 0, item.spineCount)  // FXL は spineCount で補完可
                    : +((stat || {}).total) || 0;
  if (total <= 0) return null;                          // 総量未計測 → 推定不能
  const pct  = Math.max(0, Math.min(1, (item.spineIdx + item.ratio) / item.spineCount));
  const read = (+((stat || {}).chars) > 0) ? +stat.chars : total * pct; // chars 優先・無ければ進捗率で近似
  const bookMs = _rdBookTime(stat);
  const speed = (stat && +stat.chars > 0 && bookMs >= _RD_EST_MIN_MS)
      ? stat.chars / (bookMs / 60000)                   // ① 本ごと実測
      : (fxl ? glob.ppm : glob.cpm)                     // ② 全体平均（モード別）
        || (fxl ? _RD_DEF_PPM : _RD_DEF_CPM);           // ③ 既定値
  return Math.max(0, total - read) / speed * 60000;
}
```

設計判断のメモ：

- **`read` は chars 優先**。chars は実測（max 単調）で正確。進捗率×total は章の長さの
  ばらつきで誤差が出るため、chars が無い場合（Drive 同期で stats だけ来た等の稀ケース）の近似に限る。
- **連載更新（同作品の長いファイルを開き直し）**：total は max 書込みなので新ファイルで自動増加、
  chars は絶対量なのでそのまま有効。開き直すまでは旧 total ベースの過小見積りになるが許容。
- **FXL の total は `max(stat.total, spineCount)`**：フラグさえ付けば `epub_pos_*` の
  spineCount からも推定できるため、stats の total が古くても最新の spineCount が勝つ。
- **推定不能（null）となるのは**：読了本／total 未計測の reflow 本（新ビルドで未オープン）／
  旧データのみの FXL 本（フラグ未付与）。いずれも**開き直せば自己修復**するため移行処理は作らない。

## 5. UI

### 5.1 ソートオプション追加

- `_RL_SORTS` に `'timeLeft'` を追加。**定数は変数宣言部（`let _rlPrefs = _rlLoadPrefs()` の直前）
  で定義されている現在位置を維持**（TDZ 罠 — CLAUDE.md 記載）。
- `#rl-sort-menu` に `<button data-sort="timeLeft" onclick="setRlSort('timeLeft')">` を 1 行追加
  （`progressLow` の下）。
- cmp テーブルに追加：

```js
timeLeft: (a, b) => {
  const ea = a.timeLeftMs, eb = b.timeLeftMs;
  if (ea == null && eb == null) return byRecent(a, b);
  if (ea == null) return 1;      // 推定不能は末尾（著者順の「著者なしは末尾」と同パターン）
  if (eb == null) return -1;
  return ea - eb || byRecent(a, b);
},
```

### 5.2 推定値の算出タイミング

`_rlCollect()` の冒頭で `epub_book_stats` を **1 回だけ** `_rdLoadBookStats()` で読み、
`_rdGlobalSpeeds()` を 1 回計算。各 item に `timeLeftMs: number | null` を付与する。
（`_rlCollect` は読書データ画面からも呼ばれるが、フィールド追加は無害。
単一キーの JSON.parse ×1 なのでコストは無視できる。）

### 5.3 カード常時表示

`_rlRender()` のメタ行 `.rl-meta-left` 内、`rl-date` の後ろ（`rl-offline` バッジの前）に：

```js
${item.timeLeftMs > 0 ? `<span class="rl-timeleft">${t('readingList.timeLeft',
    { t: _rdFmtDuration(item.timeLeftMs) })}</span>` : ''}
```

- `timeLeftMs === null`（推定不能）と `0`（残りゼロだが未読了判定）は非表示。
- 速度の由来（実測/平均/既定値）による表示の書き分けは**しない**（常に「約」で統一 —
  UI をシンプルに保つ。将来必要なら確度マーカーを検討）。
- CSS：`.rl-timeleft { white-space:nowrap; }` 程度。`view-grid` でも表示する
  （`.rl-meta-left` は `min-width:0` 済みで、あふれた場合は既存の flex 挙動で収まる。
  グリッドで窮屈なら `.view-grid .rl-timeleft` の font-size 調整で対応）。

### 5.4 i18n キー（4 言語 × 両ファイル）

| キー | ja | en | zh-TW | zh-CN |
|------|----|----|-------|-------|
| `readingList.sort.timeLeft` | 残り時間が短い順 | Shortest time left | 剩餘時間短至長 | 剩余时间短至长 |
| `readingList.timeLeft` | ⏱ 残り約{t} | ⏱ ~{t} left | ⏱ 剩餘約{t} | ⏱ 剩余约{t} |

`{t}` には `_rdFmtDuration()` の結果（既存の `readingData.durHM`/`durM` 経由で翻訳済み）が入る。

## 6. エッジケース・非機能

| ケース | 挙動 |
|--------|------|
| 読了本（showFinished ON で表示中） | `timeLeftMs = null` → timeLeft ソートでは末尾グループ・表示なし（残り 0 分で先頭に来るのを防ぐ） |
| total 未計測の reflow 本 | null → 末尾・表示なし。開き直しで自己治癒 |
| フラグ未付与の FXL 本（旧データ） | reflow 扱い → total=0 → null。開き直しで治癒 |
| chars > total（理論上ほぼ無し） | `Math.max(0, total-read)` で残り 0 → 非表示 |
| 全 stats 空の新端末 | glob 両方 0 → ③既定値。ただし total が無いので実際は全件 null（表示なし）— Drive 同期で stats が来れば復活 |
| 墓標・完全削除 | stats エントリごと削除（既存処理のまま）。追加対応なし |
| quota | `_rdSaveBookStats` の既存 try/catch のまま。追加書込みは FXL 本の total/fxl/chars のみで増分は微小 |
| **読書データ画面「最後に開いた本」パネル**（実装時に判明） | FXL に `chars`(=ページ数) が入ると `_rdSpeed`/`_rdTimeToFinish` が発火し「◯字/分」と**誤表示**する。パネル側で `const isFxlBook = !!(stat && stat.fxl)` を見て FXL 時は `spd=ttf=0`（＝非表示）にガード。残り時間の露出は読みかけリストの ⏱ が担当し、統計パネルの速度表示は従来どおり reflow 限定を維持 |

## 7. 実装チェックリスト

両ファイル（`yomikake.html` = CRLF / `yomikake_ios.html` = LF）に同一適用：

- [ ] 定数 `_RD_EST_MIN_MS` / `_RD_DEF_CPM` / `_RD_DEF_PPM`
- [ ] `_rdComputeBookChars()` FXL 分岐（total=spineCount・fxl=true 書込み）
- [ ] `_rdUpdateReadChars()` FXL 分岐（chars=到達最大ページ max 書込み）
- [ ] `_rdMergeBookStats()` に `fxl` truthy マージ追加
- [ ] `_rdGlobalSpeeds()` / `_rdEstTimeLeft()` 新設
- [ ] `_rlCollect()` で stats 読込＋ `timeLeftMs` 付与
- [ ] `_RL_SORTS` へ `'timeLeft'` 追加（宣言位置は現状維持・TDZ 注意）
- [ ] `_rlFilterSort()` cmp テーブルに `timeLeft` 追加
- [ ] `#rl-sort-menu` ボタン追加
- [ ] `_rlRender()` メタ行に `.rl-timeleft` チップ＋CSS
- [ ] 読書データ「最後に開いた本」パネルに FXL ガード（`spd/ttf` を FXL 時 0）— §6 参照
- [ ] i18n 2 キー × 4 言語 × 2 ファイル
- [ ] ヘルプ（`help.body` 読みかけリスト節）に一文追記

### テスト観点（単体・node で関数抽出方式 = G2.1 と同様）

1. `_rdEstTimeLeft`：reflow 実測（10分超）／実測不足→全体平均／stats 無し→null／
   FXL フラグ＋spineCount 補完／chars 無し→pct 近似／finished→null／残り負→0
2. `_rdGlobalSpeeds`：reflow・FXL プール分離／10分未満プール不採用
3. `_rdMergeBookStats`：fxl 温存（cur 側のみ・remote 側のみ・両方無し）
4. cmp `timeLeft`：null 末尾・同値 byRecent
5. FXL 書込み：chars max 非減少・total=spineCount・墓標ガード

ブラウザ実機：reflow 本と FXL 本を混ぜて timeLeft ソート・カード表示・Drive 往復で fxl フラグ生存を目視。
