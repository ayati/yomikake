# 設計書: FXL 透明テキスト検索（design_fxl_text_search.md）

作成日: 2026-07-09
対象: `yomikake.html` / `yomikake_ios.html`（両ファイル共通実装）
ステータス: **実装済み（2026-07-09・v2.7.0 として両ファイル＋sw.js VERSION バンプ済み）**

> **実装時の設計変更（本文は当初設計のまま）:**
> 1. **ハイライトは SVG オーバーレイ方式に変更** — ピクセル絶対配置の div ではなく、img と同じスロットに
>    `<svg viewBox="0 0 vbW vbH" preserveAspectRatio="…meet">`＋`<rect>` を重ねる。`meet` が
>    `object-fit:contain` と同一幾何のため、サイドバー開閉・リサイズ・ズーム transform に**再計算なしで自動追従**
>    （ピクセル方式はサイドバーを閉じるとズレることを Playwright 検証で確認したため変更）。4秒フェードは当初案どおり。
> 2. **`htmlToText()` が `<head>` を除去するよう修正** — 全ページ共通の `<title>`（書名）が検索・textFound 判定の
>    両方で偽ヒットしていた（書名の一部を検索すると全ページがヒットする実バグ）。リフロー検索の品質も改善。
> 3. **座標の意味は「グリフ左上」で確定** — Playwright 実機検証で縦書き・横書きともマーカーが文字に正着。
>    フェードアウトは4秒・タップでのクリアは実装せず（pointer-events:none で読書操作と干渉しないため不要と判断）。
> 4. リサイズ時のマーク削除は不要になった（SVG が自動追従）。spread⇔single 切替は従来どおり再描画側でクリア。
>
> 検証済み: RAIL WARS!（縦書き小説・ヘッダ横書き行・見開き左右判定・ズーム中追従）、ひだまりスケッチ２
> （マンガ吹き出し・iOS版）、テキスト無しFXL（fxlNoText 表示）、リフロー本リグレッション（51件ヒット・ジャンプ正常）。

## 背景

紙本自炊で ScanSnap 等のドキュメントスキャナ＋自動 OCR を通すと、画像 PDF に透明テキストが付加される。
これを ePub 化した固定レイアウト（FXL）本では、spine の XHTML が次の構造を持つ：

```xml
<svg viewBox="0 0 1103 1600">
  <image width="1103" height="1600" xlink:href="../image/i-010.jpg"/>
  <text fill="#000" fill-opacity="0" font-size="34.4"
        x="909.9 909.9 909.9 ..." y="197.0 231.4 265.8 ...">俺は声をあげて見入ってしまった。</text>
  ...
</svg>
```

- `<text>` 1 要素 = ページ上の 1 行（縦書きなら x 固定・y 可変、横書きなら y 固定・x 可変）
- **文字数と x/y 座標リストの要素数は 1:1 対応**（サンプル 6 冊全ページで確認済み）
- ルビ（ふりがな）は小さい font-size の独立した `<text>` 要素として本文行の間に挟まる
- テキストの無いページも存在する（表紙・口絵・マンガの絵のみページ等）

現在の yomikake は FXL モードで全文検索を**明示的に無効化**している：
- `startSearch()` 冒頭の `if (state.renderMode === 'fxl') { showToast(t('search.fxlUnsupported')); return; }`
- CSS `body.mode-fxl` で `#search-input-area` 等を `display:none`、代わりに `#fxl-search-notice` を表示

しかし検索エンジン本体は spine XHTML を `htmlToText()`（タグ除去）でテキスト化して照合する方式であり、
透明テキストは**そのまま抽出できる**。ジャンプ経路も `navigateFromSearch()` → `renderPage()` →
FXL 分岐で `renderFxlPair()` に委譲済み。つまりガードと CSS を外せば基本機能は成立する。

## スコープ

| Phase | 内容 | 規模感 |
|-------|------|--------|
| 1 | FXL モードでの全文検索の有効化＋テキスト無し本の扱い | 小 |
| 2 | ヒット位置ハイライト（ページ画像上にマーカー重畳） | 中 |
| 対象外 | テキスト選択・コピー（透明テキストレイヤーの DOM 重畳） | 大・将来検討 |

