# フォント機能拡張 設計書（design_font_extension.md）

`yomikake.html` / `yomikake_ios.html` のフォント切替機能に、以下2点を追加するための設計書。両ファイル共通実装。

- 作成日: 2026-07-01
- 改訂: 2026-07-02 レビュー反映（§1.5 位置保持共通化を新設／1-A を Blob URL 第一方式に変更／ルビ縁取り除外・マジックバイト検証・重複ガード等を追加。§6 判断ポイント 6〜11 参照）
- 対象バージョン: 未定（v1.15.x 想定）
- 関連: `CLAUDE.md`（フォント設定UI・IndexedDBキャッシュの既存節）
- 前段の技術調査（選択肢A/B/C比較）を踏まえ、**1-A（ファイル選択＋IndexedDB埋め込み方式）**と**2-A（`font-weight:bold` トグル）**を採用する前提で詳細化する。
- **2-C（`-webkit-text-stroke` による縁取り太字強度調整）は 2-A 実装後の次ステップ**として本設計書に追加する（§3）。2-Aだけでは効果不足に感じるユーザー向けの追加調整機能という位置づけ。

---

## 0. 設計の前提

1. 既存の `FONTS` / `FONT_URLS` / `FONT_GROUPS` は変更しない（後方互換）。追加機能は別レイヤーとして重ねる。
2. ローカルフォントは**端末ローカルの機能**。Drive 同期・しおりエクスポート/インポート（`collectBookmarks()`）の対象には含めない（バイナリが大きすぎるため）。
3. `buildSrcdoc()` の既存パターン（`toDataUri()` による data URI 埋め込み）を基本的に踏襲する。**ただしカスタムフォント実体のみ例外**：`#content-iframe` は `sandbox` 属性なしの srcdoc iframe（親と同一オリジン）なので、親で生成した `blob:` URL が iframe 内 CSS から解決できる。20MB級フォントを base64 化して毎章 srcdoc に連結するとパース・メモリ負荷が非現実的なため、**http(s) では Blob URL、`file://` のみ data URI フォールバック**とする（§4.4）。
4. IndexedDB は ePub Blob キャッシュ（`epub_viewer_files`）と同じ教訓（**iOS Safari は Blob 直接保存不可、ArrayBuffer で保存**）に従う。
5. 命名規約：本機能の関数・変数は `_cf` / `cf` プレフィックス（読みかけリストの `_rl`、読書データの `_rd` と分離）。

---

## 1. スコープ

| 項目 | 内容 |
|---|---|
| **0-R** | **設定変更時の章内位置保持（共通改修）**：設定変更による再レンダーで章頭に戻される既存挙動を修正し、新規トグル（2-A/2-C）と既存の表示設定変更の両方に適用する（§1.5） |
| **1-A** | ローカルの `.ttf`/`.otf`/`.woff`/`.woff2` を選択→フォントピッカーに追加→本文に適用。IndexedDBにキャッシュし次回起動後も選択可能 |
| **2-A** | 現在選択中フォントに対する太字トグル（`font-weight:bold` を注入・ON/OFF） |
| **2-C** | 2-Aの太字トグルに重ねる**縁取り強度調整**（`-webkit-text-stroke` を注入・なし/弱/中/強）。2-A実装後の第2段階として追加 |

4項目とも `yomikake.html`（CRLF）・`yomikake_ios.html`（LF）に同等実装する。実装順は **0-R → 2-A → 2-C → 1-A**（0-R は 2-A の前提となる小改修。太字系を先に固め、ローカルフォントは独立した大物機能として後段）を推奨する。0-R 以外は依存関係がないため順序は前後してもよい。

---

## 1.5 0-R：設定変更時の章内位置保持（共通改修）

### 背景（レビューで確定した問題）

`renderPage(idx)` は `scrollTarget` 省略時に `'start'` になり、冒頭で `savePos(0)` を呼ぶ（`yomikake.html` ~3035 / ~3051）。そのため設定変更→再レンダーのたびに**章頭に戻され、しおりも 0 で上書きされる**。2-A/2-C は「ON→OFF→ONと切り替えて効果を見比べる」操作が前提なので、この挙動のままでは使い物にならない。既存の表示設定変更（フォント・サイズ・行間・テーマ・組方向）についても**ユーザーから要改善の意見が出ており**、本改修で一括して直す。

### 実装

共通ヘルパーを1つ追加し、設定変更系の再レンダーはすべてこれを経由させる：

```js
function rerenderKeepPos() {
  // 章内位置（_intraChapterRatio）を保持したまま現章を再レンダーする。
  // renderPage は数値 scrollTarget を受理し savePos(ratio) も同値で保存するため、
  // しおりの 0 上書きも同時に解消される。リフローで比率の意味は多少ずれるが近似で十分。
  if (state.spine.length) renderPage(state.currentSpineIdx, _intraChapterRatio);
}
```

**適用対象（既存5関数の改修）**：`changeFont()` / `changeFontSize()` / `changeLineHeight()` / `changeTheme()` / `changeWritingMode()` の末尾 `if (state.spine.length) renderPage(state.currentSpineIdx);` を `rerenderKeepPos();` に置換（`yomikake.html` ~4471 / ~4479 / ~4484 / ~4495 / ~4516。iOS版は対応箇所を同様に）。新規の `toggleFontBold()`（§2.3）・`changeFontStrokeLevel()`（§3.3）も同ヘルパーを使う。

### 注意

- `changeWritingMode()` は縦⇔横で比率の軸が変わるが、近似位置への着地は「章頭に戻る」より明確に良いため許容する。
- FXL モードでは `renderPage()` が `renderFxlPair(idx)` に分岐し `scrollTarget` を無視するため、無影響（無害）。
- `changeMargin()` は元々再レンダーしない既存仕様のため対象外。

---

## 2. 2-A：フォント太字化トグル（先に実装しやすい方）

### 2.1 state / 永続化

`state.fontBold: false` を追加（`~1950` 付近の `fontMode:'publisher', fontSize:100, ...` の並びに追加）。
`SETTINGS_KEY`（`epub_settings`）に `fontBold` を追加保存・復元する（`saveSettings()` / `loadSettings()`）。`loadSettings()` の復元時は既存の `driveAutoSave` と同じパターンで `if (typeof s.fontBold === 'boolean') { state.fontBold = s.fontBold; updateFontBoldToggleUI(); }` のように **UI 同期関数まで必ず呼ぶ**（呼び忘れると設定は復元されるがボタン表示が OFF のままになる）。

### 2.2 UI

タイポグラフィ `set-group`（既存の `#font-picker` の下）に ON/OFF トグルボタンを1行追加。既存の `#fxl-ltr-flip-toggle` / `#drive-auto-toggle` と同じスタイル（インラインstyle・`updateXxxToggleUI()` パターン）を流用する。

```html
<div class="set-row">
  <span class="set-label" data-i18n="settings.fontBold">太字表示</span>
  <button id="font-bold-toggle" onclick="toggleFontBold()"
          style="border:1px solid var(--ui-border);border-radius:8px;padding:6px 16px;min-width:60px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;">OFF</button>
</div>
```

FXL（固定レイアウト＝画像ページ）では文字に対する効果がないため FXL モード時は非表示にするが、**タイポグラフィ set-group 自体に `fxl-hide-group` クラスが付いており（`body.mode-fxl .fxl-hide-group { display:none !important }`）、グループごと非表示になるため行単位の `.fxl-hide-row` は不要**（現行コード確認済み・§8.2）。行間（`#lineh-select`）の set-row 直後に挿入する。

