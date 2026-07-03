# UI 改善 概要設計書（v2.3.0 予定）

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**（行番号は yomikake.html 基準。iOS 版は相当箇所に同一変更を適用）
背景: 2026-07-03 の UX 調査に基づく改善一式。読書中の「出口」動線の露出（A）、モバイルツールバーの発見性（1a/1b）、コントロール表示の標準パターン導入（2）、設定パネルの整理（3）、本の直接切替時のデータ保全（4）、Escape キーの一貫性（5）、ウェルカム画面下段ガイドの削除（6）。

## 0. 確定済みの設計判断

- 左上ボタンは**本が開いているときだけ**「← リストへ」（= `closeBook()`）に切り替わる。未オープン時は従来どおり「開く」
- 設定ポップオーバー最下部の「📚 この本を閉じる」グループは**削除**（左上ボタンに一本化）
- 「読書中に別の本を直接開く」動線は読みかけリストの「別の ePub を開く」に集約（1タップ増を許容。閉じる→選ぶの方がメンタルモデルに合う）
- モバイルツールバーは「右端フェード（mask-image 方式）」**と**「しおり JSON 入出力 2 ボタンの設定への移動」の両方を実施
- 中央タップは**新規 postMessage `EPUB_TAP`** で親へ通知し、中央領域判定は**親側**で行う（FXL 直接 DOM 経路と判定ロジックを共有するため）
- 中央タップの効果は `flashNavButtons()` の再利用（+ フルスクリーン中は `showFsExitBtn()` も）。新規 UI は作らない
- 目アイコン（`flashNavButtons` ボタン）はツールバーに**残す**（PC ユーザー向け・機能の説明的役割）
- ウェルカム画面下段の操作ガイドは**タッチ分岐ではなく完全削除**（読書操作の説明を未オープン画面に置く必然性がなく、PC は読書中ステータスバーの `statusbar.keyHint`・ヘルプモーダルで代替済み。§2 の中央タップ導入で発見性も補完される）
- バージョンは v2.3.0、コミットは項目単位に分割可（推奨実装順は §10）

---

## A. 左上「開く」ボタンの読書中切替

### A-1. HTML（yomikake.html:569 / yomikake_ios.html:549）

`#open-btn` に SVG を 2 つ持たせ、`reading` クラスで切り替える。onclick はディスパッチャに変更。

```html
<button id="open-btn" onclick="openBtnClick()" data-i18n-title="btn.open.title">
  <svg class="ob-icon-open" ...>（現行のファイルアイコンをそのまま）</svg>
  <svg class="ob-icon-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" style="display:none">
    <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
  </svg>
  <span id="open-btn-label" data-i18n="btn.open">開く</span>
</button>
```

CSS: `#open-btn.reading .ob-icon-open { display:none } #open-btn.reading .ob-icon-back { display:inline-block }`（SVG の inline style は撤去し CSS 切替に寄せてもよい）。

### A-2. JS

```js
function openBtnClick() {
  if (state.epub) closeBook();
  else openFilePicker();
}
```

`updateCloseBookBtnVisibility()`（yomikake.html:5655）に追記：

```js
const ob = document.getElementById('open-btn');
const obLabel = document.getElementById('open-btn-label');
ob.classList.toggle('reading', !!state.epub);
obLabel.dataset.i18n = state.epub ? 'btn.backToList' : 'btn.open';
obLabel.textContent = t(obLabel.dataset.i18n);
ob.dataset.i18nTitle = state.epub ? 'btn.backToList.title' : 'btn.open.title';
ob.title = t(ob.dataset.i18nTitle);
```

**`data-i18n` / `data-i18n-title` 属性ごと書き換えるのが要点** — `applyI18n()` は DOM の data 属性を走査するため、属性を動的に差し替えておけば読書中の言語切替でもラベルが崩れない。

呼び出し箇所は現行のまま（`loadEpub` 内 :2387、`closeBook` 内 :5706、加えて**初期化時に 1 回**呼んで初期状態を確定させる）。

