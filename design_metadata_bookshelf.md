# 設計書：配信元メタデータの表示と本棚のジャンル分け

- 対象バージョン: **v2.12.0**（予定）
- 対象ファイル: `yomikake.html` / `yomikake_ios.html`（両ファイル共通）
- 関連設計書: [[design_bibliography_v2]]（v2.11.0・書誌ブロックの器はここで作った）／
  [[design_reading_list_v2]]（本棚のツール行・絞り込み・ソート）
- 姉妹ツール: **novel_downloader v2.4.0** が全17サイトからジャンル・タグ・連載状態を取得し、
  ePub の OPF に出力するようになった（設計書 `novel_downloader/design_metadata_expansion.md`）
- ステータス: **両ファイル実装完了（2026-07-26）**。版数反映（APP_VERSION / sw.js）は `scripts/release.sh` に任せる
- 現行コード確認日: 2026-07-26（行番号は `yomikake.html` のもの）

---

## 1. 目的

novel_downloader v2.4.0 が ePub に書誌を入れるようになったが、**yomikake 側はまだ何も読んでいない**ため
画面には一切出ていない。本改修で次を実現する。

1. **書誌ブロック（ヘルプ冒頭「現在の本」）にジャンル・状態・タグ・収録話数を出す**
2. **本棚をジャンルで絞り込めるようにする** ← 本命。ここが最終的な成果

蔵書が数十〜数百冊の本棚では、サイト側の細分類（なろう小ジャンル約30種など）は細かすぎる。
novel_downloader 側で**共通ジャンル10種**に粗くまとめてあるので、yomikake はそれをそのまま使う。

### やらないこと（スコープ外）

- **タグを本棚の絞り込み条件にしない。** タグは1冊あたり最大10個あり、`localStorage` に持つと
  容量を圧迫する（§4.3）。書誌ブロックの表示のみに使う。
- **ジャンルの推定。** OPF に `nd:genre` が無い本は「未分類」として扱い、yomikake 側で書名から
  推測したりしない。
- 人気指標（PV・ブックマーク数）の表示。novel_downloader 側でも取得していない。

---

## 2. novel_downloader が出力するもの（受け取り仕様）

### 2.1 独自メタ `nd:*`

`<package prefix="nd: https://github.com/ayati/novel_downloader/ns#">` 配下。
**`nd:` を1件も出さない本では `prefix` 宣言ごと省略される**ため、宣言の有無で判定しないこと。

| property | 例 | 本改修での用途 |
|---|---|---|
| `nd:genre` | `fantasy` | **本棚のジャンル分け**・書誌ブロック |
| `nd:genreRaw` | `ハイファンタジー〔ファンタジー〕` | 書誌ブロックに併記 |
| `nd:serialStatus` | `完結` / `連載中` | 状態バッジ |
| `nd:episodeCount` | `935` | 「935話中148話を収録」 |
| `nd:charCount` | `4074034` | 読了目安時間 |
| `nd:updated` | `2026-07-15` | 「サイト更新」 |
| `nd:published` | `2020-04-01` | （`dc:date` と同じ値。表示は `dc:date` 側を使う） |
| `nd:ageRating` | `R15` | （`dcterms:audience` と同じ値） |
| `nd:site` / `nd:siteId` / `nd:catchphrase` / `nd:tags` | — | 標準語彙側で読むので使わない |

### 2.2 標準語彙（こちらを優先して読む）

| 要素 | 内容 | 現行 v2.11.0 |
|---|---|---|
| `dc:title` ＋ `title-type="subtitle"` | キャッチコピー | **未読み取り**（本改修で対応） |
| `dc:subject` | ジャンル原文＋タグ | **未読み取り**（本改修で対応） |
| `dcterms:audience` | `R15` 等 | **未読み取り**（本改修で対応） |
| `dc:date` | **作品の初回公開日** | 読み取り済み（`_pubDateFromOpf`） |
| `dc:contributor` ＋ role | 訳者(`trl`)・入力者(`trc`)・校正者(`pfr`) | 読み取り済み。**`trc` / `pfr` のラベルが未定義**（§3.4） |
| `dc:publisher` / `dc:description` / `dc:source` | 配信元・あらすじ・底本URL | 読み取り済み |

