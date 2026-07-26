# 表示設定 きめ細かい改善 概要設計書（v2.13.0 / v2.14.0）

対象: `yomikake.html`・`yomikake_ios.html` **両ファイル**（行番号は `yomikake.html` 基準・v2.12.0 時点。iOS 版は相当箇所に同一変更を適用）

背景: 表示設定まわりを「ユーザー目線でかゆいところに手が届く」水準に引き上げる。特にスマホでの
(1) OS のダーク／ライトに追従しない、(2) ツールバーのアイコンが多すぎて右端が切れる、
(3) 設定パネルが縦に長く片手で届かない、(4) 夜間に画面が眩しい、の 4 点を解消する。

## 0. スコープと確定済みの判断

| 弾 | 版数 | 内容 |
|----|------|------|
| 第1弾 | **v2.13.0** | A-1 OS テーマ連動 / A-2 ツールバー項目の表示切替 / B-4 テーマ名ラベル / B-6 スマホ設定のボトムシート化 / B-3 表示設定リセット |
| 第2弾 | **v2.14.0** | B-1 明るさ調整 / B-2 暖色フィルタ / B-5 設定グループの折りたたみ / B-9 全画面時の時計・進捗 HUD |
| 第3弾 | 未定 | B-7 本ごとの表示設定 / B-11 行間・字間の細分化 / B-12 読み上げ速度を設定にも / B-13 画面回転ロック（本書では §9 に概要のみ） |

**不採用（今回やらない）**
- **B-8 表示設定の Drive 同期／JSON 同梱** — 端末ごとに画面サイズ・DPI・フォント資産・OS が違い、「PC の設定が iPhone に降ってくる」ほうが害が大きい。表示設定は端末ローカルに閉じる方針を明文化する。
- **B-10 カスタムテーマ（色を自由選択）** — 先送り。将来やる場合は `THEME_CONTENT` に `custom` を 1 件足し、`state.themeCustom = {paper, text}` を持たせる形（本書では実装しない）。

**全体に効く方針**
- 追加する設定はすべて **`epub_settings` 1 キーへの追加**とし、`loadSettings()` では既存同様 `if (typeof s.x === ...)` のホワイトリスト検証を通す。旧ビルドは未知キーを無視するだけなので後方互換。
- 表示に関わる新 state のうち、**セッション限りにするものは 1 つも無い**（全部永続化）。ただし §7 のとおり「暗くしたまま忘れる」事故対策を入れる。
- 再描画が必要な変更はすべて既存 `rerenderKeepPos()`（`yomikake.html:5841`）に委譲する。TTS 再生中・FXL 中の扱いは既存 `changeTheme()` と同一経路になるので、新たな考慮は不要。

---

# 第1弾（v2.13.0）

## A-1. OS のダークテーマ連動

### A-1-1. 設計判断

- テーマチップに 9 個目の「自動」を足す案は**採らない**。暗い側に `dark`（純黒）を当てたいか `hoshi`（深いネイビー）を当てたいかは好みが割れ、明るい側も `''`／`sepia`／`white` で割れるため、**連動 ON/OFF ＋ 明暗ペアの指定**にする。
- **`state.theme` には常に「解決後の実効テーマ」が入る**。`THEME_CONTENT[state.theme]`（`yomikake.html:2599`）や `buildSrcdoc()` の色注入、`updateThemeBtnUI()` など既存コードはすべて `state.theme` を見ているため、ここに `'auto'` のような番兵値を入れると全経路に分岐が波及する。連動の有無は独立フラグ `themeAuto` で持つ。
- 連動 ON 中にテーマチップを直接押したら **`themeAuto` を自動的に OFF に落とす**。チップを `.set-row-disabled` にして押せなくする案は「なぜ押せないか」が伝わらないため不可。

### A-1-2. state（`yomikake.html:2530` の `state`）

```js
themeAuto:  false,   // OS のカラースキームに追従するか（epub_settings）
themeLight: '',      // 追従 ON・明るいとき に適用するテーマキー（epub_settings）
themeDark:  'dark',  // 追従 ON・暗いとき に適用するテーマキー（epub_settings）
```

`saveSettings()`（`:5103`）に 3 項目を追加。`loadSettings()`（`:5130`）は：

