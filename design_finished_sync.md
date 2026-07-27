# 読了管理と同期 概要設計書（v2.17.0）

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**（行番号は v2.16.0 時点。`yomikake.html` / `yomikake_ios.html` の順で併記）

関連: `design_reading_list_v2.md`（読みかけリスト・墓標）・`design_reading_data.md`（読書データ画面）・`design_metadata_bookshelf.md`（連載状態 `serial`）

**実装状況: §9 の Step 1〜6 まで実装済み（両ファイル）。** テストは `tests/cases/finished-sync.js`
（両ファイル各 70 assertion）。実機確認（§8-5）は未実施。

---

## 1. 症状

> ある本を端末 A で読了して Drive にしおりを同期した。端末 B ではその本が読みかけだった。
> B で Drive からしおりを読み込んでも、**その本は読了にならない**。

「ずいぶん前からの仕様」であって新しい退行ではない。ただし現在の使い方には合っていない。

調べると、症状はひとつではなく **4 つの別々の失敗**が同じ結論に落ちていた（§3）。
そしてそのすべての根に、**「読了」がデータとして存在しない**という設計上の欠落がある。

さらに、この欠落を埋める過程で **連載小説の「続きが出た」を検出できていない**という
別の穴も同時に埋まる（§4-4）。yomikake は novel_downloader と組で使われ、
`nd:*` メタや連載中バッジまで持ちながら、**読了した連載本の更新に気づく手段がなかった**。

---

## 2. 現状の構造

### 2-1. 「読了」は保存されていない — 毎回その場で計算している

`_rlCollect()`（7183 / 6927）:

```js
finished: spineIdx >= spineCount - 1 && ratio > 0.9,  // 最終章かつ ratio > 0.9
```

保存されているのは **位置だけ**（`spineIdx` / `ratio` / `spineCount`）で、「読了」はその位置から
毎回導出される計算結果でしかない。したがって:

- 位置が 1 文字でも戻れば読了は消える
- 分母（`spineCount`）が変われば読了は消える
- 位置を上書きする経路（`savePos` / マージ）はすべて、意図せず読了を破壊できる

### 2-2. `finishedAt` は既にあるのに、誰も読んでいない

読了日時は既に記録されている。`showFinishedBanner()` → `_rdMarkFinishedAt()`（8079 / 7857）:

```js
// 読了日時を1度だけ記録（既存値があれば上書きしない＝最古を保持）。
// markAsFinished（論理削除）では呼ばない＝実際の読了日のみ記録する
```

さらに `finishedAt` は:

- しおり `epub_pos_*` の値として localStorage に載る
- `collectBookmarks()` 経由で JSON エクスポート・Drive アップロードに含まれる
- `_rdMergePos`（9432 / 9198）でも `_rdMergePosBest`（9783 / 9546）でも「最古を採用」で正しくマージされる

**つまり同期のインフラは既に全部通っている。** 使われていないのは判定だけで、現在の唯一の
利用箇所は読書データ画面の「最近読了した本」の並び順（`_rdRecentFinished` 8138 / 7916）である。

> この設計書の作業の大半は「新しく作る」ではなく「既にあるものを判定に繋ぐ」になる。

### 2-3. マージは 2 系統ある

| 経路 | 関数 | 位置の決め方 |
|------|------|-------------|
| 手動 Drive 読込 / JSON インポート | `_rdMergePos`（9424 / 9190） | **リモートを無条件採用**（ユーザーが confirm 済みなので） |
| 自動保存 ON のサイレント同期 | `_rdMergePosBest`（9768 / 9531） | 進捗 `spineIdx + ratio` が大きい方。同点なら `lastOpenedAt` が新しい方 |

どちらも位置としてはリモートの読了位置を採る。**したがって「本を開いていない状態」で同期した
場合は、現状でも読了になる。** 問題は「本を開いている」場合と、分母がずれた場合である。

### 2-4. `isNotFinal` ガード — 読了だけを取りこぼす条件

同じ形の判定が 3 箇所にある（9250 / 9747 / 9847、ios は 9018 / 9510 / 9610）:

```js
const isAhead    = newIdx > curIdx || (newIdx === curIdx && newRatio > _intraChapterRatio + 0.01);
const isNotFinal = newIdx < state.spine.length - 1;
if (isAhead && isNotFinal) { /* ジャンプ or 「タップで移動」トースト */ }
```

意図は正しい ——「同期のたびに最終ページへ飛ばされて読書が中断される」のを防ぐ。
しかし副作用として、**リモートが読了のときだけ通知すら出ない**。ユーザーには
「同期したのに何も起きなかった」としか見えない。

---

## 3. 失敗経路（なぜ読了にならないか）

### A. 本を開いた状態で同期すると、読了は必ず捨てられる ★本命

```
端末B: 本を開いている（ch5 / 全20章）
  │
  ├─ driveDownload() / driveSyncPull()
  │     └─ _rdMergePos → localStorage は ch19 / ratio 1.0 / finishedAt あり  ← 一瞬だけ読了
  │
  ├─ isNotFinal === false  →  ジャンプせず、トーストも出ない
  │
  ├─ 画面は ch5 のまま。ユーザーは何も知らないまま読み続ける
  │
  ├─ EPUB_POS（5154 / …）→ savePos(ratio) → localStorage は ch5 に戻る
  │     ※ finishedAt は {...existing} で残るが、誰も読まないので無意味
  │
  └─ 自動保存 ON なら driveUploadCore() が ch5 をそのまま Drive に PATCH
        →  端末Aの読了が Drive 上からも消える  ← 実害はここ
```

`savePos()`（8989 / 8759）は `{...existing, spineIdx, ratio}` なので `finishedAt` 自体は残る。
残っても判定に使われないため、結果は「読了が消えた」と等価になる。

