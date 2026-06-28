# 読書データ機能 設計書（design_reading_data.md）

yomikake（`yomikake.html` / `yomikake_ios.html`）に kobo / justread 風の **読書統計（読書データ）画面**を追加するための設計書。
両ファイル共通実装。Drive 端末間同期を前提とする。

- 作成日: 2026-06-28
- 対象バージョン: v1.12.x 以降（予定）
- 関連: `design_reading_list_v2.md`（読みかけリスト v2）、`CLAUDE.md`

---

## 0. 設計の最優先方針

1. **Drive 端末間同期は前提**。累積系の数字（読書時間・冊数）は **「取りこぼしなく累積」を最優先**し、精確さ（厳密な秒単位）は二の次とする。
2. ただし設計上は **取りこぼしゼロ かつ 二重計上ゼロ** を両立する（後述のデバイス別アキュムレータ）。
3. **Drive 同期の仕様はこの設計で確定（ロック）**する。グループ2/3 を後日実装しても同期スキーマを変えない。だからグループ1 実装より先に、G2/G3 まで含めてデータモデルと同期項目を確定させる。
4. **セッション生ログは持たない**。すべて集計値のみ（本ごと1レコード・日ごと1レコード）に圧縮し、localStorage 肥大化を避ける。
5. 後方互換：旧ビルドは新キー・新フィールドを無視するだけで壊れない。

---

## 1. スコープと段階リリース

| グループ | 内容 | 時間計測 | 今回 |
|---|---|---|---|
| **G1** | 読了率・読了冊数・読みかけ冊数・著者グラフ・最近読了 | 不要 | **実装する（画面込み）** |
| **G2** | 累計読書時間・本ごと読書時間・「最後の本」パネル | 必要 | **実装済み（v1.13.0・§14）** |
| **G2.1** | 文字数（既読/総）・読書スピード・読了所要時間 | 必要 | **実装済み（§14.4）** |
| **G3** | 連続 日/週/月・読書カレンダー・週次/月次ペース | 必要 | 設計のみ（同期項目確定） |

- G1 で追加する保存項目は **`epub_pos_*` への `finishedAt` と `creators` の2フィールドだけ**。時間計測インフラ（`epub_book_stats` / `epub_reading_days`）は G1 では作らない。
- ただし **同期マージ規則は G1 時点で G2/G3 分も含めて実装**しておく（受信したら無視せずマージできる状態にし、将来の相互運用で取りこぼさない）。

---

## 2. 同期アーキテクチャ：デバイス別アキュムレータ（中核）

### 2.1 端末ID

```
epub_device_id = "<16文字程度のランダム英数字>"   // localStorage のみ・Drive 同期しない
```

- 初回起動時に未設定なら生成（`crypto.getRandomValues` ベース）。
- **この端末は、累積値のうち「自分の ID の欄」だけを書く**（=自分の数字は単調増加）。

### 2.2 マージ規則（2手だけ）

すべての累積値は `{ deviceId: 値 }` のマップで保持し、

1. **同じ deviceId の値は `max` を採用**（古いコピーを受信しても壊れない／単調増加を前提に最新を拾う）
2. **合計は全 deviceId の和**（端末ごとに別実読なので二重計上しない）

### 2.3 なぜ堅いか（収束例）

ある日の読書時間（スマホ=abc, PC=def）:

| 状態 | abc 欄 | def 欄 | 合計 |
|---|---|---|---|
| スマホ単体 | 31分 | (なし) | 31分 |
| PC単体 | (受信前) | 10分 | 10分 |
| 同期後（両端末とも） | 31分 | 10分 | **41分** |

- どの端末でも 41分 に収束する。
- スマホが圏外で読んでも、後でアップした瞬間に `max` で拾われる → **取りこぼしゼロ**。
- 同一実読は片方の端末でしか記録されない → **二重計上ゼロ**。
- localStorage クリア等で端末が新 ID を取得しても、旧 ID 欄は Drive に残り `max` で復活（=過去分は失われない）。

> 単純な「合計1スカラー」では、同期のたびに二重加算するか max で片方が消える。**デバイス別マップにした瞬間に両問題が解決する。** これが G2/G3 で同期仕様を再変更せずに済む根拠。

---

## 3. データモデル（localStorage 全キー）

| キー | グループ | 同期 | 説明 |
|---|---|---|---|
| `epub_pos_*`（既存） | - | する | 既存値に **`finishedAt`**, **`creators`** を追加 |
| `epub_last_book`（既存） | - | する | 変更なし |
| `epub_purged`（既存・墓標） | - | する | 変更なし（union）。purge 時に `epub_book_stats` も連動削除 |
| **`epub_book_stats`** | G2 | する | 本ごと集計（時間・文字数） |
| **`epub_reading_days`** | G3 | する | 日ごと読書時間ログ |
| `epub_device_id` | - | **しない** | 端末ID |
| `epub_reading_data_prefs` | - | しない | 統計画面の表示設定（著者表示件数など） |

### 3.1 `epub_pos_*`（既存・フィールド追加）

```jsonc
{
  "spineIdx": 5, "ratio": 0.42, "lastOpenedAt": 1719500000000,
  "creator": "ルイス・フロイス・松田毅一・川崎桃太",  // 既存：連結文字列（後方互換用に残す）
  "spineCount": 12, "cover": "...",
  // ↓ G1 で追加（どちらも任意。旧ビルドは無視）
  "finishedAt": "2026-06-27T10:00:00.000Z",          // 読了検出が初めて立った時刻
  "creators": ["ルイス・フロイス", "松田毅一", "川崎桃太"] // OPF dc:creator を配列のまま保持
}
```

- `creators` は **OPF 解析時に `dc:creator` 要素を1件=1著者として配列化**して保存（連結前の生データ）。これにより「ルイス・フロイス」を分割せず、共著は各著者に分けて数えられる（§6.3）。
- 既存データには `creators` が無い → 著者グラフでは `creator` 文字列を **丸ごと1キー**として扱う（共著+1 のフォールバック）。

### 3.2 `epub_book_stats`（G2・本ごと1レコード）

```jsonc
{
  "<bookKey>": {
    "ms":      { "abc123": 720000, "def456": 300000 }, // 読書時間(ms)・デバイス別
    "chars":   48000,    // 既読文字数（max・単調増加）
    "total":   152000,   // 本の総文字数（章追加で増えうる→max）
    "firstAt": "2026-06-20T00:00:00.000Z" // 初回読書（min）
  }
}
```

- 本の読書時間 = `Σ ms[*]`、速度 = `chars ÷ (Σms/60000)` 〔文字/分〕、残り時間 = `(total - chars) ÷ 速度`。
- 読了日は `epub_pos_*.finishedAt` を参照（重複保持しない）。

### 3.3 `epub_reading_days`（G3・日ごと1レコード）

```jsonc
{
  "days": {
    "2026-06-28": { "abc123": 1860000, "def456": 600000 }  // ms・デバイス別
  }
}
```

- 自分の欄に書く際の deviceId は `epub_device_id` を参照する（構造体内に `device` を**持たない**＝同期で上書き事故が起きないため。§12-A 参照）。
- 日付キーは**端末ローカル時刻の `YYYY-MM-DD`**（厳密な秒精度より「その日読んだか」を重視）。
- 年365件・極小。連続日/週/月、カレンダー、週次/月次ペースをすべてここから導出（本の内訳は持たない=履歴不要）。
- 剪定：カレンダーで数年遡れる要件のため、保持は **最低3年（1095日）**。1日 ≒ 数十バイトなので3年でも〜数十KB程度に収まる。具体値は G3 実装時に確定。

---

## 4. 同期項目とマージ規則（確定）