### A-3. 設定内「この本を閉じる」の削除

- HTML: `#close-book-group`（yomikake.html:787-789）を削除
- JS: `updateCloseBookBtnVisibility()` 内の `close-book-group` 表示切替 2 行を削除（`#fxl-settings-group` の切替は**残す**）
- i18n: `btn.closeBook` / `btn.closeBook.title` キーを 4 言語から削除（title 文言は `btn.backToList.title` に転用）

### A-4. i18n 新キー（4 言語 × 両ファイル）

| キー | ja | en | zh-TW | zh-CN |
|---|---|---|---|---|
| `btn.backToList` | リストへ | Book list | 返回清單 | 返回列表 |
| `btn.backToList.title` | この本を閉じて読みかけリストへ | Close book and return to reading list | 關閉此書並回到閱讀清單 | 关闭本书并回到阅读列表 |

### A-5. 注意点

- iOS 版は `#open-btn` にアクセント色スタイル（yomikake_ios.html:36-38）が付いている。切替後もそのまま適用（読書中も「主要な出口」なので視覚的重みは妥当）
- `closeBook()` は既に設定ポップオーバー/サイドバー/フルスクリーンを閉じてから welcome に戻るため、追加のクリーンアップは不要

---

## 1a. モバイルツールバーの右端フェード（オーバーフロー指標）

### 実装方式: `mask-image` + JS クラストグル

追加 DOM なし。`#toolbar` 自体にマスクをかける（マスクはスクロールコンテナの可視ボックスに適用されるため、右端フェードがスクロールに追従しない＝常に右端で効く）。

CSS（`@media (max-width:640px)` 内に追加）:

```css
#toolbar.tb-overflow {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
          mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
}
```

JS（Init ブロックに追加）:

```js
function updateToolbarFade() {
  const tb = document.getElementById('toolbar');
  const more = tb.scrollWidth - tb.clientWidth - tb.scrollLeft > 4;
  tb.classList.toggle('tb-overflow', more);
}
document.getElementById('toolbar').addEventListener('scroll', updateToolbarFade, { passive: true });
window.addEventListener('resize', updateToolbarFade);
```

呼び出しタイミング: 初期化時・`applyI18n()` 末尾（ラベル幅変動）・`updateCloseBookBtnVisibility()` 末尾（A のラベル切替で幅が変わる）。

### 注意点

- 640px 超では `overflow-x` が効かず `scrollWidth == clientWidth` になるため自然に `tb-overflow` が外れる。メディアクエリ側でのみマスク定義しているので PC への影響なし
- 末端までスクロールしたらフェードが消える（「もう続きは無い」の合図）— `> 4` の閾値はサブピクセル誤差吸収

---

## 1b. しおり JSON 入出力ボタンの設定移動

### 変更内容

- ツールバーから 2 つの icon-btn（yomikake.html:584-589）を削除。**hidden の `#bookmark-input` は残す**（設定内ボタンから `.click()` する）
- 設定ポップオーバーに新グループを追加（配置は §3 の並び順参照）:

```html
<div class="set-group" id="bookmark-io-group">
  <h4 data-i18n="settings.bookmarkGroup">🔖 しおりデータ（JSON）</h4>
  <div class="set-row" style="gap:8px;">
    <button class="set-io-btn" onclick="document.getElementById('bookmark-input').click()"
            data-i18n="settings.bookmarkImport">📥 読み込み</button>
    <button class="set-io-btn" onclick="exportBookmarks()"
            data-i18n="settings.bookmarkExport">📤 書き出し</button>
  </div>
</div>
```

CSS: `.set-io-btn` は `#cache-clear-btn` と同系の枠線ボタン（`flex:1` で 2 等分）。

### i18n 新キー（4 言語 × 両ファイル）