### B. `autoOpenLast` が既定 ON なので、A は「起動しただけ」で起きる

読みかけ端末は起動時に自動で本を開き（`autoOpenLastBook()`）、その後 `driveSyncPull` が走る。
ユーザーが何も操作しなくても A の条件が揃う。**A は例外ケースではなく既定の経路。**

### C. `spineCount` 不一致で読了が解ける

- `_rdMergePosBest`（9791 / 9554）は `spineIdx` / `ratio` を勝者から取りながら
  `merged.spineCount = Math.max(lsc, rsc)` としている。**分子と分母の出所が違う。**
  ローカルが長い版（連載追加後）の `spineCount = 24` を持っていると、リモートの
  `spineIdx = 19`（全 20 章の読了）と組み合わさって「79% の読みかけ」に化ける。
- `saveBookMeta()`（8861 / 8634）は開くたび `spineCount: state.spine.length` を書くので、
  同じことが「同期後に開き直す」だけでも起きる。

### D. 同期以前の問題として、再読すると読了が消える

読了本を開いて少し前に戻るだけで `savePos` により読了が false になる。
「一度読み終えた」という事実が位置の副作用でしかないので、構造的に保持できない。

---

## 4. 概念モデル（あるべき姿）

### 4-1. しおりが抱える事実を分ける

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. いま どこを読んでいるか   spineIdx / ratio / spineCount             │ 端末ごとに動く・往復する
│ 2. 読み終えたことがあるか     finishedAt / finishedCount               │ 単調・戻らない
│ 3. まだ本棚にあるか           epub_purged（墓標）                       │ 既存。削除の伝播用
└──────────────────────────────────────────────────────────────────────┘
```

3 は既に独立している（`design_reading_list_v2.md`）。**1 と 2 が混ざっているのが今回の問題。**

2 に `finishedCount`（＝**読み終えた版の章数**）を新設する。理由は 4-3 で述べる。

| フィールド | 意味 | 書く場所 | 合流則 |
|---|---|---|---|
| `finishedAt` | **初めて**読み終えた日時（ISO） | `_rdMarkFinishedAt()` | 最古を採る |
| `finishedCount` | **最後に**読み終えた版の `spineCount` | 同上（毎回更新） | 大きいほうを採る |

`finishedAt` が「最古」で `finishedCount` が「最新」なのは、前者が読書データのタイムライン用
（初読日を残したい）、後者が「どこまでの版を読んだか」の基準線（進めたい）だから。
役割が逆なので合流則も逆になる。

### 4-2. 4 つの派生語

```js
atEnd     = spineIdx >= spineCount - 1 && ratio > 0.9   // いま末尾にいる
finished  = !!finishedAt || atEnd                        // 読み終えた（記録 or 位置）
newCh     = (finishedCount > 0 && spineCount > finishedCount) ? spineCount - finishedCount : 0
hasMore   = newCh > 0 && !atEnd                          // 読了後に章が増えた ＝ 続きが出た
rereading = finished && !atEnd && !hasMore               // 読了後に位置が戻った ＝ 再読中
```

`atEnd` は今の `finished` と同じ式。`finished` はそれを含む上位概念になる。

`finished` に `atEnd` を **OR で残す**理由は 2 つある。どちらも外せない。

1. **旧データ・旧ビルド互換** — v2.16.0 以前に読了した本・旧ビルドの端末から届くしおりには
   `finishedAt` が無い。位置だけが読了を示す。
2. **論理削除（`markAsFinished` 7469 / 7213）** — 「読んでいないがリストから消したい」操作は
   意図的に `finishedAt` を刻まず、位置だけ末尾に書く。この仕様は維持する（読書データの
   「読了日」に嘘を混ぜないため）。`atEnd` を残すことで従来どおり隠れる。

### 4-3. なぜ `finishedCount` が要るのか — `!atEnd` は 2 つの別事象の合流点

読了した本で `atEnd` が false に落ちる経路は 2 つあり、**由来がまったく違う**。

| 事象 | `spineIdx` | `spineCount` | 実際の意味 |
|---|---|---|---|
| 読了本を開いて前に戻った | **減る** | 不変 | 再読 |
| 連載に新章が追加された | 不変 | **増える** | 続きが出た |

`atEnd` は分子と分母の比較なので、**どちらが動いても同じように false になり区別できない**。

連載小説（20 章版を読了 → 24 章版を同じキーで開く）では、`saveBookMeta()` が
`spineCount: 24` を書いた瞬間 `atEnd = (19 >= 23)` が false に落ちる。
1 ページも読み返していないのに「再読中」と表示されることになる。
**novel_downloader と組で使う以上、こちらのほうが頻度が高い。**

読了した時点の分母を `finishedCount` として控えておけば、この 2 つは 1 つの引き算で分離できる。

### 4-4. 4 状態

| 状態 | 条件 | 既定の読みかけリスト | カードの表示 | 読了統計 |
|---|---|---|---|---|
| **読みかけ** | `!finished` | 表示 | `83%` | 対象外 |
| **読了** | `atEnd` | 隠す | `✓ 読了` | 計上 |
| **続きが出た** | `hasMore` | **表示** | **`🆕 続き4章` + `83%`** | 計上 |
| **再読中** | `rereading` | 表示 | `✓ 読了` + `62%` | 計上 |

「続きが出た」は本設計で**新しく見えるようになる状態**である。
現状は読了本が既定リストから消えるため、連載の更新に気づく手段がまったくない。

> **読了バッジと ％ の併記**は「続きが出た」「再読中」の 2 状態でのみ起きる。
> `.rl-bar` の塗り幅も実際の位置まで戻るので、「読み終えた本だが今はここ」が一目で分かる。

### 4-5. なぜ「読了の取り消し」ボタンを作らないか

端末 B のユーザーからすれば、A が読み終えただけで自分はまだ読んでいない。
「読了になったせいでリストから消えて読み続けられない」のでは改悪になる。

素直な解は「読了を取り消すボタン」だが、**取り消しを端末間で同期するには
`finishedAt` を消したという事実自体を伝える仕組み（＝墓標と同じもの）が要る**。
完全削除で一度やっているとおり、これは安くない。

代わりに **「本を開いて読み進めれば `atEnd` が false になり、再読中としてリストに戻る」**
を取り消しの代わりにする。追加 UI ゼロ・追加同期データゼロで、
「読み終えた記録は残るが、リストからは消えない」が成立する。

### 4-6. 同期における合流則

| 事実 | 合流則 | 理由 |
|------|--------|------|
| 位置 | 手動＝リモート採用／自動＝進捗が大きい方 | 現行どおり。ユーザーの確認の有無で分ける |
| `finishedAt` | どちらかにあれば採る。両方あれば**最古** | 単調な事実なので和集合。最古＝初読日 |
| `finishedCount` | どちらかにあれば採る。両方あれば**最大** | 「どこまでの版を読み終えたか」の最良値 |

`finishedCount` を最大で採るのは実用上も正しい。
A が v20 を読了（`fc=20`）、B が v24 を読了（`fc=24`）→ 合流後は `fc=24`。
v24 のファイルを持つ A でも `newCh = 0` になり、「続きあり」が二重に出ない。

**位置と読了を独立にマージすることが今回の要点。**
位置が退行しても `finishedAt` は残るので、A の逆流事故が構造的に起きなくなる。

---

## 5. 仕様

### S1. `finished` の定義を変える（データ層）

`_rlCollect()` の 1 項目を 4 項目にする（`atEnd` / `finished` / `newCh` / `hasMore`）。
以降、リスト・統計はこれを使い分ける。

- **隠す・進捗 100%・purge 判定** → `atEnd`（＝「いま末尾にいるか」）
- **読了バッジ・読了冊数・読了率・著者集計・読了タイムライン** → `finished`（＝「読み終えたか」）
- **🆕 続きバッジ** → `hasMore`

### S2. 読了時に `finishedCount` を記録する

`_rdMarkFinishedAt()` で `finishedAt` と一緒に `finishedCount: state.spine.length` を書く。
**`finishedAt` は初回のみ・`finishedCount` は毎回更新**（4-1 の表）。

毎回更新することで、増えた章を読み終えたら基準線がその版に進む。
旧データ（`finishedAt` はあるが `finishedCount` が無い）も、次に読み終えた時点で自己修復する。

### S3. 取り込み時に「派生読了 → `finishedAt` / `finishedCount`」を補完する

マージの中で、**両側に `finishedAt` が無く、かつどちらかが `atEnd`** なら
`finishedAt = lastOpenedAt`（無ければ受信時刻）・`finishedCount = その値の spineCount` を刻む。

これがないと、旧ビルドの端末や v2.16.0 以前に読了した本の読了が新方式に乗らない。
**一度どこかの端末が新ビルドで同期すれば、以後は全端末に伝播する**という移行経路になる。

> 補完に `lastOpenedAt` を使うのは「読了日」として最も近い既知の値だから。
> 正確ではないが、無いよりよい。読書データのタイムラインに現れる日付が
> 「最後に開いた日」になるだけで、順序はほぼ保たれる。

### S4. 「位置ジャンプの抑制」と「読了の取り込み」を分離する

`isNotFinal` は *位置ジャンプを抑制する条件としては正しい* ので残す。
誤りは、これが読了の取り込みまで巻き添えにしていること。

- `finishedAt` の取り込みは無条件（S1/S3 により自動的にそうなる）
- 開いている本がリモート側で読了だったときは、**専用のトーストを出す**
  「☑ この本は別の端末で読み終えています」＋タップで最終ページへ
  （既存の `showSyncMoveToast()` 9882 / 9645 と同じアクション付きトースト機構を流用）
- 通知を無視して読み続けても `finishedAt` は消えない ＝ 読了は保たれ、リストには
  「再読中」として残る

### S5. 退行を Drive に逆流させない

`savePos()` / `saveBookMeta()` は `{...existing}` を維持しているので `finishedAt` /
`finishedCount` は残る。S1 を入れれば A の逆流は自動的に止まる。

ただし **quota 超過時のフォールバック経路**（`savePos` 8999 / `saveBookMeta` 8870 で
`delete existing.cover` などをしている箇所）で落とす誘惑があるため、
「読了 2 フィールドは絶対に落とさない」を明示コメントとして残す。

### S6. `_rdMergePosBest` の `spineCount` を位置の勝者に合わせる

`spineIdx` / `ratio` を base から取るなら `spineCount` も base から取る。
`Math.max` は「進捗％の分母だけ他人のもの」という不整合を生む（§3-C）。

> `finishedCount` の合流則が最大なのと**逆**である点に注意。
> `spineCount` は「いま手元にあるファイルの章数」＝位置とセットの値。
> `finishedCount` は「読み終えた版の章数」＝読了とセットの値。所属が違う。

### S7. `🆕 続きあり` フィルタチップ（任意・独立）

`_rlPrefs` に `filterHasMore` を 1 個足し、`#rl-chip-ready` と同じ形でチップを追加する。
**S1〜S6 とは独立して入れられる**ので、実装は最後（§9 Step 5）に置く。

