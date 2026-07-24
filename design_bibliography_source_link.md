# 設計書：書誌情報ブロックの格上げ・底本サイトリンク・読みかけリストのサイトバッジ

- 対象バージョン: **v2.10.0**（予定）
- 対象ファイル: `yomikake.html` / `yomikake_ios.html`（両ファイル共通）＋ `novel_downloader/novel_downloader.py`
- 姉妹ツール推奨改修（別リポジトリ・§5B）: [jisui2epub](https://github.com/ayati/jisui2epub) / [mangaP2ePub](https://github.com/ayati/mangaP2ePub)
- 関連設計書: [[design_reading_list_v2]]（カード/しおりJSON）, [[design_reading_data]]
- ステータス: **yomikake 両ファイル実装完了（2026-07-24）** / novel_downloader（§5）・姉妹ツール（§5B）は未着手
- 実測検証: 実サンプル ePub 6冊で書誌抽出・colophon フォールバック・role 解釈を確認済み（薬屋＝なろう / スーパーカブ＝カクヨム を再DLなしでリンク化、講談社書＝出版社＋著者/イラスト分離）

---

## 1. 目的・背景

yomikake は Web 小説の読書に多用される。読書中に「底本の配信元（カクヨム等）へ飛んで、感想を書く／作者にハートを付ける」導線が欲しい。現状これを行うには、目次から**表紙ページ（cover.xhtml）または奥付（colophon.xhtml）へジャンプ**し、本文中のリンクを踏むしかない。ジャンプせず書誌を確認・底本サイトへ遷移できる表記を追加する。

同時に、これは「書誌情報を第一級で扱う」改善でもある。商業出版の ePub も含めて、**この本の書誌（書名・著者・役割・出版社・底本）を尊重して見せる**ことをねらう。novel_downloader（同スイートの ePub 生成ツール）側の出力も併せて改修する。

### やらないこと（スコープ外）
- 読書データ（`#reading-data-overlay`）への書誌表示（集計画面と個別書誌はレイヤーが違うため混ぜない）
- 起動時オープン時のインタースティシャル表示（本文即入りを優先）
- トップバーへの新規アイコン追加（スマホでは既に横スクロール必須のため増やさない）
- 著者ページ URL の保存（novel_downloader は著者名テキストしか持たないため。将来課題）

---

## 2. 現状調査（事実）

### 2.1 商業出版 ePub の OPF（実サンプル4冊を実測）

`temp_sample/` の DRM 解除済み商業 ePub を調査した結果：

| 書名 | dc:publisher | dc:source | dc:creator（role） |
|------|--------------|-----------|--------------------|
| 蘇我氏 | 中央公論新社 | **無し** | 倉本一宏(aut) |
| 平安朝の事件簿 | 文藝春秋 | **無し** | 繁田信一(aut) |
| 仏教入門 | 講談社 | **無し** | 南直哉(aut) |
| ねらわれた学園 | 講談社 | **無し** | 眉村卓(aut), れい亜(**ill**) |

判明した事実：
- **`dc:publisher` は必ず存在**し、出版社名がテキストで入る（`file-as` に読みガナ refine も付く）。
- **`dc:source` は一つも無い**。EPUB3 仕様上 `dc:source` は「派生元リソースの識別子」で、商業書では**印刷版 ISBN（`urn:isbn:…`）**を入れる用途。
- **`dc:creator` は複数・`role` 付き**（`marc:relators`：`aut`=著者 / `ill`=イラスト / `trl`=訳者 / `edt`=編者 等）。`display-seq` で並び順、`file-as` で読み。
- `dc:date`（刊行日）が入る場合がある。`dc:identifier` は `urn:uuid` または `urn:isbn`。

### 2.2 novel_downloader の現状

- OPF 生成 `_make_opf()`（`novel_downloader.py:1577`）は **`dc:publisher` も `dc:source` も出力していない**（`:1690-1701`）。
- 底本 URL / サイト名は **cover.xhtml（`_make_cover_xhtml`, :1327）と colophon.xhtml（`_make_colophon_xhtml`, :1422）の本文 `<a href>` にのみ**存在。
- `source_url` / `site_name` は `build_epub()` 内スコープに既にある（`:2286` で cover に渡している）。`_make_opf()` の呼び出しは `:2252`。
- サイト表示名テーブルは `_SITE_DISPATCH`（`:8763`、例 `narou→小説家になろう` `kakuyomu→カクヨム`）。

### 2.3 yomikake の現状

- OPF から読むのは `dc:title` / `dc:creator`(全連結) / `dc:language` のみ（`yomikake.html:2661-2668`）。
  ```js
  state.bookCreators = [...opfDoc.querySelectorAll('metadata > *|creator, metadata > creator')]
    .map(el => el.textContent.trim()).filter(Boolean);
  state.bookCreator = state.bookCreators.join('・');   // ← 著者もイラストも '・' 連結
  ```
- `state.bookCreator`（連結文字列）は **bookKey の生成に使われる**（`makeBookKey`, `:2671`）。**ここは変更不可**（しおりキー互換のため）。
- ヘルプの書誌カードは `updateHelpContent()`（`:8437-8449`）が `state.epub` の時だけ先頭に差し込む（title＋著者＋章数＋目次数＋操作ガイドボタン）。
- 読みかけリストのカードは localStorage の `epub_pos_*` 値から描画（[[design_reading_list_v2]]）。ePub を開かずに描くため、**バッジに出す情報は保存値に含めておく必要**がある。

### 2.4 スイート内ツールの生成 ePub（実サンプル4冊を実測）

同スイートの生成物を調査。**3ツールとも publisher/source を出力していない**（＝同じ追加改修が要る）。

| 生成元 | 書名 | layout | dc:publisher | dc:source | dc:creator（role） | 備考 |
|--------|------|--------|:---:|:---:|--------|------|
| novel_downloader（新） | 薬屋のひとりごと | reflowable | 無 | 無 | 日向夏(**aut**) | `dc:description` 有 |
| novel_downloader（旧） | スーパーカブ | reflowable(.kepub) | 無 | 無 | トネ コーケン（**role 無**） | 旧出力・refine 無し |
| mangaP2ePub | 惑星の影さすとき | pre-paginated(comic) | 無 | 無 | 八木ナガハル（role 無） | `book-type=comic`, viewport 有 |
| jisui2epub | 地下室からのふしぎな旅 | reflowable | 無 | 無 | 柏葉幸子**_vision**(aut) | **creator に処理タグ混入** |

判明した含意：
- **底本の性質が2種類ある**：Web 小説（novel_downloader）＝底本は **Web ページ（URL）**／自炊（jisui2epub・mangaP2ePub）＝底本は **紙の本（ISBN・原出版社）**。→ §3.1 のデータモデルを「発行元＝`dc:publisher` / 派生元＝`dc:source`」に一般化し、`dc:source` は **URL または `urn:isbn:`** を許容する。
- 旧 novel_downloader 出力（スーパーカブ）は **role refine が無い** → yomikake の role 欠落耐性（§3.3）が必須。
- jisui2epub は **処理バリアント名 `_vision` を `dc:creator` に混ぜている**。これは著者表示だけでなく **bookKey（`makeBookKey`）にも入り込みしおりキーを汚す**。ツール側で除去すべき（§5.5）。
- mangaP2ePub は FXL メタ（`book-type=comic`・`fixed-layout-jp:viewport`）は良好。書誌メタ（publisher/source/role）だけ不足。

---

## 3. 設計判断

### 3.1 データの持ち方（novel_downloader 出力）

**モデルの一般化：`dc:publisher`＝「発行元」・`dc:source`＝「派生元」**。底本が Web か紙かで値が変わるだけで、枠は共通。

| 情報 | 格納先 | Web 小説（novel_downloader） | 自炊（jisui2epub / mangaP2ePub） | 商業書 |
|------|--------|------------------------------|----------------------------------|--------|
| 発行元 | **`dc:publisher`** | サイト名（`カクヨム`） | 原出版社（`早川書房`） | 出版社（`講談社`） |
| 派生元 | **`dc:source`** | 底本 URL（`https://kakuyomu.jp/…`） | `urn:isbn:9784…`（あれば） | （通常無し／稀に ISBN） |

- `dc:publisher` に発行元名を入れることで、**商業書・Web 小説・自炊を yomikake 側の「出版社」欄で統一表示**できる。
- `dc:source` は「派生元リソースの識別子」。**URL（Web ページ）も `urn:isbn:`（紙の本）も仕様上妥当**な値。
- yomikake の分岐：
  - `dc:source` が **http(s) URL** → 「○○で読む ↗」リンクを生成（実遷移）。
  - `dc:source` が **`urn:isbn:` / bare ISBN** → リンクにせず「底本: ISBN 978…」を表示（§4.5 で任意の書誌検索リンクを付与可）。
  - 空 → 底本行を出さず出版社テキストのみ。

### 3.2 既存 ePub のフォールバック（yomikake 側・確定）

OPF に `dc:source` が無い既存 ePub（過去に novel_downloader で作った本、および他ツール製）でも底本リンクを出すため、yomikake は次の順で URL を解決する：

1. `dc:source` が http(s) → それを採用（サイト名は `dc:publisher` → 無ければ host 推定）
2. 無ければ **colophon（manifest `id="colophon"` / ファイル名 `colophon.xhtml`）→ 先頭 spine（cover.xhtml）** の XHTML を読み、最初の**外部 `<a href="http…">`** を拾う
3. それも無ければ底本リンク無し（書誌ブロックは出るがリンク行だけ省略）

サイト名は host → 表示名の**内蔵テーブル**（`SOURCE_SITES`、下記）で解決。novel_downloader の `_SITE_DISPATCH` と対応：

```
ncode.syosetu.com / novel18.syosetu.com → 小説家になろう
kakuyomu.jp        → カクヨム
alphapolis.co.jp   → アルファポリス
estar.jp           → エブリスタ
noichigo.jp        → 野いちご
… （_SITE_DISPATCH の主要サイトを移植）
その他             → host をそのまま表示（"example.com で読む"）
```

### 3.3 dc:creator の role 対応（yomikake 側）

- 表示用に **role を解釈**して分類する新フィールドを追加（bookKey 用の `state.bookCreator` 連結は温存）。
  ```js
  // 新規: 表示用（bookKey には使わない）
  state.bookCreatorsRoled = [ {name, role}, … ]   // role: 'aut'|'ill'|'trl'|'edt'|'sup'|''(不明)
  ```
- role ラベル i18n：`著者`(aut) / `イラスト`(ill) / `訳`(trl) / `編`(edt) / `監修`(sup) / それ以外は無ラベル。
- role が全く無い（refine 無し）本は従来どおり全員「著者」相当としてまとめて表示（＝現行の見た目を維持）。
- **`display-seq` があれば昇順ソート**。

### 3.4 著者名の検索リンク（yomikake 側・採用／控えめ）

- 書誌ブロックで **`role=aut` の著者名の隣にのみ**小さな 🔍 を付け、`https://www.google.com/search?q="著者名"+作品` を新規タブで開く（`window.open(_blank, noopener)`）。
- イラスト・訳者には付けない。役割不明（refine 無し）の場合は「著者相当」とみなし付ける。
- トレードオフ（設計判断として記録）：外部検索なので"公式"ではない・クリックで Google にクエリが飛ぶ。Web 小説はプラットフォームの著者ページの方が有用だが URL 未保持のため、**全書種で使える Google 検索を現実解**として採用。将来 novel_downloader が著者ページ URL を出力できるようになれば、Web 小説だけ差し替える。

### 3.5 ヘルプを本未オープンで開いた場合（確定）

- **書誌ブロックは本オープン時のみ**（現行の `state.epub ? … : ''` を維持）。未オープン時に「最後の本」を復元表示はしない。
- 未オープン時の書誌サーフェスは **読みかけリストのカードバッジ**が担う（役割分離）。

### 3.6 しおり JSON の仕様変更（追加のみ・確定）

読みかけリストのカードバッジは ePub を開かず描くため、書籍メタに底本情報を保存する。**追加フィールドのみ**で後方互換：

- `epub_pos_*` 値に追記：
  - `source`：底本 URL（http(s)。無ければ未設定）
  - `site`：サイト表示名（`dc:publisher` 由来 or host 推定。無ければ未設定）
- 既存 `creators` / `purged` と同様、**旧ビルドは未知フィールドを無視**（前方互換）。
- `collectBookmarks()` 経由で **Drive 同期・JSON エクスポートにも同梱**（書誌の同一性が端末間で運ばれる）。
- 書き込みは `saveBookMeta()`。**quota 安全弁の対象**：QuotaExceeded 時は既存の `cover` 削除フォールバックの後、なお足りなければ `source`/`site` も落として読書位置保存を最優先（[[design_reading_list_v2]] の方針に合わせる）。

---

## 4. 改修箇所：yomikake（両ファイル）

> CLAUDE.md「両ファイル同期」ルールに従い、`yomikake.html` / `yomikake_ios.html` の両方に入れる。行番号は `yomikake.html` 基準（iOS 版は各対応箇所）。

### 4.1 定数・state
- **`SOURCE_SITES`**：host→サイト表示名テーブルを新規追加（`FONTS` 等の定数群付近）。
- **`state`**（`:2318` 付近）に追加：
  - `bookSourceUrl`（''）／`bookSourceSite`（''）／`bookPublisher`（''）／`bookCreatorsRoled`（[]）
  - いずれもセッションのみ（永続化は localStorage の書誌メタで別途）。

### 4.2 `loadEpub()`（`:2661-2668` 付近）
- `dc:publisher` を読む：`opfDoc.querySelector('metadata > *|publisher, metadata > publisher')` → `state.bookPublisher`。
- `dc:source` を読む：同様 → http(s) なら `state.bookSourceUrl`。
- **role 付き creator 解釈**：各 `dc:creator` の `id` から `<meta refines="#id" property="role">` / `property="display-seq"` を引き、`state.bookCreatorsRoled` を構築。`state.bookCreator`（連結）と `state.bookCreators` は**現状のまま維持**（bookKey 互換）。
- **底本 URL 解決**：`state.bookSourceUrl` が空なら `resolveSourceFromSpine()`（下記）を呼ぶ。
- サイト名解決：`bookPublisher` が「サイト名っぽい」場合や host 推定で `state.bookSourceSite` を決定（URL があるとき）。
- `saveBookMeta()` 前に上記が揃っていること（`saveBookMeta` が `source`/`site` を書くため）。

### 4.3 新規関数 `resolveSourceFromSpine()`
- manifest から `colophon`（id or href に `colophon`）→ 先頭 spine（cover）の順に XHTML を `state.epub.file().async('text')` で読み、`DOMParser` で最初の `href^="http"` の `<a>` を返す。
- 失敗・null 安全（`zip.file()` が null を返しうる）。**同期的に重くしない**：`await` で逐次、見つかれば即 return。

### 4.4 `saveBookMeta()`
- 保存オブジェクトに `source: state.bookSourceUrl || undefined`、`site: state.bookSourceSite || undefined` を追加（undefined はシリアライズで落ちる）。
- QuotaExceeded フォールバック順：`cover` 削除 → なお失敗なら `source`/`site` も外して再試行。

### 4.5 `updateHelpContent()`（`:8437-8449`）＝書誌ブロック格上げ
現行カードを「この本について」ブロックに拡張（本オープン時のみ）：
1. 書名（現行どおり）
2. **著者/役割行**：`state.bookCreatorsRoled` を role ラベル付きで描画。`aut` 名には 🔍 検索リンク。
3. **出版社行**：`state.bookPublisher`（あれば）。
4. **底本行**：
   - `state.bookSourceUrl` が http(s) → `📖 {site}で読む ↗`（`site` 未定は host 表示）。`window.open(_blank,noopener)`。青空文庫は「図書カード」表記（novel_downloader の慣習に合わせる）。
   - `dc:source` が `urn:isbn:`/ISBN → `📖 底本: ISBN {n}` を表示。任意で 🔍 に **国立国会図書館サーチ**（`https://ndlsearch.ndl.go.jp/search?cs=bib&keyword={isbn}`）等の書誌検索リンクを付与（自炊本向け・著者 🔍 と同格の控えめアフォーダンス）。
5. 章数／目次数（現行どおり）
6. 操作ガイドボタン（現行どおり）

- `esc()` で全テキストエスケープ（`'` は非エスケープなので、URL は `onclick` に埋めず `href`＋`target=_blank rel=noopener`、またはデータ属性経由で扱う。[[design_reading_list_v2]] のインラインハンドラ規約に準拠）。

### 4.6 読みかけリストのカードバッジ
- `_rlRender()`（[[design_reading_list_v2]]）でカードの `.rl-meta-left`（`✈ オフラインOK` バッジ付近）に、値に `site`（or `source` の host）があれば **`カクヨム↗` バッジ**を追加。
- バッジは `<a href=source target=_blank rel=noopener>`。カード全体クリック（`rlCardActivate`）とはイベント分離（`stopPropagation`）。
- `source` が無いエントリ（商業書・手動追加本）はバッジ無し。

### 4.7 i18n（4言語：ja/en/zh-TW/zh-CN）
新規キー（値は各言語）：
- `help.publisher`（出版社: {name}）
- `help.readOnSite`（{site}で読む） / `help.readOnAozora`（青空文庫の図書カード）
- `help.searchAuthor`（この著者を検索）
- `role.aut`/`role.ill`/`role.trl`/`role.edt`/`role.sup`
- `readingList.sourceBadge`（{site}↗ ※ツールチップ用）

---

## 5. 改修箇所：novel_downloader

### 5.1 `_make_opf()`（`:1577`）
- 引数に `publisher: str = ""`（サイト表示名）と `source_url: str = ""` を追加。
- メタデータブロック（`:1690-1701`）に条件付きで出力：
  ```xml
  <dc:publisher id="publisher">カクヨム</dc:publisher>          <!-- publisher があれば -->
  <dc:source>https://kakuyomu.jp/works/…</dc:source>            <!-- source_url があれば -->
  ```
- `_esc()` でエスケープ。空文字なら行ごと省略。

### 5.2 呼び出し側（`build_epub` 内 `:2252`）
- `_make_opf(title, author, book_id, ep_titles, cover_fmt, …, publisher=site_name, source_url=source_url)` を渡す。
- `site_name` / `source_url` は同スコープに既にある（`:2286` で cover に渡している値と同一）。
- 青空文庫は `site_name="青空文庫"`。`dc:publisher` に「青空文庫」を入れてよい（yomikake 側で図書カード表記に分岐）。

### 5.3 影響範囲
- nav/toc/colophon/cover は**変更なし**（既存の本文リンクは互換のため残す＝フォールバックの根拠にもなる）。
- `--append`（既存 .txt 追記再生成）経路も `source_url` を抽出済み（`:8158` `_epub_colophon_to_source`）なので、そのまま OPF にも載る。

---

## 5B. 姉妹ツールへの推奨改修（jisui2epub / mangaP2ePub）

> スイート全体で **同一の書誌メタ規約**（`dc:publisher`＝発行元・`dc:source`＝派生元・`role` 付き複数 creator）に揃えると、yomikake が3ツールの出力を分岐なく扱える。両リポジトリの README からこの設計書を参照するのが望ましい。自炊本の底本は紙なので `dc:source` は **`urn:isbn:`** が基本（yomikake はリンクにせず表示＋任意で書誌検索）。

### 共通の推奨（両ツール）
1. **オプション引数の追加**：`--publisher`（発行元）／`--isbn`（→ `dc:source>urn:isbn:…`）／`--date`（原刊行日 → `dc:date`）。未指定なら該当行を省略（後方互換）。
2. **`dc:publisher` 出力**：指定時に `<dc:publisher>…</dc:publisher>` を metadata に追加。
3. **`dc:source` 出力**：ISBN 指定時 `<dc:source>urn:isbn:{isbn}</dc:source>`（ハイフン除去・チェックディジット検証は任意）。
4. **`dc:identifier` を ISBN 化（任意）**：現状 `urn:uuid` のみ。ISBN があれば `urn:isbn:` の識別子を併記してもよい（uuid は残す）。
5. **creator に `role` refine**：`<meta refines="#creatorNN" property="role" scheme="marc:relators">aut</meta>` を付与。yomikake の役割ラベル分離（§3.3）に対応。

### 5B.1 jisui2epub（reflowable OCR 自炊）— https://github.com/ayati/jisui2epub
- **最重要：`dc:creator` に処理タグを混ぜない**。実サンプルは `柏葉幸子_vision`（`_vision` はバリアント／処理系マーカー）。これは
  - yomikake の著者表示に出る、
  - **`makeBookKey(title, creator)` に入り、しおりキーが版ごとに割れる／別本扱いになる**、
  - 読みかけリストの著者ソート（`_rlSortKey`）を乱す。
  → `dc:creator` は**素の著者名のみ**。バリアント名は (a) `dc:title` の接尾（`（vision 版）`）、(b) 独自 `<meta property="…">`、(c) `dc:contributor` のいずれかに退避する。
- 訳書は `role=trl`（訳者）を別 creator で。
- `dc:publisher`＝原出版社、`dc:source`＝`urn:isbn:`。

### 5B.2 mangaP2ePub（FXL comic 自炊）— https://github.com/ayati/mangaP2ePub
- **複数 creator（役割）対応**：マンガは原作／作画が分かれる。`--author`（原作 → `role=aut`）と `--artist`（作画 → `role=art`）を受け、`display-seq` を振る。単著は1件のみ。
- 既存 FXL メタ（`rendition:layout=pre-paginated`・`book-type=comic`・`fixed-layout-jp:viewport`・`original-resolution`）は**維持**（yomikake FXL 検出に必要）。
- `dc:publisher`＝原出版社、`dc:source`＝`urn:isbn:`（自炊元の紙本）。
- Web 発の webtoon 等で URL 底本がある場合のみ `dc:source` に http(s) を入れてよい（その場合 yomikake は「○○で読む」リンク化）。

### 5B.3 yomikake 側の含意（再掲）
- 3ツールとも `role` 欠落・単一 creator の旧出力があり得るため、§3.3 の**欠落耐性は必須**。
- 自炊本は `dc:source=urn:isbn` が主。§4.5 の ISBN 表示＋書誌検索リンクがそのまま効く。
- jisui2epub の `_vision` のような**過去に生成済みの汚染 creator** は、ツール修正後に本を作り直さない限り残る。yomikake 側では救済しない（bookKey 互換を壊さないため）。ツール修正を優先し、必要なら利用者が作り直す。

---

## 6. 後方互換・移行

- **旧 yomikake × 新 ePub**：未知の `dc:publisher`/`dc:source` は無視。破綻なし。
- **新 yomikake × 旧 ePub**：`dc:source` 無し → §3.2 のフォールバックで colophon/cover から URL 回収。サイト名は host 推定。
- **しおり JSON**：`source`/`site` は追加フィールド。旧ビルドは無視、`purged`/`creators` と同格の扱い。
- **bookKey は不変**（`state.bookCreator` 連結ロジックを触らない）。既存しおりは全て有効。

---

## 7. テスト観点

- 実サンプル4冊（商業書）：出版社が「出版社: 講談社」等で表示、底本リンク**無し**、`ill` が「イラスト」ラベルで分離（ねらわれた学園）。
- novel_downloader 生成本（新）：`dc:publisher`=サイト名 / `dc:source`=URL が OPF に入り、「カクヨムで読む↗」表示・カードにバッジ。
- novel_downloader 生成本（旧・dc:source 無し）：colophon フォールバックでリンク回収。
- 青空文庫：`site_name=青空文庫` → 「青空文庫の図書カード」表記。
- 本未オープンでヘルプ：書誌ブロック非表示（現行維持）。
- role 無し creator の本：全員「著者」まとめ表示（見た目不変）。スーパーカブ（旧 novel_downloader・role 無し）で確認。
- Drive エクスポート/インポート往復で `source`/`site` が保持される。
- 両ファイル（PC/iOS）で同一挙動。
- 自炊本（`dc:source=urn:isbn`）：底本行が ISBN 表示＋書誌検索リンク（リンク遷移しない）。惑星の影さすとき（FXL）・地下室からのふしぎな旅（reflowable）で確認。
- jisui2epub 改修後：`dc:creator` に `_vision` 等の処理タグが混ざらない（著者表示・bookKey が素の著者名）。

---

## 8. リリース

- `yomikake.html` / `yomikake_ios.html` の該当関数（§4）を両方改修。
- `sw.js` の `VERSION` を `yomikake-shell-v2.10.0` へ。
- `novel_downloader.py` §5 改修後 `python -m py_compile novel_downloader/novel_downloader.py`。
- CLAUDE.md（yomikake / ルート novel_downloader 節）の該当記述を更新。
- タグ `v2.10.0`。

---

## 9. 将来課題
- novel_downloader が著者ページ URL を出力 → Web 小説の著者名リンクを Google 検索から著者ページへ差し替え。
- FXL（マンガ）本の書誌ブロック（現状も表示はされるが底本は稀）。
- `dc:date`（刊行日）・シリーズ情報（`belongs-to-collection`）の書誌ブロック表示。
