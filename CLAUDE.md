# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Two-file ePub 3 vertical-text viewer for reading Japanese publications. No build system — open the HTML file directly in a browser or serve via HTTP.

| File | Target |
|------|--------|
| `epub_viewer.html` | Chrome / Firefox / Edge (Windows, macOS, Android) and macOS Safari |
| `epub_viewer_ios.html` | iOS Safari (iPhone / iPad) only — uses CSS transform scroll instead of scroll APIs |

**External dependency:** JSZip 3.10.1 loaded via CDN (`cdnjs.cloudflare.com`).

**Public deployment:** `https://www.ayati.com/book/epub_viewer.html` / `epub_viewer_ios.html` — this origin must be listed in the Google Cloud Console OAuth client's "Authorized JavaScript origins" for Drive sync to work in production.

**License:** MIT © 2026 N.Aono — see `LICENSE`.

**Feature differences between files:**
- Drag-and-drop file open: `epub_viewer.html` only
- Keyboard shortcuts (Space/arrows/Home/End): both files support Bluetooth keyboard; `epub_viewer_ios.html` also handles touch swipe inside the iframe
- Toolbar mouse-wheel scroll: `epub_viewer.html` only
- Google Drive bookmark sync: both files (requires HTTP server — Google Identity Services does not work on `file://`)
- Release tags follow `vX.Y.Z` convention (`git tag vX.Y.Z && git push --tags`)

## Development

No build step. To open the viewer:

```sh
# Option A: open directly in browser (bookmarks/localStorage work in file:// mode)
open epub_viewer.html          # macOS
xdg-open epub_viewer.html     # Linux

# Option B: serve via HTTP (useful when testing cross-origin behaviour)
python3 -m http.server 8080
# then visit http://localhost:8080/epub_viewer.html
```

There are no automated tests. Manual testing requires a `.epub` or `.kepub` file.

### Keeping both files in sync

Most features exist in both files. As a rule:
- **`epub_viewer.html` only**: drag-and-drop, toolbar mouse-wheel scroll, `SHARED_TAIL` (Chrome `text-combine-upright` fix), `isNeg()` sign detection in horizontal/publisher scroll.
- **`epub_viewer_ios.html` only**: CSS-transform scroll mechanism, touch swipe inside iframe, `CLICK_HANDLER` / `INIT_FN` template variables, double-rAF + 500ms `INIT_FN` timing, `will-change:transform` on body.
- **Both files**: all other features — rendering pipeline, postMessage protocol, i18n, settings, bookmarks, Drive sync, fullscreen, progress bar, full-text search, sidebar tabs, `_renderSeq`, `_isRendering` / `_pendingScrollAfterRender`, chapter-end blank page, `flashOverlay()`, `flashNavButtons()`, `showResumeBanner()`, `showToast()`, `toggleSidebar()`.

When fixing a bug or adding a feature that is not in the "only" lists above, apply the change to **both files**.

## Architecture

Each viewer is a single self-contained HTML file (both ~3039 lines as of v1.7.0). Both follow a modular functional style with a single central state object. The architecture below describes `epub_viewer.html`; `epub_viewer_ios.html` is identical except for the scroll mechanism (see iOS Viewer section below).

**Key locations in both files** (approximate — shift as code grows):

