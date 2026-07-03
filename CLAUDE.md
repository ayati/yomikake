# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Two-file ePub 3 vertical-text viewer for reading Japanese publications. No build system — open the HTML file directly in a browser or serve via HTTP.

| File | Target |
|------|--------|
| `yomikake.html` | Chrome / Firefox / Edge (Windows, macOS, Android) and macOS Safari |
| `yomikake_ios.html` | iOS Safari (iPhone / iPad) only — uses CSS transform scroll instead of scroll APIs |

**External dependency:** JSZip 3.10.1, **inlined directly in both files** (a `<script>` block, v1.8.12+) so ePub unzip works fully offline / on `file://` — the cdnjs `<script src>` was removed from both. To update the inlined copy: replace the inline script body (just below the `<!-- JSZip v3.10.1 inlined ... -->` comment near the top of each file) with a freshly downloaded `jszip.min.js`; verify with `openssl dgst -sha512 -binary jszip.min.js | openssl base64 -A` against the SRI hash recorded in that comment. Keep the two files' inlined copies on the same JSZip version.

**Public deployment:** `https://www.ayati.com/book/yomikake.html` / `yomikake_ios.html` — this origin must be listed in the Google Cloud Console OAuth client's "Authorized JavaScript origins" for Drive sync to work in production.

**License:** MIT © 2026 N.Aono — see `LICENSE`.

**Feature differences between files:**
- Drag-and-drop file open: `yomikake.html` only
- File System Access API (direct file-reopen from reading list without new picker): `yomikake.html` only
- IndexedDB ePub Blob cache (直近の ePub 実体を IDB に保存し、オフライン／クラウド実体なしでもピッカー無しで再開): **both files** (v1.8.12+). `yomikake_ios.html` uses it as the sole reopen mechanism (no FSA); `yomikake.html` uses it as a **complement** to the File System Access handle — both are stored on open, and `openFilePickerForBook()` falls back handle.getFile() → IDB Blob → picker.
- Keyboard shortcuts (Space/arrows/Home/End): both files support Bluetooth keyboard; `yomikake_ios.html` also handles touch swipe inside the iframe
- Toolbar mouse-wheel scroll: `yomikake.html` only
- Google Drive bookmark sync: both files (requires HTTP server — Google Identity Services does not work on `file://`)
- Release tags follow `vX.Y.Z` convention (`git tag vX.Y.Z && git push --tags`)

## Development

No build step. To open the viewer:

```sh
# Option A: open directly in browser (bookmarks/localStorage work in file:// mode)
open yomikake.html          # macOS
xdg-open yomikake.html     # Linux

# Option B: serve via HTTP (useful when testing cross-origin behaviour)
python3 -m http.server 8080
# then visit http://localhost:8080/yomikake.html
```

There are no automated tests. Manual testing requires a `.epub` or `.kepub` file.

### Keeping both files in sync

Most features exist in both files. As a rule:
- **`yomikake.html` only**: drag-and-drop, toolbar mouse-wheel scroll, `SHARED_TAIL` (Chrome `text-combine-upright` fix), `isNeg()` sign detection in horizontal/publisher scroll.
- **`yomikake_ios.html` only**: CSS-transform scroll mechanism, touch swipe inside iframe, `CLICK_HANDLER` / `INIT_FN` template variables, double-rAF + 500ms `INIT_FN` timing, `will-change:transform` on body.
- **Both files**: all other features — rendering pipeline, postMessage protocol, i18n, settings, bookmarks, Drive sync, fullscreen, progress bar, full-text search, sidebar tabs, `_renderSeq`, `_isRendering` / `_pendingScrollAfterRender`, `_bookFinished`, chapter-end blank page, `flashOverlay()`, `flashNavButtons()`, `showResumeBanner()`, `showFinishedBanner()`, `showToast()`, `toggleSidebar()`, `buildReadingList()`, `formatRelativeDate()`, `extractCoverThumb()`, `saveBookMeta()`, `closeBook()`, `finalizeCurrentBook()`, `openBtnClick()`, `revealControls()`, `updateToolbarFade()`, `openFilePickerForBook()`, **Loading overlay** (`showLoading`, `showLoadingPreSelect`, `updateLoadingStage`, `hideLoading`, `_loadingShown`), FXL rendering (`renderFxlPair`, `buildFxlPairs`, `isEffectiveSpread`), **FXL コマ読みズーム** (`applyFxlZoom`, `applyFxlRegionPreset`, `clampFxlPan`, `getTargetPageRect`, `regionCellForIdx`, `resetFxlZoom`, `enableFxlZoom`/`disableFxlZoom`/`toggleFxlZoom`, `advanceFxlZoomStep`/`advanceFxlZoomSpine`, `handleFxlTap`, `regionIdxFromPoint`, `updateFxlNextBtnUI`, `updateFxlRegionPillUI`, `onFxlRegionPillClick`, `changeFxlZoomLevel`, `changeFxlRegionOrder`, `toggleFxlLtrAutoFlip`, `updateFxlLtrAutoFlipUI`, `FXL_REGION_ORDERS`), **FXL 軸モード（vfill / hfill）** (`isFxlAxisMode`, `applyFxlAxisPreset`, `getZoomStepMaxIdx`, `syncFxlAxisModeUI`, `_fxlAxisCache`, `_fxlAxisLandAtEnd`).

When fixing a bug or adding a feature that is not in the "only" lists above, apply the change to **both files**.

## Architecture

Each viewer is a single self-contained HTML file (`yomikake.html` ~5100 lines, `yomikake_ios.html` ~5145 lines). Both follow a modular functional style with a single central state object. The architecture below describes `yomikake.html`; `yomikake_ios.html` is identical except for the scroll mechanism (see iOS Viewer section below).

**Key locations in both files** (approximate — shift as code grows):

| Symbol | `yomikake.html` | `yomikake_ios.html` |
|--------|-------------------|----------------------|
| `GOOGLE_CLIENT_ID` | ~798 | ~789 |
| `I18N` translations | ~815 | ~806 |
| `state` object | ~1513 | ~1536 |
| `FONTS` / `FONT_URLS` / `FONT_GROUPS` | ~1578 / ~1607 / ~1631 | ~1595 / ~1624 / ~1647 |
| `loadEpub()` | ~1731 | ~1901 |
| `navigateToToc()` | ~1903 | ~2063 |
| `buildSrcdoc()` | ~2070 | ~2225 |
| `buildScrollScript()` | ~2214 | ~2354 |
| `SHARED_TAIL` (yomikake.html only) | ~2221 | — |
| `CLICK_HANDLER` / `INIT_FN` (ios only) | — | ~2370 / ~2384 |
| `_intraChapterRatio` | ~2553 | ~2746 |
| `renderPage()` | ~2565 | ~2757 |
| `handleIframeLink()` | ~3446 | ~3582 |
| `runSearch()` / `startSearch()` | ~3822 / ~3860 | ~3943 / ~3981 |
| `loadEpubFromCache()` (ios only) | — | ~4395 |
| `savePos()` | ~4500 | ~4554 |
| `driveAuth()` | ~4654 | ~4708 |

### State

```js
const state = {
  epub,             // JSZip instance
  opfPath,          // path to OPF file inside ZIP
  opfDir,           // directory prefix for opfPath
  spine[],          // chapter items in reading order
  manifest{},       // ePub manifest (id → resource path)
  toc[],            // table of contents entries
  currentSpineIdx,  // current chapter index
  bookTitle,        // from OPF dc:title
  bookCreator,      // from OPF dc:creator (multiple joined with ・)
  bookCoverDataUri, // base64 JPEG thumbnail (48×68px) extracted from OPF cover; '' if unavailable
  bookKey,          // localStorage key prefix: 'epub_pos_{title}_{spineCount}'
  writingMode,      // 'vertical' | 'horizontal' | 'publisher'
  fwdBtnSize,       // 'small' | 'medium' | 'large' — size of #btn-scroll-fwd
  driveFileId,      // cached Drive file ID for epub_bookmarks.json (session only)
  publisherAxis,    // 'h' (vertical-rl) | 'v' (horizontal-tb) | null — detected by EPUB_AXIS from iframe in publisher mode
  // UI preferences (persisted in epub_settings):
  fontMode,         // key into FONTS map — 'publisher' | 'mincho' | 'gothic' | 'meiryo' | 'serif' | 'sans' | 22 Google Fonts keys (e.g. 'noto-serif-jp', 'klee-one', 'lora' …)
  fontSize,         // 60–400 (percent, default 100)
  lineHeight,       // 1.6 | 2.0 | 2.4 | 2.8 (default 2.0)
  theme,            // '' | 'sepia' | 'white' | 'dark' | 'sakura' | 'hoshi' | 'matcha' | 'tsuki' (default '' = warm white)
  margin,           // 'full' | 'medium' | 'narrow' | 'none' (default 'full')
  driveAutoSave,    // boolean (default false) — auto-upload bookmarks on EPUB_POS events
  sidebarOpen,      // boolean (default false)
  fullscreen,       // boolean — not persisted; always false on startup
}
```

### Processing Pipeline

1. **File Load** — `loadEpub(file)` parses the ZIP, reads `META-INF/container.xml` to find the OPF, then builds `state.spine`, `state.manifest`, and `state.toc`.
2. **Resource Resolution** — `toDataUri(absPath)` converts images/CSS to base64 data URIs; `resolveCssText()` rewrites `url()` references inside stylesheets.
3. **Rendering** — `renderPage(idx)` calls `buildSrcdoc()` which processes XHTML (inlining all external resources), injects vertical-text CSS, and sets the iframe's `srcdoc`.
4. **Scroll Control** — an injected `buildScrollScript()` in the iframe handles RTL scroll via `postMessage` back to the parent; Chrome and Firefox differ in how they represent `scrollLeft` for RTL content.
5. **UI Feedback** — `showToast(msg)` displays a transient notification overlay. `showResumeBanner()` renders the welcome-screen hint when `epub_last_book` exists in localStorage; clicking it calls `resumeBook()`. `flashOverlay()` / `flashNavButtons()` give visual feedback on chapter load and initial open.