### 2.3 ロジック

```js
function toggleFontBold() {
  state.fontBold = !state.fontBold;
  saveSettings();
  updateFontBoldToggleUI();
  updateFontStrokeRowUI();   // 2-C 実装後に追加（§3.3）。2-A 単独実装時点では省略可
  rerenderKeepPos();         // §1.5 の共通ヘルパー（章内位置を保持して再レンダー）
}
function updateFontBoldToggleUI() {
  const btn = document.getElementById('font-bold-toggle');
  if (!btn) return;
  const on = !!state.fontBold;
  btn.textContent = on ? 'ON' : 'OFF';
  btn.style.background  = on ? 'var(--accent)' : '';
  btn.style.color       = on ? '#fff' : '';
  btn.style.borderColor = on ? 'var(--accent)' : 'var(--ui-border)';
}
```

### 2.4 `buildSrcdoc()` への注入（現 `~2594-2603`）

現行の `fontRule` は `font`（＝`FONTS[state.fontMode]`）が truthy な時しか出力されないため、`state.writingMode==='publisher'` かつフォント未指定（`font.publisher`＝`null`）の場合に太字だけ効かせるケースを取りこぼす。**太字適用は `fontRule` と独立したルールとして追加する**：

```js
const font = FONTS[state.fontMode];  // 既存
const weightRule = state.fontBold
  ? BOLD_SELECTOR + '{font-weight:bold!important;}'
  : '';
const fontRule = font
  ? 'html,body,p,h1,h2,h3,h4,h5,h6,div,span{font-family:' + font + '!important;}'
  : '';
// overrideStyle.textContent の組み立て箇所で fontRule の直後に weightRule を連結
```

**セレクタはファイルごとに既存 `fontRule` と揃える**（現行コード確認済み・§8.2）：
- `yomikake.html`: `html,body,p,h1,h2,h3,h4,h5,h6,div,span`（既存 fontRule ~2601 と同一）
- `yomikake_ios.html`: **`body,body *`**（既存 fontRule ~2704 が `body,body *{font-family:...}` 形式のため）

上記コード中の `BOLD_SELECTOR` は説明用の擬似表記。実装ではリテラル文字列を各ファイルの流儀で直接書く（変数化はしない — 既存 `fontRule` も変数化していないため）。

- 太字が効くかどうか（実体Bold書体 or ブラウザ疑似太字）はブラウザ・フォント依存。ここでは「指示するだけ」に留め、フォント側の実体差異には介入しない（調査時の結論どおり）。
- `<b>`/`<strong>`など ePub 側が意図的に付けた強調も同じ太さになり視覚的な区別が失われるが、これは既存の `font-family` 上書きと同じトレードオフとして許容する。
- 縦中横（`text-combine-upright`）との相互作用は自動テストがないため、実装後に手動確認が必要（本プロジェクトの既存注意事項に準拠）。

### 2.5 i18n

`settings.fontBold`（太字表示 / Bold text / 粗體顯示 / 粗体显示）を4言語分追加。

---

## 3. 2-C：太字追加調整機能（`-webkit-text-stroke`、2-A実装後の第2段階）

2-Aの `font-weight:bold` は「実体Bold書体があればそれを使い、無ければブラウザ任せの疑似太字」になるため、フォント・ブラウザによって効き目にムラがある（調査時の結論）。2-Cはこれを補う**縁取り線を足すことで太さを底上げする**追加調整機能。2-Aとは独立したCSSプロパティ（`font-weight`を変更しない）なので、**2-AのON/OFFに関わらず単独でも動作可能**だが、UI上は「太字表示をさらに強調する」ものと位置づけ、2-Aの下に従属する行として配置する。

### 3.1 state / 永続化

`state.fontStrokeLevel: 0` を追加（0=なし／1=弱／2=中／3=強）。`SETTINGS_KEY`（`epub_settings`）に `fontStrokeLevel` を追加保存・復元する。

### 3.2 UI

タイポグラフィ `set-group`、`#font-bold-toggle` の行の直下に配置。太字トグルがOFFのときは操作しても視覚効果が出ないため、行自体を disabled 表示にして誤操作・混乱を防ぐ。

```html
<div class="set-row" id="font-stroke-row">
  <span class="set-label" data-i18n="settings.fontStroke">縁取りの強さ</span>
  <select class="modern-select" id="font-stroke-select" onchange="changeFontStrokeLevel(this.value)">
    <option value="0" data-i18n="stroke.none">なし</option>
    <option value="1" data-i18n="stroke.weak">弱</option>
    <option value="2" data-i18n="stroke.medium">中</option>
    <option value="3" data-i18n="stroke.strong">強</option>
  </select>
</div>
```

（2-A と同じくタイポグラフィ set-group＝`fxl-hide-group` 配下のため `.fxl-hide-row` は不要・§8.2）

CSS追加（disabled見た目の共通クラス。既存に無ければ新設）：
```css
.set-row-disabled { opacity:.4; pointer-events:none; }
```

`pointer-events:none` は**キーボードフォーカスを防げない**ため、`<select>` 自体にも `disabled` 属性を併用する（§3.3 の `updateFontStrokeRowUI()` で同期。ネイティブのグレーアウト表示も得られる）。

### 3.3 ロジック

```js
function changeFontStrokeLevel(v) {
  const lv = parseInt(v, 10);
  if ([0,1,2,3].indexOf(lv) < 0) return;
  state.fontStrokeLevel = lv;
  saveSettings();
  rerenderKeepPos();   // §1.5 の共通ヘルパー（章内位置を保持して再レンダー）
}
function updateFontStrokeRowUI() {
  const row = document.getElementById('font-stroke-row');
  const sel = document.getElementById('font-stroke-select');
  if (!row || !sel) return;
  row.classList.toggle('set-row-disabled', !state.fontBold);
  sel.disabled = !state.fontBold;   // pointer-events:none はキーボードフォーカスを防げないため併用
  sel.value = String(state.fontStrokeLevel || 0);
}
```

`toggleFontBold()`（2-A・§2.3）の末尾に `updateFontStrokeRowUI();` を追記し、太字ON/OFF切替のたびに行の有効/無効を同期する。`loadSettings()` でも設定復元後に呼ぶ。

- **選択値は太字OFFでも保持する**（disabled化のみで、値自体はクリアしない）。再度ONにしたときに前回の強さがそのまま復元されるほうが体験がよい。

### 3.4 `buildSrcdoc()` への注入

`state.fontBold` の `weightRule`（§2.4）と並べて、独立した `strokeRule` を追加する。**2-Aの `state.fontBold` がONの場合にのみ効果を持たせる**（`fontStrokeLevel` 単体では発火しない）：

```js
const STROKE_WIDTHS = { 1: '0.02em', 2: '0.035em', 3: '0.05em' };  // フォントサイズに連動するem単位
const strokeRule = (state.fontBold && state.fontStrokeLevel > 0)
  ? 'html,body,p,h1,h2,h3,h4,h5,h6,div,span{-webkit-text-stroke:' + STROKE_WIDTHS[state.fontStrokeLevel] + ' currentColor!important;}' +
    'rt,rp{-webkit-text-stroke-width:0!important;}'   // ルビ除外（下記）
  : '';
// overrideStyle.textContent の組み立てで weightRule の直後に strokeRule を連結
```