| Symbol | `epub_viewer.html` | `epub_viewer_ios.html` |
|--------|-------------------|----------------------|
| `GOOGLE_CLIENT_ID` | ~541 | ~528 |
| `I18N` translations | ~558 | ~545 |
| `state` object | ~1060 | ~1047 |
| `FONTS` / `FONT_URLS` / `FONT_GROUPS` | ~1088 | ~1075 |
| `loadEpub()` | ~1227 | ~1200 |
| `navigateToToc()` | ~1341 | ~1306 |
| `buildSrcdoc()` | ~1411 | ~1374 |
| `buildScrollScript()` | ~1512 | ~1479 |
| `SHARED_TAIL` (epub_viewer.html only) | ~1519 | — |
| `CLICK_HANDLER` / `INIT_FN` (ios only) | — | ~1486 / ~1500 |
| `_intraChapterRatio` | ~1806 | ~1830 |
| `renderPage()` | ~1814 | ~1838 |
| `handleIframeLink()` | ~1909 | ~1933 |
| `runSearch()` / `startSearch()` | ~2228 | ~2249 |
| `savePos()` | ~2486 | ~2499 |
| `driveAuth()` | ~2633 | ~2646 |

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
- **Settings popover** — display settings (font, size, line height, theme, margin, writing mode, forward-button size) live in a floating `#settings-popover` panel toggled by `toggleSettings()`, not in inline toolbar controls. `updateThemeBtnUI()` syncs the visual theme button state after loading settings. `applyFwdBtnSize(v)` updates `#btn-scroll-fwd` dimensions when `fwdBtnSize` changes (`'small'` / `'medium'` / `'large'`).
- **`THEME_CONTENT` map** holds iframe content colors separately from CSS variables (which only apply to the outer UI). Theme changes re-render the current chapter.
- **`buildScrollScript()`** returns a self-contained IIFE string baked into the iframe. The **vertical** mode uses `window.scrollX` / `window.scrollTo()` instead of `scrollLeft`, so no browser sign-convention detection (`isNeg`) is needed: `scrollX=0` at reading start (right edge) and increases in the reading direction on both Chrome and Firefox. `doScroll` checks at the **top** whether we are already in the blank zone (from a prior scroll) and fires `EPUB_EDGE` then; otherwise it scrolls one page and, if past `contentMax`, lands on the blank page (without firing `EPUB_EDGE` yet). The horizontal and publisher modes still use `scrollLeft` with `isNeg()` detection.
- **iOS Safari scroll compatibility** — injected CSS sets `html { height:100%; overflow-y:hidden }`. Two constraints: (1) `height:100%` (not `100vh`) — iOS Safari resolves `100vh` to full screen height including address bar, making columns too tall; (2) `overflow-x` is NOT set — setting `overflow-x:auto` causes iOS to use an LTR CSS scroll container where the initial position is scrollLeft=0 (left edge = RTL content end = blank). Without it, iOS UIScrollView auto-positions at the RTL start (right edge = content beginning).
- **`window.scrollTo()` instead of `scrollLeft` assignment** — `document.documentElement.scrollLeft = X` is silently ignored inside iOS Safari iframes (confirmed via diagnostics: probe=0 after setting 9999999). `window.scrollTo(x, 0)` works correctly. All scroll operations use `window.scrollTo`; `window.scrollX` is used for reading (falls back to `scrollLeft` for browsers that don't support `scrollX`).
- **`document.documentElement.scrollWidth`** — the document root correctly reports `scrollWidth` including left-side (RTL/vertical-rl) overflow in all browsers. A wrapper `div` with `overflow-x:auto` does NOT include left-side overflow in its `scrollWidth`, causing `scrollWidth == clientWidth` always, making every scroll immediately trigger `EPUB_EDGE`. Always use `document.documentElement.scrollWidth` for measuring content width.
- **`flashOverlay()`** adds a 150ms CSS flash on `#page-overlay` at the very start of each `renderPage()` call to give visual feedback during chapter transitions. It does not wait for content to load.
- **`flashNavButtons()`** is called (1) after `renderPage` completes on ePub open, and (2) after `closeModal()` closes the help dialog. It flashes all 4 nav buttons with accent color for 3.5 seconds to help users discover the controls. All buttons including `#btn-scroll-fwd` are handled via the `.nav-hint { background:var(--accent) !important }` CSS class — the `!important` overrides the ID-level `background` rule without needing inline styles.
- **Fullscreen reading mode (`toggleFullscreen()`)** — ツールバー・ステータスバーを非表示にして読書エリアを全画面表示する。`body.fullscreen` クラスを付与し、`#toolbar` / `#statusbar` を `position:fixed; top/bottom:-200px; opacity:0` で画面外に退避させる（`position:fixed` により flex フローから外れるため `#main` が自動的に 100dvh に拡張される）。ブラウザ API (`requestFullscreen`) に対応している環境では Layer2 として合わせて適用。iOS Safari では Layer2 が非対応のため Layer1（アプリ UI 非表示）のみ動作する。`#fs-exit-zone`（上端 16px のホットゾーン）をタップすると `#fs-exit-btn`（上端からスライドインするボタン）が 2 秒間表示され、タップで解除できる。Android バックボタンは `history.pushState` + `popstate` イベントで対応。`fullscreenchange` イベントで Layer2 の外部解除を Layer1 に同期する。キーボードショートカット `f` でトグル、`Escape` で解除。フルスクリーン移行時にサイドバー・設定ポップオーバーを強制クローズする。`state.fullscreen` は `localStorage` に保存しない（常に通常モードで起動）。両ファイル共通実装。
- **Android touch device visibility (`@media (hover:none) and (pointer:coarse)`)** — only `#btn-scroll-fwd { opacity:.22 }` is set. `.chapter-btn` intentionally has **no** opacity or stroke override here, so it remains at `opacity:0` / `stroke:transparent` (base values) — same as `.scroll-btn` (`#btn-scroll-back`). The key: `#btn-scroll-fwd` is barely visible at `.22` but its SVG `stroke` stays `transparent`, so only the container is faintly present with no visible shape. If `.chapter-btn svg { stroke:var(--ui-text) }` were added alongside `opacity:.3`, the `‹›` shapes would appear — distracting during reading. The `#btn-scroll-fwd { opacity:.22 }` rule wins over `.scroll-btn { opacity:.9 }` in the narrow-screen rule because ID selector specificity beats class selector specificity. (`epub_viewer_ios.html` uses `@media (hover:none)` and explicitly sets `.chapter-btn { opacity:.3 }` and `.chapter-btn svg { stroke:var(--ui-text) }` — a deliberate difference for the iOS-only file.)
- **Android Chrome sticky `:hover` bug** — Android Chrome makes `:hover` states "sticky": tapping `#page-container` (the reading area) keeps it in `:hover` state until the next tap elsewhere. Any `#page-container:hover .chapter-btn { opacity:.8 }` rule would therefore remain permanently active after the first touch, causing `‹`/`›` to stay visible even after `nav-hint` is removed. Fix: the `@media (max-width:640px)` rule does NOT set `opacity` on `.chapter-btn` or `.scroll-btn`, and `#page-container:hover` opacity overrides are placed exclusively inside `@media (max-width:640px) and (hover:hover)` — which excludes all touch devices. On Android, opacity comes only from the `(hover:none) and (pointer:coarse)` rule (`.3`), which has no `:hover` selector and thus is immune to sticky hover.
- **`scrollPage()` calls `blur()`** on any focused nav button before sending the scroll postMessage. Without this, clicking `#btn-scroll-fwd` then pressing a keyboard scroll key leaves the button with a persistent `:focus-visible` border (since `#btn-scroll-fwd` has a always-present `border:1px solid` at the ID level).
- **`prevChapter()` uses `'start'`** as the scroll target. `'end'` is reserved for automatic chapter transitions triggered by scrolling past the chapter boundary (so the reader lands at the end of the previous chapter, matching scroll direction). Explicit chapter button navigation always starts at the beginning.
- **Chapter-end blank page** — `buildSrcdoc()` injects a blank end-page via padding: `padding-left:100vw` for vertical mode (blank space at physical left = reading end), `padding-bottom:100vh` for horizontal mode (blank space at bottom). `buildScrollScript()` accounts for this by using `sw - 2*vw` (vertical) or `sh - 2*vh` (horizontal) as the real content range. `doScroll` fires `EPUB_EDGE` when the scroll position is 2+ px into the blank zone, so the prior scroll shows the last content alongside blank — the intended UX. `epub_viewer_ios.html` uses the same "one step of blank" pattern via CSS-transform: `tx > 0` is the blank zone; `setTx(Math.min(tx + step, step))` caps blank travel at one step; `EPUB_EDGE` fires when `tx >= 2`. **`'publisher'` mode** cannot inject padding at CSS time (axis is unknown until layout). Instead, `applyInit()` detects the writing-mode via `getComputedStyle`, injects `html{padding-left:100vw!important}` or `html{padding-bottom:100vh!important}` via a `<style>` element, resets `_neg = null` (the sign cache may have been set when `sw <= vw` before padding), then uses the same `sw - 2*vw` / `sh - 2*vh` range arithmetic as the dedicated modes. For `epub_viewer_ios.html` publisher mode, the same blank-zone fix is applied: `tx` is allowed to go up to `+step` (dir=1 EPUB_EDGE fires at `tx >= 2`) and `ty` to `ms + step` (EPUB_EDGE at `ty >= ms + 2`).
- **Chrome `text-combine-upright` initial-paint fix** — Chrome has a rendering bug where `text-combine-upright: all` spans (縦中横, e.g. `<span class="tcy">DLC</span>`) are placed to the left of center on the very first paint in vertical writing mode. Subsequent renders (e.g. switching writing mode) are correct. The fix is in `SHARED_TAIL`'s `init` function: after `applyInit()` sets the scroll position, a synchronous `visibility:hidden` → `offsetWidth` (layout flush) → `visibility:""` cycle forces Chrome to re-resolve tcy positions before the browser paints the frame. Because JS blocks the paint thread, this is invisible to the user. Applies to all three writing modes via `SHARED_TAIL` (`epub_viewer.html` only — Chrome/Android; not needed in `epub_viewer_ios.html`).
- **Bookmark save on chapter start** — `renderPage()` calls `savePos()` immediately after updating `state.currentSpineIdx`, before any async operations. This ensures the new chapter's starting position is persisted even if the app closes before the iframe fires `EPUB_POS`. The ratio saved is `0` for `'start'`, `1.0` for `'end'`, or the numeric ratio as-is. Without this, `applyInit()` setting `scrollLeft=0` on a fresh iframe (where the browser's initial `scrollLeft` is also 0) produces no `scroll` event, so the debounced `reportPos()` never fires and the previous chapter's end position remains in localStorage.
- **`EPUB_POS` guard during rendering** — the `EPUB_POS` message handler ignores messages while `_isRendering` is `true`. This prevents a stale debounced `reportPos()` from the OLD iframe (which may fire up to 500 ms after the last scroll in the old chapter) from overwriting the newly-saved chapter-start position with an incorrect ratio using the already-updated `state.currentSpineIdx`.
- **`_renderSeq` (render sequence counter)** guards against race conditions when `renderPage` is called rapidly. Each call captures the current sequence number; after each `await`, the function checks if a newer call has started and returns early if so. This ensures only the last-requested chapter is rendered.
- **`_isRendering` / `_pendingScrollAfterRender` (double-tap chapter-end fix)** — `_isRendering` is set to `true` at the start of `renderPage` and stays `true` until the new iframe's `applyInit()` fires. While `_isRendering` is true, `EPUB_EDGE` is queued in `_pendingScrollAfterRender` instead of advancing the chapter. After `iframe.srcdoc` is committed, the iframe sends `EPUB_READY {seq}` (from inside the 80ms setTimeout in `SHARED_TAIL` / `runApplyInit` in `INIT_FN`) once `applyInit()` completes. The parent's `EPUB_READY` handler verifies the seq matches `_renderSeq` (to ignore stale messages from superseded renders), then clears `_isRendering` and calls `scrollPage(pendingDir)` if needed. **Why not `load` event:** the old approach fired `scrollPage` on the iframe `load` event, before `applyInit()` ran. On iOS, `body.offsetWidth` is 0 at `load` time (layout not yet settled), so `maxS()=0` and `doScroll` immediately fired `EPUB_EDGE`, causing a chapter skip for any chapter. **Why not `_isRendering=false` after srcdoc:** the race window between srcdoc assignment and `applyInit()` completion is where stray `EPUB_EDGE` messages from old-iframe postMessage backlog or premature new-iframe `doScroll` could cause a second chapter advance.
- **XHTML self-closing `<script>` preprocessing** — `buildSrcdoc()` preprocesses `xhtmlText` before passing to `DOMParser('text/html')`. XHTML uses self-closing syntax `<script src="..."/>` which is valid XML. The HTML5 parser ignores the `/>` and treats `<script>` as an unclosed element, consuming everything up to `</script>` (including `</head>`, `<body>`, and all page content) as raw text — producing an empty `<body>` (blank page). Fix: `xhtmlText.replace(/<(script|style)(\s[^>]*)?\s*\/>/gi, ...)` converts to `<script ...></script>` before parsing. This is the root cause of blank pages in manga/fixed-layout ePub files that include `<script src="..."/>` (e.g., Kobo ePub with kobo.js).
- **SVG `<image>` resolution** — `buildSrcdoc()` resolves not only `<img src>` but also SVG `<image xlink:href>` and `<image href>` elements (used by manga/image-only ePub). `getAttributeNS('http://www.w3.org/1999/xlink', 'href')` is tried first (namespace-aware HTML5 parsing of inline SVG), with `getAttribute('xlink:href')` as fallback. Both `xlink:href` and `href` attributes are set on the resolved element for ePub2/ePub3 compatibility. The override CSS includes `svg{max-width:100%!important;max-height:95vh!important;}` to scale down full-page SVG containers.
- **Publisher mode height reset** — In `publisher` mode, `wmHtml` and `wmBody` add `height:100%!important` to both `html` and `body`. This prevents ePub-specific fixed em-height constraints (intended for dedicated reader viewports) from collapsing column height to 1 character in vertical-rl layout.
- **`zip.file()` null checks** — `state.epub.file(absPath)` can return null if the ePub ZIP is missing a declared file. `renderPage` shows a toast and aborts; `loadEpub` skips TOC parsing (the book still opens without a table of contents).
- **Progress bar (`#progress-bar` / `#progress-fill`)** — lives in `#statusbar`. `updatePageInfo()` sets `#progress-fill` width using `_intraChapterRatio` for smooth intra-chapter progress: `pct = Math.min(100, (cur-1 + _intraChapterRatio) / (total-1) * 100)`. `_intraChapterRatio` (module-level, 0–1) is updated from each `EPUB_POS` message and reset to `0` at the start of `renderPage()`. For vertical mode, `marginLeft:auto` makes the bar fill from the right (RTL reading direction). An IIFE after `updatePageInfo()` wires click-to-jump and mousemove-tooltip: `ratioFromEvent()` converts `clientX` to a spine ratio (inverted for vertical), `idxFromRatio()` maps ratio to spine index. Tooltip text uses i18n key `progress.tooltip`; `#progress-tooltip` is `position:fixed` so it is not clipped by `overflow:hidden` on `#progress-bar`.
- **Anchor/fragment navigation** — `renderPage(idx, scrollTarget)` accepts `scrollTarget` as `'start'`, `'end'`, a numeric ratio, or a `'#anchorId'` string. `navigateToToc()` and `handleIframeLink()` extract the `#fragment` from href and pass it as `scrollTarget`. Inside `buildScrollScript()`, `applyInit()` detects `initTarget.charAt(0)==='#'`, looks up the element via `getElementById` then `getElementsByName`, and scrolls to it. In `epub_viewer.html`: `el.scrollIntoView({behavior:"instant",block:"start",inline:"nearest"})` works for all writing modes. In `epub_viewer_ios.html` (CSS transform): vertical uses `setTx(max(-ms, min(0, vw()-el.getBoundingClientRect().left)))`, horizontal uses `setTy(max(0, min(ms, el.getBoundingClientRect().top)))` — both read `getBoundingClientRect()` before any transform is applied (when `tx=0`/`ty=0`).
- **Font settings UI** — `#font-picker` is a grouped custom dropdown (not a `<select>`). `FONT_GROUPS` defines the display hierarchy; `FONT_URLS` maps web-font keys to Google Fonts `@import` URLs; `FONT_SAMPLE` holds per-language preview text. `toggleFontPicker()` opens/closes the dropdown; `buildFontPickerList()` renders the grouped HTML on open; `selectFont(key)` applies the choice and triggers re-render. `loadPreviewFonts()` injects a combined Google Fonts `<link>` for all web-font entries so the picker previews render in the correct typeface. `updateFontPickerUI()` syncs the button label to the current `state.fontMode`.
- **Full-text search** — `#sidebar` has two tabs (`#tab-toc` / `#tab-search`) toggled by `switchSidebarTab(tab)` (module-level `_sidebarTab` tracks current tab). The search tab contains `#search-input` and `#search-results`. `startSearch()` reads the input, increments `_searchSeq`, and calls `runSearch(query, seq)`; `runSearch()` iterates spine items, strips HTML tags, matches the query string, calls `appendSearchResult(spineIdx, snippets, extra)` for each hit, and checks `seq !== _searchSeq` after each item to abort superseded searches. `resetSearch()` increments `_searchSeq` (cancels in-progress search) and clears results. `navigateFromSearch(spineIdx)` calls `pushJumpHistory()` then `renderPage()` and closes the sidebar. `updateSearchProgress(current, total)` updates the progress indicator and cancel button. `_searchAbort` is kept for backward compatibility but `_searchSeq` is the active cancellation mechanism.