```js
if (typeof s.themeAuto === 'boolean') state.themeAuto = s.themeAuto;
if (typeof s.themeLight === 'string' && s.themeLight in THEME_CONTENT) state.themeLight = s.themeLight;
if (typeof s.themeDark  === 'string' && s.themeDark  in THEME_CONTENT) state.themeDark  = s.themeDark;
```

`in THEME_CONTENT` で検証すると `''`（標準）も正しく通る（`'' in obj` は true）。

### A-1-3. 共通化：`applyThemeClass(v)`

現状 `changeTheme()`（`:5863`）は `theme-*` クラスだけを差し替える正しい実装だが、`loadSettings()` は
`document.body.className = s.theme ? 'theme-' + s.theme : ''` と**丸ごと代入**していて実装が二重化している
（init 時のみ実行なので現状は実害なし）。ここを 1 本にまとめる。

```js
function applyThemeClass(v) {
  const cls = document.body.classList;
  Array.from(cls).forEach(c => { if (c.indexOf('theme-') === 0) cls.remove(c); });
  if (v) cls.add('theme-' + v);
  updateMetaThemeColor();
}
```

`changeTheme()` / `loadSettings()` / `applyAutoTheme()` の 3 箇所から呼ぶ。

### A-1-4. `<meta name="theme-color">` の追従

`yomikake.html:9` の `<meta name="theme-color" content="#fdf8f0">` は静的で、ダークテーマにしても
PWA のステータスバーが白いまま。テーマ変更に追従させる。

```js
function updateMetaThemeColor() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (!m) return;
  const c = THEME_CONTENT[state.theme] || THEME_CONTENT[''];
  m.setAttribute('content', c.paper);
}
```

`manifest.webmanifest` の `theme_color` は**触らない**（インストール時のスプラッシュ色。アイコン背景
`#FDF8F0` と一致させてある — CLAUDE.md の PWA アイコン節を参照）。

### A-1-5. メディアクエリ監視

```js
const _darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolveAutoTheme() {
  return (_darkMQ && _darkMQ.matches) ? state.themeDark : state.themeLight;
}

// 追従 ON のとき、OS 設定に合わせて state.theme を更新する。
// 変化が無ければ何もしない（起動時の無駄な再描画を避ける）。
function applyAutoTheme(rerender) {
  if (!state.themeAuto) return false;
  const v = resolveAutoTheme();
  if (v === state.theme) return false;
  state.theme = v;
  applyThemeClass(v);
  updateThemeBtnUI();
  if (rerender) rerenderKeepPos();
  return true;
}
```

登録（Init 末尾）。Safari 13 以前は `addEventListener` 非対応なのでフォールバックを持つ：

```js
if (_darkMQ) {
  const onSys = () => { if (applyAutoTheme(true)) saveSettings(); };
  if (_darkMQ.addEventListener) _darkMQ.addEventListener('change', onSys);
  else if (_darkMQ.addListener) _darkMQ.addListener(onSys);
}
```

**Init での適用順**: `loadSettings()` の直後、最初の `renderPage()`／`autoOpenLastBook()` より前に
`applyAutoTheme(false)` を 1 回呼ぶ（rerender 不要 — まだ何も描いていない）。

### A-1-6. UI（カラーグループ・`yomikake.html:747`）

テーマチップ行の下に 3 行追加。明暗セレクトは連動 ON のときだけ出す。

```html
<div class="set-row">
  <span class="set-label" data-i18n="settings.themeAuto">OS のテーマに連動</span>
  <button id="theme-auto-toggle" onclick="toggleThemeAuto()" style="…既存トグルと同じ inline style…">OFF</button>
</div>
<div class="set-row theme-auto-only">
  <span class="set-label" data-i18n="settings.themeLight">明るいとき</span>
  <select class="modern-select" id="theme-light-select" onchange="changeAutoTheme('light', this.value)">…8種…</select>
</div>
<div class="set-row theme-auto-only">
  <span class="set-label" data-i18n="settings.themeDark">暗いとき</span>
  <select class="modern-select" id="theme-dark-select" onchange="changeAutoTheme('dark', this.value)">…8種…</select>
</div>
```

CSS: `body:not(.theme-auto-on) .theme-auto-only { display:none; }`