### Key Design Decisions

- **`srcdoc` injection** (not blob URLs) avoids same-origin/CORS issues with iframe content.
- **`postMessage`** bridges parent↔iframe scroll edge detection.
- **Writing mode** (`state.writingMode`) controls CSS injection in `buildSrcdoc()`: `'vertical'` forces `vertical-rl` + `padding-left:100vw`; `'horizontal'` forces `horizontal-tb` + `padding-bottom:100vh`; `'publisher'` injects no override and lets the ePub's own CSS control writing direction. `buildScrollScript()` receives `writingMode` and branches into three separate IIFE implementations (vertical RTL scroll, horizontal vertical scroll, publisher auto-detect).
- **`.kepub`** (Kobo ePub) is supported by treating it as a standard ZIP/ePub.
- **Settings popover** — display settings (font, size, line height, theme, margin, writing mode, forward-button size) live in a floating `#settings-popover` panel toggled by `toggleSettings()`, not in inline toolbar controls. `updateThemeBtnUI()` syncs the visual theme button state after loading settings. `applyFwdBtnSize(v)` updates `#btn-scroll-fwd` dimensions when `fwdBtnSize` changes (`'small'` / `'medium'` / `'large'`). The "次へボタン" row lives in the layout `set-group` and is **always visible** (both reflowable and FXL modes) since `#btn-scroll-fwd` is also used as the FXL ZoomStep advance button. Mode-specific hiding is done per-row via the `.fxl-hide-row` class (`body.mode-fxl .fxl-hide-row { display:none !important }`) on the writing-mode and margin rows, not on the whole group. `#fxl-settings-group` deliberately omits its own `<h4>` so the FXL-only rows render visually continuous under the same "レイアウト" header. **Group order** (v2.3.0): カラー → タイポグラフィ → レイアウト → FXL → Google Drive → 🔖 しおりデータ (`#bookmark-io-group`, JSON import/export moved out of the toolbar) → 📂 ePub キャッシュ → 言語 (moved to the bottom — set-once). There is **no** "この本を閉じる" group anymore; closing a book is the top-left toolbar button's job (see next bullet).
- **Top-left button dual role (`#open-btn` / `openBtnClick()`)** — when no book is open it opens the file picker (label 「開く」, `btn.open`); while a book is open it becomes 「リストへ」 (`btn.backToList`, arrow icon) and calls `closeBook()` to return to the reading list. `#open-btn` holds two SVGs (`.ob-icon-open` / `.ob-icon-back`) toggled by the `.reading` class. `updateCloseBookBtnVisibility()` is the single sync point: it toggles `.reading` and **rewrites the `data-i18n` / `data-i18n-title` attributes** so `applyI18n()` keeps the label correct across language switches while reading. Called from `loadEpub`, `closeBook`, and once at init. `finalizeCurrentBook()` (savePos + `driveSaveNow()`) is shared by `closeBook()` and the top of `loadEpub()` so switching directly to another book still persists the previous book's position and pending Drive auto-save (at `loadEpub` entry `state` still points at the old book).
- **Mobile toolbar right-edge fade** — under `@media (max-width:640px)` the toolbar is horizontally scrollable with hidden scrollbar; `updateToolbarFade()` toggles the `.tb-overflow` class (a `mask-image` right-edge fade) whenever more buttons remain off-screen to the right (`scrollWidth - clientWidth - scrollLeft > 4`). Called on toolbar `scroll`, window `resize`, and at the end of `applyI18n()` / `updateCloseBookBtnVisibility()` (label width changes). Above 640px the toolbar is not scrollable so the class self-clears.
- **`THEME_CONTENT` map** holds iframe content colors separately from CSS variables (which only apply to the outer UI). Theme changes re-render the current chapter.
- **Vertical mode height constraint** — `buildSrcdoc()` injects `height:100%!important; overflow-y:hidden!important;` on `html` and `height:100%!important; overflow-y:hidden!important; box-sizing:border-box!important; padding-bottom:<vertPad>!important;` on `body` for vertical mode. Without these, ePub CSS that leaves `height:auto` on html/body causes columns to grow beyond the viewport, producing a vertical scrollbar and clipping the last character. `vertPad` scales with `state.margin`: `1em` for `full`/`medium` (one full character worth of buffer — proven safe in v1.7.10 and restored after the scrollbar regression below), `max(0.5em,10px)` / `0.5em` for `narrow`, `max(0.25em,8px)` / `0.25em` for `none` (tight layout for users who opt in). The hover-dependent `max(..,Npx)` variants ensure the padding covers the 6px horizontal scrollbar reserved on PC (see next bullet). **Publisher mode** with axis 'h' (vertical-rl) applies the same body padding-bottom at a later stage: `applyInit()` in `buildScrollScript()` computes `pubVertPad` from `state.margin` at code-generation time and bakes it into the injected style string. `yomikake_ios.html` vertical mode uses `body { position:fixed; top:0; bottom:0 }` + CSS transform scroll and needs no padding-bottom for vertical mode itself; however publisher mode applies `padding-bottom` in `detectAxis()` when axis='h'.
- **Vertical-mode horizontal scrollbar (PC-only)** — in vertical-rl, block direction is horizontal so the iframe overflows horizontally. On PC (`@media (hover:hover)`) `html::-webkit-scrollbar{height:6px}` reserves a 6px horizontal scrollbar track at the bottom (thumb is transparent at rest and fades in on hover via `html:hover::-webkit-scrollbar-thumb`) so the reader can see their chapter-internal position. On touch (`@media (hover:none)`) the scrollbar is hidden with `display:none` + `scrollbar-width:none`. Because the 6px track eats into `html.content_height` (and therefore into `body.height:100%`), `padding-bottom` must be large enough to cover both character overshoot AND the scrollbar; see the previous bullet. A historical regression appeared when PC scrollbar reservation was added while padding stayed at `0.5em` (=8px), leaving only ~2px of effective buffer — see v1.7.10 commit for the original fix.
- **`buildScrollScript()`** returns a self-contained IIFE string baked into the iframe. The **vertical** mode uses `window.scrollX` / `window.scrollTo()` instead of `scrollLeft`, so no browser sign-convention detection (`isNeg`) is needed: `scrollX=0` at reading start (right edge) and increases in the reading direction on both Chrome and Firefox. `doScroll` checks at the **top** whether we are already in the blank zone (from a prior scroll) and fires `EPUB_EDGE` then; otherwise it scrolls one page and, if past `contentMax`, lands on the blank page (without firing `EPUB_EDGE` yet). The horizontal and publisher modes still use `scrollLeft` with `isNeg()` detection.
- **iOS Safari scroll compatibility** — injected CSS sets `html { height:100%; overflow:hidden; writing-mode:horizontal-tb }` and `body { position:fixed; top:0; bottom:0; writing-mode:vertical-rl; width:max-content }`. Three constraints: (1) `height:100%` (not `100vh`) — iOS Safari resolves `100vh` to full screen height including address bar, making columns too tall; (2) `overflow-x` is NOT set to `auto` — setting `overflow-x:auto` causes iOS to use an LTR CSS scroll container where the initial position is scrollLeft=0 (left edge = RTL content end = blank); (3) **`html { writing-mode:horizontal-tb !important }`** — ePubs can place `writing-mode:vertical-rl` as an inline style on the `<html>` element. iOS Safari then interprets `position:fixed; top:0; bottom:0` on body in the html's *logical* coordinate system (block direction = horizontal), constraining body's physical *width* instead of its *height*. Body height becomes unconstrained → text never wraps to columns → `body.offsetWidth ≈ vw()` → `ms=0` → every scroll immediately fires `EPUB_EDGE`. Forcing html to `horizontal-tb` (which `!important` in an author stylesheet overrides even inline styles) makes top/bottom use physical coordinates. Body's `writing-mode:vertical-rl !important` is explicit and independent, so content still renders vertically. Publisher mode is unaffected: body inherits writing-mode from the ePub's body CSS, which is not overridden.
- **`window.scrollTo()` instead of `scrollLeft` assignment** — `document.documentElement.scrollLeft = X` is silently ignored inside iOS Safari iframes (confirmed via diagnostics: probe=0 after setting 9999999). `window.scrollTo(x, 0)` works correctly. All scroll operations use `window.scrollTo`; `window.scrollX` is used for reading (falls back to `scrollLeft` for browsers that don't support `scrollX`).
- **`document.documentElement.scrollWidth`** — the document root correctly reports `scrollWidth` including left-side (RTL/vertical-rl) overflow in all browsers. A wrapper `div` with `overflow-x:auto` does NOT include left-side overflow in its `scrollWidth`, causing `scrollWidth == clientWidth` always, making every scroll immediately trigger `EPUB_EDGE`. Always use `document.documentElement.scrollWidth` for measuring content width.
- **`flashOverlay()`** adds a 150ms CSS flash on `#page-overlay` at the very start of each `renderPage()` call to give visual feedback during chapter transitions. It does not wait for content to load.
- **`flashNavButtons()`** is called (1) after `renderPage` completes on ePub open, and (2) after `closeModal()` closes the help dialog. It flashes all 4 nav buttons with accent color for 3.5 seconds to help users discover the controls. All buttons including `#btn-scroll-fwd` are handled via the `.nav-hint { background:var(--accent) !important }` CSS class — the `!important` overrides the ID-level `background` rule without needing inline styles.
- **Fullscreen reading mode (`toggleFullscreen()`)** — ツールバー・ステータスバーを非表示にして読書エリアを全画面表示する。`body.fullscreen` クラスを付与し、`#toolbar` / `#statusbar` を `position:fixed; top/bottom:-200px; opacity:0` で画面外に退避させる（`position:fixed` により flex フローから外れるため `#main` が自動的に 100dvh に拡張される）。ブラウザ API (`requestFullscreen`) に対応している環境では Layer2 として合わせて適用。iOS Safari では Layer2 が非対応のため Layer1（アプリ UI 非表示）のみ動作する。`#fs-exit-zone`（上端 16px のホットゾーン）をタップすると `#fs-exit-btn`（上端からスライドインするボタン）が 2 秒間表示され、タップで解除できる。Android バックボタンは `history.pushState` + `popstate` イベントで対応。`fullscreenchange` イベントで Layer2 の外部解除を Layer1 に同期する。キーボードショートカット `f` でトグル。`Escape` は優先度チェーン（フォントピッカー `open` → 設定ポップオーバー `show` → サイドバー → フルスクリーンの順に、1 打で 1 つだけ閉じる）で解除される。フルスクリーン移行時にサイドバー・設定ポップオーバーを強制クローズする。`state.fullscreen` は `localStorage` に保存しない（常に通常モードで起動）。両ファイル共通実装。
- **Android touch device visibility (`@media (hover:none) and (pointer:coarse)`)** — only `#btn-scroll-fwd { opacity:.22 }` is set. `.chapter-btn` intentionally has **no** opacity or stroke override here, so it remains at `opacity:0` / `stroke:transparent` (base values) — same as `.scroll-btn` (`#btn-scroll-back`). The key: `#btn-scroll-fwd` is barely visible at `.22` but its SVG `stroke` stays `transparent`, so only the container is faintly present with no visible shape. If `.chapter-btn svg { stroke:var(--ui-text) }` were added alongside `opacity:.3`, the `‹›` shapes would appear — distracting during reading. The `#btn-scroll-fwd { opacity:.22 }` rule wins over `.scroll-btn { opacity:.9 }` in the narrow-screen rule because ID selector specificity beats class selector specificity. (`yomikake_ios.html` uses `@media (hover:none)` and explicitly sets `.chapter-btn { opacity:.3 }` and `.chapter-btn svg { stroke:var(--ui-text) }` — a deliberate difference for the iOS-only file.)
- **Android Chrome sticky `:hover` bug** — Android Chrome makes `:hover` states "sticky": tapping `#page-container` (the reading area) keeps it in `:hover` state until the next tap elsewhere. Any `#page-container:hover .chapter-btn { opacity:.8 }` rule would therefore remain permanently active after the first touch, causing `‹`/`›` to stay visible even after `nav-hint` is removed. Fix: the `@media (max-width:640px)` rule does NOT set `opacity` on `.chapter-btn` or `.scroll-btn`, and `#page-container:hover` opacity overrides are placed exclusively inside `@media (max-width:640px) and (hover:hover)` — which excludes all touch devices. On Android, opacity comes only from the `(hover:none) and (pointer:coarse)` rule (`.3`), which has no `:hover` selector and thus is immune to sticky hover.
- **`scrollPage()` calls `blur()`** on any focused nav button before sending the scroll postMessage. Without this, clicking `#btn-scroll-fwd` then pressing a keyboard scroll key leaves the button with a persistent `:focus-visible` border (since `#btn-scroll-fwd` has a always-present `border:1px solid` at the ID level).
- **`prevChapter()` uses `'start'`** as the scroll target. `'end'` is reserved for automatic chapter transitions triggered by scrolling past the chapter boundary (so the reader lands at the end of the previous chapter, matching scroll direction). Explicit chapter button navigation always starts at the beginning.
- **Chapter-end blank page** — `buildSrcdoc()` injects a blank end-page via padding: `padding-left:100vw` for vertical mode (blank space at physical left = reading end), `padding-bottom:100vh` for horizontal mode (blank space at bottom). `buildScrollScript()` accounts for this by using `sw - 2*vw` (vertical) or `sh - 2*vh` (horizontal) as the real content range. `doScroll` fires `EPUB_EDGE` when the scroll position is 2+ px into the blank zone, so the prior scroll shows the last content alongside blank — the intended UX. `yomikake_ios.html` uses the same "one step of blank" pattern via CSS-transform: `tx > 0` is the blank zone; `setTx(Math.min(tx + step, step))` caps blank travel at one step; `EPUB_EDGE` fires when `tx >= 2`. **`'publisher'` mode** cannot inject padding at CSS time (axis is unknown until layout). Instead, `applyInit()` detects the writing-mode via `getComputedStyle`, injects `html{padding-left:100vw!important}` or `html{padding-bottom:100vh!important}` via a `<style>` element, resets `_neg = null` (the sign cache may have been set when `sw <= vw` before padding), then uses the same `sw - 2*vw` / `sh - 2*vh` range arithmetic as the dedicated modes. For `yomikake_ios.html` publisher mode, the same blank-zone fix is applied: `tx` is allowed to go up to `+step` (dir=1 EPUB_EDGE fires at `tx >= 2`) and `ty` to `ms + step` (EPUB_EDGE at `ty >= ms + 2`).
- **`text-combine-upright` initial-paint fix** — Chrome/WebKit has a rendering bug where `text-combine-upright: all` spans (縦中横, e.g. `<span class="tcy">DLC</span>`) are placed to the left of center on the very first paint in vertical writing mode. The fix: after `applyInit()` sets the scroll position, a synchronous `visibility:hidden` → `offsetWidth` (layout flush) → `visibility:""` cycle forces the engine to re-resolve tcy positions before painting. Because JS blocks the paint thread, this is invisible to the user. In `yomikake.html`, this runs in `SHARED_TAIL`'s `init`. In `yomikake_ios.html`, the same fix is embedded in `INIT_FN`'s `runApplyInit()` — both files now apply it.
- **Bookmark save on chapter start** — `renderPage()` calls `savePos()` immediately after updating `state.currentSpineIdx`, before any async operations. This ensures the new chapter's starting position is persisted even if the app closes before the iframe fires `EPUB_POS`. The ratio saved is `0` for `'start'`, `1.0` for `'end'`, or the numeric ratio as-is. Without this, `applyInit()` setting `scrollLeft=0` on a fresh iframe (where the browser's initial `scrollLeft` is also 0) produces no `scroll` event, so the debounced `reportPos()` never fires and the previous chapter's end position remains in localStorage.
- **`EPUB_POS` guard during rendering** — the `EPUB_POS` message handler ignores messages while `_isRendering` is `true`. This prevents a stale debounced `reportPos()` from the OLD iframe (which may fire up to 500 ms after the last scroll in the old chapter) from overwriting the newly-saved chapter-start position with an incorrect ratio using the already-updated `state.currentSpineIdx`.
- **`_renderSeq` (render sequence counter)** guards against race conditions when `renderPage` is called rapidly. Each call captures the current sequence number; after each `await`, the function checks if a newer call has started and returns early if so. This ensures only the last-requested chapter is rendered.
- **`_isRendering` / `_pendingScrollAfterRender` (double-tap chapter-end fix)** — `_isRendering` is set to `true` at the start of `renderPage` and stays `true` until the new iframe's `applyInit()` fires. While `_isRendering` is true, `EPUB_EDGE` is queued in `_pendingScrollAfterRender` instead of advancing the chapter. After `iframe.srcdoc` is committed, the iframe sends `EPUB_READY {seq}` (from inside the 80ms setTimeout in `SHARED_TAIL` / `runApplyInit` in `INIT_FN`) once `applyInit()` completes. The parent's `EPUB_READY` handler verifies the seq matches `_renderSeq` (to ignore stale messages from superseded renders), then clears `_isRendering` and calls `scrollPage(pendingDir)` if needed. **Why not `load` event:** the old approach fired `scrollPage` on the iframe `load` event, before `applyInit()` ran. On iOS, `body.offsetWidth` is 0 at `load` time (layout not yet settled), so `maxS()=0` and `doScroll` immediately fired `EPUB_EDGE`, causing a chapter skip for any chapter. **Why not `_isRendering=false` after srcdoc:** the race window between srcdoc assignment and `applyInit()` completion is where stray `EPUB_EDGE` messages from old-iframe postMessage backlog or premature new-iframe `doScroll` could cause a second chapter advance.
- **XHTML self-closing `<script>` preprocessing** — `buildSrcdoc()` preprocesses `xhtmlText` before passing to `DOMParser('text/html')`. XHTML uses self-closing syntax `<script src="..."/>` which is valid XML. The HTML5 parser ignores the `/>` and treats `<script>` as an unclosed element, consuming everything up to `</script>` (including `</head>`, `<body>`, and all page content) as raw text — producing an empty `<body>` (blank page). Fix: `xhtmlText.replace(/<(script|style)(\s[^>]*)?\s*\/>/gi, ...)` converts to `<script ...></script>` before parsing. This is the root cause of blank pages in manga/fixed-layout ePub files that include `<script src="..."/>` (e.g., Kobo ePub with kobo.js).
- **SVG `<image>` resolution** — `buildSrcdoc()` resolves not only `<img src>` but also SVG `<image xlink:href>` and `<image href>` elements (used by manga/image-only ePub). `getAttributeNS('http://www.w3.org/1999/xlink', 'href')` is tried first (namespace-aware HTML5 parsing of inline SVG), with `getAttribute('xlink:href')` as fallback. Both `xlink:href` and `href` attributes are set on the resolved element for ePub2/ePub3 compatibility. The override CSS includes `svg{max-width:100%!important;max-height:95vh!important;}` to scale down full-page SVG containers.
- **Publisher mode height reset** — In `publisher` mode, `wmHtml` and `wmBody` add `height:100%!important` to both `html` and `body`. This prevents ePub-specific fixed em-height constraints (intended for dedicated reader viewports) from collapsing column height to 1 character in vertical-rl layout.
- **`zip.file()` null checks** — `state.epub.file(absPath)` can return null if the ePub ZIP is missing a declared file. `renderPage` shows a toast and aborts; `loadEpub` skips TOC parsing (the book still opens without a table of contents).
- **Progress bar (`#progress-bar` / `#progress-fill`)** — lives in `#statusbar`. `updatePageInfo()` sets `#progress-fill` width using `_intraChapterRatio` for smooth intra-chapter progress: `pct = Math.min(100, (cur-1 + _intraChapterRatio) / (total-1) * 100)`. `_intraChapterRatio` (module-level, 0–1) is updated from each `EPUB_POS` message and reset to `0` at the start of `renderPage()`. For vertical mode, `marginLeft:auto` makes the bar fill from the right (RTL reading direction). An IIFE after `updatePageInfo()` wires click-to-jump and mousemove-tooltip: `ratioFromEvent()` converts `clientX` to a spine ratio (inverted for vertical), `idxFromRatio()` maps ratio to spine index. Tooltip text uses i18n key `progress.tooltip`; `#progress-tooltip` is `position:fixed` so it is not clipped by `overflow:hidden` on `#progress-bar`.
- **Anchor/fragment navigation** — `renderPage(idx, scrollTarget)` accepts `scrollTarget` as `'start'`, `'end'`, a numeric ratio, or a `'#anchorId'` string. `navigateToToc()` and `handleIframeLink()` extract the `#fragment` from href and pass it as `scrollTarget`. Inside `buildScrollScript()`, `applyInit()` detects `initTarget.charAt(0)==='#'`, looks up the element via `getElementById` then `getElementsByName`, and scrolls to it. In `yomikake.html`: `el.scrollIntoView({behavior:"instant",block:"start",inline:"nearest"})` works for all writing modes. In `yomikake_ios.html` (CSS transform): vertical uses `setTx(max(-ms, min(0, vw()-el.getBoundingClientRect().left)))`, horizontal uses `setTy(max(0, min(ms, el.getBoundingClientRect().top)))` — both read `getBoundingClientRect()` before any transform is applied (when `tx=0`/`ty=0`).
- **Font settings UI** — `#font-picker` is a grouped custom dropdown (not a `<select>`). `FONT_GROUPS` defines the display hierarchy; `FONT_URLS` maps web-font keys to Google Fonts `@import` URLs; `FONT_SAMPLE` holds per-language preview text. `toggleFontPicker()` opens/closes the dropdown; `buildFontPickerList()` renders the grouped HTML on open; `selectFont(key)` applies the choice and triggers re-render. `loadPreviewFonts()` injects a combined Google Fonts `<link>` for all web-font entries so the picker previews render in the correct typeface. `updateFontPickerUI()` syncs the button label to the current `state.fontMode`.
- **Full-text search** — `#sidebar` has two tabs (`#tab-toc` / `#tab-search`) toggled by `switchSidebarTab(tab)` (module-level `_sidebarTab` tracks current tab). The search tab contains `#search-input` and `#search-results`. `startSearch()` reads the input, increments `_searchSeq`, and calls `runSearch(query, seq)`; `runSearch()` iterates spine items, strips HTML tags, matches the query string, calls `appendSearchResult(spineIdx, snippets, extra)` for each hit, and checks `seq !== _searchSeq` after each item to abort superseded searches. `resetSearch()` increments `_searchSeq` (cancels in-progress search) and clears results. `navigateFromSearch(spineIdx)` calls `pushJumpHistory()` then `renderPage()` and closes the sidebar. `updateSearchProgress(current, total)` updates the progress indicator and cancel button. `_searchAbort` is kept for backward compatibility but `_searchSeq` is the active cancellation mechanism.