チップを足すのは「続きあり」であって「再読中」ではない。再読は自分で開いた本なので
探す必要がなく、連載の更新は**能動的に探したい**情報だから。

### S8. 変更しないもの

| 対象 | 判断 |
|------|------|
| `markAsFinished()`（論理削除） | `finishedAt` を刻まない現行仕様を維持。`atEnd` フォールバックで従来どおり動く |
| 完全削除・墓標 `epub_purged` | 無関係。触らない |
| 読了バナー `showFinishedBanner()` | `atEnd` に到達した瞬間に出る。現行どおり |
| 「✓読了も表示」チップ | ラベル・キー（`_rlPrefs.showFinished`）とも現行のまま |
| `epub_settings` / `epub_book_prefs` | 無関係 |

---

## 6. 実装設計

### 6-0. 変更点一覧

| # | 箇所 | `yomikake.html` | `yomikake_ios.html` | 変更 |
|---|------|---------|---------|------|
| 1 | `_rdMarkFinishedAt()` | 8079 | 7857 | `finishedCount` を毎回書く（S2） |
| 2 | `_rlCollect()` | 7183 | 6927 | `atEnd` / `finished` / `newCh` / `hasMore` の 4 項目に |
| 3 | `_rlFilterSort()` | 7225 | 6969 | 隠す条件を `atEnd` に |
| 4 | `_rlRender()` pct | 7314 | 7058 | 100% 判定を `atEnd` に |
| 5 | `_rlRender()` バッジ | 7333 | 7077 | 3 状態のバッジ生成 |
| 6 | `confirmDeleteBook()` | 7494–7503 | 7237–7246 | purge/hide 判定を `atEnd` に（式は現状のまま） |
| 7 | `_rdEstTimeLeft()` | 8291 | 8068 | 残り時間の抑止を `atEnd` に |
| 8 | `_posAtEnd()` 新設 | 9424 直前 | 9190 直前 | マージ用ヘルパー |
| 9 | `_rdMergePos()` | 9424 | 9190 | 読了 2 フィールドの合流＋補完（S3） |
| 10 | `_rdMergePosBest()` | 9768 | 9531 | 同上 ＋ `spineCount` を base から（S6） |
| 11 | インポートハンドラ | 9250 | 9018 | 読了時のトースト分岐（S4） |
| 12 | `driveDownload()` | 9747 | 9510 | 同上 |
| 13 | `driveSyncPull()` | 9847 | 9610 | 同上 |
| 14 | `showSyncFinishedToast()` 新設 | 9882 付近 | 9645 付近 | S4 のトースト |
| 15 | i18n | 1615 他 4 言語 | 1596 他 4 言語 | `toast.syncFinished` / `readingList.hasMoreBadge` |
| 16 | `savePos` / `saveBookMeta` | 8989 / 8847 | 8759 / 8620 | コメントのみ（S5） |
| 17 | （S7）チップ | 1245 / 7147 / 7225 / 7372 / 7425 | 対応箇所 | `filterHasMore` |
| 18 | ヘルプ `help.body` | 1591 他 4 言語 | 1572 他 4 言語 | 「✓ 読了と 🆕 続きあり」節（§6-12） |