**重要（§12-B）：`epub_book_stats` / `epub_reading_days` は同期ペイロードの `bookmarks` には入れない。**
現行の取り込みループは `bookmarks` 内のキーを **無条件 `localStorage.setItem`（=丸ごと上書き）** するため、デバイス別マップを入れると他端末の累積を破壊する。
よって `purged` と同様に **ペイロード直下の独立フィールド**（`bookStats` / `readingDays`）として持ち、**専用のディープマージ**で取り込む。

```jsonc
{ "version": 1, "exportedAt": "...", "bookmarks": {...},
  "purged": [...],            // 既存
  "bookStats": { ... },       // = epub_book_stats（G2）
  "readingDays": { ... } }    // = epub_reading_days の days（G3）
```

`collectBookmarks()` に上記フィールドを追加。import / `driveDownload()` の取り込み時に以下を適用。

| 対象 | マージ規則 |
|---|---|
| `epub_pos_*`（本体） | 既存ロジック（先行/墓標）を踏襲 |
| `epub_pos_*.finishedAt` | **最古の非null**（最初に読了した日を残す） |
| `epub_pos_*.creators` | 受信側に有り・ローカルに無ければ採用（基本は不変。配列はそのまま） |
| `epub_book_stats[k].ms[dev]` | デバイスごとに **max** |
| `epub_book_stats[k].chars` | **max** |
| `epub_book_stats[k].total` | **max** |
| `epub_book_stats[k].firstAt` | **最古（min）** |
| `epub_reading_days.days[date][dev]` | デバイスごとに **max** |
| `epub_purged`（墓標） | 既存（union）。完全削除時は `epub_book_stats[k]` も削除し孤児を残さない |

- `epub_device_id` / `epub_reading_data_prefs` は **同期対象外**。
- 旧ビルドは未知の直下フィールド（`bookStats` / `readingDays`）を読まず、`bookmarks` と `purged` だけ見るので破壊しない（前方互換）。`version` は 1 のまま据え置き（読み取りは version でゲートしない）。
- **`bookStats` のディープマージ手順**: 受信側 `bookStats[k]` ごとに、ローカル `epub_book_stats[k]` と §4表の規則で統合（`ms[dev]`=max, `chars`=max, `total`=max, `firstAt`=min）。**ただし墓標済み（§12-C）またはローカルに `epub_pos_k` が存在しない本はスキップ**（孤児を作らない）。
- **`readingDays` のディープマージ手順**: 受信側 `readingDays[date][dev]` ごとに `max`。墓標は適用しない（本に紐づかないため。§12-E）。
- マージ後に **孤児掃除**（§12-D）を実行する。

---

## 5. 画面設計：「📊 読書データ」

### 5.1 入口

- **① ウェルカム画面のカード**（読みかけリストの近く）
- **② ツールバーの 📊 ボタン**

両方から同じ画面（フルスクリーンのオーバーレイ）を開く。読みかけリストの兄弟として実装。

### 5.2 レイアウト（G2/G3 の枠を最初から確保）

```
┌─ 📊 読書データ ──────────────────[×]┐
│                                          │
│  ╔══ 最後に開いた本 ════════╗  ← G2(後日)│
│  ║  進行% / この本の時間 / 速度 / 残り時間 ║ │
│  ╚════════════════════════╝           │
│                                          │
│  ╔══ 継続 ════════════════╗  ← G3(後日)│
│  ║  連続 日 / 週 / 月  ＋  草グラフ       ║ │
│  ╚════════════════════════╝           │
│                                          │
│  ── すべての本 ─────────────            │ ← G1
│     ◐ 41%        12         5           │
│    読了率      読了冊数    読みかけ        │
│   〔累計時間は G2 で右端に追加〕          │
│                                          │
│  ── よく読む著者 ───────────            │ ← G1
│   ルイス・フロイス  ███████ 8            │
│   司馬遼太郎       █████  5             │
│   宮部みゆき       ███   3              │
│              （上位8件・残りは「他N人」） │
│                                          │
│  ── 最近読了 ───────────────           │ ← G1
│   ▸ 回想の織田信長        2026-06-27    │
│   ▸ 〇〇〇〇〇〇          2026-06-20    │
│              （直近10件・タップで再オープン）│
└──────────────────────────────────────┘
```

- G1 では「最後に開いた本」「継続」枠は **DOM ごと出さない**（G2/G3 実装時に有効化）。プレースホルダは表示しない。
- G2 実装時：「すべての本」行の右端に **累計読書時間** を追加、「最後に開いた本」枠を有効化。
- G3 実装時：「継続」枠を有効化。

---

## 6. グループ1 詳細仕様（今回実装）

### 6.1 集計パイプライン

`buildReadingData()`:
1. `epub_pos_*` を全走査して `{bookKey, val, finished}` を収集（`finished` = `spineIdx>=spineCount-1 && ratio>0.9`。`spineCount` は `val.spineCount` 優先、無ければ `parseBookKey`）。
2. 墓標（`epub_purged`）該当・パース不能は除外。
3. 指標を算出（§6.2）。
4. innerHTML を生成して `#reading-data-*` に流し込む。

### 6.2 指標（時間計測ナシで算出）

- **読了率** = 読了数 ÷ 開いた本の総数（= 読みかけリスト対象の全件）。母数は「開いた本」（yomikake にライブラリ概念は無いため）。ドーナツで表示。
- **読了冊数** = `finished` の数。
- **読みかけ冊数** = 非 `finished` の数。
- **よく読む著者**（§6.3）。
- **最近読了** = `finishedAt` 降順・直近10件。`finishedAt` 欠落の既存読了本は `lastOpenedAt` にフォールバック。各行タップで `openFilePickerForBook(bookKey)`（既存の再オープン経路）。

### 6.3 著者カウント（確定仕様）

- 本の著者キー集合を求める：
  - `val.creators`（配列）が有れば **各要素を1著者としてカウント**（共著は各人に +1）。
  - 無ければ `val.creator`（連結文字列）を **丸ごと1キー**として +1（フォールバック=共著扱い、誤分割しない）。
- **「・」で再分割はしない**（「ルイス・フロイス」を誤って2人に割らないため）。
- 対象は **読了本**（`finished`）を既定とする。表示は降順、上位8件、残りは「他N人」。
- 正規化：著者名は `_rlNorm()` 相当（NFKC＋trim）でキー化し表記ゆれを軽減（表示は原文）。

### 6.4 `finishedAt` / `creators` の書き込み

- **`finishedAt`**：読了状態が**初めて**立った時に1度だけセット。書き込み箇所＝ `showFinishedBanner()`（`_bookFinished=true` の地点）／`closeBook()` で読了保存する地点／`EPUB_EDGE` の末尾読了判定。既存値があれば上書きしない（最古を保持）。
- **`creators`**：`loadEpub()` の OPF 解析で `dc:creator` 要素群を配列化し、`saveBookMeta()` で `epub_pos_*` に保存。
- どちらも quota 安全弁：`saveBookMeta()` / `savePos()` の QuotaExceeded 時は既存どおり `cover` を先に落として再書き込み（読書位置＞統計）。

### 6.5 表示設定 `epub_reading_data_prefs`

```jsonc
{ "authorScope": "finished", "authorLimit": 8 }
```
- ホワイトリスト検証付きロード（`design_reading_list_v2.md` の `_rlLoadPrefs()` に倣う）。同期しない。

### 6.6 i18n（4言語：ja / en / zh-TW / zh-CN）

追加キー（命名は仮）:
`readingData.title`, `readingData.allBooks`, `readingData.completionRate`, `readingData.finishedCount`,
`readingData.readingCount`, `readingData.topAuthors`, `readingData.othersN`, `readingData.recentFinished`,
`readingData.empty`（データ無し時）, `readingData.openBook`。
G2/G3 分（`readingData.lastBook`, `.totalTime`, `.speed`, `.timeToFinish`, `.streakDay/Week/Month`, `.calendar`, `.pace` など）は実装時に追加。

---

## 7. グループ2 設計（後日実装・同期項目は確定済み §3.2/§4）