セレクタは 2-A（§2.4）と同じくファイルごとに既存 `fontRule` と揃える（iOS版は `body,body *`）。iOS版では `body *` が `rt` に直接マッチするが、後置の `rt,rp{-webkit-text-stroke-width:0!important}` が同等specificity・後方定義のため width 0 が勝つ（カスケード確認済み）。`STROKE_WIDTHS` は `FONT_SAMPLE` 定義の直後にモジュール定数として置く（§8.5）。

- `currentColor` を使うことで、ePub側が段落・リンクごとに個別の文字色を指定していてもストローク色が地の色から浮かない。
- 単位は `em`（`px` 固定ではない）にして `state.fontSize`（60〜400%）に比例して太さも一緒にスケールするようにする。
- **ルビ（`rt`）の縁取り除外は必須**：`-webkit-text-stroke` は継承プロパティで、継承されるのは**計算済みの絶対値（px）**。`p` で `0.05em` を指定するとその px 値がフォントサイズ半分のルビにそのまま継承され、**ルビだけ相対的に2倍の太さ**の縁取りになって真っ先に潰れる。本ビューアの主用途は縦書き・ルビありの日本語書籍なので、`rt,rp{-webkit-text-stroke-width:0!important}` を必ず併記する（`rp` はフォールバック括弧用。表示環境では通常 `display:none` だが保険で含める）。
- `!important` は他の注入ルール（`fontRule` 等）と揃える。ePub 側 CSS がクラスセレクタで文字装飾を指定している場合の競合保険。
- **プレフィックス無し `text-stroke` は標準化されておらず主要ブラウザでの対応が薄いため使わない**。`-webkit-text-stroke` はChrome/Safari/Edgeに加えFirefoxも互換実装として認識するため、プレフィックス付きの1行だけで足りる。
- 縦中横（`text-combine-upright`）や小さめのフォントサイズでの視認性（文字の内側が縁取りだけになり潰れて見える懸念）は、2-Aと同様に実機での目視確認が必要。

### 3.5 i18n

`settings.fontStroke`（縁取りの強さ）、`stroke.none`（なし）、`stroke.weak`（弱）、`stroke.medium`（中）、`stroke.strong`（強）を4言語分追加（§5にまとめて記載）。

---

## 4. 1-A：ローカルフォント読み込み機能

### 4.1 データモデル

**localStorage**（メタデータのみ・軽量。バイナリは持たない）

```
epub_custom_fonts  (JSON配列)
[
  { "id": "cf_x7f3a1", "name": "MyFont.ttf", "size": 4821932, "addedAt": "2026-07-01T00:00:00.000Z" }
]
```

- `id` はフォント選択時のキー（`state.fontMode = 'custom:' + id`）。`crypto.randomUUID?.() || ('cf_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8))` で生成。
- `name` は初期値としてファイル名をそのまま使う（リネームUIは本設計ではスコープ外＝任意で後日追加）。
- **同期しない**（`epub_custom_fonts` は Drive アップロード対象の `collectBookmarks()` に含めない。しおりJSONへも含めない）。

**IndexedDB**（フォント実体。ePubキャッシュと同じ DB 設計思想・別DB）

```
DB名:     epub_viewer_fonts
Store名:  fonts
Key:      id（上記と同じ文字列）
Value:    { buf: ArrayBuffer, mime: string, fileName: string, addedAt: string }
```

- **`Blob` ではなく `ArrayBuffer` で保存**する（`CLAUDE.md` に記載済みの iOS Safari IDB Blob 消失バグの教訓をそのまま適用。`file.arrayBuffer()` で読み取って `buf` に格納）。
- 読み込み側は `new Blob([rec.buf], {type: rec.mime})` → `FileReader.readAsDataURL()` で data URI 化。

**state（セッションのみ・非永続）**

```js
state.customFonts = [];   // 起動時に epub_custom_fonts から読み込むメタ配列（上記と同一構造）
```

**モジュール変数**

```js
const CF_DB_NAME    = 'epub_viewer_fonts';
const CF_STORE_NAME = 'fonts';
const CF_MAX_COUNT  = 5;                 // 保持できるカスタムフォント数の上限
const CF_MAX_SIZE   = 20 * 1024 * 1024;  // 1ファイルあたりの上限（20MB）
let _cfBlobUrlCache = new Map();          // id → blob: URL（http(s) 用。revoke するまでタブ寿命で有効）
let _cfDataUriCache = new Map();          // id → data URI（file:// フォールバック専用。直近1件のみ保持 — §4.4）
let _cfPreviewRegistered = new Set();     // FontFace 登録済み id（ピッカープレビュー用・二重登録防止）
```

### 4.2 IndexedDBヘルパ（既存 `_idbGet`/`_idbPut`/`_idbDelete` と同型・別DB）

```js
function _cfIdbOpen() { /* indexedDB.open(CF_DB_NAME, 1) → onupgradeneeded で createObjectStore(CF_STORE_NAME) */ }
function _cfIdbGet(id) { /* → Promise<value|undefined> */ }
function _cfIdbPut(id, value) { /* → Promise<void>。QuotaExceededError は呼び出し側でcatch */ }
function _cfIdbDelete(id) { /* → Promise<void> */ }
```

既存の `_idbAvailable` と同様、`indexedDB.open()` が例外を投げる環境（プライベートブラウジング等）では `_cfIdbAvailable = false` とし、以降の追加操作をすべて no-op ＋トースト通知にフォールバックする。

### 4.3 フォント追加フロー

1. フォントピッカーの末尾に動的セクション「カスタムフォント」を描画し、末尾に **「＋ フォントを追加」** 行を置く（§4.6）。
2. クリックで隠し `<input type="file" id="custom-font-input" accept=".ttf,.otf,.woff,.woff2">` を発火。
3. `change` イベント → `cfHandleFile(file)`：
   - 拡張子チェック（`.ttf`/`.otf`/`.woff`/`.woff2` 以外は `toast.cfInvalidType` で中断）。iOS の `accept` 属性は拡張子ベースのフィルタが効かないことがあるため、この JS 側チェックが実質の防衛線。
   - **マジックバイト検証**（拡張子偽装・壊れファイルを即時検出。無反応フォールバックより明確なエラー体験になる）：
     ```js
     async function cfSniffFormat(file) {
       const u32 = new DataView(await file.slice(0, 4).arrayBuffer()).getUint32(0); // big-endian
       if (u32 === 0x00010000 || u32 === 0x74727565) return 'ttf';    // sfnt v1.0 / 'true'（旧Mac TrueType）
       if (u32 === 0x4F54544F) return 'otf';    // 'OTTO'
       if (u32 === 0x774F4646) return 'woff';   // 'wOFF'
       if (u32 === 0x774F4632) return 'woff2';  // 'wOF2'
       return null;   // 'ttcf'（.ttcコレクション）含む未対応形式 → toast.cfInvalidType で中断
     }
     ```
   - **重複追加ガード**：`state.customFonts.some(f => f.name === file.name && f.size === file.size)` なら `toast.cfDuplicate` で中断（同名・同サイズ＝同一ファイルとみなす。誤って2回選んだケースの混乱防止）。
   - サイズチェック（`file.size > CF_MAX_SIZE` → `toast.cfTooLarge` で中断）。
   - 件数チェック（`state.customFonts.length >= CF_MAX_COUNT` → `toast.cfLimitReached`（「先に削除してください」）で中断。自動追い出し(LRU)はしない＝ユーザーが明示的に選んだフォントを勝手に消さない）。
   - `id` 生成 → `file.arrayBuffer()` → `_cfIdbPut(id, {buf, mime:file.type||'font/ttf', fileName:file.name, addedAt:new Date().toISOString()})`（`.ttf`/`.otf` は `file.type` が空になる環境が多いためフォールバック必須）。
   - `state.customFonts.push({id, name:file.name, size:file.size, addedAt})` → `cfSaveMeta()`（`localStorage.setItem('epub_custom_fonts', ...)`。quota超過時は既存 `notifyStorageError()` を流用）。
   - `cfRegisterPreviewFace(id)`（§4.4）でピッカープレビュー用 FontFace を登録。
   - 直後に `selectFont('custom:' + id)` を呼び、追加してすぐ本文に反映（体感を良くする）。
   - フォントピッカーリストを再描画。