### iOS Viewer (`yomikake_ios.html`)

iOS Safari silently ignores both `document.documentElement.scrollLeft` assignment and `window.scrollTo()` inside iframes, so `yomikake_ios.html` uses a completely different scroll mechanism — **CSS `transform`** — inside `buildScrollScript()`:

- `body { position:fixed; writing-mode:vertical-rl; width:max-content; will-change:transform }` expands all columns into a single body-width block. `will-change:transform` forces GPU compositing and prevents partial-render artifacts on iPad (without it, `position:fixed` + CSS `transform` causes incomplete paints during drag scroll).
- `body.style.transform = 'translateX(px)'` slides the content to simulate page turns.
- No scroll API is called anywhere; swipe gesture (`touchstart`/`touchend`) inside the iframe replaces button/keyboard scroll for content navigation.
- `EPUB_SCROLL`, `EPUB_EDGE`, `EPUB_POS`, and `EPUB_LINK` postMessage protocol is otherwise identical to the main viewer.
- **`detectAxis()` in publisher mode** — publisher mode cannot know writing-mode at CSS injection time. `buildSrcdoc()` injects `body { position:fixed; top:0; bottom:0; left:0; right:0; min-width:100vw; max-width:none; min-height:100vh; max-height:none }` as a neutral starting point — body is initially 100vh × 100vw, invisible (`opacity:0`). `detectAxis()` (called from `applyInit()`) reads `getComputedStyle(body).writingMode`, then releases one axis constraint via inline `!important` style (which wins over stylesheet `!important` per CSS cascade). For 'h' axis (vertical-rl): sets `body { right:auto; width:max-content; min-width:100vw; box-sizing:border-box; padding-bottom:<pubVertPad> }` — releases the `right:0` constraint so body grows horizontally while `top:0+bottom:0` keeps height at 100vh, forcing column wrapping; `padding-bottom` prevents the last character from being clipped at the viewport bottom (same issue as vertical mode). For 'v' axis (horizontal-tb): sets `body { bottom:auto; height:max-content; min-height:100vh }` — releases `bottom:0` so body can grow vertically while `left:0+right:0` keeps width at 100vw. `pubVertPad` is computed from `state.margin` at code-generation time in `buildScrollScript()` and baked into the IIFE string — no `isHoverDevice` distinction (iOS has no horizontal scrollbar). This approach avoids the previous `height:max-content` initial layout (which caused iOS Safari to apply automatic text-size inflation before column wrapping was established). `-webkit-text-size-adjust:100%` is also injected on html as a secondary safeguard against iOS auto text scaling.
- **`CLICK_HANDLER` / `INIT_FN` template variables** — at the top of `buildScrollScript()`, two shared template literal strings are defined and interpolated (`${CLICK_HANDLER}`, `${INIT_FN}`) into all three scroll mode IIFEs (vertical, horizontal, publisher). `CLICK_HANDLER` intercepts `<a>` clicks inside the iframe and routes them to `window.open` or `EPUB_LINK`; `INIT_FN` wraps the `applyInit` call with the double-rAF + 500ms fallback pattern. This avoids duplicating these blocks across three separate string literals.
- **`INIT_FN` timing (iPad fix)** — on iPad, `body.offsetWidth` is read before `writing-mode:vertical-rl` layout completes, causing `maxS()=0` and content positioned off-screen. The fix uses a double-rAF (fast path for iPhone) plus a `setTimeout(runApplyInit, 500)` fallback (ensures layout is complete on iPad). A `_initApplied` flag prevents the second call from resetting the reading position if the first already succeeded. `runApplyInit` also runs the visibility:hidden → layout flush (tcy fix) and fires `EPUB_READY`:
  ```js
  var _initApplied = false;
  function runApplyInit(){
    if(_initApplied) return; _initApplied = true; applyInit();
    var _d = document.documentElement;
    _d.style.visibility = 'hidden'; _d.offsetWidth; _d.style.visibility = '';
    window.parent.postMessage({type:'EPUB_READY',seq:N},'*');
  }
  function run(){
    requestAnimationFrame(function(){ requestAnimationFrame(runApplyInit); });
    setTimeout(runApplyInit, 500);
  }
  ```