### 2.3 `dc:date` は放っておいても正しくなる

v2.11.0 は「`dc:date` と `dcterms:modified` が同日（±1日）なら ePub の生成日」とみなして
刊行日の表示を抑止している（`_pubDateFromOpf`）。novel_downloader v2.4.0 は `dc:date` に
**作品の初回公開日**を入れるようになったので、この判定に引っかからず**自動的に表示されるようになる**。

→ **抑止ロジックは削除しないこと。** v2.3.1 以前に作った ePub は生成日のままで、そちらには依然必要。

---

## 3. 現行コード確認結果

### 3.1 しおりキーは安全（確認済み）

`makeBookKey(title, creator)`（`:7696`）＝ `'epub_pos_' + title + '__' + creator`。
`title` は `querySelector('metadata > *|title, metadata > title')`（**PC `:2768` / iOS `:3086` とも同一**）で
**文書順の最初の1件**を取るだけで `title-type` を見ていない。novel_downloader は本題を先に出力するので、
副題を読む改修を入れても**キーは変わらない**。

- `state.bookCreators` は `dc:creator` のみ。**contributor を混ぜない**方針は v2.11.0 から継続する。
- 副題は `state.bookSubtitle` に**表示専用**で持ち、`bookTitle` には足さない。

### 3.2 `state.spine` は話数ではない

`state.spine` は OPF の `spine itemref` をそのまま並べたもの（`:2704`）で、各要素は
`{href, mediaType, absPath, spreadProps}`。novel_downloader の ePub の spine は実測で次のとおり。

```
cover-page, cover, toc, ep0001, …, epNNNN, colophon
（2話の本 → spine 6件 ／ 1話の本 → spine 5件。いずれも本文以外が4件）
```

`state.spine.length` は話数より **4 多い**。ただし表紙画像が無い場合は `cover-page` が
spine に入らないため**固定のオフセットではない**。定数を引くのではなく本文だけを数えること。

> 現行 v2.11.0 の書誌ブロックは `help.chapters` に `state.spine.length` をそのまま出しており、
> 自作 ePub では実際の話数より4多い値が表示されている（既存の軽微な不正確さ）。

→ 収録話数は **`href` が `ep{数字}.xhtml` に一致する spine 項目を数える**（§4.2）。
これは novel_downloader が作った ePub にだけ効く判定だが、`nd:episodeCount` を持つのは
そもそもその ePub だけなので問題にならない。数えられなければ行ごと出さない。

### 3.3 本棚の現行構造

| 関数 | 行 | 役割 |
|---|---|---|
| `saveBookMeta()` | `:7654` | 本を開くたびに `localStorage[bookKey]` へ書誌を保存。**容量超過時は cover → source/site の順に捨てる**フォールバックあり |
| `_rlCollect()` | `:6476` | `localStorage` を走査して本棚カードの item を組み立てる |
| `_rlFilterSort()` | `:6533` | `showFinished` / `filterReady` / 全文検索（`title + creator`）→ ソート6種 |
| `_rlRender()` | `:6599` | カード HTML を生成 |
| `_rlLoadPrefs()` | `:6457` | `{view, sort, filterReady, showFinished}` を `epub_rl_prefs` に永続化 |
| ツール行 markup | `:987`〜`:1011` | 検索欄・ソートメニュー・チップ2個・表示切替 |

### 3.4 役割ラベルに `trc` / `pfr` が無い

`ROLE_KEY`（`:8754` 付近）は `aut/ill/trl/edt/art/sup/pht/bkp/prt/pbl/dst/mfr` のみ。
青空文庫の**入力者（`trc`）・校正者（`pfr`）**が未定義で、名前だけがラベル無しで出る。
両者は「制作系」に近いので `ROLE_PRODUCTION` に入れて下部の小さい行に回す。

---

## 4. 設計

### 4.1 共通ジャンルの辞書

novel_downloader と同じ10種。**ID は英語・表示名は i18n 対象**（タグとジャンル原文は翻訳しない）。