| キー | ja | en | zh-TW | zh-CN |
|---|---|---|---|---|
| `settings.bookmarkGroup` | 🔖 しおりデータ（JSON） | 🔖 Bookmark data (JSON) | 🔖 書籤資料（JSON） | 🔖 书签数据（JSON） |
| `settings.bookmarkImport` | 📥 読み込み | 📥 Import | 📥 匯入 | 📥 导入 |
| `settings.bookmarkExport` | 📤 書き出し | 📤 Export | 📤 匯出 | 📤 导出 |

既存の `btn.bookmark.import` / `btn.bookmark.export`（title 用）はボタン削除に伴い**削除**。

### 注意点

- Drive 上下ボタン（`#drive-download-btn` / `#drive-upload-btn`）は**ツールバーに残す**（自動保存インジケータ `auto-save-on` クラスの表示先であり、使用頻度も高い）
- インポートの `change` リスナーは `#bookmark-input` に付いたままなので JS 変更不要

---

## 2. 中央タップでコントロール表示（EPUB_TAP）

### 2-1. プロトコル追加

| Type | 方向 | Payload |
|---|---|---|
| `EPUB_TAP` | iframe → parent | `{xr: 0–1, yr: 0–1}` — タップ位置のビューポート比率（`clientX/innerWidth`, `clientY/innerHeight`） |

### 2-2. iframe 側（送信）

両ファイルとも**既存の `<a>` クリックインターセプタに else 分岐を追加**する（yomikake.html は `SHARED_TAIL` 内 :2790 付近の `document` click リスナー、yomikake_ios.html は `CLICK_HANDLER` テンプレート変数）。iOS Safari でもタップで click が発火するため、touchend 側の改修は不要（スワイプ判定と独立）。

```js
var a = ev.target.closest("a");
if (!a) {
  var sel = window.getSelection && window.getSelection();
  if (sel && sel.type === 'Range') return;   // テキスト選択中は無視
  window.parent.postMessage({type:'EPUB_TAP',
    xr: ev.clientX / window.innerWidth,
    yr: ev.clientY / window.innerHeight}, '*');
  return;
}
// （以降、既存の <a> 処理）
```

### 2-3. 親側（受信・判定）

message リスナー（既存の `e.source === iframe.contentWindow` 検証の内側）に追加:

```js
const CENTER_TAP_RATIO = 0.2;  // 中央 ±20%（= 中央 40% × 40% の矩形）

if (e.data.type === 'EPUB_TAP') {
  if (Math.abs(e.data.xr - 0.5) < CENTER_TAP_RATIO &&
      Math.abs(e.data.yr - 0.5) < CENTER_TAP_RATIO) revealControls();
  return;
}

function revealControls() {
  flashNavButtons();                      // ナビ4ボタン + モバイル進捗ピル（既存実装を再利用）
  if (state.fullscreen) showFsExitBtn();  // フルスクリーン中は出口ボタンも
}
```

中央領域を外れたタップ（端寄り）は何もしない — ナビボタンの当たり判定・FXL のスワイプと干渉させない。

### 2-4. FXL モード（iframe なし・直接 DOM）

`handleFxlTap()` はダブルタップ検出（300ms / 30px）専用。シングルタップ確定用のワンショットタイマーを追加する:

- タップ受付時に 320ms のタイマーをセット。2 打目が来たらタイマー破棄（既存のダブルタップ＝ズーム切替へ）
- タイマー発火時（= シングルタップ確定）: **`state.fxlZoomEnabled` が false のときのみ**、タップ座標を container 比率に換算して中央判定 → `revealControls()`
- ズーム中はタップ/ドラッグが操作に使われているため発動させない

### 2-5. 注意点

- `flashNavButtons()` は再入しても class 再付与のみで冪等 — PC のダブルクリック等での二重発火は無害
- ページ側 ePub コンテンツの inline `on*` ハンドラが `stopPropagation` する場合はタップが拾えないことがあるが、既存の `<a>` インターセプトと同じ制約なので許容
- CLAUDE.md の postMessage プロトコル表に `EPUB_TAP` 行を追加すること

---

## 3. 設定ポップオーバーの並び順整理