- **Touch device visibility (`@media (hover: none)`)** — chapter nav buttons and `#btn-scroll-fwd` are slightly visible on all touch devices (opacity `.3` / `.22`) so users can find them. This media query applies to both iPhone and iPad regardless of viewport width.
- **`sidebarOpen: false`** default — both files start with the sidebar hidden. iOS viewer sidebar div has `class="hidden"` in HTML.

### postMessage Protocol

| Type | Direction | Payload |
|------|-----------|---------|
| `EPUB_SCROLL` | parent → iframe | `{direction: 1\|-1}` |
| `EPUB_EDGE` | iframe → parent | `{direction: 1\|-1}` triggers chapter change |
| `EPUB_POS` | iframe → parent | `{ratio: 0–1}` triggers bookmark save (debounced 500 ms) |
| `EPUB_LINK` | iframe → parent | `{href: string}` internal link clicked; parent resolves to spine index |
| `EPUB_AXIS` | iframe → parent | `{axis: 'h'\|'v'}` sent by publisher-mode iframe from `applyInit()`; parent stores in `state.publisherAxis` for `isVerticalAxis()` |
| `EPUB_READY` | iframe → parent | `{seq: number}` sent by iframe after `applyInit()` completes; parent clears `_isRendering` and applies any pending scroll |
| `EPUB_TAP` | iframe → parent | `{xr: 0–1, yr: 0–1}` tap position ratio, sent when a non-link tap occurs in the iframe (text-selection taps excluded). Parent's `revealControls()` fires only when the tap is within the center ±`CENTER_TAP_RATIO` (0.2) box, briefly showing nav buttons (`flashNavButtons()`) + the fullscreen-exit button. FXL mode has no iframe, so `handleFxlTap()` runs an equivalent 320 ms single-tap-confirm timer (canceled by a 2nd tap = zoom toggle) and calls `revealControls()` itself. |

### Internationalization (i18n)