```js
function toggleThemeAuto() {
  state.themeAuto = !state.themeAuto;
  document.body.classList.toggle('theme-auto-on', state.themeAuto);
  if (state.themeAuto) {
    // 追従 ON にした時点の見た目を明側/暗側の初期値として引き継ぐと自然
    if (_darkMQ && _darkMQ.matches) state.themeDark = state.theme; else state.themeLight = state.theme;
    syncAutoThemeUI();
    applyAutoTheme(true);
  }
  updateThemeAutoToggleUI();
  saveSettings();
}
function changeAutoTheme(side, v) {
  if (side === 'light') state.themeLight = v; else state.themeDark = v;
  applyAutoTheme(true);
  saveSettings();
}
```

`changeTheme(v)` の先頭に 1 行足して、チップ手動操作で連動を解除する：

```js
function changeTheme(v) {
  if (state.themeAuto) { state.themeAuto = false; document.body.classList.remove('theme-auto-on'); updateThemeAutoToggleUI(); }
  state.theme = v;
  applyThemeClass(v);
  updateThemeBtnUI();
  saveSettings();
  rerenderKeepPos();
}
```

### A-1-7. i18n キー（4 言語）

`settings.themeAuto` / `settings.themeLight` / `settings.themeDark`。
セレクトの option は既存の `theme.std` … `theme.tsuki` を `data-i18n` として再利用する。

---

## A-2. ツールバーのアイコン 表示/非表示

### A-2-1. 対象

| キー | 要素 | 備考 |
|------|------|------|
| `flash` | 目玉（`showNavHint()`） | **現在 id が無い → `id="flash-btn"` を付与** |
| `tts` | `#tts-btn` | `_ttsSupported === false` の環境では設定行ごと出さない |
| `readingData` | `#reading-data-btn` | |
| `fullscreen` | `#fs-btn` | |
| `help` | ヘルプ（`showHelp()`） | **現在 id が無い → `id="help-btn"` を付与** |
| `drive` | `#drive-download-btn` ＋ `#drive-upload-btn` | **2 ボタンで 1 キー**（片方だけ隠す意味がない） |
| `fxlZoom` | `#btn-fxl-zoom` | `.fxl-only` と併用 |

**隠せないもの**（動線が消えると復帰不能になるため）: 左上の「開く⇄リストへ」(`#open-btn`)・目次 (`#toc-btn`)・書名 (`#book-title`)・**設定 (`#settings-btn`)**。

### A-2-2. state と適用

```js
toolbarHidden: [],   // 非表示キーの配列（epub_settings）
```

```js
const TOOLBAR_ITEMS = [
  { key:'flash',       ids:['flash-btn'] },
  { key:'tts',         ids:['tts-btn'] },
  { key:'readingData', ids:['reading-data-btn'] },
  { key:'fullscreen',  ids:['fs-btn'] },
  { key:'help',        ids:['help-btn'] },
  { key:'drive',       ids:['drive-download-btn','drive-upload-btn'] },
  { key:'fxlZoom',     ids:['btn-fxl-zoom'] },
];

function applyToolbarPrefs() {
  const hid = state.toolbarHidden || [];
  TOOLBAR_ITEMS.forEach(it => {
    const off = hid.indexOf(it.key) >= 0;
    it.ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('tb-off', off); });
  });
  updateToolbarFade();   // ★必須：ボタン数が変わると右端フェードの要否が変わる
}
```

CSS: `.tb-off { display:none !important; }`

`!important` にするのは、`body.mode-fxl #tts-btn { display:none }`（`:371`）や `.fxl-only` の
既存ルールと競合したときに「隠す側」が必ず勝つようにするため。既存ルールは*表示*を強制していないので、
`.tb-off` が付いていれば常に非表示、外れていれば既存ルールが従来どおり効く。

`loadSettings()` での検証（未知キーの混入を防ぐ）：

```js
if (Array.isArray(s.toolbarHidden)) {
  const valid = TOOLBAR_ITEMS.map(i => i.key);
  state.toolbarHidden = s.toolbarHidden.filter(k => valid.indexOf(k) >= 0);
}
```

Init では `loadSettings()` 後に `applyToolbarPrefs()` を呼ぶ。

### A-2-3. UI

設定に **「ツールバー」グループ**を新設し、レイアウトグループの直後に置く（表示に関する設定の並びを保つ）。
7 行になるので、第2弾の B-5（折りたたみ）では**既定で閉じる**グループにする。