差分の実体は **`_rdMarkFinishedAt` の 2 行 + `_rlCollect` の 4 行 + マージ 2 関数 + トースト 3 箇所**。
残りは `finished` → `atEnd` の参照付け替え。

### 6-1. `_rdMarkFinishedAt()` — 読了の記録点（S2）

```js
// 読了の記録。finishedAt は初読了日（最古を保持＝読書データのタイムライン用）、
// finishedCount は「最後に読み終えた版の章数」なので毎回更新する。
// 連載で章が増えたとき、この基準線との差が「続き N 章」になる（design_finished_sync.md §4-3）。
// markAsFinished（論理削除）からは呼ばない＝実際の読了のみ記録する
function _rdMarkFinishedAt() {
  if (!state.bookKey) return;
  try {
    const v = JSON.parse(localStorage.getItem(state.bookKey)) || {};
    if (!v.finishedAt) v.finishedAt = new Date().toISOString();
    v.finishedCount = state.spine.length;
    localStorage.setItem(state.bookKey, JSON.stringify(v));
  } catch (e) {}
}
```

現行の `if (v.finishedAt) return;` による早期 return を外すのが要点。
外さないと、`finishedAt` だけを持つ旧データ・S3 で補完されたエントリに
`finishedCount` が永久に入らない。

### 6-2. `_rlCollect()` — 唯一の定義点にする

```js
      const spineIdx = val.spineIdx || 0;
      const ratio = val.ratio || 0;
      // 「いま末尾にいるか」と「読み終えたか」は別の事実（§4-1）。
      //   atEnd    … 位置から導く。読み返しても章が増えても false に戻る
      //   finished … finishedAt があれば不変。旧データ・論理削除は atEnd で拾う
      //   newCh    … 読了した版より増えた章数。連載の「続きが出た」検出（§4-3）
      const atEnd    = spineIdx >= spineCount - 1 && ratio > 0.9;
      const finished = !!val.finishedAt || atEnd;
      const fc       = +val.finishedCount || 0;
      const newCh    = (fc > 0 && spineCount > fc) ? spineCount - fc : 0;
      const it = {key, title, spineCount, spineIdx, ratio,
        atEnd, finished, newCh,
        hasMore: newCh > 0 && !atEnd,
        lastOpenedAt: val.lastOpenedAt || null,
        …
```

`finishedAt: val.finishedAt || null` は既にある（7187 / 6931）のでそのまま。

> `hasMore` を位置に依らず定義しているのは意図的。読了後に章が増えた本は、
> いま先頭を読み返していても「続きが 4 章ある」のは事実だから。
> 増えた分を読み終えれば `_rdMarkFinishedAt` が `finishedCount` を更新して `newCh` は 0 に戻る。

### 6-3. リスト表示