### 4.4 フォント選択・描画フロー

#### 埋め込み方式：Blob URL 第一・`file://` のみ data URI（レビューで変更）

data URI 一本だと 20MB フォントは base64 で約 27MB になり、**章送りのたびに 27MB 超の srcdoc 文字列生成＋HTMLパースが発生**する（iOS Safari ではメモリジェットサムによるタブ強制リロードのリスクも現実的）。`#content-iframe` は `sandbox` 属性なしの srcdoc iframe＝**親と同一オリジン**なので、親で `URL.createObjectURL()` した `blob:` URL を iframe 内の `@font-face src:url()` から解決できる。Blob URL なら srcdoc は小さいまま・フォントのデコード結果もブラウザ側でキャッシュされる（revoke 管理は FXL の `_fxlBlobCache` で実績のあるパターン）。

`file://` では opaque origin により `blob:` が解決できない環境があるため、`location.protocol === 'file:'` のときだけ data URI にフォールバックする（`selectFont()` 内の既存 Web フォント file:// 分岐と同じ発想）。

**`cfGetFontSrc(id)`**（旧設計の `cfGetDataUri` を置き換え。戻り値は `@font-face src:url()` にそのまま入れる文字列）：

```js
async function cfGetFontSrc(id) {
  if (location.protocol !== 'file:') {
    // ── http(s): Blob URL（軽量・タブ寿命）
    if (_cfBlobUrlCache.has(id)) return _cfBlobUrlCache.get(id);
    const rec = await _cfIdbGet(id);
    if (!rec || !rec.buf) return null;
    const url = URL.createObjectURL(new Blob([rec.buf], {type: rec.mime || 'font/ttf'}));
    _cfBlobUrlCache.set(id, url);
    return url;
  }
  // ── file://: data URI フォールバック
  if (_cfDataUriCache.has(id)) return _cfDataUriCache.get(id);
  const rec = await _cfIdbGet(id);
  if (!rec || !rec.buf) return null;
  const blob = new Blob([rec.buf], {type: rec.mime || 'font/ttf'});
  const dataUri = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  _cfDataUriCache.clear();          // 27MB級文字列の多重保持を避ける：直近1件のみキャッシュ
  _cfDataUriCache.set(id, dataUri);
  return dataUri;
}
```

- **章送りのたびに IDB 読み取り・再変換しない**（初回のみ。以降はメモリキャッシュ）。
- Blob URL は revoke するまでタブ寿命で有効。本の切替（`loadEpub`/`closeBook`）では revoke **しない**（フォントは本をまたいで使い続けるため）。revoke はフォント削除時のみ（§4.5）。

#### `buildSrcdoc()` の分岐

既存の `const font = FONTS[state.fontMode];`（~2594）の前段に追加：

```js
let font, fontFaceRule = '';
if (state.fontMode.indexOf('custom:') === 0) {
  const id = state.fontMode.slice(7);
  const src = await cfGetFontSrc(id);
  if (src) {
    const fam = 'CustomFont_' + id;
    fontFaceRule = "@font-face{font-family:'" + fam + "';src:url(" + src + ");font-display:swap;}\n";
    font = "'" + fam + "'";
  } else {
    // IDBに実体が無い（削除済み/破損/ブラウザによるIDB消去）→ 恒久フォールバック
    // 注意：ローカル変数 font の差し替えだけだと state.fontMode が 'custom:...' のまま残り、
    // 章送りのたびに IDB 読み込み失敗→トーストが繰り返される。state を書き換えて一度で終わらせる。
    // changeFont() は renderPage() を再帰呼び出しするため使わない（buildSrcdoc は renderPage の内側）。
    state.fontMode = 'gothic';
    saveSettings();
    updateFontPickerUI();
    font = FONTS['gothic'];
    showToast(t('toast.cfMissing'));
  }
} else {
  font = FONTS[state.fontMode];
}
```

`fontImport`（既存の `@import url(...)`）はカスタム時 `FONT_URLS[state.fontMode]` が undefined で自然に空文字になるため既存コードのままでよく、`fontFaceRule` を `overrideStyle.textContent` の先頭（`fontImport` の直後）に追加連結するだけでよい。

#### `updateFontPickerUI()` のカスタム対応（レビューで発覚した漏れ）

既存実装（~4442）はラベル解決を `FONT_GROUPS` 走査でしか行わないため、カスタムフォント選択中はピッカーボタンに **`custom:cf_xxxx` という生キーが表示されてしまう**。`FONT_GROUPS` 走査の前に分岐を追加：

確定形のコードは §8.6 を参照（`if (!label) return;` 直後に custom 分岐を挿入し、リスト open 時の再描画まで行って早期リターンする）。

`label.style.fontFamily` が実書体で描画されるためには次項の FontFace 登録が済んでいる必要がある（未登録の間はフォールバック書体で表示され、登録完了後に自動で切り替わる — FontFace API の標準挙動）。

#### ピッカープレビュー用 FontFace 登録（リロード後も有効にする）

親ドキュメントの `.fp-sample`・ピッカーボタンラベルで実書体を見せるための `FontFace` 登録。**追加直後（`cfHandleFile`）だけでなく、リロード後のセッションでも登録されるようにする**（旧設計はここが漏れており、次回起動時はプレビューが素のフォントに戻ってしまう）：

```js
async function cfRegisterPreviewFace(id) {
  if (_cfPreviewRegistered.has(id)) return;
  try {
    const src = await cfGetFontSrc(id);     // blob URL / data URI どちらも FontFace で使用可
    if (!src) return;
    const fam = 'CustomFont_' + id;
    const face = new FontFace(fam, 'url(' + src + ')');
    await face.load();
    document.fonts.add(face);
    _cfPreviewRegistered.add(id);
  } catch (e) { /* プレビュー登録失敗は致命的ではないので無視 */ }
}
```

登録タイミング（いずれも fire-and-forget）：
1. **`cfHandleFile()` 完了時**（追加直後）。
2. **`toggleFontPicker()` で開いた時**：`state.customFonts` のうち未登録の id を順に `cfRegisterPreviewFace()` → 全件完了後、リストがまだ開いていれば `buildFontPickerList()` で再描画。5件×20MB を読む最悪ケースでも遅延ロードなのでピッカー表示自体はブロックしない。
3. **起動時ウォームアップ**：init で `state.fontMode` がカスタムの場合のみ `cfRegisterPreviewFace(id)` を fire-and-forget 実行。ピッカーボタンラベルの書体表示に加え、`cfGetFontSrc` のキャッシュが温まるため**リロード後最初の本オープンで IDB 読み込み待ち（数百ms〜1秒）が消える**。