```html
<div class="set-group" id="toolbar-settings-group">
  <h4 data-i18n="settings.toolbarGroup">ツールバーに表示</h4>
  <div class="set-row" id="tbitem-flash">
    <span class="set-label" data-i18n="settings.tbFlash">👁 操作を見せる</span>
    <button class="tb-item-toggle" data-tbkey="flash" onclick="toggleToolbarItem(this.dataset.tbkey)">ON</button>
  </div>
  … 以下同様に tts / readingData / fullscreen / help / drive / fxlZoom …
</div>
```

- **インラインハンドラ規約**（CLAUDE.md）に従い、キーは `data-tbkey` 属性で渡す（文字列を直接
  `onclick` に埋め込まない）。
- `toggleToolbarItem(key)` は配列を出し入れして `applyToolbarPrefs()` ＋ `updateToolbarPrefsUI()` ＋ `saveSettings()`。
- `updateToolbarPrefsUI()` は各トグルの ON/OFF ラベル・`.on` クラスを同期し、
  **`_ttsSupported` が false なら `#tbitem-tts` を `display:none`**（その環境ではボタン自体が出ないため）。
- FXL ズーム行は常に出す（本を開いていなくても設定できてよい）。

---

## B-4. テーマ名をチップの下に表示

**問題**: テーマ名は `data-i18n-title`（`title` 属性）にしか無く、**タッチ端末では永久に読めない**。
8 個の色丸だけで「星空」「月夜」を判別しろというのは無理がある。

**変更**: テーマ行を縦積みにし、4×2 グリッドの各セルを「丸＋名前」にする。

```html
<div class="set-row set-row-stack">
  <span class="set-label" data-i18n="settings.theme">テーマ</span>
  <div class="theme-options">
    <div class="theme-cell" onclick="changeTheme('')" data-i18n-title="theme.std">
      <div class="theme-btn tb-std"><svg …/></div>
      <span class="theme-name" data-i18n="theme.std">標準</span>
    </div>
    … 8 個 …
  </div>
</div>
```

```css
.set-row-stack { flex-direction:column; align-items:stretch; gap:10px; }
.theme-options { display:grid; grid-template-columns:repeat(4,1fr); gap:10px 6px; }
.theme-cell { display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer; }
.theme-name { font-size:10px; line-height:1.2; text-align:center; color:var(--ui-text); opacity:.7; white-space:nowrap; }
```

- `.theme-btn` の `width/height/border-radius` はそのまま。`onclick` を**セル側に移す**（名前を押しても選べる）。
- `updateThemeBtnUI()`（`:5191`）は `.theme-btn` に `active` を付ける実装なので**変更不要**
  （`.tb-std` 等のクラスは維持する）。
- `grid-template-columns` を固定 `32px` から `1fr` に変えるため、popover 340px / スマホ全幅の
  どちらでも「標準・セピア・白紙・ダーク／さくら・星空・抹茶・月夜」が 4 列に収まる。
  中国語（繁/簡）のラベルも 2〜3 文字なので折り返さない。

---

## B-6. スマホでは設定をボトムシート化

**問題**: `#settings-popover` は `top:64px` から下向きに開く（`:51`）。スマホでは
`width:calc(100vw - 16px)`（`:663`）で縦に長く、**下のほうの項目に片手の親指が届かない**。

`@media (max-width: 640px)` 内の `#settings-popover` 指定を置き換える：

```css
#settings-popover {
  top:auto; bottom:0; left:0; right:0; width:100%;
  max-height:min(82dvh, calc(100dvh - 56px));
  border-radius:18px 18px 0 0;
  transform:translateY(16px);
}
#settings-popover.show { transform:translateY(0); }
.pop-body { padding-bottom:calc(12px + env(safe-area-inset-bottom, 0px)); }
```

- 既存の `transition:all .2s cubic-bezier(0.16,1,0.3,1)` がそのまま「下からせり上がる」動きになる。
- `#settings-overlay`（`.popover-overlay`）は変更なし（背景タップで閉じる導線は維持）。
- `.pop-header` の上に飾りのグラバーを 1 本入れる（スマホのみ表示）:
  `.pop-grabber { width:36px; height:4px; border-radius:2px; background:var(--ui-border); margin:8px auto 0; display:none; }`
  ＋ `@media (max-width:640px) { .pop-grabber { display:block; } }`。**ドラッグでの開閉は実装しない**
  （見た目の手がかりだけ。スワイプ実装は iOS の慣性と干渉するため見送り）。