新しいグループ順（HTML の並べ替えのみ。JS 変更は A-3 の削除分だけ）:

| # | グループ | 備考 |
|---|---|---|
| 1 | カラー | 最頻用を最上部へ |
| 2 | タイポグラフィ | `fxl-hide-group` のまま |
| 3 | レイアウト | 現行のまま |
| 4 | FXL（`#fxl-settings-group`） | レイアウト直下・現行のまま |
| 5 | Google Drive（`#drive-auto-group`） | 現行のまま |
| 6 | 🔖 しおりデータ（`#bookmark-io-group`） | **新設**（1b） |
| 7 | 📂 ePub キャッシュ（`#cache-group`） | 現行のまま |
| 8 | 言語 | **最上部 → 最下部へ**（初回以降ほぼ触らない） |
| — | ~~この本を閉じる~~ | **削除**（A-3） |

---

## 4. 別の本を直接開いたときの旧本確定処理

### 現状の問題

`closeBook()` は `savePos()` + `driveSaveNow()` を行うが、本を開いたまま `loadEpub()` で別の本に切り替える経路（ピッカー / ドラッグ&ドロップ / 読みかけリスト）では両方ともスキップされる。デバウンス 500ms 内の読書位置と保留中の Drive 自動保存が失われうる。

### 変更内容

共通ヘルパーを新設し、`closeBook()` と `loadEpub()` の両方から呼ぶ:

```js
function finalizeCurrentBook() {
  if (!state.epub) return;
  savePos(_bookFinished ? 1.0 : _intraChapterRatio);
  driveSaveNow();
}
```

- `closeBook()`（yomikake.html:5663）: 冒頭の `savePos(...)` + `driveSaveNow()` 2 行を `finalizeCurrentBook()` に置換
- `loadEpub()`（yomikake.html:2252）: 冒頭の `_rdFlush(); _rdResetMeasure();` の**前**に `finalizeCurrentBook();` を追加

### 注意点

- `savePos` は `state.currentSpineIdx` / `state.bookKey` を参照する — `loadEpub` 冒頭では**まだ旧本の値**なので正しく旧本に保存される。`_bookFinished` のリセット（loadEpub 内の既存処理）より前に呼ぶこと
- `driveSaveNow()` は保留が無ければ no-op（closeBook での既存挙動と同じ）

---

## 5. Escape キーの一貫性

keydown ハンドラ（yomikake.html:4140）の `case 'Escape':` を優先度チェーンに拡張。**1 打で 1 つだけ閉じる**（return で抜ける）:

```js
case 'Escape':
  // 優先度: フォントピッカー > 設定 > サイドバー > フルスクリーン
  // （読書データは既存の先行ガードで、FXLズームOFFは既存のFXL分岐で処理済み）
  if (document.getElementById('font-picker-list').classList.contains('show')) {
    closeFontPicker(); e.preventDefault(); break;
  }
  if (document.getElementById('settings-popover').classList.contains('show')) {
    toggleSettings(); e.preventDefault(); break;
  }
  if (state.sidebarOpen) { toggleSidebar(); e.preventDefault(); break; }
  if (state.fullscreen) { toggleFullscreen(); e.preventDefault(); }
  break;
```

### 注意点

- ハンドラ先頭の `e.target.tagName === 'INPUT'` 早期 return により、検索入力にフォーカスがある間の Escape はサイドバーを閉じない — 既知の制約として許容（IME キャンセルとの衝突回避でもある）
- `font-picker-list` の開閉判定クラス名は実装時に実物を確認（`show` でなければ実際のクラスに合わせる）
- iOS 版にも同一変更（Bluetooth キーボード対応のため keydown ハンドラは存在する）

---

## 6. ウェルカム画面下段ガイドの削除

### 現状の問題

ウェルカム画面（本未オープン）の最下段に読書中の操作説明が常時表示されている:

- yomikake.html:886 — 「スペースキー：次へ・↑↓：前進 / ←→：章切替」（タッチ端末では無意味）
- yomikake_ios.html:866 — 「左右スワイプ：前進・後退 / ‹›ボタン：章切替」