### 4.5 フォント削除・容量管理

```js
function confirmDeleteCustomFont(id) {
  if (!confirm(t('cf.deleteConfirm'))) return;
  cfDeleteFont(id);
}
async function cfDeleteFont(id) {
  await _cfIdbDelete(id);
  state.customFonts = state.customFonts.filter(f => f.id !== id);
  cfSaveMeta();
  const bu = _cfBlobUrlCache.get(id);
  if (bu) { URL.revokeObjectURL(bu); _cfBlobUrlCache.delete(id); }
  _cfDataUriCache.delete(id);
  _cfPreviewRegistered.delete(id);   // document.fonts からの FontFace 削除は省略（実害なし）
  if (state.fontMode === 'custom:' + id) {
    changeFont('gothic');           // 選択中に削除された場合のフォールバック
    showToast(t('toast.cfDeleted'));
  }
  buildFontPickerList();
}
```

- 自動LRU削除は行わない（§4.3のとおり明示的削除のみ）。容量管理はユーザー操作に委ねる。
- 設定ポップオーバーに件数・概算使用量を出す場合は、既存の `#cache-group`（ePubキャッシュ）と同型の `#cf-cache-group` を追加してもよい（任意・優先度低）。

### 4.6 フォントピッカーUI拡張（`buildFontPickerList()`）

既存の `FONT_GROUPS` ループの**末尾**に、動的な「カスタムフォント」グループを追記する：

```js
// buildFontPickerList() の末尾（list.innerHTML = html; の直前）
html += '<div class="fp-group-header">' + esc(t('font.customGroup')) + '</div>';
for (const cf of state.customFonts) {
  const key = 'custom:' + cf.id;
  const sel = state.fontMode === key ? ' fp-selected' : '';
  html += '<div class="fp-item' + sel + '" onclick="selectFont(\'' + key + '\')">' +
    '<span class="fp-name">' + esc(cf.name) + '</span>' +
    '<span class="fp-sample" style="font-family:\'CustomFont_' + esc(cf.id) + '\'">' + esc(sample) + '</span>' +
    '<button class="fp-del-btn" data-id="' + esc(cf.id) + '" ' +
      'onclick="event.stopPropagation();confirmDeleteCustomFont(this.dataset.id)">✕</button>' +
    '</div>';
}
html += '<div class="fp-item fp-add-custom" onclick="event.stopPropagation();document.getElementById(\'custom-font-input\').click()">' +
  '+ ' + esc(t('font.addCustom')) + '</div>';
```

- **`.fp-sample`（サンプル文）を他グループと同様に表示する**（表示の統一性）。実書体で描画されるには §4.4 の FontFace 登録が必要で、ピッカーを開いた時の遅延登録が完了するとリスト再描画で実書体に切り替わる（未登録の間はフォールバック書体＝許容）。
- 削除ボタンは `data-id` 属性経由で受け渡す（インライン onclick へのデータ埋め込み禁止規約。`esc()` は `'` を非エスケープのため、既存の読みかけリストv2と同じ方式）。なお `selectFont('custom:...')` のインライン埋め込みは、`cf.id` が自己生成の安全な文字集合（英数・`_`・`-`）のみで構成されるため規約に抵触しない（外部由来文字列ではない）。
- `#custom-font-input` は `<body>` 直下に `style="display:none"` で1つだけ配置。

### 4.7 制限値（確定・当面の値）

| 項目 | 確定値 | 根拠 |
|---|---|---|
| 保持件数上限 | 5件 | ePubキャッシュ(3件)より緩めだが、フォントは選び直しの手間が大きいため多めに |
| 1ファイルサイズ上限 | 20MB | CJKフル字形を含むTTF/OTFでも大半は収まる目安値。variable fontの極端に大きいものは弾く |
| 対応拡張子 | `.ttf` `.otf` `.woff` `.woff2` | ブラウザネイティブ対応形式のみ（`.ttc` 等のコレクション形式は非対応） |

当面この値で運用し、窮屈であれば後日調整する（§6-1）。

### 4.8 対象外・注意事項

- **Drive同期・エクスポート対象外**：`collectBookmarks()` / インポート処理には一切触れない。カスタムフォントは端末ごとに個別管理。
- **`file://` モードでも動作**：ローカルファイル読み込みなので、既存のWebフォント（`FONT_URLS`・要ネット）と違い完全オフラインで機能する。むしろ `file://` ユーザーへの訴求ポイントになる。
- **フォントライセンス**：ユーザー個人のローカル環境内で完結する利用であり、配布・共有は行わないため通常は問題にならない。ヘルプ文言やトーストで注意喚起までは行わない（既存プロジェクトのスコープ外判断に倣う）。
- **iOS版 (`yomikake_ios.html`) の差分**：FSA APIが無いため再オープンの仕組みとは無関係（本機能はePub本体のキャッシュとは別物）。IndexedDB ArrayBuffer方式はePubキャッシュで実績済みのパターンをそのまま流用できる。

---

## 5. i18n キー（4言語：ja / en / zh-TW / zh-CN）

追加キー（命名は仮）：

- `settings.fontBold`（太字表示）
- `settings.fontStroke`（縁取りの強さ）
- `stroke.none`（なし）
- `stroke.weak`（弱）
- `stroke.medium`（中）
- `stroke.strong`（強）
- `font.customGroup`（カスタムフォント）
- `font.addCustom`（フォントを追加）
- `cf.deleteConfirm`（このフォントを削除しますか？）
- `toast.cfInvalidType`（対応していないファイル形式です）
- `toast.cfTooLarge`（ファイルサイズが大きすぎます（上限20MB））
- `toast.cfLimitReached`（カスタムフォントの上限に達しました。先に削除してください）
- `toast.cfDuplicate`（このフォントは既に追加されています）
- `toast.cfMissing`（フォントデータが見つかりません。標準フォントに戻しました）
- `toast.cfDeleted`（フォントを削除しました）
- `toast.cfSaveFailed`（フォントの保存に失敗しました）— IDB書き込み失敗（quota・Private Browsing等）用

追加位置：両ファイルの `I18N` 辞書内、各言語ブロック（`ja` / `en` / `zh-TW` / `zh-CN`）の `settings.*` / `toast.*` キー群の並びに挿入する（フラット辞書なので位置は任意だが、既存の関連キーの近くに置く）。

---

## 6. 判断ポイント（1〜5: 2026-07-01 確定／6〜11: 2026-07-02 レビュー反映で確定）