```js
// _rlFilterSort（7225 / 6969）— 隠すのは「いま末尾にいる本」
let arr = _rlPrefs.showFinished ? items : items.filter(it => !it.atEnd);

// _rlRender pct（7314 / 7058）
const pct = item.atEnd ? '100' : Math.min(100, ((item.spineIdx + item.ratio) / item.spineCount * 100)).toFixed(0);

// _rlRender バッジ（7333 / 7077）— 4 状態（§4-4）
const pctSpan  = `<span class="rl-pct">${pct}%</span>`;
const finBadge = `<span class="rl-finished-badge">${t('readingList.finishedBadge')}</span>`;
let pctHtml;
if (item.hasMore)       pctHtml = `<span class="rl-hasmore-badge">${t('readingList.hasMoreBadge', {n: item.newCh})}</span>` + pctSpan;
else if (item.atEnd)    pctHtml = finBadge;
else if (item.finished) pctHtml = finBadge + pctSpan;
else                    pctHtml = pctSpan;
```

> 4 分岐は三項演算子の入れ子より `if / else if` のほうが読める。`.map()` のコールバックは
> ブロック本体なので文が書ける。

`pct` は `.rl-bar` の塗り幅にも使われる（7343 / 7087）。読了後に位置が戻っている状態では
**バーが実際の位置まで戻る**ので、「読み終えた本だが今はここ」が一目で分かる。

カードの `rl-finished` クラス（7336 / 7080・サムネイルを薄くする）は `item.atEnd` に変える。
続きが出た本・再読中の本は既定リストに並ぶので、**薄くせず通常の読みかけと同じ濃さ**にする。

CSS を 2 行追加（`.rl-finished-badge` 342 / 343 の隣）:

```css
.rl-hasmore-badge { font-size:12px; font-weight:700; color:var(--accent); white-space:nowrap; flex-shrink:0; }
.rl-finished-badge + .rl-pct, .rl-hasmore-badge + .rl-pct { opacity:.55; }
```

> `.rl-hasmore-badge` は `.rl-finished-badge` と同じ見た目でよい。`.rl-progress-row`
> （`display:flex; gap:8px; flex-wrap:wrap`）の直下に並ぶので間隔は自動で入る。
> 2 行目は併記時の主従を付けるため —— バッジが主、％は補足。

### 6-4. `confirmDeleteBook()` — 判定は `atEnd` の式のまま

現行コード（7494–7503 / 7237–7246）は `_rlCollect` と同じ式をその場で再計算している。
**式そのものは変えない**（＝ `atEnd` 相当のまま）。変えるのは変数名とコメントだけ。

```js
  // 既定リストに出ている本の × は論理削除、「✓読了も表示」ON でしか出ない本の × は
  // 物理削除。したがって判定は「読了記録の有無」ではなく _rlFilterSort と同じ atEnd。
  let atEnd = false;
  …
  _rlPendingDeleteMode = atEnd ? 'purge' : 'hide';
  const isPurge = atEnd;
```

続きが出た本・再読中の本（既定リストに出る）は `hide` になる。
**読了記録がある本を誤って物理削除しない**ので安全側で正しい。

### 6-5. `_posAtEnd()` — マージ用ヘルパー（新設）

`_rdMergePos` の直前に置く。

```js
// しおり値 1 件が「末尾にいるか」。_rlCollect の atEnd と同一条件（分母は値側の spineCount のみ）
function _posAtEnd(o) {
  if (!o || typeof o !== 'object') return false;
  const sc = +o.spineCount || 0;
  return sc > 0 && (o.spineIdx || 0) >= sc - 1 && (o.ratio || 0) > 0.9;
}
```

> `parseBookKey` の旧形式 `spineCount` は見ない。マージ関数は `key` を持っているので
> 見ることもできるが、**旧形式キーは直後の `consolidateBookmarks()` で新形式に統合される**ため、
> ここで凝る意味がない。値に `spineCount` が無い＝補完しない、で十分。

### 6-6. `_rdMergePos()` — 位置はリモート、読了は和集合、無ければ補完

現行（9424 / 9190）の `if (local && …)` ブロック内に `finishedCount` を足し、
ブロックの後ろに補完を足す。

```js
  const merged = { ...remote };
  if (local && typeof local === 'object') {
    const lf = local.finishedAt, rf = remote.finishedAt;
    if (lf && rf) merged.finishedAt = (Date.parse(lf) <= Date.parse(rf)) ? lf : rf;
    else if (lf || rf) merged.finishedAt = lf || rf;
    // finishedCount は「どこまでの版を読み終えたか」の最良値なので最大を採る（§4-6）
    const lc = +local.finishedCount || 0, rc = +remote.finishedCount || 0;
    if (lc || rc) merged.finishedCount = Math.max(lc, rc);
    …（creators / genre / serial は現行のまま）…
  }
  // 旧ビルド・旧データ由来の「位置だけの読了」を読了フィールドに昇格させる。
  // これがないと、新方式に乗る前に読了した本の読了が同期で伝わらない（§S3）
  if (!merged.finishedAt) {
    const at = _posAtEnd(local) ? local : (_posAtEnd(remote) ? remote : null);
    if (at) {
      merged.finishedAt = at.lastOpenedAt || new Date().toISOString();
      if (+at.spineCount > 0) merged.finishedCount = +at.spineCount;
    }
  }
  localStorage.setItem(key, JSON.stringify(merged));
```

### 6-7. `_rdMergePosBest()` — 同じ合流 ＋ `spineCount` を base から

現行（9768 / 9531）の末尾を差し替える。