いずれも**読書中の操作**の説明であり、本を開いていない画面に置く意味がない。読みかけリスト表示時（`has-list`）はリストの下に取り残される形にもなる。

### 変更内容

- 両ファイルから `<p ... data-i18n="welcome.keyHint" ...>` 要素を削除
- i18n キー `welcome.keyHint` を 4 言語から削除（両ファイル）
- JS 変更なし（`applyI18n()` は存在する data-i18n 要素のみ走査するため）

### 注意点

- 操作説明の受け皿は既存のヘルプモーダル（`showHelp()`）・PC 読書中のステータスバー `statusbar.keyHint`・§2 の中央タップ。削除のみで代替追加は不要
- CLAUDE.md の i18n 節に「iOS 版は `welcome.*` の文言が異なる」との記載あり — `welcome.keyHint` 削除後も他の `welcome.*` キーは残るため記述はそのままで矛盾しない

---

## 7. CLAUDE.md 更新項目

- postMessage プロトコル表に `EPUB_TAP` 行を追加
- 「Settings popover」節: グループ並び順の変更、`close-book-group` 削除、`bookmark-io-group` 新設を反映
- 「両ファイル共通」機能リストに `openBtnClick` / `finalizeCurrentBook` / `revealControls` / `updateToolbarFade` を追加
- localStorage キー表: 変更なし

## 8. バージョン・タグ

- 両ファイルのバージョン表記を **v2.3.0** に更新
- コミット後 `git tag v2.3.0 && git push --tags`

## 9. テスト計画（手動）

| # | 確認項目 | 環境 |
|---|---|---|
| T1 | 本を開くと左上が「← リストへ」になり、押すと読みかけリストに戻る（位置保存済み） | PC / Android / iOS |
| T2 | 本を閉じた状態では「開く」でピッカーが出る。読書中に言語切替してもラベル・title が正しい | PC |
| T3 | 設定に「この本を閉じる」が無く、グループ順が §3 のとおり。しおり JSON 読込/書出が設定から動作 | PC / iOS |
| T4 | 幅 640px 以下でツールバー右端がフェードし、末端までスクロールすると消える | Android / iOS |
| T5 | 読書中に画面中央タップでナビボタン+進捗ピルが 3.5 秒表示。端寄りタップでは何も起きない | Android / iOS |
| T6 | フルスクリーン中の中央タップで「読書モード終了」ボタンも出る | Android |
| T7 | FXL 本: ズーム OFF 時の中央シングルタップで表示、ダブルタップは従来どおりズーム切替 | PC / iOS |
| T8 | テキスト選択直後のタップ（選択解除）でフラッシュが誤発動しない | PC |
| T9 | 本を開いたまま別の本を D&D / リストから開く → 旧本の位置が直前スクロールまで保存されている | PC |
| T10 | Escape: フォントピッカー → 設定 → サイドバー → フルスクリーンの順に 1 打 1 閉じ | PC |
| T11 | 内部リンク（目次アンカー等）のクリックが従来どおり動作（EPUB_TAP 追加のデグレなし） | 全環境 |
| T12 | ウェルカム画面（リスト有り/無し両方）の最下段に操作ガイドが表示されない。4 言語で確認 | PC / iOS |

## 10. 推奨実装順（コミット分割）

1. **§3 + A + 1b + §6** — 設定・ウェルカムの HTML 再構成と左上ボタン切替（HTML 整理をまとめて）
2. **§4** — `finalizeCurrentBook()`（小・独立）
3. **§5** — Escape チェーン（小・独立）
4. **§1a** — ツールバーフェード（小・独立）
5. **§2** — EPUB_TAP（iframe スクリプト・FXL タイマーに触るため最後に単独で）

各ステップ完了ごとに `python3 -m http.server 8080` で両ファイルの動作確認。iOS 版は LF 改行・本体は CRLF の規約に注意。