テキスト選択・コピーは FXL ズーム/パン（PointerEvent）とのヒットテスト干渉が大きく、本設計では対象外とする。

## Phase 1: FXL 検索の有効化

### 変更点

1. **`startSearch()` の FXL ガードを削除**。
2. **CSS の検索 UI 非表示を撤廃** — `body.mode-fxl #search-input-area / #search-progress-bar /
   #search-status / #search-results { display:none }` と `#fxl-search-notice` の表示切替ルールを削除。
   `#fxl-search-notice` の div と関連 CSS も削除（i18n キー `search.fxlUnsupported` は後述の
   新メッセージに置き換え）。
3. **テキスト無し本の判定は遅延方式**（load 時サンプリングはしない）：
   - `runSearch()` 内で「テキストが 1 文字でもあったページがあるか」を集計（`textFound` フラグ）。
   - 検索完了時に hit 0 かつ FXL かつ `textFound === false` なら、`search.none`（見つかりません）
     ではなく新キー **`search.fxlNoText`**（「この本には検索可能なテキストが含まれていません」）を表示。
   - 利点: 誤判定ゼロ・load 時のコストゼロ。サンプリング方式は表紙/口絵が続く本で誤判定リスクがある。
4. **検索結果の章ラベルを FXL では「ページ表記」に**：
   - FXL 本の TOC は最小限（表紙/本文程度）のため、`chapterLabelForSpine()` のフォールバック
     「第N章」は不適切。FXL 時は TOC マッチしなければ新キー **`search.fxlPageLabel`**
     （ja: `{n}ページ` / en: `Page {n}` / zh: `第 {n} 頁`・`第 {n} 页`）を使う。
5. **i18n**（4 言語 × 両ファイル）：
   - `search.fxlNoText` 新設
   - `search.fxlPageLabel` 新設
   - `search.fxlUnsupported` は削除（参照箇所が無くなるため）

### テキスト抽出方式（v1 は現行 `htmlToText()` を流用）

- `<text>` 要素間はタグ除去時に空白 1 個に潰される → 行間は空白区切りで連結される。
- **制限 1: 行またぎのマッチは不可**（例: 行末「…銀色の盾。」＋次行「整った動きで…」に
  またがる「盾。整った」は探せない）。検索語は通常 1 行内に収まる単語・フレーズなので v1 は許容。
  行を空白なし連結すればまたぎ検索は可能になるが、ルビ行が本文行の間に挟まる形式のため
  連結文が壊れる（誤マッチ源になる）。ルビ除去＋無空白連結は Phase 2 の抽出器（後述）導入後の
  改善候補とする。
- **制限 2: ルビ・柱・ノンブル等の OCR 断片もヒット対象**になる。スニペットに混じるが実害は小さい。
- 性能: FXL 本は spine が数百ページ規模だが、unzip するのは XHTML（数 KB/ページ）のみで
  画像には触れない。既存の 5 ページごとの yield（`setTimeout 0`）で UI ブロックも無し。
  進捗バー・キャンセル（`_searchSeq`）は既存機構がそのまま機能する。

### 影響なしの確認済み事項

- 読書統計（G2.1 文字数計測）は FXL 本を `stat.fxl` で除外済み → 本変更の影響なし。
- `navigateFromSearch(spineIdx)` → `renderPage(spineIdx, 'start')` は FXL で
  `renderFxlPair(spineIdx)` に委譲される（見開きペア解決も `renderFxlPair` 側で処理）→ 変更不要。

## Phase 2: ヒット位置ハイライト

検索でページに飛んでも、マンガや雑誌の 1 ページは情報量が多く「どこにヒットしたか」が分からない。
透明テキストの文字単位座標を使い、ページ画像上にハイライト矩形を重畳する。

### 動作仕様

- 検索結果クリックでページジャンプした直後、該当ページ内の**全マッチ箇所**に半透明の
  アクセント色マーカー（`background:var(--accent); opacity:0.35` 程度、`border-radius:3px`）を表示。