- ドラッグ操作を付けない代わり、`max-height` を `82dvh` に留めて背景の本文を必ず覗かせ、
  「背景タップで閉じられる」ことを視覚的に示す。

---

## B-3. 表示設定を初期値に戻す

**対象**（表示に関わるものだけ）:
`fontMode` `fontSize` `lineHeight` `theme` `themeAuto` `themeLight` `themeDark` `margin`
`writingMode` `fwdBtnSize` `tapZone` `fontBold` `fontStrokeLevel` `spreadMode` `fxlZoomLevel`
`fxlRegionOrder` `fxlLtrAutoFlip` `toolbarHidden`
（第2弾で `brightness` `warmth` `fsHud` `setGroupsOpen` を追加）

**対象外**（明示的に触らない）: `autoOpenLast` / `ttsRate` / `ttsVoice` / `driveAutoSave` /
`epub_lang` / `epub_rl_prefs`（読みかけリスト設定）/ しおり `epub_pos_*` / ePub キャッシュ / ローカルフォント。

```js
const DISPLAY_DEFAULTS = {
  fontMode:'publisher', fontSize:100, lineHeight:2.0,
  theme:'', themeAuto:false, themeLight:'', themeDark:'dark',
  margin:'full', writingMode:'vertical', fwdBtnSize:'small', tapZone:'lshape',
  fontBold:false, fontStrokeLevel:0,
  spreadMode:'auto', fxlZoomLevel:2.0, fxlRegionOrder:'story', fxlLtrAutoFlip:true,
  toolbarHidden:[],
};

function resetDisplaySettings() {
  if (!confirm(t('settings.resetConfirm'))) return;
  Object.keys(DISPLAY_DEFAULTS).forEach(k => {
    const v = DISPLAY_DEFAULTS[k];
    state[k] = Array.isArray(v) ? v.slice() : v;
  });
  state.fxlZoom.level = state.fxlZoomLevel;
  syncAllSettingsUI();          // 下記
  saveSettings();
  rerenderKeepPos();
  showToast(t('toast.settingsReset'));
}
```

`syncAllSettingsUI()` は既存の同期関数を並べて呼ぶだけの薄いラッパにする
（`applyThemeClass` / `updateThemeBtnUI` / `syncAutoThemeUI` / `updateThemeAutoToggleUI` /
`updateFontPickerUI` / `applyMargin` / `applyFwdBtnSize` / `updateFontBoldToggleUI` /
`updateFontStrokeRowUI` / `syncFxlAxisModeUI` / `updateFxlLtrAutoFlipUI` /
`updateTapZoneBodyClass` / `applyToolbarPrefs` ＋ 各 `<select>` の `.value` 代入）。
**これは B-3 のためだけでなく、`loadSettings()` の後半と重複する処理をまとめる機会でもある**が、
`loadSettings()` は「保存値が無ければ触らない」意味論なので**統合はしない**（別関数として並存）。

配置は設定パネルの **最下部（言語グループの後）**。破壊的操作は下端に置く定石に従う。

```html
<div class="set-group" id="reset-group">
  <div class="set-row">
    <button id="settings-reset-btn" onclick="resetDisplaySettings()" data-i18n="settings.reset">表示設定を初期値に戻す</button>
  </div>
  <span style="font-size:11px;opacity:.6;line-height:1.5;padding:0 8px;" data-i18n="settings.resetHelp">
    しおり・キャッシュ・言語・読み上げ設定は変更されません
  </span>
</div>
```

i18n: `settings.reset` / `settings.resetHelp` / `settings.resetConfirm` / `toast.settingsReset`。

---

# 第2弾（v2.14.0）

## B-1 / B-2. 明るさ調整・暖色フィルタ

### 実装方式の決定

**CSS `filter` は使わない。半透明オーバーレイ 1 枚を重ねる。**

