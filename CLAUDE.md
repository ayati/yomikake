# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Two-file ePub 3 vertical-text viewer for reading Japanese publications. No build system — open the HTML file directly in a browser or serve via HTTP.

| File | Target |
|------|--------|
| `epub_viewer.html` | Chrome / Firefox / Edge (Windows, macOS, Android) and macOS Safari |
| `epub_viewer_ios.html` | iOS Safari (iPhone / iPad) only — uses CSS transform scroll instead of scroll APIs |

**External dependency:** JSZip 3.10.1 loaded via CDN (`cdnjs.cloudflare.com`).

**License:** MIT © 2026 N.Aono — see `LICENSE`.

**Feature differences between files:**
- Drag-and-drop file open: `epub_viewer.html` only
- Keyboard shortcuts (Space/arrows/Home/End): both files support Bluetooth keyboard; `epub_viewer_ios.html` also handles touch swipe inside the iframe
- Toolbar mouse-wheel scroll: `epub_viewer.html` only
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

## Architecture

Each viewer is a single self-contained HTML file (`epub_viewer.html` ~1308 lines, `epub_viewer_ios.html` ~1361 lines). Both follow a modular functional style with a single central state object. The architecture below describes `epub_viewer.html`; `epub_viewer_ios.html` is identical except for the scroll mechanism (see iOS Viewer section below).

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
  // UI preferences: fontMode, fontSize, lineHeight, theme, margin, sidebarOpen
}
```

### Processing Pipeline

1. **File Load** — `loadEpub(file)` parses the ZIP, reads `META-INF/container.xml` to find the OPF, then builds `state.spine`, `state.manifest`, and `state.toc`.
2. **Resource Resolution** — `toDataUri(absPath)` converts images/CSS to base64 data URIs; `resolveCssText()` rewrites `url()` references inside stylesheets.
3. **Rendering** — `renderPage(idx)` calls `buildSrcdoc()` which processes XHTML (inlining all external resources), injects vertical-text CSS, and sets the iframe's `srcdoc`.
4. **Scroll Control** — an injected `buildScrollScript()` in the iframe handles RTL scroll via `postMessage` back to the parent; Chrome and Firefox differ in how they represent `scrollLeft` for RTL content.

### Key Design Decisions

- **`srcdoc` injection** (not blob URLs) avoids same-origin/CORS issues with iframe content.
- **`postMessage`** bridges parent↔iframe scroll edge detection.
- **Writing mode** (`state.writingMode`) controls CSS injection in `buildSrcdoc()`: `'vertical'` forces `vertical-rl` + `padding-left:100vw`; `'horizontal'` forces `horizontal-tb` + `padding-bottom:100vh`; `'publisher'` injects no override and lets the ePub's own CSS control writing direction. `buildScrollScript()` receives `writingMode` and branches into three separate IIFE implementations (vertical RTL scroll, horizontal vertical scroll, publisher auto-detect).
- **`.kepub`** (Kobo ePub) is supported by treating it as a standard ZIP/ePub.
- **Settings popover** — display settings (font, size, line height, theme, margin, writing mode) live in a floating `#settings-popover` panel toggled by `toggleSettings()`, not in inline toolbar controls. `updateThemeBtnUI()` syncs the visual theme button state after loading settings.
- **`THEME_CONTENT` map** holds iframe content colors separately from CSS variables (which only apply to the outer UI). Theme changes re-render the current chapter.
- **`buildScrollScript()`** returns a self-contained IIFE string baked into the iframe. The **vertical** mode uses `window.scrollX` / `window.scrollTo()` instead of `scrollLeft`, so no browser sign-convention detection (`isNeg`) is needed: `scrollX=0` at reading start (right edge) and increases in the reading direction on both Chrome and Firefox. `doScroll` checks at the **top** whether we are already in the blank zone (from a prior scroll) and fires `EPUB_EDGE` then; otherwise it scrolls one page and, if past `contentMax`, lands on the blank page (without firing `EPUB_EDGE` yet). The horizontal and publisher modes still use `scrollLeft` with `isNeg()` detection.
- **iOS Safari scroll compatibility** — injected CSS sets `html { height:100%; overflow-y:hidden }`. Two constraints: (1) `height:100%` (not `100vh`) — iOS Safari resolves `100vh` to full screen height including address bar, making columns too tall; (2) `overflow-x` is NOT set — setting `overflow-x:auto` causes iOS to use an LTR CSS scroll container where the initial position is scrollLeft=0 (left edge = RTL content end = blank). Without it, iOS UIScrollView auto-positions at the RTL start (right edge = content beginning).
- **`window.scrollTo()` instead of `scrollLeft` assignment** — `document.documentElement.scrollLeft = X` is silently ignored inside iOS Safari iframes (confirmed via diagnostics: probe=0 after setting 9999999). `window.scrollTo(x, 0)` works correctly. All scroll operations use `window.scrollTo`; `window.scrollX` is used for reading (falls back to `scrollLeft` for browsers that don't support `scrollX`).
- **`document.documentElement.scrollWidth`** — the document root correctly reports `scrollWidth` including left-side (RTL/vertical-rl) overflow in all browsers. A wrapper `div` with `overflow-x:auto` does NOT include left-side overflow in its `scrollWidth`, causing `scrollWidth == clientWidth` always, making every scroll immediately trigger `EPUB_EDGE`. Always use `document.documentElement.scrollWidth` for measuring content width.
- **`flashOverlay()`** adds a 150ms CSS flash on `#page-overlay` at the very start of each `renderPage()` call to give visual feedback during chapter transitions. It does not wait for content to load.
- **`flashNavButtons()`** is called (1) after `renderPage` completes on ePub open, and (2) after `closeModal()` closes the help dialog. It flashes all 4 nav buttons with accent color for 3.5 seconds to help users discover the controls. All buttons including `#btn-scroll-fwd` are handled via the `.nav-hint { background:var(--accent) !important }` CSS class — the `!important` overrides the ID-level `background` rule without needing inline styles.
- **`scrollPage()` calls `blur()`** on any focused nav button before sending the scroll postMessage. Without this, clicking `#btn-scroll-fwd` then pressing a keyboard scroll key leaves the button with a persistent `:focus-visible` border (since `#btn-scroll-fwd` has a always-present `border:1px solid` at the ID level).
- **`prevChapter()` uses `'start'`** as the scroll target. `'end'` is reserved for automatic chapter transitions triggered by scrolling past the chapter boundary (so the reader lands at the end of the previous chapter, matching scroll direction). Explicit chapter button navigation always starts at the beginning.
- **Chapter-end blank page** — `buildSrcdoc()` injects a blank end-page via padding: `padding-left:100vw` for vertical mode (blank space at physical left = reading end), `padding-bottom:100vh` for horizontal mode (blank space at bottom). `buildScrollScript()` accounts for this by using `sw - 2*vw` (vertical) or `sh - 2*vh` (horizontal) as the real content range. `doScroll` fires `EPUB_EDGE` when the scroll position is 2+ px into the blank zone, so the prior scroll shows the last content alongside blank — the intended UX. `epub_viewer_ios.html` uses the same "one step of blank" pattern via CSS-transform: `tx > 0` is the blank zone; `setTx(Math.min(tx + step, step))` caps blank travel at one step; `EPUB_EDGE` fires when `tx >= 2`. `'publisher'` mode has no injected padding and no blank end-page.
- **`_renderSeq` (render sequence counter)** guards against race conditions when `renderPage` is called rapidly. Each call captures the current sequence number; after each `await`, the function checks if a newer call has started and returns early if so. This ensures only the last-requested chapter is rendered.
- **`zip.file()` null checks** — `state.epub.file(absPath)` can return null if the ePub ZIP is missing a declared file. `renderPage` shows a toast and aborts; `loadEpub` skips TOC parsing (the book still opens without a table of contents).

### iOS Viewer (`epub_viewer_ios.html`)

iOS Safari silently ignores both `document.documentElement.scrollLeft` assignment and `window.scrollTo()` inside iframes, so `epub_viewer_ios.html` uses a completely different scroll mechanism — **CSS `transform`** — inside `buildScrollScript()`:

- `body { position:fixed; writing-mode:vertical-rl; width:max-content; will-change:transform }` expands all columns into a single body-width block. `will-change:transform` forces GPU compositing and prevents partial-render artifacts on iPad (without it, `position:fixed` + CSS `transform` causes incomplete paints during drag scroll).
- `body.style.transform = 'translateX(px)'` slides the content to simulate page turns.
- No scroll API is called anywhere; swipe gesture (`touchstart`/`touchend`) inside the iframe replaces button/keyboard scroll for content navigation.
- `EPUB_SCROLL`, `EPUB_EDGE`, `EPUB_POS`, and `EPUB_LINK` postMessage protocol is otherwise identical to the main viewer.
- **`CLICK_HANDLER` / `INIT_FN` template variables** — at the top of `buildScrollScript()`, two shared template literal strings are defined and interpolated (`${CLICK_HANDLER}`, `${INIT_FN}`) into all three scroll mode IIFEs (vertical, horizontal, publisher). `CLICK_HANDLER` intercepts `<a>` clicks inside the iframe and routes them to `window.open` or `EPUB_LINK`; `INIT_FN` wraps the `applyInit` call with the double-rAF + 500ms fallback pattern. This avoids duplicating these blocks across three separate string literals.
- **`INIT_FN` timing (iPad fix)** — on iPad, `body.offsetWidth` is read before `writing-mode:vertical-rl` layout completes, causing `maxS()=0` and content positioned off-screen. The fix uses a double-rAF (fast path for iPhone) plus a `setTimeout(applyInit, 500)` fallback (ensures layout is complete on iPad):
  ```js
  function run(){
    requestAnimationFrame(function(){ requestAnimationFrame(applyInit); });
    setTimeout(applyInit, 500);
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
| `epub_settings` | `{fontMode, fontSize, lineHeight, theme, margin, writingMode}` |

Bookmark key uses OPF title + spine count (not file path), so moving or renaming the file does not break saved positions. `exportBookmarks()` serialises all `epub_pos_*` and `epub_last_book` keys to a JSON file (`{ version, exportedAt, bookmarks: {} }`) for cross-device transfer. Import is handled by a `change` event listener on a hidden `<input type="file" id="bookmark-input">` (no named import function); it validates the JSON shape and writes matching keys back to `localStorage`. `notifyStorageError()` shows a toast when any `localStorage.setItem` throws (quota exceeded). `resumeBook()` is invoked when the user clicks the welcome-screen resume banner; it calls `loadSavedPos()` then opens a file picker.

### Help Modal

`showHelp()` builds the modal content dynamically. When a book is open (`state.epub` is non-null), a book-info card is prepended showing `state.bookTitle`, `state.bookCreator` (omitted if empty), spine count, and TOC item count (omitted if 0). `state.bookTitle` and `state.bookCreator` are populated in `loadEpub()` from OPF `dc:title` / `dc:creator` elements; multiple creators are joined with `・`. `esc()` escapes HTML entities before injecting title/creator into `innerHTML`. `#modal-body` has `max-height: calc(80vh - 120px); overflow-y: auto` to handle long content.

### Security

- ePub `<script>` tags stripped in `buildSrcdoc()` (XSS — iframe has no `sandbox` attribute).
- ePub `<base>` replaced with `<base href="about:blank">` to prevent `file://` URL leakage.
- JSZip loaded with SRI (`integrity` + `crossorigin`).
- `postMessage` origin is `"*"` (required for `file://`); receiver validates `e.data.type`.
- All `<a>` clicks inside the iframe are intercepted: external URLs → `window.open(_blank, noopener)`, internal epub links → `EPUB_LINK` postMessage to parent (prevents X-Frame-Options errors).
- Inline `on*` event handlers in ePub content are **not** stripped — intentional trade-off (low risk, high removal cost).