Both files support **4 languages**: `ja` (Japanese), `en` (English), `zh-TW` (Traditional Chinese), `zh-CN` (Simplified Chinese).

- **`const I18N`** — flat key-value translation dictionary at the top of `<script>`, defined separately in each file (iOS version has different strings for `app.title`, `btn.prev/next/scrollBack/scrollFwd`, `resume.hint`, `welcome.*`, `statusbar.keyHint`, `help.body`).
- **`let _lang`** — current language code (module-scope variable).
- **`t(key, vars?)`** — translation lookup with `{placeholder}` substitution; falls back to `ja` if a key is missing in the active language.
- **`initLang()`** — reads `epub_lang` from `localStorage`, then auto-detects from `navigator.language`; called first in the Init block before `applyI18n()`.
- **`setLang(lang)`** — switches language, saves to `localStorage`, calls `applyI18n()`, and calls `updateHelpContent()` if the help modal is open.
- **`applyI18n()`** — scans DOM for `data-i18n` (sets `textContent` or `innerHTML` when `data-i18n-html` is also present) and `data-i18n-title` (sets `title` attribute); updates `<html lang>`, `document.title`, and `#book-title` (only when no book is open); syncs all `.lang-select` values.
- **`updateHelpContent()`** — builds the help modal body from translation keys; separated from `showHelp()` so language can be switched while the modal is open.
- **Language selector** — a `<select class="lang-select">` in the toolbar (right end) and one in the settings popover Language group. Option text is native language names (not translated). Both selects are synced via `applyI18n()`.
- **`epub_lang`** localStorage key stores the selected language independently from `epub_settings`.

### localStorage Keys

| Key | Content |
|-----|---------|
| `epub_pos_{title}__{creator}` | `{spineIdx, ratio, lastOpenedAt, creator, spineCount, cover?}` — reading position + book metadata written by `saveBookMeta()` on open and `savePos()` on scroll/chapter change. Separator is **double underscore** (v1.8.11+). |
| `epub_last_book` | `{title, bookKey}` — for the resume banner |
| `epub_settings` | `{fontMode, fontSize, lineHeight, theme, margin, writingMode, fwdBtnSize, driveAutoSave}` |
| `epub_lang` | selected UI language (`ja` / `en` / `zh-TW` / `zh-CN`) |
| `epub_consolidate_v1` | one-shot flag set after `consolidateBookmarks()` runs once at startup |

Bookmark key uses OPF title + creator (v1.8.11+, was title + spineCount before). The new scheme means **the same Web 連載 novel re-downloaded with more chapters is recognised as the same book** — re-opening the new file resumes from the last-read position. Moving or renaming the file does not break saved positions either. `makeBookKey(title, creator)` and `parseBookKey(key)` are the single source of truth for key construction/parsing; both files use double underscore (`__`) as separator since title may contain single underscores. `parseBookKey()` handles both formats — new (`...__{creator}`) and legacy (`..._{spineCount}`) — by checking for `__` first.

**Migration paths** (legacy `_{spineCount}` keys → new `__{creator}` keys):
- **`consolidateBookmarks()`** runs once at startup (gated by `epub_consolidate_v1` flag). Groups all `epub_pos_*` keys by `(title, creator)`, picks the entry with highest progress (`spineIdx + ratio`), tie-broken by `lastOpenedAt`, writes it under the new key format with `spineCount` preserved in the value, and deletes the rest. Updates `epub_last_book.bookKey` if it pointed to a consolidated key. Same flag is cleared and re-run after local import / Drive download so re-imported legacy keys are merged.
- **`migrateLegacyBookmark(title, creator, newKey)`** runs in `loadEpub()` only when the new key is not yet present. Scans for `epub_pos_{title}_*` entries with matching `value.creator`, picks the latest, copies to the new key (with `spineCount` from the legacy key parse), deletes the legacy key. Used for cross-device sync edge cases where a user has the new build locally but imports a JSON exported by an old build.

`spineCount` is stored in the **value** (not derivable from the key in the new format). `_rlCollect()` and `markAsFinished()` prefer `val.spineCount` and fall back to `parsed.spineCount` (legacy keys only). `saveBookMeta()` writes the current `state.spine.length` as `spineCount` on every open, so once a user re-opens the new (longer) file, the displayed chapter count updates automatically.

`exportBookmarks()` serialises all `epub_pos_*` and `epub_last_book` keys to a JSON file (`{ version, exportedAt, bookmarks: {} }`) for cross-device transfer. Import is handled by a `change` event listener on a hidden `<input type="file" id="bookmark-input">` (no named import function); it validates the JSON shape and writes matching keys back to `localStorage`. After writing, if the currently open book's key is present in the imported data and the new position is ahead of the current position but not on the last spine item, `renderPage()` is called with the new position and `toast.localJumped` is shown instead of `toast.imported`. `notifyStorageError()` shows a toast when any `localStorage.setItem` throws (quota exceeded). `resumeBook()` is invoked when the user clicks the welcome-screen resume banner; it calls `loadSavedPos()` then opens a file picker.

**Note**: titles containing `__` (double underscore) would collide with the separator — extremely rare in practice and explicitly out of scope (per design discussion). Two unrelated works that happen to share both title and creator would also share progress; users can manually re-select via the file picker if this collision occurs.

**読みかけリスト完読済み判定** — `_rlCollect()` は `spineIdx >= spineCount - 1 && ratio > 0.9` を満たすエントリに `finished: true` フラグを付けて収集し（v1.10.0 から除外ではなくフラグ化）、`_rlFilterSort()` が `_rlPrefs.showFinished` に従って表示/非表示を決める。「✓読了も表示」チップ ON で読了本も表示され再オープン可能（未読了カードの「削除」は `markAsFinished`（論理削除）なので、削除した本もここに現れる — データ上、読了と論理削除は区別不能）。**読了カードの ×（v1.11.0）は物理削除（purge）**：`confirmDeleteBook` がエントリから読了判定を再計算して `_rlPendingDeleteMode = 'purge'|'hide'` を設定し、purge 時は強い確認ダイアログ（purgeTitle/purgeMsg/purgeDetail/purgeNote/purgeOk の i18n キー）→ `_rlPurgeBook()` が `epub_pos_*` エントリ・FSAハンドル（PC版のみ）・該当時の `epub_last_book` を削除する（IDB ePubキャッシュは `doDeleteBook` の共通処理で破棄）。エントリが JSON.parse できない場合は安全側（hide）にフォールバック。**削除墓標（tombstone）**: 完全削除は `epub_purged` に「キーのハッシュ（`_rlHashKey`、FNV-1a×2・タイトル非含有）＋削除時刻」を記録し、`collectBookmarks()` が `purged` フィールドとしてエクスポート/Drive 保存に同梱。インポート/`driveDownload` は `_rlApplyTombstones()` で墓標をマージ→「墓標 t が lastOpenedAt より新しいローカルしおりを完全削除」「t >= lastOpenedAt の受信しおりを取込スキップ」→ `_rlCleanupLastBook()` で迷子の `epub_last_book` を掃除。これにより完全削除が端末間で伝播し、和集合マージによる復活が起きない。`saveBookMeta()` 冒頭で該当墓標を除去（ePub を開き直す＝意図的な復活）。墓標は365日・200件で剪定（`_rlSavePurged`）。旧ビルドは `purged` を無視するため後方互換。`ratio=1.0` は `closeBook()` または EPUB_EDGE ハンドラで保存される。短い最終章（コンテンツが1画面に収まる `sw <= 2*vw`）では `doScroll` が `reportPos()` を呼ばずに即 `EPUB_EDGE` を発火するため `_intraChapterRatio=0` のまま。この問題を防ぐため `_bookFinished` フラグを使用する: `showFinishedBanner()` で `true` にセット → `closeBook()` で `_bookFinished ? 1.0 : _intraChapterRatio` を `savePos()` に渡す → `_bookFinished` をリセット。`loadEpub()` でも新しい本を開く際にリセットする。

### 読みかけリスト v2（v1.10.0・両ファイル共通）

詳細設計は `design_reading_list_v2.md` を参照。実装の要点：

- **パイプライン**: `buildReadingList()` = `_rlCollect()`（localStorage 走査・finished フラグ付与）→ `_rlFilterSort()`（読了→⚡すぐ開ける→検索 AND→ソート）→ `_rlRender()`（innerHTML 生成）→ `_rlSyncToolsUI()`（ツール行の active/ラベル同期）
- **設定永続化**: `epub_rl_prefs` キー1個に `{view, sort, filterReady, showFinished}` を JSON 保存。`_rlLoadPrefs()` はホワイトリスト検証付き。**`const _RL_SORTS` は変数宣言部（`let _rlPrefs = _rlLoadPrefs()` の直前）で定義必須** — v2 関数セクションに置くと TDZ → try/catch が握り潰して保存設定が黙って無視される（発見しにくいバグ）。デフォルト view は `'list'`（メディアクエリ分岐しない）
- **ソート**: `Intl.Collator('ja', {numeric:true, sensitivity:'base'})`。タイトル/著者順は `_rlSortKey()` で先頭の `【…】[…]（…）` プレフィックス（中身20文字以内のみ）を反復除去、`「『` は開き括弧のみ除去。全部削れたら原文フォールバック
- **検索**: `_rlNorm()` = NFKC＋小文字化＋カタカナ→ひらがな折り。スペース（全半角）区切り AND。`rl-search` の input に 120ms デバウンス。再レンダーは `#reading-list-items` の innerHTML のみなので検索ボックスのフォーカス・IME 状態は維持される
- **グリッド CSS**: カード DOM はリスト/グリッド単一テンプレート。コンテナの `view-grid` クラスで切替。列定義 `repeat(auto-fill, minmax(min(150px, calc(50% - 7px)), 1fr))` — `min()` により狭幅端末（表示拡大設定等で実効 360px 未満）でも必ず2列。カード全体クリックは `rlCardActivate()`（`view !== 'grid' || _editMode` で early return する JS ガード方式）
- **表紙サムネイル**: `extractCoverThumb` は 160×224・JPEG q0.72（`imageSmoothingQuality='high'`、Safari では無視されるが無害）。dataURL が 28000 文字（≒21KB）超なら q0.55 → q0.4 と適応再エンコード。既存の 48×68 表紙はその本を次に開いたとき自動更新
- **quota 安全弁**: `saveBookMeta()` / `savePos()` は QuotaExceeded 時に `cover` を削除して再書き込みし、読書位置の保存を優先する
- **インラインハンドラ規約**: `esc()` は `'` をエスケープしないため、**inline onclick へのデータ文字列埋め込みは禁止**。キーは `data-key` 属性＋`this.dataset.key` / `this.closest('.rl-card').dataset.key` で渡す。削除確認は `confirmDeleteBook(bookKey)` → `_rlPendingDeleteKey` モジュール変数 → 引数なし `doDeleteBook()` の受け渡し（タイトルは `parseBookKey` で復元）
- **iOS 版差分**: `_handleKeys`（File System Access API）が存在しないため「⚡すぐ開ける」と ▶ バッジは `_cachedKeys` のみで判定。開くボタンのラベル/クラスは `readingList.openCached` / `rl-cached` を維持。本体は CRLF・iOS 版は LF 改行