```js
const ND_GENRES = ['fantasy','romance','sf','mystery','drama',
                   'history','literature','nonfiction','fanfic','other'];
// 表示名は t('genre.' + id) で引く
```

`nd:genre` が未知の値だった場合（novel_downloader 側で軸が増えたとき）は、
**その値を素のまま表示し、絞り込みの選択肢にも出す**。ビューアを更新しなくても壊れないようにする。

### 4.2 書誌ブロックの表示（Phase 5 相当）

```
現在の本
水属性の魔法使い
 　剣と魔法の世界に転生することになった…        ← dc:title[title-type=subtitle]
著者 久宝　忠 🔍
出版社：小説家になろう          ［完結］        ← nd:serialStatus をバッジで
刊行：2020年4月1日 ／ サイト更新：2026年7月15日  ← dc:date ／ nd:updated
ジャンル：ファンタジー（ハイファンタジー〔ファンタジー〕）
#異世界転生 #男主人公 #魔法                     ← dc:subject をチップ表示
対象：R15                                      ← dcterms:audience
底本：小説家になろうで読む ↗
あらすじ：……（3行クランプ・実装済み）
935話中 148話を収録 ／ 約407万字 ／ 読了目安 約13時間
入力 金川一之　校正 高橋美奈子                  ← 制作系ロール（小さく）
```

- **収録話数**: `nd:episodeCount` と §3.2 の実話数の**両方が取れたときだけ**「N話中M話を収録」。
  片方しか無ければ従来どおり章数だけを出す。
- **読了目安**: `nd:charCount ÷ 500字/分`。既存の `_rdFmtDuration()` で整形する。
- `dc:subject` は**先頭の1件がジャンル原文**（novel_downloader の出力順）だが、順序に依存せず
  `nd:genreRaw` と一致する要素をタグ表示から除くだけにする。

### 4.3 本棚のジャンル分け（Phase 7 相当・本命）

**`localStorage` に増やすのはジャンルと連載状態の2つだけ。**

```js
// saveBookMeta() に追加
...(state.bookGenre  ? {genre:  state.bookGenre}  : {}),
...(state.bookSerial ? {serial: state.bookSerial} : {}),
```

- タグ・あらすじ・文字数は**保存しない**（1冊で数百バイト増える。本棚に必要ない）。
- 既存の容量超過フォールバック（`:7674`）の**捨てる順序に影響させない**。
  `genre` / `serial` は数十バイトなので、`cover` を捨てる段階より前に消す必要はない。

**絞り込み UI** はツール行にジャンル用のドロップダウンを1つ足す（ソートメニューと同じ作り）。

```
[並び替え ▾] [ジャンル ▾] [⚡ すぐ開ける] [✓ 読了も表示] [≡ ⊞]
```

- 選択肢は**蔵書に実在するジャンルだけ**を冊数付きで出す（`すべて` / `ファンタジー (12)` / …）。
  10種を常に並べると1冊も無い項目が並んで使いにくい。
- `nd:genre` を持たない本（他ツール製・v2.4.0 以前の novel_downloader 製）は
  **「未分類」**としてまとめ、選択肢の末尾に置く。
- `_rlPrefs` に `genre: ''`（空＝すべて）を追加して永続化する。

**カードの表示**（`_rlRender()`）:

- 連載中の本に `連載中` バッジを出す。**完結は出さない**（読了バッジと紛らわしく、
  そもそも本棚の大半は完結作品なので情報量が薄い）。
- ジャンルはカードには出さない（絞り込みで使えれば足りる。カードの情報量を増やしすぎない）。

**全文検索の対象にジャンルを含める**（`_rlFilterSort()` `:6541` の `hay`）。
「ファンタジー」と打てば絞り込めるほうが自然。

### 4.4 反映のタイミング（重要な制約）

ジャンルは **OPF を読んだとき＝本を開いたとき**にしか分からない。したがって
**v2.12.0 に上げただけでは既存の蔵書は全部「未分類」**で、開き直すたびに1冊ずつ分類されていく。