1. **保持件数上限（5件）・1ファイル上限（20MB）**：**当面この値で確定**（§4.7）。運用してみて窮屈であれば後日調整。
2. **フォント名のリネームUI**：**スコープ外で確定**。表示名はファイル名をそのまま使う（§4.1のとおり）。
3. **カスタムフォント選択中の太字トグル（2-A）・縁取り調整（2-C）併用**：**併用可能とする前提で確定**。`weightRule`/`strokeRule` は `font` の種類に依存せず独立適用なので技術的な障害はない。
4. **2-Cの縁取り幅（弱0.02em／中0.035em／強0.05em）**：**仮値のまま実装し、実機で試して調整する**（オープン。§3.4 STROKE_WIDTHS の数値は実装時の最終確定値ではなく、実装後の目視確認で微調整する前提とする）。
5. **2-Cの行のOFF時表示**：**disabled表示（グレーアウト・操作不可）で確定**。行自体は非表示にしない（§3.2のとおり）。
6. **設定変更時の章内位置保持（0-R）**：**新設・既存5関数への遡及適用も含めて確定**（§1.5）。既存挙動（章頭リセット）はユーザーからも要改善の声があった。
7. **フォント実体の埋め込み方式**：**Blob URL 第一・`file://` のみ data URI フォールバックで確定**（§4.4）。data URI 一本案は 27MB級 srcdoc の毎章パースが iOS で非現実的なため棄却。
8. **ルビの縁取り除外（`rt,rp{-webkit-text-stroke-width:0!important}`）**：**必須で確定**（§3.4）。主用途が縦書き・ルビあり書籍であり、text-stroke の継承（計算済みpx値）によりルビだけ相対2倍の太さになるため。
9. **マジックバイト検証**：**採用で確定**（§4.3）。拡張子偽装・壊れファイル・`.ttc` を追加時点で即時検出する。
10. **重複追加ガード（同名・同サイズで判定）**：**採用で確定**（§4.3）。
11. **2-C行のdisabled**：`pointer-events:none` に加え **`<select>` の `disabled` 属性を併用で確定**（キーボードフォーカス対策・§3.2/§3.3）。

---

## 7. 実装チェックリスト（両ファイル）

### 0-R（設定変更時の章内位置保持・最初に実装）
- [ ] `rerenderKeepPos()` ヘルパー追加（`renderPage(state.currentSpineIdx, _intraChapterRatio)`）
- [ ] 既存5関数の置換：`changeFont` / `changeFontSize` / `changeLineHeight` / `changeTheme` / `changeWritingMode`
- [ ] 動作確認：章の途中でフォント/テーマを変えても近似位置に留まり、しおりが 0 で上書きされないこと
- [ ] FXL 本で設定変更してもページ表示が壊れないこと（`scrollTarget` 無視で無影響のはず）

### 2-A（太字トグル）
- [ ] `state.fontBold` 追加、`saveSettings`/`loadSettings` に反映
- [ ] `loadSettings()` 復元時に `updateFontBoldToggleUI()` を呼ぶ（UI同期の呼び忘れ注意・§2.1）＋ Init ブロックでも無条件に1回呼ぶ（§8.4）
- [ ] タイポグラフィ set-group（`fxl-hide-group`）に ON/OFF ボタン行を行間 set-row の直後に追加（`.fxl-hide-row` は不要・§8.2）
- [ ] `toggleFontBold()`（`rerenderKeepPos()` 使用）/ `updateFontBoldToggleUI()`
- [ ] `buildSrcdoc()` に `weightRule` 注入（`fontRule` と独立。**セレクタはファイル別**：本体=`html,body,p,...,span`・iOS=`body,body *`）
- [ ] i18n `settings.fontBold` ×4言語
- [ ] 縦中横との相互作用を実機で目視確認

### 2-C（縁取り太字強度調整・2-A実装後）
- [ ] `state.fontStrokeLevel` 追加、`saveSettings`/`loadSettings` に反映
- [ ] `#font-stroke-row`（select：なし/弱/中/強）を太字トグル行の直下に追加（`.fxl-hide-row` は不要・§8.2）
- [ ] `.set-row-disabled` CSS 追加＋`sel.disabled` 併用（キーボードフォーカス対策）
- [ ] `changeFontStrokeLevel()`（`rerenderKeepPos()` 使用）/ `updateFontStrokeRowUI()`（太字トグルON/OFF連動）
- [ ] `toggleFontBold()` から `updateFontStrokeRowUI()` を呼ぶよう修正
- [ ] `buildSrcdoc()` に `strokeRule`（`-webkit-text-stroke`・`currentColor`・em単位・`!important`）注入
- [ ] **`rt,rp{-webkit-text-stroke-width:0!important}` のルビ除外を必ず含める**（§3.4）
- [ ] i18n `settings.fontStroke` / `stroke.none` / `stroke.weak` / `stroke.medium` / `stroke.strong` ×4言語
- [ ] 縦中横・小フォントサイズ・**ルビつき縦書き本**での視認性を実機で目視確認

### 1-A（ローカルフォント）
- [ ] `state.customFonts` ＋起動時ロード（`cfLoadMeta()` — **必ず `loadSettings()` より前に呼ぶ**。§8.2）
- [ ] `CF_DB_NAME`/`CF_STORE_NAME` ＋ `_cfIdbGet`/`_cfIdbPut`/`_cfIdbDelete`（ArrayBuffer方式）
- [ ] `#custom-font-input` ＋ `cfHandleFile()`（拡張子・**マジックバイト**・**重複**・サイズ・件数チェック）
- [ ] `cfSniffFormat()`（先頭4バイト判定・`.ttc` 拒否含む）
- [ ] `cfGetFontSrc()`（**Blob URL 第一・`file://` のみ data URI**。`_cfBlobUrlCache` / `_cfDataUriCache`（1件のみ）によるメモ化）
- [ ] `buildSrcdoc()` の `font` 解決ロジック分岐（`custom:` プレフィックス）＋ `fontFaceRule` 注入
- [ ] `buildSrcdoc()` の実体欠損フォールバックで **`state.fontMode='gothic'` を書き込んで恒久化**（毎章トースト防止・§4.4）
- [ ] `updateFontPickerUI()` に `custom:` 分岐追加（生キー表示の防止・§4.4）
- [ ] `cfRegisterPreviewFace()`＋3箇所の登録タイミング（追加時／ピッカーを開いた時の遅延登録／init ウォームアップ）
- [ ] `buildFontPickerList()` にカスタムフォント動的セクション（**`.fp-sample` 付き**）＋追加行
- [ ] `confirmDeleteCustomFont()` / `cfDeleteFont()`（選択中フォント削除時のフォールバック・**Blob URL revoke** 含む）
- [ ] i18n 10キー×4言語（`toast.cfDuplicate` / `toast.cfSaveFailed` 含む）
- [ ] `.fp-del-btn` CSS 追加（§8.6）
- [ ] `collectBookmarks()` 等の同期処理に**触れていない**ことを確認（対象外の担保）
- [ ] iOS版（`yomikake_ios.html`）へ同等反映（LF）
- [ ] 実機確認：iOS Safari で 15〜20MB フォント適用時の章送り速度・メモリ（Blob URL 方式でジェットサムが起きないこと）

---

## 8. 詳細設計（2026-07-02・現行コード照合済み）

実装時に検索で到達できるよう、アンカーは**検索可能な文字列**を正とし、行番号は目安（コード成長でずれる）。行番号は 2026-07-02 時点の HEAD（v2.0.0）＋未コミットなし状態。

### 8.1 実装アンカー対応表