```js
  const merged = { ...local, ...remote, spineIdx: base.spineIdx, ratio: base.ratio, lastOpenedAt: base.lastOpenedAt };
  // finishedAt は「最初に読了した時刻」、finishedCount は「最後に読了した版」（§4-1）
  const lf = local.finishedAt, rf = remote.finishedAt;
  if (lf && rf) merged.finishedAt = (Date.parse(lf) <= Date.parse(rf)) ? lf : rf; else merged.finishedAt = lf || rf;
  const lc = +local.finishedCount || 0, rc = +remote.finishedCount || 0;
  if (lc || rc) merged.finishedCount = Math.max(lc, rc);
  if (!merged.finishedAt) {
    const at = _posAtEnd(local) ? local : (_posAtEnd(remote) ? remote : null);
    if (at) {
      merged.finishedAt = at.lastOpenedAt || new Date().toISOString();
      if (+at.spineCount > 0) merged.finishedCount = +at.spineCount;
    }
  }
  if (!merged.finishedAt) { delete merged.finishedAt; delete merged.finishedCount; }
  …（cover / creators / genre / serial は現行のまま）…
  // 分子（spineIdx/ratio）と分母（spineCount）の出所を必ず揃える。
  // Math.max だと「他人の分母 × 自分の位置」で読了が 79% に化ける（§3-C）。
  // finishedCount とは合流則が逆になる — spineCount は位置とセット、finishedCount は読了とセット
  const bsc = +base.spineCount || 0;
  if (bsc) merged.spineCount = bsc;
  else { const lsc = +local.spineCount || 0, rsc = +remote.spineCount || 0;
         if (lsc || rsc) merged.spineCount = Math.max(lsc, rsc); }
```

**注意**: `_posAtEnd(local)` / `_posAtEnd(remote)` は必ず**生の値**に対して評価すること。
`merged` に対して行うと、base 差し替え後の混合値を見てしまう。

### 6-8. 同期 UX — 読了を告げる（S4）

`showSyncMoveToast()`（9882 / 9645）の直後に、ほぼ同型の関数を足す。

```js
// 同期後、開いている本が「リモート側で読了」だった場合の告知。
// isNotFinal ガードで位置ジャンプは抑制するが、黙って何も起きないのは
// 「同期したのに読了にならない」に見えるため、必ず知らせる（v2.17.0）
function showSyncFinishedToast() {
  const el = document.getElementById('toast');
  _clearToastAction(el);
  el.textContent = t('toast.syncFinished');
  el.classList.add('show', 'toast-action');
  el.style.cursor = 'pointer';
  clearTimeout(el._timer);
  const handler = () => {
    _clearToastAction(el);
    el.classList.remove('show');
    pushJumpHistory();
    renderPage(state.spine.length - 1, 'end');
  };
  el._actionHandler = handler;
  el.addEventListener('click', handler);
  el._timer = setTimeout(() => { _clearToastAction(el); el.classList.remove('show'); }, 8000);
}
```

> 実装時に `showSyncMoveToast` と `_showToastAction(msgKey, onTap)` へ共通化してよい。
> **その場合は両ファイルで同じ形にすること。**

呼び出し側は 3 箇所とも同じ形にする（インポートハンドラ 9250 / `driveDownload` 9747 /
`driveSyncPull` 9847）:

```js
          if (isAhead && isNotFinal) {
            …現行のジャンプ or showSyncMoveToast…
          } else if (isAhead && !isNotFinal && !_bookFinished) {
            // リモートが読了。位置は飛ばさないが、読了になったことは伝える
            finishedNotice = true;   // driveSyncPull では直接 showSyncFinishedToast() でよい
          }
```

**`isAhead` を条件から外してはいけない。** `!isNotFinal` だけにすると、
自分が最終章を読んでいるだけの平常時にも「別の端末で読み終えています」が毎回出る
（`isAhead` が false なら受信側に新しい情報は無い）。実装中に一度踏んだ罠。

`!_bookFinished` を付けるのは、**自分でいま読み終えたばかりの本**（読了バナー表示中）に
同じトーストが重なるのを避けるため。

> **`driveDownload` / インポートハンドラでは `jumped = true` を立てないこと。**
> `jumped` は「`toast.driveDownloaded` を出すか」の分岐（9757 / 9520）に使われており、
> ここで立てると件数トーストが消える。**アクショントーストは後勝ちで上書きされる**ので、
> フラグ `finishedNotice` を立てておき、`if (!jumped) showToast(...)` の**後**で
> `if (finishedNotice) showSyncFinishedToast();` と呼ぶ。
> `driveSyncPull` には件数トーストが無いのでその場で呼んでよい。

### 6-9. i18n（4 言語 × 2 ファイル）

`toast.driveSyncAvailable`（1615 / 1963 / 2311 / 2659、ios は 1596 / 1943 / 2290 / 2637）の
直後に:

```js
'toast.syncFinished': '☑ この本は別の端末で読み終えています（タップで最終ページへ）',
'toast.syncFinished': '☑ You finished this book on another device (tap for the last page)',
'toast.syncFinished': '☑ 您已在其他裝置讀完本書（點擊前往最後一頁）',
'toast.syncFinished': '☑ 您已在其他设备读完本书（点击前往最后一页）',
```

`readingList.finishedBadge`（1729 / 2077 / 2425 / 2773）の直後に:

```js
'readingList.hasMoreBadge': '🆕 続き{n}章',
'readingList.hasMoreBadge': '🆕 {n} new',
'readingList.hasMoreBadge': '🆕 新增{n}章',
'readingList.hasMoreBadge': '🆕 新增{n}章',
```

### 6-10. コメントだけの変更（S5）

`savePos()`（8989 / 8759）と `saveBookMeta()`（8847 / 8620）の quota フォールバックに:

```js
      // quota 対策で捨ててよいのは cover / source / site まで。
      // finishedAt / finishedCount は読了の唯一の記録なので絶対に落とさない（v2.17.0）
```

### 6-11. `🆕 続きあり` チップ（S7・任意）

`⚡ すぐ開ける`（`filterReady`）と完全に同型。5 箇所を触る。