- マーカーは**ページ遷移（renderFxlPair）で自動クリア**。加えて表示から **4 秒でフェードアウト**
  （読書の邪魔をしない。ズーム操作等とは干渉しない：マーカーは `pointer-events:none`）。
- 見開き表示時は左右どちらのハーフか判定して該当画像上に配置。
- FXL ズーム（コマ読み/軸モード）中は `#fxl-spread` ごと transform されるため、マーカーを
  `#fxl-spread` 内側（画像と同じ座標系）に置けば追従は自動。

### 実装方式

1. `navigateFromSearch(spineIdx, query)` に query を追加し、モジュール変数
   `_fxlPendingHighlight = { spineIdx, query }` にセット（FXL 時のみ）。
2. `renderFxlPair()` 末尾フック（既存の fxlZoom フックと同位置）で
   `_fxlPendingHighlight` を消費：
   - 対象 spine の XHTML を unzip → `DOMParser('text/html')` で `<svg>` 内の `<text>` を走査。
   - 各 `<text>` の `textContent` に対して query をマッチ（大文字小文字は既存検索と同じ扱い）。
   - マッチ範囲の文字インデックス → x/y リストの該当区間 → 矩形算出：
     - 縦書き行（x 一定）: `left = x − fs×0.1`, `width = fs×1.2`, `top = yFirst − fs`,
       `height = yLast − yFirst + fs×1.3`（y はベースライン近傍のため上方向に fs 分広げる）
     - 横書き行（y 一定）: `left = xFirst`, `width = xLast − xFirst + fs`,
       `top = y − fs`, `height = fs×1.3`
     - 係数は実機（サンプル 6 冊）で目視調整する。
   - viewBox 座標 → 表示上の座標変換: `getTargetPageRect()` 相当のロジックで対象 `<img>` の
     表示矩形（object-fit:contain 後）を取得し、`scale = dispW / viewBoxW` で変換。
     オフセット（レターボックス）も加算。
   - `#fxl-spread` 内に `<div class="fxl-search-mark">` を絶対配置で追加。
3. クリア: `renderFxlPair()` 冒頭で既存マーカーを全削除。リサイズ時（`_fxlResizeTimer`）は
   位置が狂うため単純に削除（再計算はしない）。
4. 縦書き/横書き行の判定: x リストの全要素が同値なら縦書き行、y 同値なら横書き行。
   1 文字だけの行はどちらでも同じ矩形になるので任意。
5. 行またぎマッチは Phase 1 制限によりそもそも発生しない（単一 `<text>` 内のみ）。

### iOS 版の差分

ハイライトは DOM 重畳のみで scroll API を使わないため、両ファイル完全共通実装で成立する見込み。

## localStorage / 永続化

追加なし。`_fxlPendingHighlight` はセッション内どころか 1 回のジャンプ限りの一時状態。

## リリース

- Phase 1 + 2 を v2.7.0 として同時リリース想定（Phase 1 のみ先行も可）。
- `sw.js` の `VERSION` バンプ（HTML 変更のため）。
- CLAUDE.md の「Both files」共通機能リストに検索の FXL 対応とハイライト関数群を追記。

## テスト計画（手動）

| ケース | サンプル | 期待 |
|--------|----------|------|
| 小説 FXL で単語検索 | RAIL WARS! / 図南の翼 | ヒット一覧＋スニペット表示・ジャンプ・ハイライト |
| マンガ FXL でセリフ検索 | ひだまりスケッチ２ / 絶対安全剃刀 | 吹き出し位置にハイライト |
| 横書き併記の本 | 日本史ウォーキング関西 | 横書き行の矩形が正しい |
| テキスト無しページ主体の本 | AKIRA1（テキスト無しページ多数） | ヒットするページのみ列挙 |
| 透明テキスト無し FXL 本 | （手持ちの画像のみ ePub） | `search.fxlNoText` 表示 |
| リフロー本のリグレッション | 任意の縦書き ePub | 既存検索が従来どおり動作 |
| 見開き表示でのハイライト | PC 横長ウィンドウ | 該当ハーフに正しく配置 |
| FXL ズーム中のジャンプ | コマ読み ON 状態から検索 | マーカーが transform に追従 |