| 対象 | 検索アンカー | `yomikake.html` | `yomikake_ios.html` |
|---|---|---|---|
| state オブジェクト（設定群） | `fontMode:'publisher', fontSize:100,` | ~1950 | ~1925 |
| `FONT_SAMPLE` 定義（`STROKE_WIDTHS` 追加位置） | `const FONT_SAMPLE = {` | ~2121 | ~2089 |
| `buildSrcdoc()` フォント解決 | `const font   = FONTS[state.fontMode];` ※iOS はスペース1個 `const font = FONTS` | ~2594 | ~2697 |
| `fontRule` 定義 | `const fontRule = font` | ~2601 | ~2704 |
| `overrideStyle.textContent` 組み立て | `overrideStyle.textContent = fontImport + [` | ~2631 | 対応行 |
| 配列内の `fontRule,` | `    fontRule,` | ~2647 | ~2738 |
| `saveSettings()` | `function saveSettings() {` | ~4073 | ~4144 |
| `loadSettings()` | `function loadSettings() {` | ~4094 | ~4165 |
| `buildFontPickerList()` | `function buildFontPickerList() {` | ~4382 | ~4452 |
| `toggleFontPicker()` | `function toggleFontPicker() {` | ~4418 | ~4486 |
| `updateFontPickerUI()` | `function updateFontPickerUI() {` | ~4442 | ~4510 |
| `changeFont()`〜`changeWritingMode()` | `function changeFont(v) {` | ~4467-4517 | ~4532-4581 |
| ePub IDB キャッシュ節（`_cf` 群の配置先） | `const EPUB_CACHE_DB` | ~4606 | ~2100台 |
| `navigator.storage.persist` ブロック | `navigator.storage.persist()` | ~4675 | ~2171 |
| 隠しファイル input | `id="bookmark-input"` | ~592 | ~572 |
| bookmark-input change リスナー | `getElementById('bookmark-input').addEventListener` | ~6181 | ~5947 |
| タイポグラフィ set-group | `<div class="set-group fxl-hide-group">` | ~658 | ~638 |
| 行間 set-row（挿入位置の直前要素） | `id="lineh-select"` | ~679 | ~659 |
| Init ブロック | `// Init` → `initLang();` | ~7018 | ~6771 |
| `esc()` | `function esc(s) {` | ~6923 | ~6683 |
| フォントピッカー CSS（`.fp-del-btn` 追加位置） | `.fp-sample {` | ~94 | 同等 |

### 8.2 コード照合で判明した設計修正点（§2〜§4 に反映済み）

1. **`.fxl-hide-row` は不要**：タイポグラフィ set-group 自体が `fxl-hide-group` クラス持ちで、`body.mode-fxl .fxl-hide-group { display:none !important }`（本体 ~330 / iOS ~329）によりグループごと FXL 非表示になる。2-A/2-C の行は素の `set-row` でよい。
2. **注入セレクタはファイルで異なる**：本体の `fontRule` は `html,body,p,h1,h2,h3,h4,h5,h6,div,span`、iOS は `body,body *`。`weightRule` / `strokeRule` も各ファイルの既存セレクタに揃える。iOS では `body *` が `rt` に直接マッチするが、後置の `rt,rp{...width:0!important}` が後方定義で勝つ。
3. **`cfLoadMeta()` は `loadSettings()` より前に呼ぶ**：`loadSettings()` は `s.fontMode` 復元時に `updateFontPickerUI()` を呼ぶ（本体 ~4098 / iOS ~4169）。カスタムフォント選択中だった場合、ラベル解決に `state.customFonts` が必要なため、Init での呼び出し順は `cfLoadMeta()` → `loadSettings()`。
4. **IDB 書き込み失敗用トースト `toast.cfSaveFailed` を追加**（§5 反映済み）。quota・Private Browsing 等で `_cfIdbPut` が reject した場合に使用。
5. **`renderPage()` の数値 scrollTarget 対応は両ファイルとも既存**（本体 ~3035 / iOS ~3179 で `'start'` デフォルト＋数値受理・`savePos` も同値保存）— 0-R はヘルパー追加と呼び出し置換のみで成立する。

### 8.3 0-R 詳細

**ヘルパー配置**：`changeFont()` 定義の直前（両ファイル。change系関数群の先頭）。

```js
// 設定変更による再レンダーで章内位置を保持する（§design_font_extension.md 0-R）
function rerenderKeepPos() {
  if (state.spine.length) renderPage(state.currentSpineIdx, _intraChapterRatio);
}
```

**置換対象（各ファイル5箇所）**：`changeFont` / `changeFontSize` / `changeLineHeight` / `changeTheme` / `changeWritingMode` の末尾行

```js
  if (state.spine.length) renderPage(state.currentSpineIdx);   // ← これを
  rerenderKeepPos();                                           // ← これに置換
```

対象外：`changeMargin`（再レンダーなし）・`changeFwdBtnSize`（同）・`changeSpreadMode`（FXL専用・別経路）。

### 8.4 2-A 詳細

1. **state**（`fontMode:'publisher', ...` 行の直後、`fwdBtnSize` の並び）：
   ```js
   fontBold:false,        // 太字表示トグル（epub_settings に永続化）
   ```
2. **saveSettings()**：`driveAutoSave: state.driveAutoSave,` の直後に `fontBold: state.fontBold,` を追加。
3. **loadSettings()**：`driveAutoSave` 行の直後に追加：
   ```js
   if (typeof s.fontBold === 'boolean') { state.fontBold = s.fontBold; updateFontBoldToggleUI(); }
   ```
4. **HTML**：行間 set-row（`</select>` 閉じの `</div>`）の直後・タイポグラフィ set-group 閉じ `</div>` の前に §2.2 の行を挿入。
5. **関数**：`changeFwdBtnSize()` の後ろ等、change系関数群の並びに `toggleFontBold()` / `updateFontBoldToggleUI()`（§2.3）を配置。
6. **buildSrcdoc()**：`const fontRule = ...` の直後に `weightRule`（§2.4・ファイル別セレクタ）を定義し、配列の `fontRule,` を `fontRule, weightRule,` に変更。
7. **Init**：`updateFxlLtrAutoFlipUI();`（本体 ~7024）の並びに `updateFontBoldToggleUI();` を追加（設定なし初回起動時の OFF 表示確定）。

### 8.5 2-C 詳細

1. **state**：`fontBold:false,` の直後に `fontStrokeLevel:0,`。
2. **saveSettings()**：`fontBold` の直後に `fontStrokeLevel: state.fontStrokeLevel,`。
3. **loadSettings()**：`fontBold` 行の直後に追加（ホワイトリスト検証は FXL 系の既存パターンに倣う）：
   ```js
   if (typeof s.fontStrokeLevel === 'number' && [0,1,2,3].indexOf(s.fontStrokeLevel) >= 0) {
     state.fontStrokeLevel = s.fontStrokeLevel;
     const el = document.getElementById('font-stroke-select'); if (el) el.value = String(s.fontStrokeLevel);
   }
   ```
4. **CSS**：`.set-group h4` 定義（~49）付近に `.set-row-disabled { opacity:.4; pointer-events:none; }` を追加。
5. **HTML**：太字トグル行の直後に §3.2 の `#font-stroke-row` を挿入。
6. **`STROKE_WIDTHS`**：`const FONT_SAMPLE = {...};` 定義の直後にモジュール定数として配置（buildSrcdoc 内で毎回生成しない）。
7. **buildSrcdoc()**：`weightRule` の直後に `strokeRule`（§3.4・ファイル別セレクタ＋`rt,rp` 除外）を定義し、配列を `fontRule, weightRule, strokeRule,` に。
8. **Init**：`updateFontBoldToggleUI();` の直後に `updateFontStrokeRowUI();`（disabled 初期状態の確定）。

### 8.6 1-A 詳細

**モジュール配置**：ePub IDB キャッシュ節の末尾（`navigator.storage.persist()` ブロックの後）に「カスタムフォント（1-A）」節を新設し、定数・IDBヘルパ・メタ管理・`cfGetFontSrc`・`cfRegisterPreviewFace`・`cfHandleFile`・`cfSniffFormat`・削除系をまとめて置く（`_rl` / `_rd` 節と同じ「機能ごとに一塊」の流儀）。