- 初回は「未分類」が大量に出るため、**ジャンル絞り込みの既定値は「すべて」**にする。
- 選択肢に「未分類」があること自体が「まだ開いていない本がある」の合図になる。
- この挙動をヘルプに1行書く（`help.body` の本棚の節）。

---

## 5. 改修箇所

| # | 箇所 | 内容 |
|---|---|---|
| 5.1 | `state`（`:2425` 付近） | `bookSubtitle` / `bookGenre` / `bookGenreRaw` / `bookSerial` / `bookTags` / `bookEpisodeCount` / `bookCharCount` / `bookSourceUpdated` / `bookAudience` を追加。**すべて表示専用** |
| 5.2 | `closeBook()`（`:6889` 付近） | 上記のリセットを漏れなく追加 |
| 5.3 | `loadEpub()`（`:2768` 付近） | 新関数 `_ndMetaFromOpf(opfDoc)` / `_subtitleFromOpf(opfDoc)` / `_subjectsFromOpf(opfDoc)` / `_audienceFromOpf(opfDoc)` を呼んで state へ |
| 5.4 | 新関数 `_countEpisodesInSpine()` | `href` が `ep\d+\.xhtml` の spine 項目を数える（§3.2） |
| 5.5 | `ROLE_KEY` / `ROLE_PRODUCTION`（`:8753` 付近） | `trc`（入力）・`pfr`（校正）を追加し `ROLE_PRODUCTION` に含める |
| 5.6 | `updateHelpContent()`（`:8850` 付近） | 新関数 `_helpSubtitleHtml()` / `_helpGenreHtml()` / `_helpTagsHtml()` / `_helpStatusBadge()` / `_helpVolumeHtml()`（話数・文字数・読了目安）を追加 |
| 5.7 | `saveBookMeta()`（`:7654`） | `genre` / `serial` を保存（§4.3） |
| 5.8 | `_rlCollect()`（`:6476`） | item に `genre` / `serial` を載せる |
| 5.9 | `_rlLoadPrefs()`（`:6457`）／`_rlFilterSort()`（`:6533`） | `genre` 絞り込みを追加。検索の `hay` にジャンル表示名を含める |
| 5.10 | ツール行 markup（`:991` 付近）＋ `_rlSyncToolsUI()` | ジャンルのドロップダウンを追加。`toggleRlGenreMenu()` / `setRlGenre()` |
| 5.11 | `_rlRender()`（`:6599`） | 連載中バッジ |
| 5.12 | i18n 4言語（ja/en/zh-TW/zh-CN） | `genre.*`（10種）／`help.genre` / `help.tags` / `help.serialRunning` / `help.serialFinished` / `help.volume` / `help.readTime` / `help.sourceUpdated` / `help.audience`／`role.trc` / `role.pfr`／`readingList.genreAll` / `readingList.genreUnclassified` / `readingList.genreLabel` |

**両ファイルに同一差分を当てる。** 該当関数は PC / iOS で同一実装であることを事前に確認する
（v2.11.0 のときと同じ手順）。

---

## 6. 検証

### 6.1 データの用意

novel_downloader v2.4.0 で各ジャンルの ePub を作る。最低限そろえたい組み合わせ:

| 確認したいこと | 用意する本 |
|---|---|
| ジャンル・タグ・状態・話数が全部そろう | なろう（`nd:` 11項目） |
| 副題（キャッチコピー） | カクヨム |
| contributor が `trc` / `pfr` | 青空文庫 |
| contributor が `trl`（訳者分離） | プロジェクト杉田玄白 |
| `nd:` が1件も無い | v2.3.1 以前の出力・他ツール製・商用 ePub |
| ジャンルだけ無い（判定不能サイト） | ソリスピア |

### 6.2 必須の回帰確認

1. **しおり互換**: v2.11.0 でしおりを付けた本を v2.12.0 で開き、**同じ位置に復帰**すること。
   **副題を持つカクヨムの本で必ず確認**（`dc:title` が2件ある本）。