### iOS Viewer (`epub_viewer_ios.html`)

iOS Safari silently ignores both `document.documentElement.scrollLeft` assignment and `window.scrollTo()` inside iframes, so `epub_viewer_ios.html` uses a completely different scroll mechanism — **CSS `transform`** — inside `buildScrollScript()`:

- `body { position:fixed; writing-mode:vertical-rl; width:max-content; will-change:transform }` expands all columns into a single body-width block. `will-change:transform` forces GPU compositing and prevents partial-render artifacts on iPad (without it, `position:fixed` + CSS `transform` causes incomplete paints during drag scroll).
- `body.style.transform = 'translateX(px)'` slides the content to simulate page turns.
- No scroll API is called anywhere; swipe gesture (`touchstart`/`touchend`) inside the iframe replaces button/keyboard scroll for content navigation.
- `EPUB_SCROLL`, `EPUB_EDGE`, `EPUB_POS`, and `EPUB_LINK` postMessage protocol is otherwise identical to the main viewer.
- **`CLICK_HANDLER` / `INIT_FN` template variables** — at the top of `buildScrollScript()`, two shared template literal strings are defined and interpolated (`${CLICK_HANDLER}`, `${INIT_FN}`) into all three scroll mode IIFEs (vertical, horizontal, publisher). `CLICK_HANDLER` intercepts `<a>` clicks inside the iframe and routes them to `window.open` or `EPUB_LINK`; `INIT_FN` wraps the `applyInit` call with the double-rAF + 500ms fallback pattern. This avoids duplicating these blocks across three separate string literals.
- **`INIT_FN` timing (iPad fix)** — on iPad, `body.offsetWidth` is read before `writing-mode:vertical-rl` layout completes, causing `maxS()=0` and content positioned off-screen. The fix uses a double-rAF (fast path for iPhone) plus a `setTimeout(runApplyInit, 500)` fallback (ensures layout is complete on iPad). A `_initApplied` flag prevents the second call from resetting the reading position if the first already succeeded:
  ```js
  var _initApplied = false;
  function runApplyInit(){ if(_initApplied) return; _initApplied = true; applyInit(); }
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
| `epub_pos_{title}_{spineCount}` | `{spineIdx, ratio}` — per-book reading position |
| `epub_last_book` | `{title, bookKey}` — for the resume banner |
| `epub_settings` | `{fontMode, fontSize, lineHeight, theme, margin, writingMode, fwdBtnSize, driveAutoSave}` |
| `epub_lang` | selected UI language (`ja` / `en` / `zh-TW` / `zh-CN`) |

Bookmark key uses OPF title + spine count (not file path), so moving or renaming the file does not break saved positions. `exportBookmarks()` serialises all `epub_pos_*` and `epub_last_book` keys to a JSON file (`{ version, exportedAt, bookmarks: {} }`) for cross-device transfer. Import is handled by a `change` event listener on a hidden `<input type="file" id="bookmark-input">` (no named import function); it validates the JSON shape and writes matching keys back to `localStorage`. After writing, if the currently open book's key is present in the imported data and the new position is ahead of the current position but not on the last spine item, `renderPage()` is called with the new position and `toast.localJumped` is shown instead of `toast.imported`. `notifyStorageError()` shows a toast when any `localStorage.setItem` throws (quota exceeded). `resumeBook()` is invoked when the user clicks the welcome-screen resume banner; it calls `loadSavedPos()` then opens a file picker.

### Jump History (セッション内しおり履歴)

Two module-level variables track navigation history for the duration of the current ePub session (not persisted to localStorage):

- **`_originalBookmark`** — `{spineIdx, ratio} | null`. Set in `loadEpub()` from `loadSavedPos()` when a saved position exists; reset to `null` on new book open.
- **`_jumpHistory`** — `[{spineIdx, ratio}, ...]`, max 4 entries, newest first. Reset to `[]` on new book open.

**`pushJumpHistory()`** — captures `{state.currentSpineIdx, _intraChapterRatio}` and prepends to `_jumpHistory` (capped at 4). Skips if the new entry is within 0.01 ratio of the most recent entry. Called before `renderPage()` in: `navigateToToc()`, progress bar `click` handler, Drive auto-jump, and local import auto-jump.

**`updateJumpHistoryUI()`** — rebuilds `#jump-history-section` (in the TOC sidebar, above `#toc-list`). Hidden when both `_originalBookmark` is null and `_jumpHistory` is empty. When visible: shows a `📌` row for `_originalBookmark` (if set) and `↩` rows for each `_jumpHistory` entry, followed by a `<hr class="history-divider">` separator. Clicking any row calls `pushJumpHistory()` then `renderPage()` so the return trip is also recordable.