### 7.1 読書時間の計測（idle フィルタ付き）

- **活動シグナル**（=ページめくり相当）：`EPUB_POS`、`scrollPage()`、`EPUB_EDGE`、`navigateToToc()`、FXL ズームのステップ移動。
- **計測ロジック**：`_lastActivityTs` を保持。シグナル受信ごとに `delta = now - _lastActivityTs`。
  - `delta < IDLE_THRESHOLD`（既定 **180秒**）なら、`delta` を「現在の本の `ms[self]`」と「今日の `days[today][self]`」に加算。
  - `delta >= IDLE_THRESHOLD` なら加算せず（=放置時間を除外）、`_lastActivityTs` のみ更新。
  - `visibilitychange`（タブ非表示）/ `closeBook()` で確定フラッシュし、`_lastActivityTs` をリセット。
- **書き込み**：デバウンス（例 5秒）＋ `visibilitychange` / `closeBook` 即時フラッシュ。`self = epub_device_id` 欄のみ更新。

### 7.2 文字数

- `loadEpub()` 時に各 spine の本文文字数（検索用の HTML 除去ロジックを流用）を算出しキャッシュ。`total = Σ`。
- `chars`（既読）= 完了済み spine の文字数和 ＋ `現在 spine 文字数 × _intraChapterRatio`。`epub_book_stats[k].chars` には **max** で書く（戻り読みで減らさない）。

### 7.3 派生指標

- 本の読書時間 = `Σ ms[*]`。
- 読書スピード〔文字/分〕 = `chars ÷ (Σms / 60000)`（極小分母ガード）。
- 読了所要時間 = `(total - chars) ÷ 速度`。
- 「最後に開いた本」= `lastOpenedAt` 最大の `epub_pos_*`。パネルに 進行% / 本の時間 / 速度 / 残り時間。
- 累計読書時間 = `epub_reading_days` 全日 `Σ Σ days[*][*]`（=全体時間の単一ソース。`epub_book_stats.ms` は本別内訳用）。

> 注：累計の単一ソースは `epub_reading_days`。`epub_book_stats.ms` は本別表示用で、合計が日次合計と完全一致しなくても許容（方針 §0-1）。

---

## 8. グループ3 設計（後日実装・同期項目は確定済み §3.3/§4）

`epub_reading_days` から導出（端末ローカル日付基準）。「その日読書 = `Σ days[date][*] > 0`」。

- **連続日数**：今日（または昨日）から遡って連続して読書日である日数。
- **連続週数**：ISO 週単位。各週に1日でも読書日があれば「読書週」。連続する読書週数。
- **連続月数**：月単位。各月に1日でも読書日があれば「読書月」。連続する読書月数。
  - 週・月ストリークは「忙しい日を許す」ためのもの（ユーザー要望）。
- **読書カレンダー**：GitHub 草グラフ風（日ごとの時間量を濃淡で）。直近 N 週間/月。
- **週次/月次ペース**：週・月ごとの合計時間の棒グラフ。

---

## 9. 実装上の注意（両ファイル共通）

- インラインハンドラ規約：`esc()` は `'` を非エスケープ → **データはインライン onclick に埋め込まない**。`data-key` 属性＋`this.closest('.rd-card').dataset.key` で受け渡し（読みかけリスト v2 と同方針）。
- 本体 `yomikake.html` は CRLF、`yomikake_ios.html` は LF。
- iOS 版差分：再オープンは IDB キャッシュ経由（FSA 無し）。それ以外の統計ロジックは共通。
- `closeBook()` で G2 の計測フラッシュ＋タイマー停止。`loadEpub()` で `_lastActivityTs` リセット。
- 墓標（完全削除）：削除実体は `_rlPurgeBook()` ではなく **`_rlPurgeLocalData(bookKey)`** で行われる（FSA・IDB・`epub_last_book` もここ）。よって **`_rlPurgeLocalData()` に `epub_book_stats` マップから当該 `bookKey` エントリを削除する処理を追加**する。`_rlApplyTombstones()` が残存本に対して `_rlPurgeLocalData()` を呼ぶので、**端末間の完全削除伝播も自動的に stats へ波及**する。`epub_reading_days` は本に紐づかないため触らない（§12-E）。

---

## 10. 今日の作業範囲

1. 本設計書の確定（G1〜G3 のデータモデル・同期項目をロック）。
2. **G1 実装**：
   - `epub_pos_*` に `finishedAt`（読了検出時）と `creators`（OPF 解析時）を追加。
   - 「📊 読書データ」画面（読了率・読了冊数・読みかけ・著者グラフ・最近読了）。入口①ウェルカムカード＋②ツールバー📊。
   - i18n キー（§6.6）。
   - 両ファイルへ反映。
3. **同期スキーマのロック（G2/G3 を見据えて今回まとめて入れる）**：
   - `collectBookmarks()` に直下フィールド `bookStats` / `readingDays` を追加（G1 時点では空マップでも可）。
   - 取り込み（import / `driveDownload`）に **専用ディープマージ**（デバイス別 max）を追加（§12-B）。`bookmarks` の既存ループには混ぜない。
   - epub_pos 取り込みに `finishedAt`/`creators` の**軽量フィールドマージ**を追加（§12-G 案①）。
   - `_rlPurgeLocalData()` に `epub_book_stats[bookKey]` 削除を追加（§9・§12-C）。
   - consolidate 後に **stats 孤児掃除**パスを追加（§12-D）。
   - これにより、G2/G3 を後日実装してもペイロード構造・マージ方式は変更不要。

## 12. 現行コードとの齟齬レビュー（2026-06-28）

`yomikake.html` の同期・墓標実装（`collectBookmarks` / 取り込みループ / `_rlApplyTombstones` / `_rlPurgeLocalData` / `consolidateBookmarks`）を確認した結果。**A〜F は設計に反映済み**。

### A. reading_days の `device` フィールドは持たない（修正済み）
当初案の `epub_reading_days.device` は、ダウンロード時に他端末の値で上書きされる事故源。構造体から削除し、自分の欄を書く際は `epub_device_id` を参照する（§3.3）。同期は `.days` のみディープマージ。

### B. 新キーを `bookmarks` に入れてはいけない（最重要・修正済み）
現行の取り込みループ（`bookmark-input` change / `driveDownload`）は、`bookmarks` 内の `epub_pos_*` / `epub_last_book` を **無条件 `localStorage.setItem`（丸ごと上書き）** する。
`epub_book_stats` / `epub_reading_days` をここに混ぜると、**他端末のデバイス別累積マップが丸ごと上書きされて消える**（=取りこぼし方針に真っ向から反する重大バグ）。
→ `purged` と同じく **ペイロード直下フィールド**（`bookStats` / `readingDays`）にし、**専用ディープマージ（デバイス別 max）** で取り込む（§4）。

### C. 墓標は「キー単位ハッシュ」。stats も同 bookKey でマッチできる（整合OK）
`_rlHashKey(key)` は `epub_pos_{title}__{creator}` 文字列のハッシュ。`bookKey === state.bookKey`（`makeBookKey` は `'epub_pos_'+...` を返す）なので、`epub_book_stats` を **同じ bookKey でキー**すれば、墓標ハッシュと突き合わせ可能。
ただし `epub_book_stats` は **1キーに全本のマップ**を持つ単一 localStorage キーなので、墓標適用は「キーごと削除」ではなく **マップ内エントリ削除**になる。実装は §9 のとおり `_rlPurgeLocalData()` 内で `map[bookKey]` を消す方式に統一。

### D. stats は epub_pos の存在に従属させる（孤児掃除を追加）
stats には `lastOpenedAt` が無く、墓標の `t >= lastOpenedAt` 判定が使えない。
→ **「対応する `epub_pos_{k}` が無い `epub_book_stats[k]` は破棄」する掃除パス**を、`consolidateBookmarks()` の後（`_rlCleanupLastBook()` の隣）に追加する。これで purge・端末間墓標・後述 F の改名すべてに対し孤児が残らない。stats のインポートも「ローカルに epub_pos_k が無ければスキップ」で統一。