`filter: brightness()` を `#page-container` や `iframe` に掛けると新しい合成レイヤーが生まれ、
- `yomikake_ios.html` の **CSS transform スクロール**（`body { position:fixed; will-change:transform }`）
- FXL の **`#fxl-spread` への `translate()+scale()` ズーム**
- FXL 検索ハイライトの SVG オーバーレイ（`preserveAspectRatio` で幾何を一致させている）

のいずれとも干渉するリスクがある。オーバーレイ方式ならレンダリング経路に一切触れない。

### DOM と重ね順

`#reading-area`（`:181`・`position:relative`）の**最後の子**として追加する。

```html
<div id="screen-filter" aria-hidden="true"></div>
```

```css
#screen-filter {
  position:absolute; inset:0; pointer-events:none; z-index:15;
  background:
    linear-gradient(rgba(255,147,41,var(--warm-a,0)), rgba(255,147,41,var(--warm-a,0))),
    linear-gradient(rgba(0,0,0,var(--dim-a,0)), rgba(0,0,0,var(--dim-a,0)));
  transition:background .15s linear;
}
```

**z-index の根拠**（`#reading-area` 内の既存値）:

| 要素 | z-index |
|------|---------|
| `#page-overlay`（章遷移フラッシュ） | 10 |
| **`#screen-filter`** | **15** |
| `.chapter-btn` / `.scroll-btn` | 20 |
| `#tts-bar` | 40 |
| `#tap-guide-overlay` | 60 |
| `#tap-menu` | 70 |

→ **本文と FXL 画像だけを暗くし、操作系 UI（ナビボタン・TTS バー・タップガイド・メニュー）は暗くしない**。
暗い中で操作子まで見えなくなるのを避けるため。`#fxl-container` は `#page-container` の子で z-index 指定が
無く、`#page-container` 自身も `z-index:auto` なので、兄弟である `#screen-filter`(15) が正しく上に来る。
（実装時に DevTools で FXL・リフロー両方の重なりを実測確認すること。）

### state / UI

```js
brightness: 100,  // 30–100（%）5 刻み。100 = フィルタ無し（epub_settings）
warmth: 0,        // 0–5（0 = 無し）（epub_settings）
```

```js
function applyScreenFilter() {
  const dim  = Math.max(0, (100 - state.brightness) / 100) * 0.72;  // 30% で α≈0.50
  const warm = state.warmth * 0.05;                                  // 5 で α=0.25
  const rs = document.documentElement.style;
  rs.setProperty('--dim-a',  dim.toFixed(3));
  rs.setProperty('--warm-a', warm.toFixed(3));
  updateFilterIndicator();
}
```

- `brightness=30` で最大 α≈0.50 に留める（真っ黒にして「壊れた」と誤認させない）。
- カラーグループのテーマ行の下に 2 行。明るさは `<input type="range" min="30" max="100" step="5">`
  （`#jump-slider` のスタイルを流用）、暖色は同じく range（0–5）。**どちらも `oninput` で即時反映**
  （`rerenderKeepPos()` は不要 — CSS 変数だけで完結するのが本方式の利点）。
- 値は行の右に `92%` のように数値表示する。

### 「暗くしたまま忘れる」対策

`brightness < 100 || warmth > 0` のとき、**`#settings-btn` に視覚インジケータ**を出す。
既存の Drive 自動保存 ON 時に `#drive-upload-btn` へ `box-shadow:0 0 0 1.5px var(--ui-text)` を
付けている手法（`.auto-save-on`）と同じパターンを踏襲する。

```css
#settings-btn.filter-on { box-shadow:0 0 0 1.5px var(--accent); border-radius:8px; }
```

起動時トーストは出さない（毎回うるさい）。インジケータ ＋ B-3 のリセットで復帰可能。

---

## B-5. 設定グループの折りたたみ

**問題**: 設定パネルは現在 9 グループ・スマホで縦に非常に長く、下端の「言語」まで延々スクロールが要る。
第1弾で「ツールバー」（7 行）と「リセット」が増えるとさらに悪化する。

### 方式

`.set-group` を `<details class="set-group">` ＋ `<summary><h4>…</h4></summary>` に置き換える。

```css
.set-group > summary { list-style:none; cursor:pointer; display:flex; align-items:center; }
.set-group > summary::-webkit-details-marker { display:none; }
.set-group > summary::after { content:'▾'; margin-left:auto; margin-right:8px; opacity:.5; transition:transform .15s; }
.set-group[open] > summary::after { transform:rotate(180deg); }
```