**`labelForPos(spineIdx, ratio)`** — returns an HTML string with the chapter label (from `state.toc` if a matching entry exists, else `sidebar.chapter` i18n key) and a `<span class="history-pct">· N%</span>` suffix. Uses `esc()` for the label text.

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
- JSZip loaded with SRI (`integrity` + `crossorigin`).
- `postMessage` origin is `"*"` (required for `file://`); receiver validates `e.source === iframe.contentWindow` to reject messages from other windows/extensions, plus `e.data.type`.
- All `<a>` clicks inside the iframe are intercepted: external URLs → `window.open(_blank, noopener)`, internal epub links → `EPUB_LINK` postMessage to parent (prevents X-Frame-Options errors). `javascript:` scheme URIs are rejected in `handleIframeLink()`.
- Inline `on*` event handlers in ePub content are **not** stripped — intentional trade-off (low risk, high removal cost).
- Drive API file IDs validated against `/^[a-zA-Z0-9_-]{10,200}$/` in `driveFindFile()` before use in fetch URLs (prevents URL injection via malicious API responses).
- `resolveCssText()` uses regex with escaped pattern (not `split().join()`) to replace `url()` references, avoiding mismatches with special characters in URL strings.
- `_driveToken` stored in memory only (not localStorage) to limit XSS token theft surface.