### E. 完全削除しても累計読書時間は減らない（仕様として明記）
`epub_reading_days`（=累計時間の単一ソース）は本に紐づかないため、墓標の対象外。
→ **本を完全削除しても累計読書時間・連続記録・カレンダーは変化しない**（その時間は実際に費やされたため）。減るのは「読了冊数・読了率・本ごと統計」のみ。ユーザー方針（取りこぼさない累積優先）とも一致。

### F. consolidateBookmarks の改名による stats 孤児（G2 で要対応）
`consolidateBookmarks()` は旧 `_{spineCount}` キーを新 `__{creator}` キーへ改名し旧キーを削除する。stats を bookKey で持つと、改名時に旧 bookKey の stats が孤児化し D の掃除で**消える＝その本の本ごと累積時間を失う**。
- 対象は **旧形式キーのみ**。v1.8.11 以降に開いた本は最初から安定キーなので発生しない。G2 の stats 蓄積開始時点では大半の端末で consolidate は実行済み（一度きり）。
- 影響は「本ごと内訳の喪失」だけで、**累計時間は reading_days 側に残る**（E）。
- 安全策：G2 実装時、`consolidateBookmarks()` / `migrateLegacyBookmark()` のキー改名箇所に `epub_book_stats` エントリの付け替えも追加することを推奨（必須ではない）。

### G. finishedAt / creators のマージは丸ごと上書きの影響を受ける（G1 で要判断）
epub_pos は同期時に**丸ごと上書き**（ダウンロードしたファイルが勝つ）。そのため §4 の「`finishedAt`=最古」「`creators`=保持」は、丸ごと上書きのままでは保証されない（リモート側に欠けていればローカルの値が消える）。
- 対策案①（推奨）：取り込みの epub_pos 書き込みを**小さなフィールドマージ**にし、`finishedAt`（最古の非null）と `creators`（リモートに無ければローカル保持）だけ温存。読書位置は従来どおりリモート優先。
- 対策案②：丸ごと上書きのまま許容。`finishedAt` は読了判定の副次情報で再オープン時に復元され自己修復するが、`creators` を失うと著者グラフが劣化する。
- **判断**：著者グラフが目玉なので案①を採用。コスト小。G1 の取り込みループに `epub_pos_*` 用の軽量フィールドマージを入れる。

### まとめ（同期実装の確定事項）
1. ペイロードに `bookStats` / `readingDays` を**直下フィールド**で追加（B）。
2. 取り込みは**専用ディープマージ（デバイス別 max）**（B/§4）。`bookmarks` の既存ループには混ぜない。
3. epub_pos 取り込みに `finishedAt`/`creators` の**軽量フィールドマージ**を追加（G）。
4. `_rlPurgeLocalData()` で `epub_book_stats[bookKey]` も削除（C/§9）。
5. consolidate 後に **stats 孤児掃除**パスを追加（D）。
6. reading_days は墓標非対象。**完全削除で累計時間は減らない**（E）。
7. （G2）consolidate/migrate のキー改名に stats 付け替えを追加推奨（F）。

これで Drive 同期スキーマは G1〜G3 を通して確定。以後の追加はフィールド増分のみで、ペイロード構造・マージ方式は変えない。

## 13. G1 詳細実装設計（現行コードベース・2026-06-28）

> **実装状況（2026-06-28）**: G1 を `yomikake.html`（CRLF）/ `yomikake_ios.html`（LF）両方に実装済み。同期スキーマ（§13.9）も同時にロック実装。JS 構文チェック・主要ロジックの単体テスト（デバイス別 max マージ／孤児掃除／finishedAt 最古・creators 温存／著者ランキング）通過。ブラウザ実機での目視確認は未実施（要手動テスト）。バージョンは v1.12.0 想定（未コミット）。

`yomikake.html` の現行構造（行番号は目安）に即した実装単位。**命名規約**：読書データ画面の関数・変数は `_rd` / `rd` プレフィックス（読みかけリストの `_rl` / `rl` と分離）。両ファイル共通（本体 CRLF・iOS 版 LF）。

### 13.1 `epub_pos_*` への `finishedAt` / `creators` 追記

**(a) `creators` 配列の捕捉**（`loadEpub()` 内・現 `~2063`）
```js
// 現行: state.bookCreator = [...].map(...).filter(Boolean).join('・');
const _creatorEls = [...opfDoc.querySelectorAll('metadata > *|creator, metadata > creator')]
  .map(el => el.textContent.trim()).filter(Boolean);
state.bookCreators = _creatorEls;            // ← 新規（配列・連結前）
state.bookCreator  = _creatorEls.join('・'); // 既存（後方互換の連結文字列）
```
- `state` に `bookCreators: []` を追加（`~1745` の `bookCreator` 隣）。`closeBook()`（`~5067`）で `state.bookCreators = []` リセット。

**(b) `saveBookMeta()` で書き込み**（現 `~5177` の meta オブジェクト）
```js
meta = { ...existing, lastOpenedAt: ..., creator: state.bookCreator,
         ...(state.bookCreators && state.bookCreators.length ? {creators: state.bookCreators} : {}),
         spineCount: state.spine.length, ...(cover ...) };
```
- quota 安全弁（cover 削除リトライ）は現行のまま。`creators` は小さいので落とさない。

**(c) `finishedAt` の書き込み**：全読了経路の単一チョークポイント `showFinishedBanner()`（`~5099`）に1行追加する。
```js
function showFinishedBanner() {
  _bookFinished = true;
  _rdMarkFinishedAt();          // ← 新規
  ...
}
function _rdMarkFinishedAt() {  // 既存値があれば上書きしない（最古保持）
  if (!state.bookKey) return;
  try {
    const v = JSON.parse(localStorage.getItem(state.bookKey)) || {};
    if (v.finishedAt) return;
    v.finishedAt = new Date().toISOString();
    localStorage.setItem(state.bookKey, JSON.stringify(v));
  } catch (e) {}
}
```
- 読了経路は `~3284` / `~3414` / `~3423`（FXL）/ `~3672`（EPUB_EDGE）すべてが `showFinishedBanner()` を通るので、ここ1箇所で全モード網羅。
- **`markAsFinished()`（論理削除＝読了扱いで隠す・`~4935`）では `finishedAt` を立てない**（実際の読了日ではないため）。「最近読了」はそのエントリで `lastOpenedAt` にフォールバック（§13.4）。

### 13.2 集計の土台：`_rlCollect()` を拡張して再利用

新規収集関数は作らず、`_rlCollect()`（`~4703`）の push 時に2フィールド追加：
```js
items.push({ key, title, spineCount, spineIdx, ratio, finished, lastOpenedAt,
  creator: val.creator || '',
  creators: Array.isArray(val.creators) ? val.creators : null,  // ← 新規
  finishedAt: val.finishedAt || null,                            // ← 新規
  cover: val.cover || '' });
```
- 読みかけリスト側は新フィールドを無視するだけなので影響なし。読書データ側はこの配列を集計に使う。

### 13.3 著者ランキング `_rdAuthorRanking(items)`

```js
function _rdAuthorRanking(items) {
  const map = new Map();  // normKey -> { name, count }
  items.filter(it => it.finished).forEach(it => {
    // 配列があれば各著者 +1、無ければ連結文字列を丸ごと1キー（共著+1フォールバック）
    const list = (it.creators && it.creators.length) ? it.creators
               : (it.creator ? [it.creator] : []);
    list.forEach(name => {
      const k = _rlNorm(name);                 // NFKC＋小文字＋カナ折り（既存）
      if (!k) return;
      const e = map.get(k) || { name, count: 0 };
      e.count++; map.set(k, e);
    });
  });
  const all = [...map.values()].sort((a, b) => b.count - a.count || _rlCollator.compare(a.name, b.name));
  const limit = _rdPrefs.authorLimit;          // 既定 8
  return { top: all.slice(0, limit), restAuthors: Math.max(0, all.length - limit) };
}
```
- 「・」での再分割はしない（§6.3。外国人名の誤分割回避）。
- 「他N人」の N は **残り著者数**（残り冊数ではない）。
- 対象は読了本（`_rdPrefs.authorScope='finished'`）。