### Loading Overlay（ファイル取り込み待機表示）

ePub を開く際の体感ハングを防ぐためのオーバーレイ。特に OneDrive/Google Drive 等のクラウド同期ファイル選択時、ピッカー閉鎖から `change` イベント発火までの数秒〜数十秒の DL 待ちが無音になる問題に対応する。`#loading-overlay` は `position:fixed; inset:0; z-index:250`（modal=200 と toast=300 の間）。レイアウト: 上から `#loading-file-msg`（ファイル名つきメッセージ）、`#loading-spinner`（CSS keyframe `loading-spin` で回転）、`#loading-stage`（処理段階テキスト）、`#loading-file`（サイズ表示）。

- **`showLoadingPreSelect()`** — ファイルピッカー起動直前に呼ぶ。`#loading-file-msg` に `t('loading.fetching')` （「📂 ファイルを取得しています…」）を表示し、stage / size はクリア。`openFilePicker()` / `openFilePickerForBook()` 冒頭で必ず呼ばれる。`yomikake.html` の `showOpenFilePicker` API 経路と従来の `<input type="file">` 経路の両方で発動する。
- **`showLoading(filename, sizeBytes)`** — `loadEpub()` 冒頭で呼ばれ、`#loading-file-msg` を `t('loading.opening', {filename})` （「『book.epub』を開いています…」）に上書き。stage は `loading.unzipping`、size は `(N.N MB)` を表示。`textContent` 経由でセットするため XSS 安全。
- **`updateLoadingStage(key)`** — stage テキストのみ更新。`loadEpub` 内で `JSZip.loadAsync` 完了直後に `loading.parsing`、`renderPage` 直前に `loading.rendering` へ遷移。`_loadingShown` ガードあり。
- **`hideLoading()`** — `_loadingShown` ガード後にクラス除去。`loadEpub` の `try/finally` で必ず呼ばれる。
- **キャンセル検出** — `#file-input` に `cancel` イベントリスナー（Chrome 113+ / Safari 16.4+ / Firefox 91+ で標準）。`change` イベントもファイル無し時に `hideLoading()` 呼び出し。`showOpenFilePicker` の `AbortError` も catch して `hideLoading()`。
- **double rAF** — `loadEpub` 冒頭で `await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))` を入れ、JSZip の重い同期処理に入る前にブラウザに描画機会を与える。
- **i18n キー** — `loading.fetching` / `loading.opening` / `loading.unzipping` / `loading.parsing` / `loading.rendering`（4 言語分）。`loading.opening` は `{filename}` プレースホルダを持つ。
- **しきい値なし** — 6MB 等のサイズ判定は撤廃。OneDrive 上の小ファイルでも DL 待ちが発生するため、すべてのファイル取り込みでオーバーレイを出す（PC のローカル小ファイルでは一瞬だけフラッシュするが許容）。
- **古いブラウザの限界** — `cancel` イベント未対応のブラウザ（iOS Safari < 16.4 等）でユーザーがピッカーをキャンセルすると、オーバーレイが残る。トレードオフとして許容。

### FXL コマ読みズーム (Phase 3)

固定レイアウト本（マンガ・雑誌）で 1 ページを 2 列 × 3 行 = 6 領域に分割し、Next ボタン連打で順次遷移しながら読むモード。iframe を使わない FXL の直接 DOM 配置を活かし、`#fxl-spread` に CSS `transform: translate()+scale()` を適用するだけの軽量実装。

- **state**: `state.fxlZoomEnabled`（セッションのみ）、`state.fxlZoom = {level, tx, ty, regionIdx, mode}`、`state.fxlZoomLevel` / `state.fxlRegionOrder` / `state.fxlLtrAutoFlip`（`epub_settings` に永続化）
- **`FXL_REGION_ORDERS`** テーブル: `story` = `[[1,0],[0,0],[1,1],[0,1],[1,2],[0,2]]`（RT→LT→RM→LM→RB→LB）、`yonkoma` = `[[1,0],[1,1],[1,2],[0,0],[0,1],[0,2]]`（右列3 → 左列3）。LTR 書籍は `regionCellForIdx` 内で `col = 1 - col` 反転（`fxlLtrAutoFlip` ON 時）
- **`getTargetPageRect()`**: single または非ペア時は container 全域、spread かつ `pair.items.length === 2` の時は `state.currentSpineIdx` と `state.fxlPpd` から左右どちらのハーフが現在フォーカスかを判定して返す
- **`applyFxlRegionPreset()`**: `transform-origin:50% 50%` 前提で、セル中心 `(cellCx, cellCy)` を container 中央 `(W/2, H/2)` に一致させる `tx, ty` を `-(cellCx - W/2) * level` / `-(cellCy - H/2) * level` で算出し、`clampFxlPan` で範囲制限
- **`clampFxlPan(tx, ty)`**: 上限 `maxX = (L-1) * W / 2`、`maxY = (L-1) * H / 2`。`excessX/Y` はクランプ入力と結果の差で rubber-band 検知に使う
- **Next/Back ボタン（`#btn-scroll-fwd` / `#btn-scroll-back`）**: ズーム中は `scrollPage()` が `advanceFxlZoomStep(dir)` に分岐。`preset` モードで `regionIdx < 5` なら次領域、それ以外（末尾 or `free` モード）は `advanceFxlZoomSpine(dir)` で spine を進め `regionIdx = 0` リセット。spread 内で target だけ切り替わる場合は **再描画せず** `applyFxlRegionPreset()` のみ呼ぶことで高速
- **バッジ**: `.fxl-nav-badge` を両ボタンに inline-block で重ね、ズーム中のみ `body.mode-fxl.fxl-zoomed` でも可視化。表示は `updateFxlNextBtnUI()` がモード/regionIdx から `"2/6"` / `"⏭"` / `"⏮"` を生成
- **領域ピル（`#fxl-region-pill`）**: 右下固定。`updateFxlRegionPillUI()` が `🎯 3/6`（preset）/ `🌀 自由`（free）を描画。`onFxlRegionPillClick()` は free→preset 復帰 or preset→次領域
- **ドラッグ PAN**: `PointerEvent` 統一実装（デスクトップ / iOS 13+ 共通）。5px 超で `mode='free'`、rubber-band は `excessX` を累積し `50px` 超で `advanceFxlZoomStep` を発火（`rtl` 書籍は `dirSign` 反転）
- **ダブルタップ**: `handleFxlTap()` が `300ms` / `30px` 以内の連続タップを検出。OFF→ON 時は `regionIdxFromPoint()` でタップ位置の領域を算出。iOS では既存 `touchend` ハンドラの「スワイプ前のタップ判定」で呼び出す（ズーム中は PointerEvent に完全委譲）
- **renderFxlPair 末尾フック**: `if (state.fxlZoomEnabled) requestAnimationFrame(applyFxlRegionPreset)` — spread 切替で layout が変わるため rAF 後に再計算
- **リサイズ対応**: `_fxlResizeTimer` 内で spread 切替なしでもズーム中なら `applyFxlRegionPreset()` を呼ぶ（viewport 寸法変化で `tx/ty` が狂うため）
- **closeBook での確実なクリーンアップ**: `state.fxlZoomEnabled = false; resetFxlZoom(); document.body.classList.remove('mode-fxl', 'fxl-zoomed')`
- **見開き時のペア跨ぎ**: `advanceFxlZoomSpine()` は `pair.items.indexOf(state.currentSpineIdx)` で現 spine のペア内位置を取得し、同ペア内の移動なら `state.currentSpineIdx` 更新＋`applyFxlRegionPreset` のみ（再描画なし）。ペア境界越えは `renderFxlPair(targetSpine)` で末尾フック経由
- **キーボード（デスクトップのみ）**: `z`=トグル、`1`-`6`=領域直接、`0`/`Escape`=OFF、`Space`/矢印は既存 `scrollPage` 経由で自動的に ZoomStep へ
- **永続化しない理由**: ズーム状態（level/tx/ty/regionIdx/mode/enabled）は「本を開くたびに OFF で起動」する方が UX として自然なため、`epub_settings` / `epub_pos_*` / Drive 同期いずれにも入れない。永続するのは「拡大倍率」「領域順」「LTR 反転」の 3 設定のみ

#### FXL Blob URL キャッシュと本切替