### 既定の開閉と例外

| グループ | 既定 | 備考 |
|----------|------|------|
| カラー | 開 | |
| タイポグラフィ | 開 | `.fxl-hide-group` の `display:none` は `<details>` でもそのまま効く |
| レイアウト | 開 | |
| **FXL（`#fxl-settings-group`）** | **details 化しない** | `<h4>` を意図的に持たず「レイアウトの続き」として連続表示させる設計（CLAUDE.md 参照）。ここを畳めるようにすると設計意図が壊れる |
| ツールバー | 閉 | |
| 🔊 読み上げ | 閉 | |
| Google Drive | 閉 | |
| 🔖 しおりデータ | 閉 | |
| 📂 ePub キャッシュ | 閉 | ただし `updateCacheGroupUI()` は開閉に関係なく動く |
| 言語 | 閉 | set-once |
| リセット | details 化しない | 1 行なので畳む意味がない |

開閉状態は `epub_settings.setGroupsOpen = { color:true, typography:true, … }` に保存。
`toggle` イベントを各 `<details>` に 1 本ずつ張り、`saveSettings()` を呼ぶ。
`loadSettings()` はキーごとに `el.open = !!v` を代入（未知キーは無視）。

---

## B-9. 全画面時の時計・進捗 HUD

**問題**: 全画面（読書モード）にすると OS のステータスバーも `#statusbar` も消えるため、
**時刻も読了率も分からない**。長時間読書では「あと何分読めるか」を知りたい。

### DOM / CSS

`#fs-exit-btn` の隣（`body` 直下）に追加：

```html
<div id="fs-hud" aria-hidden="true"><span id="fs-hud-time"></span><span id="fs-hud-pct"></span></div>
```

```css
#fs-hud {
  position:fixed; right:14px; z-index:45; display:none; gap:10px;
  bottom:max(10px, env(safe-area-inset-bottom, 10px));
  font-size:11px; font-variant-numeric:tabular-nums; color:var(--ui-text);
  opacity:.38; pointer-events:none;   /* ★必須：下端は「次へ」タップ帯と重なる */
}
body.fullscreen #fs-hud { display:flex; }
```

- **`pointer-events:none` は必須**。`tapZone` が `lshape`/`tb` のとき下端はページ送り帯であり、
  HUD がタップを吸うと「ここだけ反応しない」死角ができる（タップガイドとの整合が崩れる）。
- 位置は**右下**。下端中央は `#btn-scroll-fwd`（モバイルで 120×40・`bottom:16px`）が占めるため。
- **バッテリー残量は含めない** — `navigator.getBattery()` は Chromium 限定で iOS Safari 非対応。
  片方の端末でだけ出る機能は入れない。

### state / 更新

```js
fsHud: 'both',   // 'off' | 'clock' | 'both'（epub_settings）
```

- 時刻は `toLocaleTimeString` の `{hour:'2-digit', minute:'2-digit'}`。
- 更新は **`body.fullscreen` の間だけ `setInterval` を arm し、解除時に `clearInterval`**（30 秒間隔）。
  `toggleFullscreen()` と `fullscreenchange` ハンドラの両方から `syncFsHud()` を呼ぶ
  （Layer2 の外部解除に追従するため）。
- 進捗は `updatePageInfo()` の末尾から `updateFsHudPct()` を呼び、既存の
  `(cur-1 + _intraChapterRatio) / (total-1)` と**同じ式**を使う（進捗バーと数字がズレないこと）。
- 設定 UI はレイアウトグループに 1 行（`<select>`: 表示しない / 時刻のみ / 時刻＋進捗）。

---

# 共通事項

## 7. 追加する `epub_settings` キー一覧

| キー | 型 / 範囲 | 既定 | 弾 |
|------|-----------|------|----|
| `themeAuto` | boolean | `false` | 1 |
| `themeLight` | `THEME_CONTENT` のキー | `''` | 1 |
| `themeDark` | `THEME_CONTENT` のキー | `'dark'` | 1 |
| `toolbarHidden` | string[]（`TOOLBAR_ITEMS` のキーのみ） | `[]` | 1 |
| `brightness` | number 30–100 | `100` | 2 |
| `warmth` | number 0–5 | `0` | 2 |
| `setGroupsOpen` | `{[groupId]: boolean}` | 上表のとおり | 2 |
| `fsHud` | `'off'｜'clock'｜'both'` | `'both'` | 2 |