### 13.4 最近読了 `_rdRecentFinished(items)`

```js
items.filter(it => it.finished)
  .map(it => ({ ...it, _at: it.finishedAt || it.lastOpenedAt || null }))
  .sort((a, b) => (Date.parse(b._at)||0) - (Date.parse(a._at)||0))
  .slice(0, 10);
```
- 表示：タイトル＋日付（`YYYY-MM-DD`。`_at` が null なら日付欄空）。行タップで `openFilePickerForBook(item.key)`（既存の再オープン経路をそのまま使用）。
- インライン onclick にキー文字列を埋めない（`esc()` は `'` 非エスケープ）。`data-key` 属性＋ `this.closest('.rd-recent-row').dataset.key` で受け渡し。

### 13.5 全体統計 `_rdComputeStats(items)`

```js
const total    = items.length;                       // = 開いた本（読了率の母数）
const finished = items.filter(it => it.finished).length;
const reading  = total - finished;
const rate     = total ? Math.round(finished / total * 100) : 0;
return { total, finished, reading, rate };
```

### 13.6 画面（HTML / CSS / 開閉）

**専用オーバーレイ `#reading-data-overlay`**（`#modal-overlay` とは別。読書中でも開けるよう独立）。`position:fixed; inset:0; z-index:210`（modal=200 の上）。中央に `#reading-data-box`（`max-width:560px; max-height:85vh; overflow-y:auto`）。テーマ変数（`--ui-bg` / `--ui-text` / `--ui-border` / `--accent`）を使用。

DOM 骨子（G2/G3 枠は **DOM ごと出さない**＝未挿入。後日有効化）:
```html
<div id="reading-data-overlay">
  <div id="reading-data-box">
    <div class="rd-head"><h3 data-i18n="readingData.title">📊 読書データ</h3>
      <button onclick="closeReadingData()">×</button></div>
    <!-- G2: #rd-last-book / G3: #rd-streak は今回未挿入 -->
    <section id="rd-allbooks"></section>     <!-- 読了率/読了冊数/読みかけ -->
    <section id="rd-authors"></section>      <!-- 著者グラフ -->
    <section id="rd-recent"></section>       <!-- 最近読了 -->
  </div>
</div>
```

**読了率ドーナツ**：CSS `conic-gradient(var(--accent) 0 <rate>%, var(--ui-border) 0)` で円を描き、中央くり抜きは内側に背景色の小円を重ねる（追加ライブラリ不要・既存のテーマ配色で完結）。

**著者バー**：各行 `display:flex`。バー幅は `count / maxCount * 100%`。色は `--accent`。

**開閉関数**
```js
function openReadingData(){ buildReadingData(); document.getElementById('reading-data-overlay').classList.add('show'); }
function closeReadingData(){ document.getElementById('reading-data-overlay').classList.remove('show'); }
function buildReadingData(){
  const items = _rlCollect();
  const box = document.getElementById('reading-data-box');
  if (!items.length){ /* readingData.empty を表示して return */ }
  const s = _rdComputeStats(items);
  // 各 section.innerHTML を生成（esc() でタイトル/著者名をエスケープ）
}
```
- オーバーレイ背景クリック／Escape で閉じる（既存 modal と同じ作法）。読書中に開いた場合はスクロール等の裏側操作を止めるだけ（iframe はそのまま）。

### 13.7 入口

- **② ツールバー 📊 ボタン**：`#fs-btn`（`~551`）の隣に `class="icon-btn" id="reading-data-btn" onclick="openReadingData()"`、棒グラフ SVG アイコン、`data-i18n-title="readingData.title"`。常時表示（本を開いていなくても押せる）。
- **① ウェルカム入口**：`#reading-list-footer`（`~791`）に `<button id="welcome-rd-btn" onclick="openReadingData()" data-i18n="readingData.title">📊 読書データ</button>` を追加（「別の ePub を開く」の隣）。蔵書ゼロ時は footer 非表示なので出ない（その時は統計も空なので問題なし）。将来カード化する余地あり。

### 13.8 表示設定 `epub_reading_data_prefs`（同期しない）

```jsonc
{ "authorScope": "finished", "authorLimit": 8 }
```
- `_rdLoadPrefs()` はホワイトリスト検証（`_rlLoadPrefs()` に倣う）。`const _RD_DEFAULTS` を変数宣言部で定義（TDZ 回避。読みかけリスト v2 の `_RL_SORTS` 教訓）。G1 では UI 露出なし（既定値固定）でも可。

### 13.9 同期実装（§12 まとめ＝今回まとめて入れてロック）

1. **`collectBookmarks()`（`~5638`）**：戻り値に直下フィールドを追加。
   ```js
   return { version:1, exportedAt, bookmarks: data,
     ...(purged.length ? {purged} : {}),
     ...(_rdHasStats() ? {bookStats: _rdLoadBookStats()} : {}),     // G1 では空なら省略
     ...(_rdHasDays()  ? {readingDays: _rdLoadDays()}   : {}) };
   ```
   - G1 時点では `epub_book_stats` / `epub_reading_days` は未生成 → 省略されるだけ。キー定数（`_BOOK_STATS_KEY='epub_book_stats'` / `_READING_DAYS_KEY='epub_reading_days'`）と読み書きヘルパは今回定義しておく。
2. **取り込み（`bookmark-input` change `~5510` / `driveDownload` `~5816`）**：`bookmarks` ループの後に **専用ディープマージ**を追加。
   - `json.bookStats` → 本ごと：`ms[dev]`=max, `chars`=max, `total`=max, `firstAt`=min。**ローカルに `epub_pos_k` が無い／墓標済みはスキップ**。
   - `json.readingDays` → 日ごと：`[date][dev]`=max。墓標非適用。
   - 共通ヘルパ `_rdMergeBookStats(remote)` / `_rdMergeDays(remote)` を新設し、import と driveDownload の両方から呼ぶ（重複実装しない）。
3. **epub_pos の軽量フィールドマージ（§12-G 案①）**：取り込みループの `localStorage.setItem(key, val)` を、`epub_pos_*` の時だけ「リモートを基本に採用しつつ `finishedAt`=最古の非null・`creators`=リモートに無ければローカル保持」する小関数 `_rdMergePos(key, remoteObj)` 経由に置換。`epub_last_book` は従来どおり丸ごと。
4. **`_rlPurgeLocalData()`（`~5430`）に stats 削除を追加**：
   ```js
   try { const m = _rdLoadBookStats(); if (m && m[bookKey]){ delete m[bookKey]; _rdSaveBookStats(m); } } catch(e){}
   ```
   - `_rlApplyTombstones()` が残存本に対し本関数を呼ぶので、端末間の完全削除も stats に波及（§12-C）。
5. **stats 孤児掃除**：`consolidateBookmarks()` 実行後（import `~5530` / driveDownload `~5833` の `_rlCleanupLastBook()` 隣）に `_rdPruneOrphanStats()` を追加。`epub_book_stats` の各キーについて `localStorage.getItem(k) === null` なら削除（§12-D）。
6. reading_days は墓標非対象＝完全削除で累計時間は減らない（§12-E）。

> G1 では時間計測（G2）を実装しないため `bookStats` / `readingDays` は基本空。だが上記 1〜6 を入れておくことで、**他端末が将来 G2/G3 ビルドになっても受信・マージでき、ペイロード構造を再変更しない**。これがユーザー要望「同期仕様変更を一度で終わらせる」の実体。