2. `nd:` が無い本で書誌ブロックの見た目が v2.11.0 と変わらないこと（行が増えない）。
3. 商用 ePub（ISBN・contributor あり）で v2.11.0 と同じ表示になること。
4. 本棚: 既存の蔵書が「未分類」に入り、**既定の「すべて」では全部見えている**こと。
5. 本棚: 1冊開き直すとその本だけジャンルが付き、選択肢に冊数が反映されること。
6. 本棚: ジャンル絞り込み＋既存の `filterReady` / `showFinished` / 検索が併用できること。
7. `localStorage` 容量超過時のフォールバックが従来どおり動くこと（cover → source/site の順）。
8. PC 版 / iOS 版で同一挙動。

---

## 7. リリース

- `yomikake.html` / `yomikake_ios.html` を両方改修。
- 版数3箇所（両 `APP_VERSION` と `sw.js` の `VERSION`）は `scripts/release.sh 2.12.0` が一括更新する
  （手で書き換えない）。
- CLAUDE.md の「書誌ブロック」節に新関数・state を追記。
- タグ `v2.12.0`。
- リリースノートに **「ジャンルは本を開き直すと付く」**（§4.4）を明記する。
  これを書かないと「ジャンルが出ない」という誤解を招く。

## 8. 将来課題

- `file-as`（読み）による著者名ソート。青空文庫の ePub は `nd:` 経由で読みを持っているが、
  OPF の `refines` に `file-as` を出すのは novel_downloader 側の未実装項目。
- ジャンル別の読書データ（どのジャンルをよく読むか）。
- `nd:siteId` を使った同一作品の重複検出。


---

## 9. 実装メモ（2026-07-26）

### 9.1 しおり JSON のマージに手当てが必要だった（設計時に見落としていた）

Drive 同期のマージ関数は2つあり、**ローカル固有のフィールドの扱いが逆**だった。

| 関数 | 使われる場面 | マージ規則 |
|---|---|---|
| `_rdMergePos` | しおりの取込（JSON インポート／Drive 取込） | `{...remote}` ＝ **リモートが総取り** |
| `_rdMergePosBest` | 自動同期（Drive→端末） | `{...local, ...remote}` ＝ ローカル固有キーは残る |

`genre` / `serial` は**本を開いた端末にしか無い**ので、前者のままだと v2.11.0 の端末から
送られたしおりで上書きされ、本棚の分類が消える。既存の `creators` / `cover` と同じく
**「どちらかにあれば残す」**を両方の関数に追加した。

### 9.2 未収録がある本で文字数・読了目安を出さない

`nd:charCount` は**サイト側の作品全体の文字数**。実装後の確認で「935話中2話を収録／約407万字／
読了目安136時間」と並んでしまい、**手元の本を読む時間だと誤読される**ことが分かった。
`nd:episodeCount > 収録話数` のときは文字数と読了目安を出さないようにした。

### 9.3 検証に使ったもの

- 両ファイルの `<script>` を抽出して `node --check`（構文）
- **jsdom 22**（最新版は Node 18 で `ERR_REQUIRE_ESM` になる）で実 ePub の OPF を投入。
  jsdom は `*|title` を**解釈せず例外を投げる**ため、localName 照合のシムを噛ませて
  ロジックだけを検証した（本番のブラウザでは `*|title` が効く。v2.11.0 の書誌ブロックで実証済み）
- 新規22関数が両ファイルで完全一致していることを確認

**実 ePub での確認結果**

| 本 | 確認できたこと |
|---|---|
| なろう（935話中2話） | ジャンル・タグ10件・状態・R15・「935話中2話を収録」 |
| カクヨム（副題あり） | **`dc:title` が2件でも `bookKey` が使う値は本題のまま**＝しおり不変 |
| 青空文庫（走れメロス） | 文芸（NDC 913）・spine 5件→本文1話 |
| 杉田玄白（鏡の国のアリス） | ジャンルなし・spine 19件→**本文15話**（従来は19章と表示されていた） |
| `nd:` なしの本 | 行が1つも増えず、従来どおり「チャプター数：N」 |

### 9.4 残り（実機で確認すること）

§6.2 の8項目。特に **v2.11.0 でしおりを付けた本を開いて位置が復帰すること**（副題を持つ
カクヨムの本で必須）と、**ジャンル絞り込みが既存のチップ・検索と併用できること**。