すべて `loadSettings()` でホワイトリスト検証する。**`epub_settings` は Drive 同期にもしおり JSON にも
含めない**（B-8 不採用の帰結。端末ローカルに閉じる）。

## 8. 実装順とテスト

### 第1弾の推奨実装順（コミット単位）

1. `applyThemeClass()` 抽出 ＋ `updateMetaThemeColor()`（挙動不変のリファクタ。単独で検証できる）
2. A-1 OS テーマ連動
3. B-4 テーマ名ラベル（A-1 のセレクトと同じカラーグループを触るため連続で）
4. A-2 ツールバー項目（`flash-btn` / `help-btn` の id 付与を含む）
5. B-6 ボトムシート（CSS のみ）
6. B-3 リセット（新設定が出揃ってから最後に）

### 手動テスト観点

- **A-1**: OS のダーク切替 → 読書中に即反映され、**読書位置が保持される**こと（`rerenderKeepPos`）。
  連動 ON → チップ手動選択 → 連動が OFF に落ちること。連動 ON のまま再起動 → 起動時の OS 設定で開くこと。
  `file://` でも動くこと（メディアクエリはオリジン非依存）。
- **A-2**: 全部隠す → 目次・設定・左上ボタンが残ること。スマホで隠した直後に**右端フェードが消える**こと。
  FXL 本を開いて `#tts-btn` が二重に隠れても復帰時に正しく戻ること。
- **B-4**: 4 言語すべてでラベルが 4 列に収まり折り返さないこと。
- **B-6**: iOS Safari で下端セーフエリアに被らないこと。キーボード表示中（検索は別 UI なので影響無しの想定）。
- **B-3**: 実行後に**しおり・言語・キャッシュ・読み上げ設定が変わらない**こと。
- **第2弾 B-1**: リフロー／FXL／FXL ズーム中／iOS transform スクロール中の 4 状況でフィルタが
  正しく本文だけに掛かること。TTS バー・タップガイド・タップメニューが暗くならないこと。
- **第2弾 B-9**: `tapZone='lshape'` で右下 HUD 位置をタップして**ページが送れる**こと（`pointer-events:none` 確認）。

### 自動テスト

Playwright で検証可能なもの: `epub_settings` の保存・復元（全新キー）、`applyToolbarPrefs()` 後の
`display` 計算値、`matchMedia` をエミュレート（`page.emulateMedia({ colorScheme:'dark' })`）した
テーマ切替、`DISPLAY_DEFAULTS` へのリセット。
実機のみ: iOS のボトムシート挙動・セーフエリア、OS のテーマ自動切替（時刻連動）、
暗所での明るさ・暖色の実効。

## 9. 第3弾（設計は別途）

- **B-7 本ごとの表示設定** — `epub_book_prefs`（**しおり `epub_pos_*` とは別キー**）に
  `bookKey → {writingMode, fontSize, fontMode}` を持ち、`loadEpub()` で適用。
  「本ごとに覚える」トグルで ON/OFF。しおり JSON・Drive には**含めない**（B-8 と同じ理由）。
  縦書き小説 ⇄ 横書き技術書 ⇄ マンガの往復で毎回設定を直す手間が消える。
- **B-11 行間・字間** — `lineHeight` を 4 段階固定から 1.4–3.0 の連続値へ（既存 4 値は有効値のまま移行）。
  併せて `letterSpacing`（0〜0.2em）を追加。`buildSrcdoc()` の注入 CSS に 1 行足すだけ。
- **B-12 読み上げ速度を設定パネルにも** — 現在 `ttsRate` は `#tts-bar` からしか変更できず、
  設定の「🔊 読み上げ」グループには音声しか無くて非対称。行を 1 つ足すだけ（最小）。
- **B-13 画面回転ロック** — `screen.orientation.lock()` は **PWA インストール時の Android のみ**動作し、
  iOS Safari は非対応。`'lock' in screen.orientation` で**対応環境でだけ設定行を出す**こと。
  出しっぱなしにすると iPhone で「押しても何も起きない設定」になる。