**IDBヘルパ**：既存 `_idbOpenCache`〜`_idbDelete`（本体 ~4612-4650）を**そのまま複製して**DB名・ストア名・可用性フラグだけ差し替える（`_cfIdbOpen` / `_cfIdbGet` / `_cfIdbPut` / `_cfIdbDelete` / `_cfIdbAvailable`）。`.catch(() => null)` 等のエラー吸収パターンも同一にする。ただし **`_cfIdbPut` だけは reject をそのまま呼び出し側へ伝播**させる（`cfHandleFile` が `toast.cfSaveFailed` を出すため）。

**メタ管理**：

```js
function cfLoadMeta() {
  try {
    const arr = JSON.parse(localStorage.getItem('epub_custom_fonts'));
    if (Array.isArray(arr))
      state.customFonts = arr.filter(f => f && typeof f.id === 'string' && typeof f.name === 'string');
  } catch (e) { /* 破損時は空のまま */ }
}
function cfSaveMeta() {
  try { localStorage.setItem('epub_custom_fonts', JSON.stringify(state.customFonts)); }
  catch (e) { notifyStorageError(); }
}
```

**`cfHandleFile()` 確定形**（§4.3 のチェック順を実装に落としたもの）：

```js
async function cfHandleFile(file) {
  if (!file) return;
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) { showToast(t('toast.cfInvalidType')); return; }
  if (!(await cfSniffFormat(file)))            { showToast(t('toast.cfInvalidType')); return; }
  if (state.customFonts.some(f => f.name === file.name && f.size === file.size))
                                               { showToast(t('toast.cfDuplicate')); return; }
  if (file.size > CF_MAX_SIZE)                 { showToast(t('toast.cfTooLarge')); return; }
  if (state.customFonts.length >= CF_MAX_COUNT){ showToast(t('toast.cfLimitReached')); return; }
  const id = 'cf_' + (crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const addedAt = new Date().toISOString();
  try {
    const buf = await file.arrayBuffer();
    await _cfIdbPut(id, { buf, mime: file.type || 'font/ttf', fileName: file.name, addedAt });
  } catch (e) {
    console.warn('custom font save failed:', e);
    showToast(t('toast.cfSaveFailed'));
    return;
  }
  state.customFonts.push({ id, name: file.name, size: file.size, addedAt });
  cfSaveMeta();
  cfRegisterPreviewFace(id);        // fire-and-forget（プレビュー登録）
  selectFont('custom:' + id);       // 即適用（closeFontPicker + changeFont 経由で再レンダー）
  buildFontPickerList();            // 次回オープン時のリスト整合
}
```

**隠し input と change リスナー**：`#bookmark-input`（本体 ~592 / iOS ~572）の直後に
`<input type="file" id="custom-font-input" accept=".ttf,.otf,.woff,.woff2" style="display:none">` を追加。
リスナーは既存 bookmark-input リスナー（本体 ~6181 / iOS ~5947）の近くに：

```js
document.getElementById('custom-font-input').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';   // 同一ファイルの再選択で change が発火するようリセット
  cfHandleFile(f);
});
```

**`buildSrcdoc()` の分岐（確定形）**：既存 `const font   = FONTS[state.fontMode];` を次で置き換え：

```js
  let font = FONTS[state.fontMode], fontFaceRule = '';
  if (state.fontMode.indexOf('custom:') === 0) {
    const cfId = state.fontMode.slice(7);
    const cfSrc = await cfGetFontSrc(cfId);
    if (cfSrc) {
      const fam = 'CustomFont_' + cfId;
      fontFaceRule = "@font-face{font-family:'" + fam + "';src:url(" + cfSrc + ");font-display:swap;}\n";
      font = "'" + fam + "'";
    } else {
      // 実体欠損 → 恒久フォールバック（§4.4。changeFont は renderPage を再帰するため不可）
      state.fontMode = 'gothic';
      saveSettings();
      updateFontPickerUI();
      font = FONTS['gothic'];
      showToast(t('toast.cfMissing'));
    }
  }
```

`overrideStyle.textContent = fontImport + [` → `overrideStyle.textContent = fontImport + fontFaceRule + [` に変更（`fontImport` はカスタム時 undefined→`''` となり既存のまま無害）。

**`updateFontPickerUI()` の分岐**：`if (!label) return;` の直後に挿入：

```js
  if (state.fontMode.indexOf('custom:') === 0) {
    const cf = state.customFonts.find(f => 'custom:' + f.id === state.fontMode);
    label.textContent = cf ? cf.name : t('font.customGroup');
    label.style.fontFamily = cf ? "'CustomFont_" + cf.id + "'" : '';
    if (document.getElementById('font-picker-list').classList.contains('open')) buildFontPickerList();
    return;
  }
```

**`toggleFontPicker()` の遅延プレビュー登録**：`if (open) buildFontPickerList();` を次に変更：

```js
  if (open) {
    buildFontPickerList();
    const pending = state.customFonts.filter(cf => !_cfPreviewRegistered.has(cf.id));
    if (pending.length) {
      Promise.all(pending.map(cf => cfRegisterPreviewFace(cf.id))).then(() => {
        if (list.classList.contains('open')) buildFontPickerList();   // 実書体で再描画
      });
    }
  }
```

**`buildFontPickerList()`**：`list.innerHTML = html;` の直前に §4.6 のカスタムセクションを挿入（`sample` 変数は関数冒頭で定義済み・そのまま利用可）。

**`.fp-del-btn` CSS**（`.fp-sample` 定義の直後）：

```css
.fp-del-btn { flex-shrink:0; border:none; background:none; color:inherit; opacity:.45;
              font-size:12px; cursor:pointer; padding:2px 6px; border-radius:4px; }
.fp-del-btn:hover { opacity:1; background:rgba(0,0,0,.18); }
```

**Init 配線**（Init ブロック内・順序が重要）：

```js
cfLoadMeta();       // ← loadSettings() より前（§8.2-3）
// ...既存: initLang(); applyI18n(); ...
loadSettings();
// ...既存: updateFxlLtrAutoFlipUI(); ...
updateFontBoldToggleUI();
updateFontStrokeRowUI();
if (state.fontMode.indexOf('custom:') === 0)
  cfRegisterPreviewFace(state.fontMode.slice(7));   // ウォームアップ（§4.4）
```

実際の挿入位置：`cfLoadMeta()` は `initLang();` の直前、UI同期2行とウォームアップは `updateFxlLtrAutoFlipUI();` の直後。

### 8.7 iOS版（`yomikake_ios.html`）差分まとめ

| 項目 | 本体 | iOS |
|---|---|---|
| 改行コード | CRLF | LF |
| `weightRule` / `strokeRule` セレクタ | `html,body,p,h1,h2,h3,h4,h5,h6,div,span` | `body,body *` |
| FXL ズームキーボード（z/0/1-6） | 実装あり（2-A/2-C とは無関係・変更不要） | 未実装（同） |
| それ以外の 0-R / 2-A / 2-C / 1-A | — | **完全同一実装**（アンカー行番号のみ §8.1 参照） |

**実装時の進め方**：機能ごとに「本体に実装 → 動作確認 → iOS へ移植（セレクタ・改行コードだけ注意）」の順。両ファイルの diff を取って構造が揃っていることを確認してからコミットする。
