# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file ePub 3 vertical-text viewer (`epub_viewer.html`) designed for reading Japanese publications. No build system — open the HTML file directly in a browser or serve via HTTP.

**External dependency:** JSZip 3.10.1 loaded via CDN (`cdnjs.cloudflare.com`).

**License:** MIT © 2026 N.Aono — see `LICENSE.md`.

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

The entire application lives in `epub_viewer.html` (~995 lines). It follows a modular functional style with a single central state object.

### State

```js
const state = {
  epub,        // JSZip instance
  spine[],     // chapter items in reading order
  manifest{},  // ePub manifest (id → resource path)
  toc[],       // table of contents entries
  // UI preferences: font, fontSize, theme, sidebar open/closed, etc.
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
- **CSS override** injects `writing-mode: vertical-rl` to force vertical layout regardless of the ePub's own styles.
- **`.kepub`** (Kobo ePub) is supported by treating it as a standard ZIP/ePub.
- **`THEME_CONTENT` map** holds iframe content colors separately from CSS variables (which only apply to the outer UI). Theme changes re-render the current chapter.
- **`buildScrollScript()`** returns a self-contained IIFE string baked into the iframe. Chrome RTL `scrollLeft` starts at 0 and goes negative; Firefox starts at max and decreases. The script detects this at runtime via sign check.
- **`flashNavButtons()`** is called after `renderPage` completes on ePub open. It flashes all 4 nav buttons with accent color for 4 seconds to help users discover the controls. `#btn-scroll-fwd` is handled via inline styles (not CSS class) because its ID-level `background` and `border` override class-based rules at the same specificity level.
- **`scrollPage()` calls `blur()`** on any focused nav button before sending the scroll postMessage. Without this, clicking `#btn-scroll-fwd` then pressing a keyboard scroll key leaves the button with a persistent `:focus-visible` border (since `#btn-scroll-fwd` has a always-present `border:1px solid` at the ID level).
- **`prevChapter()` uses `'start'`** as the scroll target. `'end'` is reserved for automatic chapter transitions triggered by scrolling past the chapter boundary (so the reader lands at the end of the previous chapter, matching scroll direction). Explicit chapter button navigation always starts at the beginning.
- **`_renderSeq` (render sequence counter)** guards against race conditions when `renderPage` is called rapidly. Each call captures the current sequence number; after each `await`, the function checks if a newer call has started and returns early if so. This ensures only the last-requested chapter is rendered.
- **`zip.file()` null checks** — `state.epub.file(absPath)` can return null if the ePub ZIP is missing a declared file. `renderPage` shows a toast and aborts; `loadEpub` skips TOC parsing (the book still opens without a table of contents).

### postMessage Protocol

| Type | Direction | Payload |
|------|-----------|---------|
| `EPUB_SCROLL` | parent → iframe | `{direction: 1\|-1}` |
| `EPUB_EDGE` | iframe → parent | `{direction: 1\|-1}` triggers chapter change |
| `EPUB_POS` | iframe → parent | `{ratio: 0–1}` triggers bookmark save (debounced 500 ms) |
| `EPUB_LINK` | iframe → parent | `{href: string}` internal link clicked; parent resolves to spine index |

### localStorage Keys

| Key | Content |
|-----|---------|
| `epub_pos_{title}_{spineCount}` | `{spineIdx, ratio}` — per-book reading position |
| `epub_last_book` | `{title, bookKey}` — for the resume banner |
| `epub_settings` | `{fontMode, fontSize, lineHeight, theme, margin}` |

Bookmark key uses OPF title + spine count (not file path), so moving or renaming the file does not break saved positions. `exportBookmarks()` serialises all `epub_pos_*` and `epub_last_book` keys to a JSON file for cross-device transfer; the import handler writes them back.

### Security

- ePub `<script>` tags stripped in `buildSrcdoc()` (XSS — iframe has no `sandbox` attribute).
- ePub `<base>` replaced with `<base href="about:blank">` to prevent `file://` URL leakage.
- JSZip loaded with SRI (`integrity` + `crossorigin`).
- `postMessage` origin is `"*"` (required for `file://`); receiver validates `e.data.type`.
- All `<a>` clicks inside the iframe are intercepted: external URLs → `window.open(_blank, noopener)`, internal epub links → `EPUB_LINK` postMessage to parent (prevents X-Frame-Options errors).
