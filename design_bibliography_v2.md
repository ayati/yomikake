# 設計書：書誌情報ブロックの拡充（contributor・ISBN取得元・あらすじ・刊行日・シリーズ）

- 対象バージョン: **v2.11.0**（予定）
- 対象ファイル: `yomikake.html` / `yomikake_ios.html`（両ファイル共通）
- 関連設計書: [[design_bibliography_source_link]]（v2.10.0・本書はその続き。§9 将来課題の回収）
- 姉妹ツール: [jisui2epub](https://github.com/ayati/jisui2epub) v1.4.0 が NDL 書誌から
  `dc:contributor` / `file-as` / `dcndl:seriesTitle` / `dc:date` を出力するようになった
- ステータス: **両ファイル実装完了（2026-07-25）**。版数反映（APP_VERSION / sw.js）は `scripts/release.sh` に任せる
- 実測: 手元の ePub **58冊**（yomikake / mangaP2ePub / jisui2epub の temp_sample 合算。商用・自作混在）の
  OPF metadata を機械集計

---

## 1. 目的

v2.10.0 で書誌ブロック（ヘルプ冒頭「現在の本」）を作ったが、表示しているのは
**書名・著者(role付き)・出版社・底本(URL/ISBN)・章数・目次項目数**だけで、ePub が持っている
書誌のうち読者に意味のあるものを取りこぼしている。本改修で以下を出す。

- **`dc:contributor`（訳者・画家・編者ほか）** ← 今回の主目的
- **ISBN の取得元を `dc:identifier` にも拡張**（商用 ePub で ISBN 表示・NDL 検索が効くようになる）
- **あらすじ（`dc:description`）を折りたたみで**
- **刊行日（`dc:date`）を条件付きで**
- **シリーズ名・巻**
- **著作権表示（`dc:rights`）**

### やらないこと（スコープ外）
- **ASIN の表示（`dc:identifier` の `opf:scheme="ASIN"`）**。Kindle 由来3冊にあるが、
  出自を可視化する意味合いが強く読書の役に立たない。**採用しない（確定）**。
- `dc:subject` の NDC 番号（`913.6` は一般読者に意味が伝わらない。分類名辞書が必要）。
- `file-as`（読み）の表示。ソート用データなので画面には出さない（将来の本棚ソート用）。
- `dcterms:modified`・`rendition:*`・`ebpaj:` / `ibooks:` / `kadokawa:` / `fixed-layout-jp:` 等の
  各社独自・変換器の痕跡。
- 読書データ画面への書誌表示（v2.10.0 と同じくレイヤーを混ぜない）。

---

## 2. 現状調査（58冊の実測）

### 2.1 出現状況

| 項目 | 出現 | v2.10.0 の扱い |
|---|---|---|
| `dc:title` / `dc:identifier` / `dc:language` | 58/58 | 書名のみ表示 |
| `dc:creator` | 57/58 | 表示（role: aut 35 / trl 4 / ill 3 / role無し 24） |
| `dc:publisher` | 26/58 | 表示 |
| `refines:role` / `display-seq` / `file-as` | 28 / 19 / 19 | role・display-seq のみ利用 |
| `dc:date` | 17/58 | **未表示** |
| `dc:rights` | 5/58 | **未表示** |
| `dc:contributor` | 4/58（role: trl 3 / bkp 2 / prt 2 / pbl 1 / edt 1） | **未表示** |
| `dc:description` | 2/58（338字・78字） | **未表示** |
| `dc:source` | 3/58（すべて自作ツール製） | 表示 |

### 2.2 O'Reilly Japan 3冊が事実上の「書誌が最も揃っている実例」

```
dc:title / dc:creator / dc:publisher
dc:identifier = 9784873117782（ISBN-13。1冊は opf:scheme="ISBN"、2冊は裸13桁）
dc:date       = 2017-06-03（電子版の発行日）
dc:rights     = "Copyright ©2015 by Al Sweigart." ほか計3要素
dc:contributor[trl] = 相川 愛三 ／ [bkp] 株式会社トップスタジオ ／ [prt] 株式会社オライリー・ジャパン
```

**罠1: ISBN が `dc:source` ではなく `dc:identifier` に入る。** v2.10.0 は `dc:source` しか見ないため、
この3冊は ISBN 表示も NDL 検索リンクも出ない。→ §3.2 で取得元を拡張する。

**罠2: `dc:date` の意味が本ごとに違う。** 17冊のうち **7冊は `dcterms:modified` と同日＝ ePub の生成日**
（旧 novel_downloader / 旧 jisui2epub の出力・kepub 変換）。一方 `opf:event="publication"` 付きの3冊
（Kindle 由来）は正しい刊行日。→ §3.4 で条件付き表示にする。

### 2.3 自作ツール側（jisui2epub v1.4.0）が出すもの

`dc:contributor`＋role（trl/ill/art/edt）・`file-as`（書名/著者/出版社の読み）・`dc:publisher`・
`dc:date`（底本の刊行日のみ。生成日は入れない）・`dc:source urn:isbn`・
`dcndl:seriesTitle` / `dcndl:volume`・`dc:subject`（NDC）・アクセシビリティ metadata。
**本改修で最も見た目が変わるのは自炊本**（翻訳小説・挿絵つき児童書で訳者/画家が1〜2人増える）。

---

## 3. 設計判断

### 3.1 `dc:contributor` の表示（主目的）

- `_parseCreatorsRoled()` を汎用の `_parseRoledPeople(opfDoc, tag)` に一般化し、
  creator と contributor を**別々の配列**として持つ（`kind` フラグは持たせない。
  混ぜないことをデータ構造で担保する）。
- **`state.bookCreators` / `state.bookCreator` には絶対に混ぜない**。しおりキーは
  `makeBookKey(title, creator)`＝`書名 + 全 dc:creator` 由来なので、contributor を足すと
  **既存のしおりが全部割れる**。表示専用の配列を別に持つ（`state.bookContributorsRoled`）。
- 表示は既存の役割付き著者行に続けて同じ体裁で並べる（`著者 ○○ / 訳 ○○ / 絵 ○○`）。
- **制作系ロール（`bkp` 制作・`prt` 印刷・`pbl` 発売元・`dst` 発売）は別行に小さく**出す。
  読者向けの情報ではないが、O'Reilly 本に実績があり書誌としては正当なので捨てない。
  例: `制作：株式会社トップスタジオ／印刷：株式会社オライリー・ジャパン`（opacity .55・11px）。
- role ラベルの追加が必要（既存: aut/ill/trl/edt/art/sup）。**追加: `pht`(写真) / `bkp`(制作) /
  `prt`(印刷) / `pbl`(発売元) / `dst`(発売)**。未知の role コードはラベル無しで名前だけ出す。

### 3.2 ISBN の取得元を広げる（`classifySource()` の拡張）

優先順に、

1. `dc:source`（現行どおり。`urn:isbn:` / 裸 ISBN / http(s) URL）
2. **`dc:identifier`**（`opf:scheme="ISBN"` / `refines` の `identifier-type` / 値が ISBN 形）

いずれも**数字だけ取り出して13桁チェックディジットを検証**してから採用する。
`urn:uuid` と ASIN は検証で自然に落ちる（ASIN は §1 のとおり採用しない）。
ISBN-10 は13桁へ換算して NDL 検索に使う（jisui2epub の `normalize_isbn` と同じ規則）。
表示は現行の「底本：ISBN …🔍」を流用。**`dc:source` が URL の本ではそちらを優先**（現行維持）。

### 3.3 あらすじ `dc:description`（折りたたみ）

- 既定は**3行でクランプ**（`-webkit-line-clamp:3`）し、「もっと見る／閉じる」でトグル。
- 改行を含むことがあるので `esc()` 後に `\n` → `<br>`。HTML タグは入れない。
- 500字を超える場合も全文を保持（トグルで全部読める）。

### 3.4 刊行日 `dc:date`（条件付き）

次のいずれかを満たすときだけ「**刊行：YYYY年M月D日**」として表示する。

- `opf:event="publication"` が付いている（EPUB2 系）
- `dcterms:modified` が無い、または **`dc:date` と日付部分が異なる**

同日は ePub 生成日の可能性が高い（実測7/17件）ため出さない。**誤った刊行日を出さないことを優先**する
（jisui2epub v1.4.0 以降は底本の刊行日しか入れないので自炊本は常に表示される）。
`YYYY` / `YYYY-MM` の粒度もありうるので、年・年月・年月日を出し分ける。

> **実装時の修正（実測）**: 「同日」判定は**±1日の許容が必要**。`dcterms:modified` は UTC、
> `dc:date` はローカル日付で書かれるため、生成日でも1日ずれる本がある
> （実測: 地下室からのふしぎな旅＝`dc:date 2026-07-23` / `modified 2026-07-22T23:38Z`。
> 霧・黒牢城も同型）。前方一致（年・年月・年月日）と `Date.parse` の差 ≤ 86400000ms の
> 両方で判定する。商用本は差が年単位なので誤って隠すことはない。

### 3.5 シリーズ名・巻

- 自作ツール: `dcndl:seriesTitle` ＋ `dcndl:volume`
- EPUB3 標準: `belongs-to-collection`（＋ `refines` の `collection-type="series"` / `group-position`）
  ※ 58冊には未出現だが、規格準拠の本のために対応しておく
- 表示: `シリーズ：創元推理文庫（下）`

### 3.6 著作権表示 `dc:rights`

- 複数要素は `／` で連結し、**全体120字で省略**（`…`）。11px・opacity .5 で最下部。
- リンクにはしない。

### 3.7 表示レイアウト（あるものだけ出す・現行方針を踏襲）

```
現在の本
魔法使いの塔（下）                        ← dc:title
著者 マーセデス・ラッキー 🔍  訳 山口緑      ← dc:creator + dc:contributor（role付き）
出版社：東京創元社
刊行：2016年10月21日                      ← §3.4 の条件を満たすときだけ
シリーズ：創元推理文庫（下）
底本：ISBN 9784488577230 🔍               ← dc:source / dc:identifier（§3.2）
あらすじ：〜〜〜〜〜（3行でクランプ）… もっと見る
15章 ／ 目次 17項目
制作：株式会社トップスタジオ                ← 制作系 role（小さく）
© 2016 O'Reilly Japan, Inc. ／ …           ← dc:rights（小さく）
[タップガイドを表示]
```

---

## 4. 改修箇所（yomikake 両ファイル）

| # | 箇所 | 内容 |
|---|---|---|
| 4.1 | `state`（`:2380`付近） | `bookContributorsRoled` / `bookDescription` / `bookPubDate` / `bookSeries` / `bookRights` を追加。`closeBook()` のリセット（`:6838`付近）も同期 |
| 4.2 | `_parseCreatorsRoled()`（`:7472`） | `_parseRoledPeople(opfDoc, tag)` へ一般化し contributor も読む。**`bookCreators` は creator のみのまま**（bookKey 不変） |
| 4.3 | `classifySource()`（`:7462`） | ISBN 判定を13桁チェックディジット検証に変更。`dc:identifier` からの取得を追加（新関数 `_isbnFromIdentifiers(opfDoc)`） |
| 4.4 | `loadEpub()`（`:2732`付近） | 上記 state の抽出。`dc:description` / `dc:date`＋`opf:event` / `dcterms:modified` / シリーズ / `dc:rights` |
| 4.5 | `_helpCreatorsHtml()`（`:8612`） | contributor を連結。制作系 role は別行（新関数 `_helpProductionHtml()`） |
| 4.6 | `updateHelpContent()`（`:8649`） | 行の追加。新関数 `_helpDescriptionHtml()`（折りたたみ）・`_helpPubDateHtml()`・`_helpSeriesHtml()`・`_helpRightsHtml()` |
| 4.7 | i18n（4言語 ja/en/zh-TW/zh-CN） | `help.pubDate` / `help.series` / `help.synopsis` / `help.more` / `help.less` ＋ `role.pht` / `role.bkp` / `role.prt` / `role.pbl` / `role.dst` / `role.mfr`（制作行はラベル＋名前の並びで出すので専用キーは設けない） |

- **しおりキー（`makeBookKey`）は一切変えない**。回帰確認の必須項目。
- `saveBookMeta()`（読みかけリスト用）は現行のまま（カードに書誌は増やさない）。

### 4.8 実装メモ（2026-07-25）

- `classifySource()` は **`normalizeIsbn13()` 経由に一本化**した。従来は `dc:source` の値を
  そのまま表示していた（ハイフン入りのまま）が、常に裸の13桁になり NDL 検索と表示が一致する。
  ISBN-10 の底本表記（`4-06-158980-6`）も13桁へ換算されるようになった。
- `_parseCreatorsRoled()` は `_parseRoledPeople(opfDoc, 'creator')` の薄いラッパにした
  （CLAUDE.md が関数名を参照しているため名前は残す）。
- 役割ラベルの対応表 `ROLE_KEY` は `_helpCreatorsHtml()` 内のローカル定義をやめ、
  `ROLE_PRODUCTION` とともにファイル先頭側のグローバル定数にした（制作行と共用するため）。
- あらすじの折りたたみは `-webkit-line-clamp:3` と `data-open` 属性で行い、
  `toggleHelpDesc(event)` を `onclick` から呼ぶ（モーダルは innerHTML 再構築なので状態は毎回リセット）。
- **両ファイルへは同一の差分をスクリプトで適用**した（PC/iOS で該当5関数のハッシュが一致していることを
  事前確認済み）。実装後も両ファイルで `node --check` 相当の構文チェックを通している。

---

## 5. 検証

### 5.1 実施済み（2026-07-25・jsdom で実 OPF 10冊を投入）

`yomikake.html` から対象関数を切り出し、実 ePub の OPF を食わせて表示 HTML を確認した
（jsdom は名前空間セレクタ `*|tag` を解釈しないため、localName 一致の簡易セレクタを噛ませている）。

| 本 | 結果 |
|---|---|
| O'Reilly 778 / 552 | **`dc:identifier` から ISBN を取得**（9784873117782 / 9784873115528）→ 底本行＋NDL検索。訳者が著者行に、印刷・制作が制作行に分離。`dc:rights` 3要素を連結・120字省略。刊行 2017-06-03 / 2013-06-07 |
| オープンソースライセンス | 編 高橋征義（edt）／あらすじ78字クランプ／権利表示 |
| 薬屋のひとりごと | あらすじ338字クランプ／**刊行日は非表示**（`dc:date`＝`dcterms:modified`＝生成日） |
| 遠まわりする雛・ナルニア（ASIN） | **ISBN 行も ASIN も出ない**／`@event="publication"` の刊行日は表示 |
| 蘇我氏（商用）・地下室（旧 jisui2epub 出力） | 刊行日を**出さない**（生成日と同日・±1日） |
| jisui2epub v1.4.0 出力（霧・諸国そばの本） | 著者＋イラスト（ill）／編（edt）／出版社／刊行日／シリーズ（`dcndl:seriesTitle`）／ISBN が並ぶ |
| **bookKey 安全性** | 3冊で `bookCreators` に contributor が混ざらないことを確認（`epub_pos_霧のむこう__柏葉幸子` など従来と同一） |

`normalizeIsbn13()` のユニット12件（接頭辞・ハイフン・`urn:isbn:`・ISBN-10→13・末尾X・
ASIN・`urn:uuid`・価格コード・チェックディジット不正・空・非ISBN文字列）も全件一致。

### 5.2 実機で確認すること

1. **しおり互換**: v2.10.1 で栞を付けた本を v2.11.0 で開き、**同じ位置に復帰**すること（contributor を
   持つ本＝ jisui2epub v1.4.0 出力で必ず確認）。
2. O'Reilly 3冊: ISBN 表示＋NDL 検索リンク、訳者、制作系行、`dc:rights`、刊行日。
3. 薬屋のひとりごと（description 338字）: 3行クランプ＋トグル。
4. Kindle 由来3冊（ASIN）: **ISBN 行も ASIN も出ない**こと。刊行日は `@event="publication"` で出る。
5. 旧ツール出力（`dc:date` == `dcterms:modified`）: 刊行日を**出さない**こと。
6. jisui2epub v1.4.0 出力: 著者＋訳/絵、出版社、刊行日、シリーズ、ISBN が並ぶこと。
7. 書誌が何も無い本（Web小説 ePub 等）: 現行と同じ見た目（行が増えない）。
8. PC 版 / iOS 版で同一挙動。
9. あらすじの「もっと見る／閉じる」トグル（jsdom では HTML 生成のみ確認）。

## 6. リリース

- `yomikake.html` / `yomikake_ios.html` を両方改修（§4）。**済**
- 版数3箇所（両 `APP_VERSION` と `sw.js` の `VERSION`）は `scripts/release.sh 2.11.0` が一括更新する
  （手で書き換えない）。
- CLAUDE.md の書誌ブロック節に新関数・state を追記。
- タグ `v2.11.0`。

## 7. 将来課題

- `file-as`（読み）を使った本棚の著者名ソート。
- `dc:subject` / NDC の分類名表示（辞書が必要）。
- 書誌ブロックからの「同じ著者の本を本棚で絞り込む」導線。