### 13.10 i18n キー（4言語：ja / en / zh-TW / zh-CN）

G1 追加（`I18N` へ・両ファイル）:
`readingData.title`（📊 読書データ）, `readingData.allBooks`, `readingData.completionRate`,
`readingData.finishedCount`（{n} 冊読了）, `readingData.readingCount`（読みかけ {n} 冊）,
`readingData.topAuthors`, `readingData.othersN`（他 {n} 人）, `readingData.recentFinished`,
`readingData.empty`（まだ読書記録がありません）, `readingData.close`。
- G2/G3 用キー（`readingData.lastBook` / `.totalTime` / `.speed` / `.timeToFinish` / `.streakDay` / `.streakWeek` / `.streakMonth` / `.calendar` / `.pace` …）は各実装時に追加。

### 13.11 実装チェックリスト（両ファイル）

- [ ] `state.bookCreators` 追加＋`loadEpub`捕捉＋`closeBook`リセット
- [ ] `saveBookMeta` で `creators` 書き込み
- [ ] `_rdMarkFinishedAt()` ＋ `showFinishedBanner` から呼出
- [ ] `_rlCollect` に `creators` / `finishedAt` 追加
- [ ] `_rdComputeStats` / `_rdAuthorRanking` / `_rdRecentFinished`
- [ ] `#reading-data-overlay` HTML＋CSS、`openReadingData` / `closeReadingData` / `buildReadingData`
- [ ] ツールバー 📊 ボタン、ウェルカム footer ボタン
- [ ] `epub_reading_data_prefs` ＋ `_rdLoadPrefs`（既定固定でも可）
- [ ] 同期：`collectBookmarks` 直下フィールド、`_rdMergeBookStats` / `_rdMergeDays` / `_rdMergePos`、`_rlPurgeLocalData` stats 削除、`_rdPruneOrphanStats`
- [ ] i18n 4言語ぶん
- [ ] iOS 版（`yomikake_ios.html`）へ同等反映（LF・再オープンは IDB 経由）

## 14. G2 詳細実装設計（現行コードベース・2026-06-28）

> **実装状況（2026-06-28）**: G2（時間計測）を **v1.13.0 としてコミット済み**、G2.1（文字数・速度・所要時間）を続けて両ファイル（`yomikake.html` CRLF / `yomikake_ios.html` LF）に実装済み（**G2.1 はコミット前**）。ユーザー判断：①文字数系は G2.1 として後続実装（本節で完了）、②デバウンス 5 秒、③consolidate/migrate の stats 付け替え（`_rdRekeyStats`）あり。
>
> **G2 実装分（v1.13.0）**: 計測中核（`_rdRecordActivity`/`_rdScheduleFlush`/`_rdFlush`/`_rdTodayKey`/`_rdResetMeasure`）、活動シグナル6箇所フック、`visibilitychange`/`pagehide`リスナー、`closeBook`/`loadEpub`のフラッシュ＋リセット、派生指標（`_rdBookTime`/`_rdTotalTime`/`_rdFmtDuration`/`_rdLastBook`）、画面（最後に開いた本パネル＋累計時間タイル＋CSS）、i18n 6キー×4言語、`_rdRekeyStats`。
>
> **G2.1 実装分（本節・未コミット）**: `_rdComputeBookChars`（reflow のみ・初回描画 1.5 秒後にバックグラウンド起動・本切替で中断・`htmlToText` 流用・`total` を max 書込み）、`_rdUpdateReadChars`（既読＝Σ完了 spine＋現 spine×`_intraChapterRatio`・`chars` を max 書込み・`_rdFlush` 冒頭から毎回呼出）、`_rdSpeed`/`_rdTimeToFinish`（極小分母ガード）、最後に開いた本パネルに速度・残り時間を追加表示（reflow・stat があるときのみ）、i18n `readingData.speed`/`readingData.timeToFinish`×4言語。FXL は本文文字数が無いため文字数系は出さない。同期スキーマは G1 ロック分のまま無変更（`chars`/`total` は G1 でロック済みフィールド）。JS構文OK＋単体テスト：G2計測22件・G2.1文字数13件（per-spine文字数／total書込み／既読＝完了＋ratio／戻り読みmax非減少／速度22.5cpm・残り40000ms／極小分母ガード／FXLスキップ／本切替中断）通過。ブラウザ実機の目視確認は未実施。

> **前提（G1 で確定済み）**: 同期スキーマ（`bookStats` / `readingDays` 直下フィールド・デバイス別 max マージ）、保存ヘルパ（`_rdLoadBookStats` / `_rdSaveBookStats` / `_rdLoadDays` / `_rdSaveDays` / `_rdDeviceId`）、受信マージ（`_rdMergeBookStats` / `_rdMergeDays` / `_rdMergePos`）、孤児掃除（`_rdPruneOrphanStats`）、purge 連動削除（`_rlPurgeLocalData` 内 stats 削除）は **すべて実装済み（`yomikake.html` ~5871–5970／`collectBookmarks` ~5973）**。**G2 で新規に実装するのは「①時間の計測・書き込み」「②文字数の計測」「③派生指標」「④画面（最後に開いた本パネル＋累計時間タイル）」「⑤i18n」の5点のみ**。同期ペイロード構造・マージ規則は一切変更しない（§0-3 の約束）。命名は G1 同様 `_rd` / `rd` プレフィックス。両ファイル共通（本体 CRLF・iOS 版 LF）。

行番号は G1 実装後の現行コード（`yomikake.html`）の目安。iOS 版の対応行は §14.9 に併記。

### 14.1 計測の中核：活動シグナル＋idle フィルタ

**モジュール変数**（`yomikake.html` の `let _intraChapterRatio = 0;`（~2887）付近に追加）:
```js
const _RD_IDLE_THRESHOLD = 180000;  // 180秒（3分）= 確定値（§11）。これ以上の無活動は放置とみなし加算しない
const _RD_FLUSH_DEBOUNCE = 5000;    // 計測値を localStorage に書き出すデバウンス（5秒）。体感は実装後調整
let _rdLastActivityTs = 0;          // 直近の活動シグナル時刻（0 = 計測停止中）
let _rdPendingMs      = 0;          // 未フラッシュの加算待ち時間（ms）
let _rdActiveBookKey  = '';         // _rdPendingMs / chars が帰属する bookKey（フラッシュ先を固定するため）
let _rdFlushTimer     = null;       // _RD_FLUSH_DEBOUNCE のタイマー
```

**`_rdRecordActivity()`** — すべての「ページめくり相当」シグナルから呼ぶ単一入口:
```js
function _rdRecordActivity() {
  if (!state.bookKey) return;                  // 本が開いていない＝計測対象外
  const now = Date.now();
  if (_rdLastActivityTs && _rdActiveBookKey === state.bookKey) {
    const delta = now - _rdLastActivityTs;
    if (delta > 0 && delta < _RD_IDLE_THRESHOLD) {
      _rdPendingMs += delta;
      _rdScheduleFlush();
    }
    // delta >= IDLE_THRESHOLD は放置＝加算しない（_rdLastActivityTs だけ更新して継続）
  }
  _rdLastActivityTs = now;
  _rdActiveBookKey  = state.bookKey;
}
```
- **idle 判定**：直近シグナルからの経過が 180 秒以上なら、その間は読んでいないとみなして加算しない（kobo 等の自動スリープ相当をブラウザで再現）。
- **本の取り違え防止**：`_rdActiveBookKey !== state.bookKey`（本切替直後）なら delta を加算せず時刻だけ更新。`_rdPendingMs` は必ず `_rdActiveBookKey` に帰属する（フラッシュ先が混ざらない）。