| 箇所 | 内容 |
|---|---|
| markup 1244 | `#rl-chip-ready` の隣に `<button id="rl-chip-hasmore" class="rl-chip" onclick="toggleRlFilter('filterHasMore')" data-i18n="readingList.filterHasMore">🆕 続きあり</button>` |
| `_rlLoadPrefs` 7147 | `def` と復元の両方に `filterHasMore: !!p.filterHasMore` |
| `_rlFilterSort` 7227 | `if (_rlPrefs.filterHasMore) arr = arr.filter(it => it.hasMore);` |
| `_rlSyncToolsUI` 7371 | `document.getElementById('rl-chip-hasmore').classList.toggle('active', _rlPrefs.filterHasMore);` |
| `toggleRlFilter` 7426 | ホワイトリストに `'filterHasMore'` を追加 |

i18n は `readingList.filterReady` の隣に `readingList.filterHasMore` を 4 言語。

### 6-12. ヘルプの記載

`help.body`（4 言語 × 2 ファイル）の「📚 読みかけリスト」節と「📊 読書データ」節の間に
**「✓ 読了と 🆕 続きあり」** を挿入する。挿入位置のアンカーは `<br><p><strong>📊 …</strong>`
（4 言語とも各ファイルで一意）。

書くのは 4 点:

1. 最終章の末尾まで読むと読了として記録され、読みかけリストからは隠れる（「✓ 読了も表示」で戻せる）
2. **読了の記録は読書位置とは別に保存される** ——読み返して位置が戻っても消えない／
   別の端末で読み終えた本も同期すれば読了になる（開いている最中ならトーストで通知）
3. 読了した本に章が追加されると「🆕 続きN章」でリストに戻り、「🆕 続きあり」チップで絞り込める
4. **章の追加を検出できるのは読了済みの本だけ**（§10）——まだ読み終えていない本は
   もともとリストに出ているので 🆕 は付かず、進捗％が下がることで分かる

4 が今回いちばん誤解されやすい点なので、小さめのフォント（`font-size:12px;opacity:.6`）の
注記として必ず入れる。

---

## 7. 移行と互換性

| 相手 | 挙動 |
|------|------|
| 既存 localStorage | そのまま読める。`finishedAt` が無い本は `atEnd` で従来どおり読了扱い |
| `finishedAt` はあるが `finishedCount` が無い | `newCh = 0` ＝「続きあり」は出ない（＝再読中と同じ表示）。次にその本を読み終えた時点で `finishedCount` が入り、以後正しくなる |
| 旧ビルドが書いた Drive / JSON | `_posAtEnd` 補完で読了 2 フィールドに昇格する（S3） |
| 旧ビルドの端末 | 未知フィールドを無視するだけ。位置も一緒に同期されるので**従来どおりの挙動**に留まる |
| データ量 | `finishedCount`（整数 1 個・約 20 バイト）のみ増。表紙 dataURI が 20KB 級なので誤差 |

**一方向の劣化のみで、データは壊れない。** 新ビルドの端末が 1 台でも同期に参加すれば、
以後その本の読了は全端末に伝播する。

### ファイル版数が端末間で違う場合

| A の版 | B の版 | A の読了後、B で開くと |
|---|---|---|
| v20（読了・`fc=20`） | v24 | `spineCount=24 > fc=20` → **🆕 続き4章**（正しい） |
| v24（読了・`fc=24`） | v20 | `spineCount=20`、`spineIdx=23 >= 19` → `atEnd` → **読了**（B のファイル範囲は読み終えている） |

> 2 行目では `spineIdx=23` が B の spine 範囲外になる。`loadEpub()` の復帰は
> `saved.spineIdx < state.spine.length` を検査している（3334 / 3643）ので先頭から開く。
> これは本設計以前からある挙動で、今回は触らない（§10）。

### 数値の連続性

読書データ画面の「読了冊数」「読了率」「著者ランキング」「最近読了した本」は
`finished = finishedAt || atEnd` で計上するため、**既存ユーザーの数値は変わらない**。
論理削除した本が読了に混ざる現行の性質もそのまま（改善したくなるが、
数値が黙って減るほうが害が大きいので今回は触らない）。

---

## 8. テスト

`tests/cases/finished-sync.js`（実装済み・両ファイル各 70 assertion）。
`tests/lib/run.sh finished-sync` で流す。DOM テストなので localStorage とマージ関数を直接叩く。
マージの 5 項目は `_rdMergePos` / `_rdMergePosBest` の**両方に同じ表を流す**ので、
片方だけ直した事故がその場で出る。

### 8-1. データ層（`_rlCollect` の 4 状態）

- `finishedAt` あり・位置は途中・`finishedCount` なし → `finished` / `!atEnd` / `!hasMore`（再読中）
- `finishedAt` なし・末尾 → `finished` / `atEnd`（旧データ・論理削除）
- `finishedCount:20` ・`spineCount:24` ・`spineIdx:19,ratio:1.0` → `hasMore` / `newCh === 4`
- 上の本を最後まで読む（`spineIdx:23,ratio:1.0`）→ `atEnd` / `!hasMore`
- `_rlFilterSort`（`showFinished:false`）で **`atEnd` だけが隠れる**（続きあり・再読中は残る）
- `_rdComputeStats().finished` が続きあり・再読中の本を計上する

### 8-2. 読了の記録（`_rdMarkFinishedAt`）

- `finishedAt` が無ければ刻まれる／あれば**上書きされない**
- `finishedCount` は呼ぶたび `state.spine.length` に**更新される**
- `finishedAt` だけを持つ旧エントリに `finishedCount` が後から入る

### 8-3. マージ（本設計の主題）

- **読了が伝播する**: local `{spineIdx:5, ratio:.3, spineCount:20}` に
  remote `{spineIdx:19, ratio:1, spineCount:20, finishedAt, finishedCount:20}` を
  `_rdMergePos` → `finished === true`
- **位置が退行しても読了が残る**: 上の後に `savePos` 相当で `{spineIdx:5, ratio:.3}` を
  書き戻す → 読了 2 フィールドが残り `finished === true`（§3-A の回帰テスト）