`_fxlBlobCache` は `Map<spineIdx, objectURL>` で、`loadFxlPageBlobUrl()` が現在ペア＋前後 1 ペア分（最大 6 枚）の Blob URL を保持する。`renderFxlPair()` の末尾で `trimFxlBlobCache(keepIdxSet)` が範囲外を `URL.revokeObjectURL` する。**本を切り替える際は `loadEpub()` 内で必ず `revokeAllFxlBlobs()` を呼んでキャッシュを全クリアする** — `spineIdx` をキーにしているため、両書とも `spineIdx=0` の表紙が cache hit して旧本の URL が返り、新本の表紙が表示されないバグが起きる（`imgA.src` に同値を再代入してもブラウザは再描画しない）。`closeBook()` でも呼ぶが、本切替時は close を経由しないため両方必要。同タイミングで `_fxlLastSpreadState = null` もリセット。

### FXL 軸モード vfill / hfill（1軸ズーム）

紙本スキャンの自炊 FXL 本を端末画面の片軸いっぱいに拡大して読むモード。`state.fxlRegionOrder` に `'story'` / `'yonkoma'` に加えて `'vfill'`（縦合わせ・横スクロール、v1.8.4）と `'hfill'`（横合わせ・縦スクロール、v1.8.5）を追加。`fxlRegionOrder` の値域拡張で実装し、内部変数名は据え置き。

| モード | 用途 | 軸 | ステップ進行 |
|--------|------|----|-------------|
| `vfill` | 縦書きスキャン本＋縦持ちスマホ | 横軸 | 書字方向（RTL: 右→左、LTR: 左→右）|
| `hfill` | 横書きスキャン本＋横倒しスマホ | 縦軸 | 常に上→下（書字方向に依らず）|

- **共通ヘルパー** `isFxlAxisMode()` が `state.fxlRegionOrder === 'vfill' || 'hfill'` を返す。複数の分岐で参照
- **動的 level 算出** — `applyFxlAxisPreset()` が `imgA.naturalWidth/Height` から `imgAR = nW/nH`、`contAR = W/H` を比較し object-fit:contain 後の `displayedW/H` を求める。
  - vfill: `level = H / displayedH`（`imgAR > contAR` で >1）
  - hfill: `level = W / displayedW`（`imgAR < contAR` で >1）
- **動的ステップ数** — vfill: `n = max(1, ceil(displayedW * level / W))` ／ hfill: `n = max(1, ceil(displayedH * level / H))`。`getZoomStepMaxIdx()` が story/yonkoma=5、軸モード=`n-1` を返す
- **tx / ty 計算** — transform-origin:50% 50% の `transform: translate(tx,ty) scale(L)` で：
  - vfill `tx_init = W/2 - displayedW*level/2`（負＝画像を左へ translate＝画像右端を viewport 右端に）。Step `i` の tx は `rtl ? tx_init + i*W : -tx_init - i*W`、ty=0
  - hfill `ty_init = (displayedH*level - H)/2`（正＝画像を下へ translate＝画像上端を viewport 上端に）。Step `i` の ty は `ty_init - i*H`、tx=0
- **`_fxlAxisCache`** — `{displayedW, displayedH, level, n, tx_init, ty_init}` を module-level で保持。`clampFxlPan()` が軸モード別に max を計算する根拠
  - vfill: `maxX = (displayedW*L - W)/2`、`maxY = 0`
  - hfill: `maxX = 0`、`maxY = (displayedH*L - H)/2`
- **`_fxlAxisLandAtEnd`** — Back 方向のページ境界跨ぎで「新ページの末尾ステップに着地」させるためのワンショットフラグ。新ページ側の `applyFxlAxisPreset()` が新 n を確定したタイミングで読み・消費する。これがないと、元ページの maxIdx を新ページに持ち込んで誤った位置に着地する
- **画像未ロード時** — `applyFxlAxisPreset()` 冒頭で `img.complete && naturalWidth` を確認し、未ロードなら `addEventListener('load', ..., {once:true})` で再呼び出し
- **spread 強制 OFF** — 軸モード ON 中は `isEffectiveSpread()` が false 強制返却。`enableFxlZoom`/`disableFxlZoom`/`changeFxlRegionOrder` で前後の `isEffectiveSpread()` 結果を比較し、変化があれば `renderFxlPair(state.currentSpineIdx)` で再描画
- **PAN 軸ロック** — `onPointerMove` が vfill 時 `dy = 0`、hfill 時 `dx = 0` を強制。rubber-band は hfill 時 `excessY` 判定（dirSign>0=下方向超過＝次ページ。書字方向に依らず）、それ以外は `excessX` 判定（既存挙動：RTL は dirSign を反転）
- **ダブルタップ ON** — 軸モード時は `regionIdxFromPoint()` が常に 0 を返す（n が画像比から動的なので位置→idx 逆算が困難。常に先頭から開始）
- **キーボード `1-6` 直接ジャンプ** — story/yonkoma 専用。軸モード時は `isFxlAxisMode()` ガードで無効化（yomikake_ios.html はそもそも z/0/1-6 ショートカット未実装）
- **設定 UI 表示制御** — `body.fxl-axis-mode` クラスで `.fxl-2d-only`（拡大倍率行・LTR反転行）を `display:none`。`syncFxlAxisModeUI()` が `isFxlAxisMode()` を見てクラス付与
- **バッジ/ピル** — vfill 時 `↔ N/total`、hfill 時 `↕ N/total`（領域ピルアイコンが 🎯 → ↔ / ↕ に変化）。Next/Back バッジは `(idx+2)/total` ・ `idx/total`、末尾は ⏭/⏮
- **永続化スコープ** — `_fxlAxisCache`、`_fxlAxisLandAtEnd`、`fxlZoomEnabled`、`fxlZoom.{tx,ty,level,regionIdx,mode}` は永続化しない（本を開くたびに OFF で起動）。設定として永続化されるのは `fxlRegionOrder` のみ

### Jump History (セッション内しおり履歴)

Two module-level variables track navigation history for the duration of the current ePub session (not persisted to localStorage):

- **`_originalBookmark`** — `{spineIdx, ratio} | null`. Set in `loadEpub()` from `loadSavedPos()` when a saved position exists; reset to `null` on new book open.
- **`_jumpHistory`** — `[{spineIdx, ratio}, ...]`, max 4 entries, newest first. Reset to `[]` on new book open.

**`pushJumpHistory()`** — captures `{state.currentSpineIdx, _intraChapterRatio}` and prepends to `_jumpHistory` (capped at 4). Skips if the new entry is within 0.01 ratio of the most recent entry. Called before `renderPage()` in: `navigateToToc()`, progress bar `click` handler, Drive auto-jump, and local import auto-jump.

**`updateJumpHistoryUI()`** — rebuilds `#jump-history-section` (in the TOC sidebar, above `#toc-list`). Hidden when both `_originalBookmark` is null and `_jumpHistory` is empty. When visible: shows a `📌` row for `_originalBookmark` (if set) and `↩` rows for each `_jumpHistory` entry, followed by a `<hr class="history-divider">` separator. Clicking any row calls `pushJumpHistory()` then `renderPage()` so the return trip is also recordable.

**`labelForPos(spineIdx, ratio)`** — returns an HTML string with the chapter label (from `state.toc` if a matching entry exists, else `sidebar.chapter` i18n key) and a `<span class="history-pct">· N%</span>` suffix. Uses `esc()` for the label text.

### File System Access API (`yomikake.html` only)

When `window.showOpenFilePicker` is available (Chrome/Edge), the viewer stores `FileSystemFileHandle` objects in IndexedDB (`epub_viewer_fsh` DB, `handles` object store) so the reading list can reopen a book without showing a new file picker.

- **`fshPut(bookKey, handle)`** — stores the handle under `bookKey` after `loadEpub()` succeeds.
- **`fshGetAllKeys()`** — returns all keys with stored handles; called at init to populate `_handleKeys` (module-level `Set`).
- **`_handleKeys`** — tracks which bookKeys have a cached handle; used by `buildReadingList()` to render "このファイルを開く（直接）" instead of the normal picker button.
- **`openFilePickerForBook(bookKey)`** — if `_handleKeys.has(bookKey)`, calls `handle.getFile()` directly and passes the result to `loadEpub()`; on `NotAllowedError` or `NotFoundError`, falls back to `showOpenFilePicker()` and removes the stale handle. In `yomikake_ios.html`, this function uses the IDB ePub cache instead (see next section).

### IndexedDB ePub Cache (both files)

iOS Safari does not implement the File System Access API, so v1.8.8 introduced this for `yomikake_ios.html`: cache the entire ePub Blob in IndexedDB (`epub_viewer_files` DB, `files` object store) keyed by `bookKey`. The reading list can then reopen the book without showing a file picker, even after the page reload. **v1.8.12 ports the same cache to `yomikake.html`** to fix offline reading (e.g. multi-day ferry trips): the previous FSA-handle-only approach stored a *reference* to the file, so `handle.getFile()` failed when the source lived on cloud storage (OneDrive/Drive) whose bytes were not synced locally. The IDB cache stores the actual bytes, so reopen works offline. The function set below is identical in both files; the differences are:

- **`yomikake.html` complements the FSA handle**: `loadEpub()` stores *both* the handle (`fshPut`) and the Blob (`cacheEpubFile`) on every open. `openFilePickerForBook()` chains **handle.getFile() → IDB Blob (`loadEpubFromCache`) → picker** — handle is preferred online (zero extra storage), IDB Blob covers offline; a failed `getFile()` does **not** delete the handle (the failure may just be transient/offline). The reading-list card shows `rl-open-direct` styling + `readingList.openDirect` label when *either* handle or cache is present, and a separate **`✈ オフラインOK` badge** (`readingList.offline`, in `.rl-meta-left`) only when `_cachedKeys.has(key)` (handle alone is not offline-safe).
- **`yomikake_ios.html` uses the cache as the sole reopen mechanism** (no FSA): `openFilePickerForBook()` branches cache → picker.