**`_rdScheduleFlush()` / `_rdFlush()`**:
```js
function _rdScheduleFlush() {
  if (_rdFlushTimer) return;
  _rdFlushTimer = setTimeout(_rdFlush, _RD_FLUSH_DEBOUNCE);
}
function _rdFlush() {
  if (_rdFlushTimer) { clearTimeout(_rdFlushTimer); _rdFlushTimer = null; }
  const add = _rdPendingMs; _rdPendingMs = 0;
  const key = _rdActiveBookKey;
  if (add <= 0 || !key || localStorage.getItem(key) === null) return; // 墓標／削除済みには書かない
  const dev = _rdDeviceId();
  // ① 本ごと（epub_book_stats）
  const m = _rdLoadBookStats();
  const e = m[key] || {};
  e.ms = e.ms || {};
  e.ms[dev] = (+e.ms[dev] || 0) + add;          // self 欄のみ加算（単調増加→max マージで安全）
  if (!e.firstAt) e.firstAt = new Date().toISOString();
  m[key] = e; _rdSaveBookStats(m);
  // ② 日ごと（epub_reading_days）＝累計時間の単一ソース
  const today = _rdTodayKey();
  const d = _rdLoadDays();
  d[today] = d[today] || {};
  d[today][dev] = (+d[today][dev] || 0) + add;
  _rdSaveDays(d);
}
function _rdTodayKey() {  // 端末ローカル時刻の YYYY-MM-DD（§3.3）
  const dt = new Date(), p = n => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}
```
- **self 欄だけ書く**＝自端末の値は単調増加。受信側の max マージ（実装済み `_rdMergeBookStats` / `_rdMergeDays`）で取りこぼし・二重計上ゼロ（§2）。
- **quota**：`_rdSaveBookStats` / `_rdSaveDays` は既に try/catch 済み。stats は読書位置より優先度が低いので、失敗は黙って捨てて良い（位置保存を阻害しない）。

### 14.2 活動シグナルのフック箇所（全モード網羅）

`_rdRecordActivity()` を以下に1行ずつ挿入する。重複呼び出しは「直近からの delta」を足すだけなので二重計上にならない。

| 経路 | 関数 / ハンドラ | 行 | 対象モード |
|---|---|---|---|
| スクロール位置報告 | `EPUB_POS` ハンドラ（`if (!_isRendering){…}` 内） | ~3771 | reflow（PC スクロール・iOS スワイプ） |
| ボタン/キーめくり | `scrollPage()` 冒頭 | ~3720 | reflow / FXL 共通 |
| 章境界越え | `EPUB_EDGE` ハンドラ冒頭（`_isRendering` 判定の前） | ~3753 | reflow |
| 目次ジャンプ | `navigateToToc()` 冒頭（`base` 検証後） | ~2231 | 全モード |
| FXL ページ送り | `advanceFxlPage()` 冒頭 | ~3500 | FXL（非ズーム） |
| FXL ズームステップ | `advanceFxlZoomStep()` 冒頭 | ~3389 | FXL（コマ読み） |

- `handleIframeLink()`（内部リンク）も `renderPage` を呼ぶので任意で追加可（必須ではない＝直後の EPUB_POS で拾える）。
- **`scrollPage()` は FXL ズーム分岐の前**（`return` より上）に置くこと。FXL は EPUB_POS を出さないため、`scrollPage` と FXL advance の2系統が FXL の唯一の計測源になる。

### 14.3 確定フラッシュとタイマー停止（ライフサイクル）

| タイミング | 処理 |
|---|---|
| `visibilitychange` → `hidden` | `_rdFlush()` 即時 → `_rdLastActivityTs = 0`（復帰時に離席時間を加算しないため） |
| `pagehide`（タブ破棄・iOS Safari は `beforeunload` 不発のため必須） | `_rdFlush()` 即時（best-effort） |
| `closeBook()`（~5148・`savePos` の直後） | `_rdFlush()` → `_rdLastActivityTs = 0; _rdPendingMs = 0; _rdActiveBookKey = ''`、`clearTimeout(_rdFlushTimer)` |
| `loadEpub()` 冒頭（旧本の取りこぼし回収） | `_rdFlush()`（旧 `_rdActiveBookKey` 宛に確定）→ 上記同様リセット |

- **新規リスナー2本**（init ブロックに追加・両ファイル）:
  ```js
  document.addEventListener('visibilitychange', () => { if (document.hidden) { _rdFlush(); _rdLastActivityTs = 0; } });
  window.addEventListener('pagehide', _rdFlush);
  ```
- 復帰（`visible`）時は `_rdLastActivityTs = 0` のままなので、次の活動シグナルで delta が加算されない＝離席ぶんが自然に除外される（idle 閾値に依らず確実）。

### 14.4 文字数の計測（chars / total）

**方針**：opening をブロックしないよう、**総文字数は初回描画後にバックグラウンドで算出**する（design §7.2 の「loadEpub 時算出」を、体感ハング回避のため非同期化）。

```js
let _rdSpineChars = [];   // spineIdx -> 本文文字数（未計測は undefined）
let _rdTotalChars = 0;    // Σ _rdSpineChars（算出完了後に確定）
```

- **算出 `_rdComputeBookChars()`**：`loadEpub()` の初回 `renderPage` 完了後に `setTimeout(_rdComputeBookChars, 0)`（または `requestIdleCallback`）で起動。各 spine の XHTML を `zip.file(absPath).async('text')` で読み、既存 `htmlToText()`（~4060）で本文抽出→ `.length` を `_rdSpineChars[idx]` に格納。`_renderSeq` を握って本切替時に中断。完了時 `_rdTotalChars = Σ` を確定し、`epub_book_stats[bookKey].total` に **max** で書き込む（章追加で増えうるため min ではなく max・§3.2）。
- **FXL（画像本）は本文文字数が無い**ため、`htmlToText` の結果が概ね空になる。FXL では chars/total/速度・残り時間の表示を出さない（§14.6 で本パネルは時間のみ表示）。
- **既読文字数 `_rdUpdateReadChars()`**：`chars = Σ(完了 spine の _rdSpineChars) + _rdSpineChars[currentSpineIdx] × _intraChapterRatio`。`epub_book_stats[bookKey].chars` に **max** で書く（戻り読みで減らさない）。呼び出しは `_rdFlush()` の末尾（時間と同じデバウンスに相乗り）＋章遷移時。`_rdTotalChars` 未確定（算出途中）の間は chars 更新をスキップしてよい（total 確定後に自己修復）。

> 簡素化オプション：G2 初版は **chars/total/速度/残り時間を省き、累計時間・本ごと時間・読書日数だけ**を出す案も可（時間計測だけで「最後の本パネル」「累計時間タイル」は成立する）。文字数系は派生指標が一つ増えるだけで同期スキーマは不変（`chars`/`total` フィールドは G1 でロック済み）。**実装判断はユーザー確認事項**（§14.10）。

### 14.5 派生指標

```js
function _rdBookTime(stat)  { return stat && stat.ms ? Object.values(stat.ms).reduce((a,b)=>a+(+b||0),0) : 0; } // 本の総読書時間(ms)
function _rdTotalTime()     { const d=_rdLoadDays(); let s=0; for(const k in d) for(const dev in d[k]) s+=(+d[k][dev]||0); return s; } // 累計（単一ソース＝reading_days）
function _rdSpeed(stat)     { const ms=_rdBookTime(stat); return (stat&&stat.chars&&ms>60000)?(stat.chars/(ms/60000)):0; } // 文字/分（分母ガード）
function _rdTimeToFinish(stat){ const sp=_rdSpeed(stat); return (sp>0&&stat.total>stat.chars)?((stat.total-stat.chars)/sp*60000):0; } // ms
```
- **累計読書時間の単一ソースは `epub_reading_days`**（§7 注記）。`epub_book_stats.ms` は本別内訳用で、合計が日次合計と完全一致しなくても許容（方針 §0-1）。
- **「最後に開いた本」** = `_rlCollect()` の items から `lastOpenedAt` 最大のエントリ。その `key` で `_rdLoadBookStats()[key]` を引いてパネル描画。stat が無ければ（時間未蓄積）進行%のみ表示。
- **整形ヘルパ `_rdFmtDuration(ms)`** → i18n 対応で `"3時間12分"` / `"3h 12m"` / `"45分"` 等。0 は `"—"`。`_rdFmtDate`（~5265）と同じ場所に追加。