- **補完**: 両側に `finishedAt` が無く remote が末尾 → `finishedAt = remote.lastOpenedAt` かつ
  `finishedCount = remote.spineCount`（§S3）
- **補完しない**: 両側とも途中 → 読了フィールドが付かない
- **`finishedAt` は最古 / `finishedCount` は最大**: 両側にある場合の合流則（§4-6）
- **分母**: `_rdMergePosBest` に local `spineCount:24` / remote `spineCount:20, spineIdx:19`
  → `merged.spineCount === 20` かつ `finished === true`（§3-C の回帰テスト）
- **`_rdMergePosBest` でも上記 4 点が同じ結果になる**

### 8-4. UI

- 続きありカードに `.rl-hasmore-badge` と `.rl-pct` が**両方**出る
- 再読中カードに `.rl-finished-badge` と `.rl-pct` が**両方**出る
- 末尾カードには `.rl-finished-badge` のみ（`.rl-pct` なし）
- `toast.syncFinished` / `readingList.hasMoreBadge` が 4 言語 × 2 ファイルに存在する
  （既存の i18n 網羅ケースに乗る）

### 8-5. 実機でしか確認できないこと

- 実際の 2 端末（PC ↔ iPhone）での Drive 往復
- `autoOpenLast` ON の起動直後に `driveSyncPull` が走る順序（§3-B）
- アクショントーストのタップで最終ページへ飛べること
- 自動保存 ON での逆流が止まっていること（A 端末の読了が B 起動後も Drive に残る）
- **連載本の実データ** — novel_downloader で章追加後に再取得し、同じキーで
  「🆕 続き N 章」が正しい N で出ること
- **同期告知トーストの発火条件** — `showSyncFinishedToast()` は本を開いた状態で
  Drive 同期を通さないと出ない（ヘッドレスでは Drive に到達できない）。
  「最終章を読んでいるだけでは出ない」「別端末が読了したときだけ出る」の 2 点を実機で確認する

---

## 9. 実装順序

| Step | 内容 | 単独で意味があるか |
|------|------|------------------|
| 1 | `_rdMarkFinishedAt` の `finishedCount`（6-1） | △ 記録だけ。表示は変わらない |
| 2 | `_rlCollect` の 4 状態化 ＋ 参照の付け替え（6-2〜6-4, 6-3 の `_rdEstTimeLeft`） | ○ 再読で読了が消えない・連載の続きが見える |
| 3 | `_posAtEnd` ＋ マージ 2 関数（6-5〜6-7） | ○ 同期で読了が伝わる（§3-A/C の本体） |
| 4 | 同期トースト ＋ i18n（6-8, 6-9）＋ コメント（6-10） | ○ 「同期したのに何も起きない」の解消 |
| 5 | `🆕 続きあり` チップ（6-11・任意） | ○ 独立。後日でよい |
| 6 | テスト（§8） | — |

Step 1〜6 実装済み（v2.16.0 の次のリリースに載る）。

**1 → 2 の順を守る。** Step 1 だけでは何も見えず、Step 2 だけでは `finishedCount` が
入らないので「続きあり」が永遠に出ない。また **Step 3 を先に入れてはいけない** ——
`finishedAt` が伝わっても判定が `atEnd` のままでは何も変わらず、
「効かない変更」としてデバッグが難しくなる。

---

## 10. 今回やらないこと（将来課題）

- **読了の明示的な取り消し** — 取り消しの同期には墓標相当の仕組みが要る。
  4-5 のとおり「読み進めれば再読中に戻る」で代替する。
- **論理削除の作り直し** — 本来は `hiddenAt` のような別フィールドであるべきで、
  「位置を末尾に書く」は `atEnd` に相乗りしたハック。ただし `atEnd` フォールバックが
  残る限り従来どおり動くので、今回は触らない。
- **`spineIdx` が新しいファイルの範囲外になる場合の復帰** — 短い版のファイルで開くと
  先頭から始まる（§7）。しおりを「章の相対位置」で持てば解けるが、別設計。
- **「続きあり」でのソート優先** — `_RL_SORTS` に `hasMore` 優先の並びを足すことは可能だが、
  チップ（S7）で絞れれば足りる。需要が出てから。
- **読みかけ本の章追加検出（意図的に対象外・確定仕様）** — `hasMore` は `newCh > 0 && !atEnd`、
  `newCh` は `finishedCount > 0` を前提にしている。したがって **読了記録の無い本は、章が増えても
  「🆕 続きあり」には該当しない**。

  実装上の理由: `finishedCount` は「読み終えた版の章数」なので読了していない本には基準線が無く、
  `spineCount` は開くたび `saveBookMeta()` が上書きするため「前は何章だったか」がどこにも残らない。

  設計上の理由: **読みかけ本は困っていない。** 読了本は既定リストから消えるので更新に気づけないが、
  読みかけ本はリストに出たままで、章が増えれば進捗％が下がる（83% → 79%）ので、それ自体が
  シグナルになる。「続きあり」は**本棚から消えた本を呼び戻すための機能**という位置づけ。

  もし読みかけ本でも出すなら、別フィールド（例 `seenCount` ＝前回開いたときの `spineCount`）を
  `saveBookMeta()` で管理することになるが、**意味が変わる** ——
  `finishedCount` 基準は「読み終えて以降に増えた分」で本を開いても消えないのに対し、
  `seenCount` 基準は「前回開いて以降に増えた分」なので開いた瞬間に消える。
  同じバッジに混ぜると「押しても消えないバッジ」と「押すと消えるバッジ」が同居して分かりにくい。
  やるなら別バッジ・別チップにすること。

  この線引きはヘルプの「✓ 読了と 🆕 続きあり」節に明記してある（§6-12）。