**Origin caveat (both files):** IndexedDB is per-origin. The cache only helps when reopening the *same URL* you read on while online (e.g. `https://www.ayati.com/book/yomikake.html`). A downloaded `file://` copy is a different (and unreliable) origin and will not see a cache written under the https deployment — though with JSZip inlined, a `file://` copy can still open locally-saved ePubs via the picker.

- **Storage value**: `{ buf: ArrayBuffer, name: string, size: number, type: string, savedAt: ISO }`. **The ePub bytes are stored as an `ArrayBuffer` (`buf`), not a `Blob`** — iOS Safari has a WebKit bug where a `Blob`/`File` saved to IndexedDB loses its backing store and throws `"The object can not be found here."` when later read (PC/Android unaffected; re-picking the file works). An `ArrayBuffer` is structured-cloned by value so it survives. `cacheEpubFile()` does `await file.arrayBuffer()` and stores `buf` (falling back to `value.blob = file` only if `arrayBuffer()` is unavailable on a very old engine). `loadEpubFromCache()` reads `cached.buf || cached.blob`, and for a legacy `blob` entry calls `await data.arrayBuffer()` first (which throws → clean picker fallback if the blob is already dead on iOS), then reconstructs a fresh in-memory `new File([data], name, {type})` to hand to `loadEpub()`. Legacy `blob`-only entries self-heal: a failed read falls back to the picker, and the next successful open re-caches as `buf`.
- **`EPUB_CACHE_LIMIT = 3`** — LRU cap. Adding a 4th book evicts the oldest by `lastOpenedAt` (read from existing `epub_pos_*` localStorage entries — no extra metadata store needed).
- **`_cachedKeys: Set<bookKey>`** — module-level set populated at init via `_idbGetAllKeys()`. Refresh `buildReadingList()` once it loads so the UI badge reflects cache state without flicker on slow IDB.
- **`_idbAvailable`** — flips to `false` if `indexedDB.open()` throws (Private Browsing, ITP block, etc.). All cache functions become no-ops; reading list falls back to picker.
- **Quota handling** — `cacheEpubFile()` catches `QuotaExceededError`, calls `evictOldestEpubCache()` once, then retries. Further failure is logged via `console.warn` and silently ignored. The user can still read the book; only persistence is lost.
- **Persistence request** — `navigator.storage.persist()` is called once at init. iOS Safari 16.4+ honors this when the page is added to the Home Screen (PWA-like). Otherwise it returns `false` silently.
- **`cacheEpubFile(file, bookKey)`** — fire-and-forget call from `loadEpub()` after `saveBookMeta()`. Uses `instanceof Blob` (covers File too) to gate the write.
- **`loadEpubFromCache(bookKey)`** — entry from reading list cards / `resumeBook()`. Calls `_idbGet(bookKey)`, wraps the Blob into a synthesized `File`, passes to `loadEpub()`. On miss or load failure, deletes the stale cache entry and falls back to `openFilePicker()`. `showLoadingPreSelect()` is called first so the overlay shows immediately; `loadEpub()` then overwrites the message via `showLoading()`.
- **`openFilePickerForBook(bookKey)`** — branches on `_cachedKeys.has(bookKey)`: cache → `loadEpubFromCache()`, miss → `openFilePicker()`. The `onclick` handler in the reading list card stays the same.
- **Visual badge** — `.rl-cached` CSS class on `.rl-open-btn` flips the button to filled-accent style and changes label to `t('readingList.openCached')` ("📂 続きから（直接）"). Implemented inline in `buildReadingList()`'s template literal — the same key-driven render as the non-cached button.
- **Settings panel UI** — `#cache-group` inserts above `#close-book-group`. Shows count + approximate origin storage usage from `navigator.storage.estimate()` (close enough — localStorage usage is ~5MB max), and a "クリア" button that calls `clearEpubCache()` after `confirm()`. Reading positions are NOT touched (only the Blob cache is cleared).
- **`updateCacheGroupUI()`** — refresh trigger called from: init's `_idbGetAllKeys()` resolution, `cacheEpubFile()` success, `doDeleteBook()` cache eviction, `clearEpubCache()` completion, and `toggleSettings()` opening.
- **List deletion** — `doDeleteBook()` calls `_idbDelete(bookKey)` and removes from `_cachedKeys` so a removed book stops occupying cache space immediately.
- **`resumeBook()`** — when called (legacy entry from welcome banner), prefers `loadEpubFromCache()` if `epub_last_book.bookKey` is in `_cachedKeys`; otherwise falls back to existing toast + picker.

### Google Drive Bookmark Sync

Both files support syncing `epub_pos_*` / `epub_last_book` keys to/from Google Drive `appDataFolder` as `epub_bookmarks.json`.

- **`GOOGLE_CLIENT_ID`** — hardcoded OAuth 2.0 client ID near the top of `<script>`. If empty, Drive buttons show an error toast and abort.
- **`_driveToken`** — OAuth access token stored in memory only (not localStorage, for XSS safety). Re-acquired on next button press after expiry.
- **`driveAuth()`** — calls Google Identity Services `initTokenClient` with scope `drive.appdata`. Requires `https://accounts.google.com/gsi/client` to be loaded (HTTP only; fails on `file://`).
- **`driveFindFile(token)`** — searches `appDataFolder` for `epub_bookmarks.json` and caches the file ID in `state.driveFileId` for the session. Returns `null` if not found. Validates the returned ID against `/^[a-zA-Z0-9_-]{10,200}$/` (security: prevents URL injection via API response).
- **`driveUpload()`** — serialises all `epub_pos_*` and `epub_last_book` localStorage keys via `collectBookmarks()`, then PATCHes the existing Drive file or POSTs a new multipart upload. Button is disabled during the operation.
- **`driveDownload()`** — fetches `epub_bookmarks.json` from Drive and writes matching keys back to `localStorage`. Prompts confirmation before overwriting (button is briefly re-enabled while `confirm()` is shown, then re-disabled if confirmed). Token is cleared and `state.driveFileId` reset on 401 so the user can retry. After writing, applies the same auto-jump logic as the local import handler: if the currently open book's key is in the new data and the new position is ahead of the current position but not on the last spine item, calls `renderPage()` and shows `toast.driveJumped` instead of `toast.driveDownloaded`.
- **`google.accounts` guard** — `driveAuth()` checks `typeof google === 'undefined'` and throws a human-readable error when the GIS script has not loaded (e.g., `file://` mode).
- **Auto-save** — `const AUTO_SAVE_INTERVAL = 60000` (1 min). When `state.driveAutoSave` is true, each `EPUB_POS` event schedules a debounced `driveUploadCore()` call via `scheduleAutoSave()`. Toggled by a switch in the settings popover; `updateAutoSaveToggleUI()` syncs the UI: it adds/removes the `auto-save-on` CSS class on `#drive-upload-btn` (toolbar upload button), which applies `box-shadow:0 0 0 1.5px var(--ui-text)` as a visual indicator that auto-save is active. Persisted in `epub_settings` as `driveAutoSave`. Forced off on `file://` during init. `_autoSaveBusy` flag prevents concurrent uploads.
- **Token lifecycle** — `_tokenClient` holds the GIS `TokenClient` instance (created once on first auth, reused thereafter). `_driveTokenExpiry` stores the expiry timestamp from `r.expires_in`. `driveAuth()` returns the cached token if >5 min remain; otherwise calls `requestAccessToken({ prompt: '' })` on the existing client for a silent refresh (no popup). `scheduleTokenRefresh()` arms a timer 5 min before expiry to proactively refresh in the background. `runAutoSave()` retries once with silent refresh on 401; only if that also fails does it disable auto-save and show `toast.driveAutoSaveExpired`.

### Help Modal

`showHelp()` builds the modal content dynamically. When a book is open (`state.epub` is non-null), a book-info card is prepended showing `state.bookTitle`, `state.bookCreator` (omitted if empty), spine count, and TOC item count (omitted if 0). `state.bookTitle` and `state.bookCreator` are populated in `loadEpub()` from OPF `dc:title` / `dc:creator` elements; multiple creators are joined with `・`. `esc()` escapes HTML entities before injecting title/creator into `innerHTML`. `#modal-body` has `max-height: calc(80vh - 120px); overflow-y: auto` to handle long content.

### Security

- ePub `<script>` tags stripped in `buildSrcdoc()` (XSS — iframe has no `sandbox` attribute).
- ePub `<base>` replaced with `<base href="about:blank">` to prevent `file://` URL leakage.
- JSZip: **both files** inline a SRI-verified copy of `jszip.min.js` (no network fetch, so no runtime SRI; integrity is checked once at update time against the hash recorded in the inline-block comment).
- `postMessage` origin is `"*"` (required for `file://`); receiver validates `e.source === iframe.contentWindow` to reject messages from other windows/extensions, plus `e.data.type`.
- All `<a>` clicks inside the iframe are intercepted: external URLs → `window.open(_blank, noopener)`, internal epub links → `EPUB_LINK` postMessage to parent (prevents X-Frame-Options errors). `javascript:` scheme URIs are rejected in `handleIframeLink()`.
- Inline `on*` event handlers in ePub content are **not** stripped — intentional trade-off (low risk, high removal cost).
- Drive API file IDs validated against `/^[a-zA-Z0-9_-]{10,200}$/` in `driveFindFile()` before use in fetch URLs (prevents URL injection via malicious API responses).
- `resolveCssText()` uses regex with escaped pattern (not `split().join()`) to replace `url()` references, avoiding mismatches with special characters in URL strings.
- `_driveToken` stored in memory only (not localStorage) to limit XSS token theft surface.