### 14.6 画面：G2 枠の有効化

G1 で `#reading-data-body`（~916）に innerHTML を流し込む `buildReadingData()`（~5281）を拡張する。**DOM は G1 同様 `buildReadingData()` 内で文字列生成**（`#rd-last-book` / `#rd-streak` のような静的プレースホルダは置かない方針＝G1 のまま）。

1. **「最後に開いた本」パネル**を `rd-section`「すべての本」の **前**に挿入:
   ```
   ╔══ 最後に開いた本 ════════╗
   ║ [表紙] タイトル                ║
   ║  進行 42% / この本 1時間12分    ║
   ║  速度 480字/分 / 残り 約35分     ║   ← 文字数を実装した場合のみ
   ╚════════════════════════╝
   ```
   - タップで `closeReadingData(); openFilePickerForBook(key)`（G1 の最近読了行と同じ `data-key` 規約・インライン埋め込み禁止）。
   - FXL 本・stat 無しは「速度／残り」行を出さない。
2. **累計時間タイル**を「すべての本」行（`rd-tiles`）の末尾に追加: `<div class="rd-tile"><div class="rd-num">${_rdFmtDuration(_rdTotalTime())}</div><div class="rd-lbl">${t('readingData.totalTime')}</div></div>`。ドーナツ＋3タイル（読了・読みかけ・累計時間）構成になる。
3. CSS：新クラス `.rd-last-book`（カード枠 `border:1px solid var(--ui-border); border-radius:12px; padding:14px`）・`.rd-lb-prog` 等。既存テーマ変数のみ使用。

> 「継続」枠（連続日/週/月・草グラフ）は **G3** で有効化（G2 では出さない）。

### 14.7 同期：変更なし（確認のみ）

- `collectBookmarks()`（~5973）は既に `_rdHasStats()` / `_rdHasDays()` で `bookStats` / `readingDays` を条件付き同梱する。**G2 で時間が貯まり始めれば自動的にペイロードへ載る**。
- 受信側 `_rdMergeBookStats` / `_rdMergeDays` / `_rdPruneOrphanStats` / `_rlPurgeLocalData` の stats 削除は実装済み。**G2 で追加のマージ実装は不要**。
- **唯一の追加候補（§12-F 推奨・必須ではない）**：`consolidateBookmarks()`（~5450）と `migrateLegacyBookmark()` の **キー改名箇所に `epub_book_stats[old]→[new]` の付け替え**を入れる。入れないと旧形式キーの本を G2 で開いた直後に consolidate/migrate が走った場合、本ごと内訳時間が孤児化して `_rdPruneOrphanStats` で消える（累計時間は reading_days 側に残るので §12-E のとおり減らない）。大半の端末は consolidate 実行済み（一度きり）なので影響は限定的。
  ```js
  // 改名直後に:
  try { const sm=_rdLoadBookStats(); if(sm[oldKey]){ sm[newKey]=sm[newKey]||sm[oldKey]; delete sm[oldKey]; _rdSaveBookStats(sm); } } catch(e){}
  ```

### 14.8 i18n キー（4言語：ja / en / zh-TW / zh-CN）

G2 追加（`I18N` へ・両ファイル）:
`readingData.lastBook`（最後に開いた本）, `readingData.totalTime`（累計読書時間）,
`readingData.thisBookTime`（この本）, `readingData.progress`（進行）, `readingData.speed`（速度・{n}字/分）,
`readingData.timeToFinish`（残り 約{t}）, `readingData.durHM`（{h}時間{m}分）, `readingData.durM`（{m}分）, `readingData.cps`（{n}字/分）。
- G3 用（`streakDay` / `streakWeek` / `streakMonth` / `calendar` / `pace`）は G3 実装時に追加。

### 14.9 iOS 版（`yomikake_ios.html`）差分

ロジックは共通。フック箇所の対応行（現行）:
- `scrollPage()` ~3805、`EPUB_POS` ハンドラ ~3850、`advanceFxlZoomStep` ~3476、`advanceFxlPage` ~3580、`navigateToToc`（要確認）、`closeBook` ~4928、`loadEpub` ~2170、`buildReadingData` ~5056、sync ヘルパ ~5641+。
- **iOS は本文スクロールが CSS transform** だが EPUB_POS は同プロトコルで飛ぶ（~3850）ので計測源は共通。スワイプ＝touchend→ EPUB_POS。
- `visibilitychange` / `pagehide` リスナーは iOS Safari で特に重要（バックグラウンド遷移が頻繁）。`pagehide` は iOS で `beforeunload` の代替として必須。
- 「最後に開いた本」再オープンは IDB キャッシュ経由（`openFilePickerForBook` が iOS では cache 分岐・既存）。改行 LF。

### 14.10 実装前のユーザー確認事項

1. **文字数系（速度・残り時間）を G2 初版に含めるか**（§14.4 簡素化オプション）。含めない場合は時間のみ（累計・本ごと・最後の本パネルの進行%＋時間）で先行し、文字数は G2.1 に切り出せる。同期スキーマは不変。
2. **デバウンス間隔 5 秒**の体感（短いほど取りこぼし減・書込頻度増）。実装後に調整可。
3. **consolidate/migrate の stats 付け替え（§14.7）** を入れるか（推奨・コスト小）。

### 14.11 実装チェックリスト（両ファイル）

- [ ] `_RD_IDLE_THRESHOLD` / `_RD_FLUSH_DEBOUNCE` / 計測モジュール変数追加
- [ ] `_rdRecordActivity` / `_rdScheduleFlush` / `_rdFlush` / `_rdTodayKey`
- [ ] 活動シグナル6箇所へ `_rdRecordActivity()` 挿入（§14.2）
- [ ] `visibilitychange` / `pagehide` リスナー、`closeBook` / `loadEpub` のフラッシュ＋リセット
- [ ]（採用時）`_rdComputeBookChars` / `_rdUpdateReadChars` / `_rdSpineChars` / `_rdTotalChars`
- [ ] 派生指標 `_rdBookTime` / `_rdTotalTime` / `_rdSpeed` / `_rdTimeToFinish` / `_rdFmtDuration`
- [ ] `buildReadingData` に「最後に開いた本」パネル＋累計時間タイル、CSS
- [ ]（採用時）`consolidateBookmarks` / `migrateLegacyBookmark` の stats 付け替え
- [ ] i18n 4言語（§14.8）
- [ ] iOS 版へ同等反映（§14.9・LF）
- [ ] 動作確認：3分超放置で加算停止／タブ切替フラッシュ／本切替で帰属が混ざらない／累計＝reading_days 単一ソース

## 11. 未決事項 / 将来

- IDLE_THRESHOLD は **180秒（3分）で確定**（2026-06-28 ユーザー判断：kobo 端末の初期スリープ5分／カバー閉じスリープのある専用端末と違い、汎用ブラウザでは3分が適切）。デバウンス間隔は実装後に体感調整。
- カレンダーは GitHub 風（草グラフ）＋棒グラフ。**数年分を遡れる**ことを要件とする（画面詳細は G3 実装時に決定）。`epub_reading_days` の剪定を 730日→**数年（例 1095日=3年）以上**に広げる方向で再検討。配色（テーマ連動）も G3 で決定。
- 著者グラフのタップ → その著者の本一覧（読みかけリスト絞り込み連携）は将来拡張候補。
- 読書メーター風の「読了ペース予測」「目標設定」は対象外（現時点）。
