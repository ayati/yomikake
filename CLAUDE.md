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

**PWA icons:** the 4 PNG icons are generated from the author's master image **`myfont-icon-512-new20260714.png`** (512×512・完全不透明・背景 `#FDF8F0` = manifest の `background_color` / `theme_color` / HTML の `<meta name="theme-color">` と一致。旧マスタ `myfont-icon-512.png` は背景が `#F8F6F2` でわずかにズレていた)。自作フォント更新でマスタが差し替わったら Pillow で再生成する:
- `icon-512.png` = マスタをそのまま RGB 化（作者のレイアウトを尊重し再センタリングしない）
- `icon-192.png` / `apple-touch-icon.png` (180×180) = LANCZOS 縮小のみ
- `icon-512-maskable.png` = **字面を中央に寄せて最大辺 53% に縮小**し `#FDF8F0` の 512 キャンバスへ配置。maskable のセーフゾーンは直径 80% の円（半径 40% = 204.8px）で、この比率だと字面の最大半径は約 176px＝**余裕 14%**。マスタは字面が 55.9% あり、そのままだと対角が半径 39.5% に達してほぼ余裕ゼロになるため縮小が要る。
リリース時は `sw.js` の `VERSION` を上げれば旧キャッシュが破棄されて新アイコンに入れ替わる（`apple-touch-icon.png` は `SHELL` 未収録だが、iOS はインストール時にネットワークから取得する）。

**PWA assets (v2.6.0):** the "two-file" model now ships **7 companion files in the same `/book/` directory** (still no build step): `manifest.webmanifest` (+ `manifest_ios.webmanifest`), `sw.js`, and 4 PNG icons (`icon-192`, `icon-512`, `icon-512-maskable`, `apple-touch-icon`). All PWA behavior is progressive-enhancement — `file://`, uninstalled tabs, and SW-unsupported browsers behave exactly as before. `sw.js` does two things: (1) **Web Share Target** — a `POST .../share-receive` (declared in `manifest.webmanifest`'s `share_target`, Android Chrome only) has its `epub` file stashed in a dedicated IDB (`epub_viewer_share` / store `pending` / key `'file'`, **separate from the `epub_viewer_files` cache DB**) and redirects to `yomikake.html?shared=1`; the page's Init `handleSharedFile()` does get+delete via `_shareIdbTake()`, applies a 10-min freshness guard, and calls `loadEpub()`. (2) **App-shell offline** — HTML navigation is **network-first** (updates land immediately; cache only on failure), static assets cache-first. **On release, bump `VERSION` in `sw.js`** when HTML changes. iOS gets manifest+SW registration only (no share receiver — iOS Safari has no Web Share Target); its home-screen install uses a **separate storage bucket** from Safari (bookmarks migrate via Drive; ePub cache / local fonts need re-open). `loadEpub()` now validates the ZIP magic bytes (`PK`) up front and shows `toast.sharedNotEpub` for non-ePub input (octet-stream shares / drag-drop) — in **both files**.

**License:** MIT © 2026 N.Aono — see `LICENSE`.

**Feature differences between files:**
- Drag-and-drop file open: `yomikake.html` only
- File System Access API (direct file-reopen from reading list without new picker): `yomikake.html` only
- IndexedDB ePub Blob cache (直近の ePub 実体を IDB に保存し、オフライン／クラウド実体なしでもピッカー無しで再開): **both files** (v1.8.12+). `yomikake_ios.html` uses it as the sole reopen mechanism (no FSA); `yomikake.html` uses it as the **primary** reopen path too — both handle と Blob を open のたびに保存するが、`openFilePickerForBook()` は **IDB Blob → FSA ハンドル → ピッカー**の順に見る（v2.20.0 で順序を逆にした。理由は下記）。
- Keyboard shortcuts: both files support Bluetooth keyboard (§キーボード操作・v2.20.0）; `yomikake_ios.html` also handles touch swipe inside the iframe. **FXL 専用ショートカット（`z` / `0` / `1-6`）だけは `yomikake.html` のみ**
- Toolbar mouse-wheel scroll: `yomikake.html` only
- Google Drive bookmark sync: both files (requires HTTP server — Google Identity Services does not work on `file://`)
- Release tags follow `vX.Y.Z` convention. **リリースは `scripts/release.sh <X.Y.Z>` に集約**（版数を単一ソース化）: `const APP_VERSION`（**両 HTML**）と `sw.js` の `VERSION`（`yomikake-shell-vX.Y.Z`）を一括で書き換え → 一致検証 → `release: vX.Y.Z` コミット → タグ → push → GitHub Release。`--notes-file` / `--title` / `--yes` / `--no-release` 対応。手で版数を触る必要はない。`scripts/install-hooks.sh` で入れる `pre-push` フックが「3箇所の版数＝タグ」を検査（非ブロック）。**版数表示**: ヘルプモーダル冒頭に `yomikake vX.Y.Z`（`APP_VERSION`）を常時表示。**更新通知**: SW はサイレント自動更新（`skipWaiting`）のまま、Init で `APP_VERSION` と `localStorage.epub_app_version` を比較し、変化時のみ `toast.updated` を一度表示（初回は無音・`file://` でも動作）。両ファイル共通。

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

### テスト

```sh
tests/lib/run.sh            # 全ケースを両ファイルに流す（落ちたら exit 1）
tests/lib/run.sh theme      # 名前で絞り込み
```

依存は python3・node・Chrome 系 1 本のみ（自動探索・無ければ SKIP）。詳細は `tests/README.md`。

**主目的は `yomikake.html` と `yomikake_ios.html` の同期崩れの検知** — 同じ assertion を両ファイルに流すので、片方だけ直した事故がその場で出る。この repo 最大の弱点をコードで見張るためにある。E2E は `tests/lib/make-fixtures.py` が生成する合成 ePub（リフロー4章／FXL4ページ）を使うので `temp_sample/`（個人の蔵書）に依存しない。

**担保できないこと（実機確認が必須）**: headless の `--dump-dom` では `requestAnimationFrame` が発火せず `loadEpub()` が完了しないため、E2E は **rAF を `setTimeout` に差し替えている**。iPad の `double-rAF + 500ms フォールバック`・`EPUB_READY` の seq 競合・`_isRendering` の窓といった**タイミング由来のバグは検出できないどころか隠れる**。ほかに 500px 未満の実寸レイアウト、iOS Safari 固有挙動（transform スクロール・`dvh` と URL バー・セーフエリア）、実音声 TTS、Drive 連携、タッチ操作も対象外。手動テストには `.epub` / `.kepub` が要る。

### Keeping both files in sync

Most features exist in both files. As a rule:
- **`yomikake.html` only**: drag-and-drop, toolbar mouse-wheel scroll, `SHARED_TAIL` (Chrome `text-combine-upright` fix), `isNeg()` sign detection in horizontal/publisher scroll.
- **`yomikake_ios.html` only**: CSS-transform scroll mechanism, touch swipe inside iframe, `CLICK_HANDLER` / `INIT_FN` template variables, double-rAF + 500ms `INIT_FN` timing, `will-change:transform` on body.
- **Both files**: all other features — rendering pipeline, postMessage protocol, i18n, settings, bookmarks, Drive sync, fullscreen, progress bar, full-text search, sidebar tabs, `_renderSeq`, `_isRendering` / `_pendingScrollAfterRender`, `_bookFinished`, chapter-end blank page, `flashOverlay()`, `flashNavButtons()`, `showResumeBanner()`, `showFinishedBanner()`, `showToast()`, `toggleSidebar()`, `buildReadingList()`, `formatRelativeDate()`, `extractCoverThumb()`, `saveBookMeta()`, `closeBook()`, `finalizeCurrentBook()`, `openBtnClick()`, `revealControls()`, `updateToolbarFade()`, `openFilePickerForBook()`, **タップページ送り／操作ガイド／起動時自動オープン** (`tapZoneAction`, `runTapAction`, `changeTapZone`, `updateTapZoneBodyClass`, `showTapGuide`, `hideTapGuide`, `showNavHint`, `showTapMenu`, `hideTapMenu`, `tapMenuAct`, `_tapGuideOpen`, `_tapMenuOpen`, `TAP_EDGE_RATIO`, `autoOpenLastBook`, `toggleAutoOpenLast`, `updateAutoOpenToggleUI`), **Loading overlay** (`showLoading`, `showLoadingPreSelect`, `updateLoadingStage`, `hideLoading`, `_loadingShown`), **キーボード操作** (`handleKey`, `handleListKey`, `openSearchPane`, `reclaimKeyFocus`, `_KEY_REPEATABLE`, `_rlSelKey`, `_rlSyncSelection`, `_rlMoveSel`, `rlCardOpen`, `_helpKeysHtml`, `_kbSeen`, `EPUB_KEY`), FXL rendering (`renderFxlPair`, `buildFxlPairs`, `isEffectiveSpread`), **FXL コマ読みズーム** (`applyFxlZoom`, `applyFxlRegionPreset`, `clampFxlPan`, `getTargetPageRect`, `regionCellForIdx`, `resetFxlZoom`, `enableFxlZoom`/`disableFxlZoom`/`toggleFxlZoom`, `advanceFxlZoomStep`/`advanceFxlZoomSpine`, `handleFxlTap`, `regionIdxFromPoint`, `updateFxlNextBtnUI`, `updateFxlRegionPillUI`, `onFxlRegionPillClick`, `changeFxlZoomLevel`, `changeFxlRegionOrder`, `toggleFxlLtrAutoFlip`, `updateFxlLtrAutoFlipUI`, `FXL_REGION_ORDERS`), **FXL 軸モード（vfill / hfill）** (`isFxlAxisMode`, `applyFxlAxisPreset`, `getZoomStepMaxIdx`, `syncFxlAxisModeUI`, `_fxlAxisCache`, `_fxlAxisLandAtEnd`), **FXL 透明テキスト検索＋ヒットハイライト** (`applyFxlSearchHighlight`, `clearFxlSearchMarks`, `_fxlPendingHighlight`, `_lastSearchQuery`), **読み上げ（TTS・Web Speech API・v2.9.0）** (`ttsExtractText`, `ttsSplitChunks`, `ttsResolveVoice`, `ttsPlay`, `ttsPause`, `ttsResume`, `ttsStop`, `ttsPrevSent`, `ttsNextSent`, `ttsAdvanceChapter`, `ttsOnUserNavigate`, `ttsLoadChapterAndSpeak`, `changeTtsRate`, `changeTtsVoice`, `buildTtsVoiceSelect`, `updateTtsUI`, `ttsRequestWakeLock`, `ttsReleaseWakeLock`, `ttsInit`, `_tts`, `_ttsInternalNav`), **書誌情報ブロック・底本サイトリンク（v2.10.0）** (`SOURCE_SITES`, `siteNameFromUrl`, `classifySource`, `_parseCreatorsRoled`, `resolveSourceFromSpine`, `_authorSearchLink`, `_helpCreatorsHtml`, `_helpSourceHtml`, `state.bookPublisher`/`bookSourceUrl`/`bookSourceIsbn`/`bookSourceSite`/`bookCreatorsRoled` — 設計書 `design_bibliography_source_link.md`), **書誌ブロック拡充（v2.11.0）** (`normalizeIsbn13`, `_isbnFromIdentifiers`, `_pubDateFromOpf`, `_seriesFromOpf`, `_parseRoledPeople`, `ROLE_PRODUCTION`, `ROLE_KEY`, `_helpProductionHtml`, `_formatPubDate`, `_helpPubDateHtml`, `_helpSeriesHtml`, `_helpDescriptionHtml`, `toggleHelpDesc`, `_helpRightsHtml`, `state.bookContributorsRoled`/`bookDescription`/`bookPubDate`/`bookSeries`/`bookRights` — 設計書 `design_bibliography_v2.md`。**contributor は表示専用で `bookCreators` に混ぜない**＝しおりキー不変).

**配信元メタデータ・本棚のジャンル分け（v2.12.0）** (`ND_GENRES`, `genreLabel`, `_ndMeta`, `_ndMetaInt`, `_subtitleFromOpf`, `_subjectsFromOpf`, `_audienceFromOpf`, `_countEpisodesInSpine`, `_helpSubtitleHtml`, `_helpStatusBadge`, `_helpGenreHtml`, `_helpTagsHtml`, `_helpAudienceHtml`, `_helpSourceUpdatedHtml`, `_helpVolumeHtml`, `_rlSyncGenreUI`, `toggleRlGenreMenu`, `setRlGenre`, `state.bookSubtitle`/`bookGenre`/`bookGenreRaw`/`bookSerial`/`bookTags`/`bookEpisodeCount`/`bookCharCount`/`bookSourceUpdated`/`bookAudience` — 設計書 `design_metadata_bookshelf.md`）。novel_downloader v2.4.0 以降が出力する `nd:*` と標準語彙を読む。**`nd:` を1件も出さない本では `prefix` 宣言ごと省略される**ので宣言の有無で判定しない。**`state.spine.length` は話数ではない**（表紙・目次・奥付を含み、実測で2話の本が spine 6件）。本文は `_countEpisodesInSpine()` で数える。**しおり JSON に増やすのは `genre` / `serial` の2つだけ**（タグ・あらすじは容量を食うので保存しない）。この2つは本を開いた端末にしか無いため、`_rdMergePos` / `_rdMergePosBest` の**両方**で `creators` / `cover` と同じく「どちらかにあれば残す」扱いにしている。

**KOReader 読書位置同期（kosync・v2.22.0）** (`koMd5Create`, `koMd5Bytes`, `koPartialMd5FromBlob`/`FromBuffer`, `koPartialMd5Offsets`, `koFilenameMd5`, `koEnsureDocHashes`, `_koDocGet`/`_koDocSet`/`_koDocDelete`, `_koConfLoad`/`_koConfSave`, `_kosync`, `koBaseUrl`, `koFetch`, `koConfigured`, `koTestConnection`, `koRegister`, `updateKosyncUI`, `koParseXPointer`, `koResolveSteps`, `koNthChildByTag`, `koResolveInChapter`, `koMarkXPointerTarget`, `koTargetFromProgress`, `koGetRemote`, `koPullForCurrentBook`, `showKosyncMoveToast`, `koTextBlocks`, `koPickElementForRatio`, `koPathToElement`, `koStepsToXPointer`, `koBuildProgress`, `koCurrentPercentage`, `koPushForCurrentBook`, `koAutoPullOnOpen`, `koScheduleAutoPush`, `koRunAutoPush`, `koFlushAutoPush`, `_koPendingTarget`, `_koPullDone`, `_koLastPushed`, `KO_TARGET_ID` — 設計書 `design_kosync.md`)。

- **CORS が最大の障害で、これは回避できない。** kosync は `PUT` ＋ 独自ヘッダ（`x-auth-user` / `x-auth-key`）が必須なので**必ずプリフライトが飛ぶ**が、公式 `sync.koreader.rocks` も `sync.send2ereader.net`（`nperez0111/koreader-sync`）も `Access-Control-Allow-Origin` を返さない。`no-cors` では応答を読めず pull が成立しない。→ **`www.ayati.com` の Apache に `/kosync/` のリバースプロキシを置いて同一オリジンにしてある**（`<VirtualHost *:443>`。80 に置くと 443 で Apache 素の 404 が返る）。yomikake 側は**サーバ URL のテキスト欄 1 つ**しか持たず、相手が本家か中継かを知らない（v2.19.0 の受け渡しと同じ設計判断）。転送先を変えても**コードは 1 行も変わらない**。
- **`sw.js` に `/kosync/` の除外がある（必須）。** 同一オリジンにした副作用で kosync の GET がルール 3（cache-first）の射程に入る。今は素通しだが、将来ランタイムキャッシュを足すと「しおりが古いまま返る」壊れ方をする。
- **partial MD5 の先頭オフセットは 0**（`lshift(1024, -2)` が 32bit で溢れる）。二次情報の「256」説は誤り。**KOReader 実機 2 台のサイドカー 3 件と照合済み**。オフセットは `0,1024,4096,…,1073741824` の各 1024B・EOF で打ち切り。`Blob.slice` で 12KB しか読まないので 159MB の本でも軽い。**MD5 は WebCrypto に無いので自前実装をインライン**（逐次 `update` できる形が要る）。
- **`_koHashReady` を待ってから pull / push する。** 初回オープンではハッシュ確定（`koEnsureDocHashes`）が fire-and-forget で走るため、自動 pull がそれより先に動くと `_koDocGet` が空を返して**「記録なし」と誤判定**する。
- **`epub_kosync`（認証情報）と `epub_kosync_docs`（bookKey→ハッシュ）は別キー。** しおりに混ぜない＝`collectBookmarks()` の走査対象（`epub_pos_*` / `epub_last_book`）から**構造的に外れる**。`x-auth-key` の `userkey` は**パスワードと等価**なので、書き出しにも Drive にも絶対に載せない。平文パスワードは保存せず md5 だけ持つ。
- **XPointer は `DocFragment[N]` → `state.spine[N-1]`、以降は「同名兄弟の 1 始まり添字」で素朴に解決できる**（実機 2 台 3 例で検証済み）。**照合はローカル名で行う**（名前空間を見ない — crengine のパスには SVG が裸の `svg` として出る）。末尾の `text().N` / `.N`（文字オフセット）は無視する。
- **pull の着地は既存のアンカースクロールに載せる。** 解決できた要素に `buildSrcdoc()` の中で `id="__ko_xp_target"` を打ち、`renderPage(idx, '#__ko_xp_target')` を呼ぶ。`'#id'` 経路は両ファイルで実績があり、**id が無ければ自動的に先頭へ落ちる**。位置計算を新規に書くと iOS の transform スクロールぶんだけ二重に持つことになるので触らない。`_koPendingTarget` は**一回限り**で、`buildSrcdoc` が消費したら必ず捨てる（`_fxlPendingHighlight` と同じ作法）。本の切り替えと `closeBook()` でも掃除。
- **解決の可否は描画前に判定する**（`koResolveInChapter`）。`buildSrcdoc` に入ってから外れると「id が無いので先頭に落ちる」しかできず、呼び出し側が章頭フォールバックを選べない。
- **push は 3 段で守る**: (1) ブロック要素どまりの XPointer しか作らない (2) 送る前に自分の解決器へ流して元の要素に戻ることを検算する (3) 戻らなければ親で組み直し、最後は章頭 `/body/DocFragment[N]/body` に落とす。**指す要素は `_intraChapterRatio` から決める** — iframe の中を直接測ると iOS のスクロール機構ぶんだけ別実装が要る。章の XHTML を読んで**テキストを持ついちばん内側のブロック要素**を**文字数で按分**する。この作りだと `ruby`/`rt`/`span` が候補に入らないので (1) が構造的に保証される。
- **`percentage` は位置に使わない（実測）。** 同じ本のほぼ同じ位置で Android 0.0695 / PocketBook 0.0569（`doc_pages` 187 vs 281）と**22% ずれる**。KOReader 端末どうしでも一致しない量なので、位置の情報源にも本の同定にもしない。使うのはずれの検算だけ。
- **pull は両方式を試し、順序は設定した方式が先。** 両方に記録がある場合、もう片方は過去の設定で書かれた古い記録でありうる。**push は設定した方式だけ**に書く（使っていない側に古い記録が残ると、後でそれを拾って位置が後退する）。
- **自動 push のタイミング**: `EPUB_POS`（スクロール）→ `koScheduleAutoPush()` で **60 秒デバウンス**（`AUTO_SAVE_INTERVAL` を Drive 自動保存と共有）。前回送信から 60 秒経っていれば即時。加えて `finalizeCurrentBook()`（リストへ戻る・別の本へ切り替え）と **タブ非表示・`pagehide`** で `koFlushAutoPush()` が保留分を確定させる。**読み上げ中は予約しない**（TTS は文単位で `savePos` するので、無意識スクロール由来の位置を送るとあちらのしおりが読み上げ位置とずれる）。ガードは `koScheduleAutoPush()` の中に置く —— 呼び出し元が増えても効くように。
- **鉄則: pull が済むまで自動 push を武装しない**（`_koPullDone`）。先行事例（Readest issue #5625）は XPointer の解決に黙って失敗したあと、5 秒後の自動保存が自分のローカル位置でリモートを上書きして正しい位置を破壊した。**同じ位置を送り直さない**（`_koLastPushed`）のも必須 — KOReader 側の `timestamp` を無意味に更新すると、あちらの正しい位置を「古い」と誤判定させる。
- **FXL は 1 spine = 1 ページなので最も相性が良い**（章内位置の概念が無く、pull も push も無損失）。KOReader は ePub を FXL でも rolling 扱いするので XPointer が来る（`has_pages` が真になるのは PDF/CBZ/DjVu）。
- 自動同期の既定は **OFF**（Drive 自動保存と同じ。KOReader 側にも自動/手動があり、両方が勝手に動くと「どちらが位置を書いたか」を追えなくなる）。`file://` では機能ごと非表示。
- **実機確認済み（2026-08-30）**: リフロー本・FXL 本（AKIRA1）とも**取得・送信の双方向**で成功。**`yomikake_ios.html`（iPad）でも双方向で確認済み**（iOS 版が同じコードで通ったのは、pull の着地を既存のアンカースクロール `'#id'` 経路に載せたため。位置計算を自前で書いていたら iOS の transform スクロール向けに別実装が要り、独立したバグ源になっていた）。これで**「ブラウザが生成した XPointer を crengine が解決できるか」が決着**した（§2-5 で確かめられたのは crengine → ブラウザの向きだけで、逆向きは実機でしか確かめようがなかった）。§4-3 の 3 段の守りは残す —— ePub の作りは千差万別で、章頭フォールバックに落ちる本はいずれ出る。
- テストは `tests/cases/kosync.js`（両ファイル各 211 assertion）。`window.fetch` を差し替えて**実際に飛ぶヘッダと本文**まで検査している。

**表示設定のきめ細かい改善 第1弾（v2.13.0）** (`applyThemeClass`, `updateMetaThemeColor`, `_darkMQ`, `resolveAutoTheme`, `applyAutoTheme`, `toggleThemeAuto`, `changeAutoTheme`, `syncAutoThemeUI`, `updateThemeAutoToggleUI`, `TOOLBAR_ITEMS`, `applyToolbarPrefs`, `toggleToolbarItem`, `updateToolbarPrefsUI`, `DISPLAY_DEFAULTS`, `syncAllSettingsUI`, `resetDisplaySettings`, `state.themeAuto`/`themeLight`/`themeDark`/`toolbarHidden` — 設計書 `design_display_settings.md`)。

- **OS テーマ連動** — `state.theme` には**常に「解決後の実効テーマ」**を入れ、連動の有無は独立フラグ `themeAuto` で持つ（`theme` に `'auto'` のような番兵値を入れると `THEME_CONTENT` 参照・`buildSrcdoc()` の色注入・`updateThemeBtnUI()` の全経路に分岐が波及する）。`prefers-color-scheme` の `change` を購読して読書中でも即反映（`rerenderKeepPos()` なので読書位置は保持）。**連動ON中にテーマチップを直接押したら連動は自動解除**（`.set-row-disabled` で押せなくすると理由が伝わらないため）。Safari 13 以前向けに `addListener` フォールバックあり。
- **`applyThemeClass(v)`** が `changeTheme()` / `loadSettings()` / `applyAutoTheme()` の共通経路。`theme-*` クラスだけを差し替える（`document.body.className` 丸ごと代入だと `mode-fxl` が外れて FXL 本が消える）。`<meta name="theme-color">` も `updateMetaThemeColor()` で追従させる（`manifest*.webmanifest` の `theme_color` は起動スプラッシュ用なので触らない）。
- **ツールバー項目の表示切替** — 隠せるのは 目玉/読み上げ/読書データ/全画面/ヘルプ/Drive(2ボタンで1キー)/FXLズーム の7つ。**`#open-btn`・`#toc-btn`・`#book-title`・`#settings-btn` は隠せない**（動線が消えると復帰不能）。`.tb-off { display:none !important }` の `!important` は `body.mode-fxl #tts-btn` や `.fxl-only` と競合したとき「隠す側」を必ず勝たせるため（外れれば既存ルールが復帰する）。**`applyToolbarPrefs()` は末尾で必ず `updateToolbarFade()` を呼ぶ**（ボタン数が変わればモバイルの右端フェードの要否も変わる）。読み上げ非対応環境では tts 行を、`file://` では Drive 行を出さない。キーは `data-tbkey` 属性で渡す（インラインハンドラ規約）。
- **テーマ名ラベル** — テーマ名は `title` 属性にしか無くタッチ端末では読めなかったため、`.theme-cell`（丸＋名前）構成に変更。グリッドは `repeat(4,1fr)`。`.tb-*` クラスは維持したので `updateThemeBtnUI()` は変更不要。
- **スマホの設定はボトムシート** — `@media(max-width:640px)` で下端接地・全幅・上角丸。`max-height` は `min(82dvh, calc(100dvh - 56px))` に留め、背景の本文を必ず覗かせて「背景タップで閉じられる」ことを示す。グラバーは見た目の手がかりのみ（ドラッグ開閉は iOS の慣性と干渉するため実装しない）。
- **表示設定リセット** — `DISPLAY_DEFAULTS` の範囲だけを戻す。**しおり・ePubキャッシュ・言語・`ttsRate`/`ttsVoice`・`driveAutoSave`・`autoOpenLast`・`epub_rl_prefs` は触らない**。`syncAllSettingsUI()` は `loadSettings()` と役割が違う（後者は「保存値が無ければ触らない」意味論）ので統合せず並存させている。
- **行間セレクトの注意** — `state.lineHeight` は数値なので `String(2.0)` は `'2'` になり `<option value="2.0">` と一致しない（既定値のとき行間セレクトが空欄になる不具合があった）。`Number(v).toFixed(1)` を使うこと。

**表示設定のきめ細かい改善 第2弾（v2.14.0）** (`applyScreenFilter`, `updateFilterIndicator`, `changeBrightness`, `changeWarmth`, `updateFsHudTime`, `updateFsHudPct`, `syncFsHud`, `changeFsHud`, `_fsHudTimer`, `SET_GROUP_DEFAULT_OPEN`, `applySetGroupsOpen`, `_wireSetGroupToggles`, `state.brightness`/`warmth`/`fsHud`/`setGroupsOpen` — 設計書 `design_display_settings.md`)。

- **明るさ・暖色フィルタ** — **CSS `filter` は使わない**。半透明オーバーレイ `#screen-filter` 1 枚を重ね、CSS 変数 `--dim-a` / `--warm-a` を書き換えるだけ（再描画不要）。`filter` は新しい合成レイヤーを作るため、`yomikake_ios.html` の CSS transform スクロール・FXL の transform ズーム・FXL 検索ハイライトの SVG 幾何（`preserveAspectRatio` 依存）と干渉するおそれがある。**`z-index:15`** は本文（iframe / `#fxl-container` / `#page-overlay`:10）の上、操作系 UI（ナビ 20 / モバイル進捗 25 / 領域ピル 28 / TTSバー 40 / 完読バナー 50 / ガイド 60 / メニュー 70）の下 — 暗い中で操作子まで見えなくならないようにする。`#reading-area` の最後の子なので読みかけリストも覆う（夜に本を閉じたとき本棚で目を焼かれない）。最暗でも α≈0.50 に留める。**目印は強く効いているときだけ**出す（`FILTER_HINT_BRIGHTNESS=60` 以下 or `FILTER_HINT_WARMTH=3` 以上のとき `#settings-btn` に `.filter-on`）。既定でないだけで出すとテーマや文字サイズにも同じ理屈が必要になり過剰。Drive 自動保存の `.auto-save-on` とは意味が違う（あちらは**画面に痕跡が残らない**裏の処理の可視化。明るさは画面が暗いという形で自己申告している）。`.filter-on` に `border-radius` は指定しない — `.icon-btn` の 6px を上書きすると目印が付いている間だけ歯車の角丸が他のアイコンと変わる。
- **全画面 HUD** — `#fs-hud` は `body.fullscreen` の間だけ右下に出る。**`pointer-events:none` は必須** — `tapZone` が `'lshape'`/`'tb'` のとき下端はページ送り帯であり、HUD がタップを吸うと「ここだけ反応しない」死角ができてタップ操作ガイドが嘘をつく。位置が右下なのは下端中央を `#btn-scroll-fwd` が占めるため。進捗は進捗バーと**同じ式**を使い `updatePageInfo()` から更新する。時計の `setInterval` は全画面の間だけ arm し、`toggleFullscreen` と `fullscreenchange` の**両方**から `syncFsHud()` を呼ぶ（Layer2 の外部解除に追従）。**バッテリー残量は入れない**（`getBattery()` は Chromium 限定で iOS Safari に無い）。
- **設定グループの折りたたみ** — `SET_GROUP_DEFAULT_OPEN` が対象 9 グループと既定の開閉を持つ。**Init では `loadSettings()` の後にも `applySetGroupsOpen()` を呼ぶこと** — `loadSettings()` は保存値が無いと早期 return するため、初回訪問時に既定の開閉が DOM に届かない。既定で開く 3 つは markup にも `open` を書いてちらつきを防ぐ。
- **`resetDisplaySettings()` はオブジェクトをコピーする** — `state[k] = v` で参照を代入すると `DISPLAY_DEFAULTS.setGroupsOpen` 自体が汚れ、2 回目以降のリセットが壊れる。
- **`syncAllSettingsUI()` は「state → UI 反映」だけを行う。副作用のある適用（`applyOrientationLock()` 等）を混ぜないこと** — この関数は `resetDisplaySettings()` と `applyBookPrefs()`（＝**本を開くたび**）の両方から呼ばれる。ロックの掛け直しをここに置くと、`lock()` の一時的な失敗で `_onOrientationLockFail()` が走り、**ユーザーの設定が無断で `'off'` に戻る**（v2.16.0 のレビューで是正）。

**表示設定 第3弾（v2.15.0）** (`LETTER_SPACING_EM`, `previewLineHeight`, `changeLineHeight`, `previewLetterSpacing`, `changeLetterSpacing`, `setTtsRate`, `_orientationLockSupported`, `changeOrientationLock`, `applyOrientationLock`, `_onOrientationLockFail`, `updateOrientationLockUI`, `state.letterSpacing`/`orientationLock` — 設計書 `design_display_settings_v3.md`)。

- **行間はスライダー（1.4–3.0・0.1 刻み）** — 旧 4 値（1.6/2.0/2.4/2.8）はすべて新レンジの刻みに乗るので移行不要。**`oninput` では数値ラベルだけ更新し、再描画は `onchange`（ドラッグ終了）で行う** — `rerenderKeepPos()` は章全体を描き直すので、明るさ（CSS 変数だけで完結）と違いドラッグ中に毎ステップ走らせると重い。
- **字間は `body` 側 1 箇所にのみ注入し、0 のときは宣言ごと出さない**（`letter-spacing` は最終文字の後ろにも空きを入れるため、既定では一切触らない）。**`rt,rp` は `letter-spacing:normal` で打ち消す** — 継承するとルビ文字まで間延びして親字とのバランスが崩れる。
- **⚠ 縦中横フィックス（`fixTcy`）との干渉** — `fixTcy` は body の `letter-spacing` を微小変更してレイアウトを dirty にする実装。字間注入は `!important` の author スタイルなので、**非 important の inline style では摂動が効かず縦中横の左ずれが再発する**。`setProperty(..., 'important')` で摂動し、`getPropertyValue`/`getPropertyPriority` で元の値と優先度を厳密に復元すること。`letter-spacing` を触る改修をする際は必ずここを確認する。
- **読み上げ速度** — 絶対値セッター `setTtsRate(v)` が本体で、`changeTtsRate(delta)`（バーの ＋/－）はラッパ。**`updateTtsUI()` がバーと設定セレクトの両方を同期する**（片方だけだと 2 つの UI が食い違う）。option の `value` は `toFixed(2)` と一致する文字列（`'1.00'`）で書くこと。`ttsRate` は**リセット対象外**（読み上げ設定は触らない方針）。
- **画面の向きロック** — `screen.orientation.lock()` は環境差が大きい（Android Chrome は全画面/インストール済み PWA が要る、iOS Safari には `lock()` が無い、デスクトップは効果なし）。**(1) `lock` が生えている環境でだけ設定行を出す (2) 全画面に紐付けて掛け外しする (3) 失敗したら設定ごと `'off'` に戻してトースト**、の 3 点で組んである。`lock()` が Promise を返さない実装・同期例外を投げる実装のどちらでも落ちないようにしてある。

**本ごとの表示設定（v2.16.0・B-7）** (`BOOK_PREFS_KEY`, `_bpLoad`, `_bpSave`, `_bpPrune`, `_bpGet`, `_bpSet`, `_bpDelete`, `_bpClearAll`, `applyBookPrefs`, `_bpFontUsable`, `toggleBookPrefs`, `updateBookPrefsToggleUI`, `state.bookPrefsEnabled` — 設計書 `design_per_book_settings.md`)。

- **覚えるのは 5 つだけ**: `writingMode` / `fontMode` / `fontSize` / `spreadMode` / `fxlRegionOrder`。線引きの基準は「同じ本で前と同じであってほしいか」ではなく **「本が変われば変わるべきか」** — テーマ・明るさ・余白・行間・字間・タップ設定は読者の目や環境で決まるので対象外。
- **`epub_pos_*` の値には入れない。別キー `epub_book_prefs` にする** — しおりは Drive 同期・JSON 書き出し・墓標マージの対象で、そこに端末固有の表示設定を混ぜると「表示設定は端末ローカルに閉じる」方針（B-8 不採用）と矛盾する。**別キーであること自体が同期に載せない構造的な保証**。
- **`change*()` はグローバルと本ごとの両方に書く** — 本ごとにだけ書くとグローバルが初期値で固定され、新しい本を開くたびに設定し直す羽目になる。両方書けば「最後に使った設定」が新しい本の既定になる。
- **`_bpSet` は触った項目だけ記録する** — 全項目のスナップショットにすると、一度開いただけの本が古い設定を丸ごと抱え込み、グローバルを変えても反映されない「なぜかこの本だけ古い」状態になる。
- **適用は `loadEpub()` の `state.bookKey` 確定後・最初の `renderPage()` より前**（`renderMode` は既に確定済み）。ここでないと開いてから設定が切り替わってチラつく。
- **リセット（`resetDisplaySettings`）は `_bpClearAll()` で全消しする** — 残っていると本を開き直した瞬間に復活し「リセットしたのに戻らない」という最悪の体験になる。確認文にも明記してある。
- ローカルフォント（`custom:`）は `state.customFonts` に実体が無ければ**採用しない**（端末ごとに有無が違う。既定へ落とすより現状維持のほうが混乱が少ない）。
- **マップのキー存在判定は `hasOwnKey(obj, k)` を使う**（`k in obj` / `obj[k] !== undefined` は禁止）— プロトタイプチェーンを拾うため `'constructor'` や `'toString'` が検証を通ってしまう。検証対象は localStorage 由来の値で、たとえば `FONTS['constructor']` は関数を返し、そのまま `font-family` へ文字列化されて流れ込む。`THEME_CONTENT` / `I18N` / `FONTS` の判定はすべてこれに統一済み（v2.16.0）。
- 完全削除（`_rlPurgeLocalData`）では該当エントリも消す。論理削除（`markAsFinished`）では消さない。

**読了管理と同期（v2.17.0）** (`_posAtEnd`, `showSyncFinishedToast`, `state`/しおり値の `finishedAt`/`finishedCount`, `_rlCollect` の `atEnd`/`finished`/`newCh`/`hasMore`, `_rlPrefs.filterHasMore` — 設計書 `design_finished_sync.md`)。

- **「読了」は位置からの派生値ではなく記録**。しおり値に `finishedAt`（初読了日・最古を採る）と `finishedCount`（**最後に読み終えた版の `spineCount`**・最大を採る）を持ち、位置とは独立にマージする。これ以前は `spineIdx >= spineCount-1 && ratio > 0.9` の計算結果しかなく、**別端末で読了 → 読みかけ端末が本を開いたまま同期 → `savePos` が位置を戻す → 自動保存が Drive の読了まで消す**という逆流が起きていた。
- **`_rlCollect` が出す 4 語を使い分ける**: `atEnd`（いま末尾にいる）/ `finished`（`!!finishedAt || atEnd`）/ `newCh`（読了した版より増えた章数）/ `hasMore`（`newCh>0 && !atEnd`）。**隠す・進捗100%・purge 判定は `atEnd`、読了バッジ・読了冊数・著者集計・読了タイムラインは `finished`**。混同すると再読中の本が本棚から消える／読了統計が減る。
- **`finished` に `atEnd` を OR で残すのは必須** — (1) v2.16.0 以前のデータと旧ビルドの端末には `finishedAt` が無い、(2) 論理削除（`markAsFinished`）は意図的に `finishedAt` を刻まず位置だけ末尾に書く。
- **`!atEnd` は 2 つの別事象の合流点**（設計の核心）。読了本で `atEnd` が外れる経路は「位置が戻った（再読）」と「**分母が増えた（連載に新章）**」の 2 つあり、比較式では区別できない。`finishedCount` との差 `newCh` で分離し、後者を `🆕 続きN章` バッジ＋`filterHasMore` チップとして見せる（**読了本は本棚から消えるので、連載の更新に気づく手段が今までゼロだった**）。
- **`_rdMarkFinishedAt()` は早期 return しない** — `finishedAt` は初回のみ、`finishedCount` は**毎回**更新する。早期 return すると旧データ・同期で昇格したエントリに `finishedCount` が永久に入らない。
- **`spineCount` と `finishedCount` は合流則が逆** — `_rdMergePosBest` の `spineCount` は**位置の勝者（base）から採る**（`Math.max` だと「他人の分母 × 自分の位置」で読了が 79% に化ける）。`finishedCount` は最大。前者は位置とセット、後者は読了とセットで所属が違う。
- **取り込み時に旧データを昇格させる**（`_posAtEnd`）— 両側に `finishedAt` が無くどちらかが末尾なら `finishedAt = lastOpenedAt` / `finishedCount = その値の spineCount` を刻む。これで旧ビルドが書いた Drive/JSON からも読了が伝わる。判定は必ず**生の値**に対して行う（`merged` に対して行うと base 差し替え後の混合値を見る）。
- **同期告知トーストの条件は `isAhead && !isNotFinal && !_bookFinished`** — `isAhead` を外すと、自分が最終章を読んでいるだけの平常時に毎回「別の端末で読み終えています」が出る。`isNotFinal` ガード自体（位置ジャンプの抑制）は残し、**読了の取り込みだけを分離**する。`driveDownload` / インポートでは `jumped` を立てず `finishedNotice` フラグ経由で件数トーストの**後**に出す（アクショントーストは後勝ち）。
- **読了の取り消しボタンは作らない** — 取り消しの同期には墓標相当の仕組みが要る。「本を開いて読み進めれば `atEnd` が false になり再読中として本棚に戻る」で代替する。

**読み上げのバックグラウンド強化（v2.18.0）** (`TTS_KEEPALIVE_HZ`, `TTS_KEEPALIVE_AMP`, `_ttsMakeKeepAliveUri`, `_ttsKeepAliveStart`/`_ttsKeepAliveStop`, `_ttsKeepAudio`, `ttsSyncMediaSession`, `_ttsInitMediaSession`, `_ttsMsSpine`, `toggleTtsKeepAlive`, `updateTtsKeepAliveUI`, `TTS_LOOKAHEAD`, `ttsRestartQueue`, `ttsFillQueue`, `_ttsMakeUtterance`, `_ttsUnpauseForSeek`, `_tts.queuedTo`, `_ttsAdvancing`, `state.ttsKeepAlive` — 設計書 `design_tts_background.md`)。

- **`speechSynthesis` はブラウザから見て「メディア再生」ではない。** だからタブの *audible* フラグが立たず、背面タブの凍結（Page Lifecycle）とタイマースロットリングをそのまま食らうし、Media Session にも登録できない。利用者側の設定（電池最適化の解除・PiP 許可・通知許可・PWA インストール）はすべて**動画/ネイティブメディア向け**なので一切効かない。`design_tts.md` の「バックグラウンド再生は技術的に不可能」は `speechSynthesis` を使う限り正しく、**真の解決は「実音声にする」（クラウド TTS / WASM ニューラル TTS）以外にない**。v2.18.0 はその手前の延命策で、Android で効く保証はない。
- **キープアライブは完全な無音では効かない** — Chrome の `AudioStreamMonitor` は実際の振幅を見て audible を判定するので、振幅ゼロのファイルではタブが audible にならず無意味。19kHz / 約 -48dBFS（`TTS_KEEPALIVE_AMP`）で「成人にほぼ聞こえず・スマホのスピーカーは帯域外で出せない」を狙っている。**効いているかの検証は「再生中にタブへスピーカーアイコンが出るか」の目視** — これが audible 判定の直接の証拠。出なければ AMP を上げる。WAV は `_ttsMakeKeepAliveUri()` が実行時に組み立てる data URI（外部アセットを増やさず 2 ファイル構成を守るため）。
- **`_ttsKeepAliveStart()` は `ttsPlay()` の同期部（`u0` speak の直後）でしか呼べない** — その下は `await` をまたぐので autoplay policy に弾かれる。**そこから先の早期 return が 4 経路ある**（音声なし / `!item` / ZIP 読み失敗 / チャンク 0）ので全経路で `_ttsKeepAliveStop()` すること。「無音だけが鳴り続ける」状態を作らない。停止は `ttsStop()` に集約されている。
- **Media Session は実音声（キープアライブ）が鳴って初めて機能する。** `ttsSyncMediaSession()` は `_ttsMsSpine` を見て**章が変わったときだけ**メタデータを組み直す（毎チャンク作り直さない）。artwork は既存の `state.bookCoverDataUri` をそのまま使える。**Android でキープアライブが効かなかった場合、ロック画面の操作子だけ出て押しても鳴らない見せかけになりうる。実機判定の合否は「操作子が出るか」ではなく「読み上げが継続するか」で見ること。**
- **先読みキューは `_tts.idx`（いま発話中）と `_tts.queuedTo`（積み終わり）を分ける。** `ttsRestartQueue()` が cancel を伴う唯一の経路で、`ttsFillQueue()` は補充だけ（ここで cancel すると先読みの意味が消える）。旧 `ttsSpeakNext()` は廃止し、全呼び出し元が `ttsRestartQueue()` に移行済み。
- **現在地の確定と `savePos` は `onstart` だけで行う** — `onend` で `idx++` すると先読みした分しおりが先へ飛び、逆に `onend` で `savePos` すると 1 つ後ろへずれる（チャンク i の `onend` 時点では既に i+1 が発話中）。
- **`onstart` からも `ttsFillQueue()` を呼ぶこと** — `onend(i)` と `onstart(i+1)` の発火順は保証されず、`onend` が先だと上限が `queuedTo` と同値になり**1 本も補充されない**。毎チャンク繰り返すとキューが 1 本ずつ枯れて元の直列動作に戻る。`onend` 側には `onstart` を発火しないエンジン向けの idx 保険も要る。
- **`ttsAdvanceChapter()` は `ttsLoadChapterAndSpeak()` を呼ぶ直前で `_ttsAdvancing` を降ろす** — 立てたままだと新章の `ttsFillQueue()` が自分のフラグで止まる。
- **`ttsPrevSent`/`ttsNextSent` は一時停止中に押されたら `_ttsUnpauseForSeek()` で復帰させる** — `ttsPause()` がキープアライブと Wake Lock を落としているため、掛け直さないと再開後に背面で止まる（v2.17.0 以前は Wake Lock について同じ穴があった）。
- `state.ttsKeepAlive` は `epub_settings` に永続化。**`DISPLAY_DEFAULTS` に入れない**ので自動的にリセット対象外（`ttsRate`/`ttsVoice` と同じ）。他アプリの音楽が止まる／ダッキングされる副作用があるので OFF の逃げ道は必須。
- **実機確認済み（2026-08-06）**: Windows/Chrome・macOS/Safari・**iPhone/iPad Safari** で背面再生が継続（iOS は「AudioContext ごと suspend されるので効かない」という設計時の見込みが**外れて効いた** — `<audio>` のループ再生は suspend されない）。**Android Chrome だけ不可**で、他アプリ・別タブのどちらでも停止する。タブを audible にしても Chrome 側が hidden で読み上げを止めるため**キープアライブでは原理的に届かない**。→ **Android は外部読み上げアプリへの委託（設計書 Phase F）で対応する**。`TTS_KEEPALIVE_AMP = 0.004` は初期値のまま通ったので調整不要だった。**Document PiP（Phase C）は PC が解決したので着手しない。**
- `ttsKeepAlive` の既定は Android でも **ON のまま**。効果が無いだけで害も無く、端末ごとに初期値を変えると説明が難しくなる。
- テストは `tests/cases/tts-background.js`（両ファイル各 69 assertion）。**自動テストで担保できないのは「キープアライブが実環境で実際に効くか」だけ**で、それは上記の実機確認で決着済み。

**外部の読み上げアプリへの受け渡し（v2.19.0）** (`ttsHandoffText`, `_handoffStartChunk`, `_handoffSliceFrom`, `_handoffChapterHead`, `_handoffFilename`, `_handoffDeliver`, `_handoffEpub`, `_handoffAdvance`, `ttsHandoffRun`, `_handoffSyncUI`, `showTtsHandoff` — 設計書 `design_tts_background.md` Phase F)。

- **Android Chrome は背面で `speechSynthesis` を止めるのでキープアライブ（v2.18.0）では届かない。** そこで yomikake は「蔵書・しおり・読書位置」を持ったまま、**読み上げの実行だけを外部アプリ（@Voice Aloud Reader 等）へ委託する**。
- **往路（どこから読むか）は渡せるが、復路（どこまで聴いたか）を取る API は存在しない。** そこで受け渡しの既定単位を **1 章**にし、「この章を渡す」操作自体を進捗の記録にする。章の粒度は目次・進捗バー・章送りと一致するので、ズレを手で直す動線が既にある。
- **連携先ごとの分岐コードは書かない（設計の核心）** — Web からはインストール済みアプリを列挙できず、名指し起動もできない（`intent://` は URI 長で破綻・iOS では不可）。**宛先は OS の共有シートに委ね**、yomikake は「どの範囲を・どの形式で・どこから」作る責務だけを持つ。この形なら **@Voice 以外のアプリは実装ゼロで既に対応済み**になり、連携先が増えても増えるのはヘルプの記述だけ。
- **`ttsExtractText()` / `ttsSplitChunks()` をそのまま再利用する。** ルビ rt 優先・タグ除去済みのプレーンテキストは外部読み上げアプリに渡す形としてそのまま最適で、これが Phase F の実装コストを極小にしている。
- **チャンク列を join してはいけない** — 1 文 1 段落になり受け側の段落ナビが細かくなりすぎる。`_handoffSliceFrom()` はチャンクを**開始位置の目印としてだけ**使い、本文は `ttsExtractText()` の行構造（＝段落）をそのまま渡す。目印の文が本文中に見つからなければ**章まるごと**にフォールバックする（読み飛ばしより安全側）。
- **経路は 3 段**: `navigator.share({files})` → `navigator.share({text})` → `.txt` ダウンロード。**テキスト直接共有は `range==='chapter'` のときだけ許す**（Android の Intent extras にサイズ上限があり、全文を載せると TransactionTooLargeException で落ちる）。共有シートを閉じただけの `AbortError` は失敗トーストを出さない。
- **BOM 付き UTF-8 で書き出す**（一部の Android リーダーが Shift_JIS と誤判定するため）。**ソースには不可視文字を置かず `'﻿'` のエスケープ表記で書くこと**（編集で黙って消える）。また **`Blob.text()` は仕様どおり BOM を剥がす**ので、テストは生バイト（`arrayBuffer()`）で確かめる。
- **FXL 本は ePub 実体の受け渡しのみ。** 本文テキストを取り出せないので範囲選択を出さず、IDB キャッシュも無ければモーダルごと開かない。ePub 実体は `_idbGet(state.bookKey).buf` から `File` を作って共有する（位置は伝わらないが蔵書ごと移せる。iOS でも有効）。
- **「しおりを進める」チェックは `range==='chapter'` のときだけ有効**（`_handoffSyncUI()` が他の範囲で disabled にしチェックも外す）。既定 OFF — 渡したが聴かなかった場合に位置が進みすぎるため。
- **`showTtsHandoff()` は開く前に `#settings-popover` を閉じる（必須）** — ポップオーバーは `z-index:500`、`#modal-overlay` は `200` なので、設定パネルから開くと**モーダルが設定の後ろに隠れて「押しても何も起きない」ように見える**（v2.19.0 の実機で発覚）。modal 側を上げる手は `loading:250` / `toast:300` まで押し上げる必要があり波及が大きいので、「モーダルと設定パネルは排他」という既存の前提を守る側で直してある。**今後 `#modal-overlay` を設定パネルから開く導線を足すときは同じ処理が要る。**
- **`#tts-bar` には `flex-wrap:wrap` が要る** — 中身は `flex:none` / `min-width` 持ちで縮まないため、`max-width` を超えると**ピルの外へ溢れて描画される**（狭幅 Android で 📤 が切れ、初見で操作が分からなくなった）。`@media(max-width:640px)` の詰めルールは 1 段に収めるための最適化で、**溢れない保証は `flex-wrap` のほう**。⚠ **headless Chrome は 500px 未満に縮められない**（`--window-size` を渡しても `innerWidth` は 500 で頭打ち）ため、この回帰は幾何では再現できない。テストは `getComputedStyle(bar).flexWrap === 'wrap'` という**仕組みそのもの**を検査している。
- 制限事項は**ヘルプ本文ではなくモーダル内の注記**（`handoff.note`）に置いた。使う直前に目に入るほうが伝わり、`help.body` を 4 言語ぶん膨らませずに済む。
- **実機確認済み（2026-08-06）**: **Android + @Voice Aloud Reader は良好**。**iOS は受け側アプリが見つからない**（共有自体は成立するが、共有先に出る Voicepaper は処理中のまま再生が始まらない。クリップボード・text 経由も同様）。→ **当面「Android 向けの機能」として説明する**が、機能は全環境で有効なまま残す。**iOS で使える受け側アプリが後から現れてもコード変更は不要で、直すのは注記の文言だけ** — 「連携先ごとの分岐を書かない」設計判断の効果がそのまま出ている。
- **BOM は残す（結論・再検討不要）。** 外すと受け側が文字コードを推測することになり、日本語テキストを扱う Android アプリに残る「Shift_JIS を先に試す」実装に当たると全文が文字化けする。付けたままのデメリットは「BOM を剥がさないアプリで先頭に U+FEFF が 1 個残る」だけで、zero-width no-break space なので表示・読み上げとも無視される。**BOM なし版のテストは判断材料が増えないので行わない。**
- テストは `tests/cases/tts-handoff.js`（両ファイル各 58 assertion・fixture の実本を開いて生成テキストを検証）。

**キーボード操作（v2.20.0）** (`handleKey`, `handleListKey`, `_KEY_REPEATABLE`, `openSearchPane`, `reclaimKeyFocus`, `KEY_HANDLER`（iOS）, `_rlSelKey`, `_rlSyncSelection`, `_rlMoveSel`, `_rlSelEdge`, `_rlOpenSel`, `_rlCards`, `rlCardOpen`, `_kbSeen`, `_helpKeysHtml`, `EPUB_KEY` — 設計書 `design_keyboard.md`)。

- **`keydown` の中身は `handleKey(e)` に切り出してある。** iframe から中継された `EPUB_KEY` も同じ関数に流すため。引数は `{key, shiftKey, ctrlKey, metaKey, altKey, repeat, preventDefault()}` を持つ**オブジェクトという緩い契約**で、`e.target` は参照しない（転送元で判定済み）。
- **本文をクリックするとフォーカスが iframe へ移り親の keydown が届かない**という初期からの穴を、iframe 側 `keydown` → `EPUB_KEY` postMessage で塞いだ。**転送はホワイトリストのキーだけ**（`_KEYS` のパイプ区切り文字列）— 全部 `preventDefault()` すると iframe 内の Tab 移動や `Ctrl+C` まで殺す。`yomikake.html` は `SHARED_TAIL` に直接、iOS 版は **`KEY_HANDLER` テンプレート変数**を新設して 3 つの IIFE すべてで `${CLICK_HANDLER}${KEY_HANDLER}` と展開する。
- **ブラウザ／OS のダイアログ明けはフォーカスがページ外に残る（実機で発覚）** — Android Chrome の File System Access 権限プロンプト（「このサイトに ○○.epub の表示とコピーを許可しますか？」）で「許可する」を押した直後、**どのキーも効かない**（画面をタップするまで復帰しない）。キーが iframe にも届かないので `EPUB_KEY` 転送では直せず、**`element.focus()` も `window.focus()` も効かない（実機で確定・この方向はもう試さなくてよい）** — JS が動かせるのはドキュメント内のフォーカスだけで、ブラウザ UI が持っている OS レベルのフォーカスは奪えない（`document.hasFocus()` で検知はできるが回復手段が無い）。→ **本当の対策は「プロンプトを出さないこと」**＝ `openFilePickerForBook()` をキャッシュ優先に変えた（§IndexedDB ePub Cache）。`loadEpub()` 末尾の `reclaimKeyFocusPersistent()`（`hasFocus()` を見ながら 250ms×最大8回・ユーザーが何かを触ったら即中止）は、キャッシュが無い本や OS ピッカー明け向けの延命策として残してある。
- **`EPUB_KEY` 受信時に `reclaimKeyFocus()` でフォーカスを親へ引き取る（重要）** — `postMessage` ハンドラは user activation を引き継がないので、転送経路では `f`（`requestFullscreen`）や `r`（iOS の初回 `speechSynthesis.speak`）が通らない。フォーカスを戻せば**転送されるのは本文クリック直後の 1 打だけ**になり、2 打目以降は親に直接届く。`#page-container` に `outline:none` が要る。
- **修飾キーガードは必須** — 旧実装は `case 'f':` が修飾キーを見ずに `preventDefault()` していたため **`Ctrl+F` / `Cmd+F` がブラウザ検索を開かず全画面トグルに化けていた**（`Ctrl+Z` も FXL ズームに化ける）。`if (mod || e.altKey) return;` を switch の前に置く。**例外は Ctrl/Cmd+F だけ**で、これは**読書中に限り**奪ってアプリの全文検索を開く（ブラウザ検索は iframe 内の現在の章しか当たらない）。リストでは奪わない。
- **矢印の章送りは `isVerticalAxis()` に連動させる** — 旧実装は `←`＝次章 固定で、横書き本では逆だった。タップ帯（`tapZoneAction`）と同じ判定を使うので、両者が同時に正しい／同時に間違うことが保証される。方向非依存の `]` / `[` も用意。
- **モーダル表示中は Escape 以外のキーを通さない**（`!state.epub` 分岐より**前**に置く先行ガード）。**`preventDefault()` せずに `return` する**ので、Tab のフォーカス移動とボタン上の Enter はブラウザ既定のまま生きる。⚠ **削除確認ダイアログに既定フォーカスを与えないこと** — Enter 連打で完全削除（墓標記録つき）が走る。
- **Escape チェーンの最後尾は「本を閉じる」**。フォントピッカー > 設定 > サイドバー > 全画面 > 本を閉じる、の順で 1 打 1 つ。
- **`q` の往復（読書中 → リスト → 同じ本）が成立する条件はリスト側のフォーカス設計**。`closeBook()` は `#open-btn` のフォーカスを外していなかったため、戻った直後の Enter で**OS のファイルピッカーが開いていた**。`closeBook()` で `state.bookKey` をクリアする**前に退避**し、末尾で `blur()` → `_rlSelKey = closedKey` → `_rlSyncSelection(true)` する。
- **カードのキーボード選択はローミング tabindex**（常にちょうど 1 枚だけ `tabindex="0"`）。**選択は DOM 要素ではなく必ず `bookKey` で持つ** — `_rlRender()` は検索 1 文字ごとに `innerHTML` を作り直すので要素参照は即座に迷子になる。再レンダー末尾で `_rlSyncSelection(false)` を呼ぶ（**`focus` を渡してはいけない** — 検索欄に入力中にフォーカスを奪うと IME が飛ぶ）。Tab はカード群を 1 枚だけ通過して次のコントロールへ抜ける（従来はカードごとの「開く」ボタンを全部通過していた）。
- **Enter はカードにフォーカスがあるときだけ握る** — ボタン上の Enter まで奪うとブラウザ既定の活性化と二重に走る。カード markup に inline `onkeydown` を置かないのも同じ理由（`handleListKey` に一本化）。
- **`.rl-sel` のリングは `outline` で描く** — `.rl-card` は `overflow:hidden` なので `box-shadow` だとクリップされて見えない。`.rl-last`（左端バー＝前回読んでいた本）とは意味が違うので併存させる。
- **リストの Escape で `clearRlFilters()` を呼ぶ条件は、その関数が実際に消すものだけに合わせる**（`_rlQuery` / `filterReady` / `genre`。`filterHasMore` は対象外）。揃えないと「押したのに何も起きない」ように見える。
- **初回オープンではタップ操作ガイドが自動で出る**（`epub_tap_guide_v1`）。ガイド表示中は「任意キーで閉じる」が全ショートカットより優先されるので、**本を開いた直後の 1 打はガイドを閉じるだけ**になる。仕様どおりだが「キーが効かない」と誤解しやすい。
- FXL キーボードショートカット（`z` / `0` / `1-6`）は従来どおり **`yomikake.html` のみ**。`n` `p` `b` `j` `k` の FXL ページ送りは両ファイルに入っている。文字サイズ（`+` `-`）は FXL では**無反応**（画像なので効果ゼロ。押しても何も起きないキーは「壊れている」と読まれるのでトーストも出さない）。
- ヘルプのショートカット一覧（`_helpKeysHtml`）は **`_kbSeen || matchMedia('(hover:hover)')` のときだけ**出す。i18n に持たせるのは動作の説明だけで、キー表記そのもの（`Space` `↑ ↓`）は翻訳しない。
- テストは `tests/cases/keyboard.js`（両ファイル各 76 assertion）。**`EPUB_KEY` 転送の実効性は担保できない**（headless では本文クリックによるフォーカス移動を再現しにくく、「転送コードが焼き込まれているか」しか見ていない）ので、**「本文をクリックしてから `n` を押す」は実機で必ず確認する**。

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
- **Settings popover** — display settings (font, size, line height, theme, margin, writing mode, forward-button size) live in a floating `#settings-popover` panel toggled by `toggleSettings()`, not in inline toolbar controls. `updateThemeBtnUI()` syncs the visual theme button state after loading settings. `applyFwdBtnSize(v)` updates `#btn-scroll-fwd` dimensions when `fwdBtnSize` changes (`'small'` / `'medium'` / `'large'`). The "次へボタン" row lives in the layout `set-group` and is **always visible** (both reflowable and FXL modes) since `#btn-scroll-fwd` is also used as the FXL ZoomStep advance button. Mode-specific hiding is done per-row via the `.fxl-hide-row` class (`body.mode-fxl .fxl-hide-row { display:none !important }`) on the writing-mode and margin rows, not on the whole group. `#fxl-settings-group` deliberately omits its own `<h4>` so the FXL-only rows render visually continuous under the same "レイアウト" header. **Group order** (v2.13.0): カラー → タイポグラフィ → レイアウト → FXL → **ツールバーに表示** (`#toolbar-settings-group`) → 🔊 読み上げ → Google Drive → 🔖 しおりデータ (`#bookmark-io-group`, JSON import/export moved out of the toolbar) → 📂 ePub キャッシュ → 言語 (set-once) → **リセット** (`#reset-group`, 破壊的操作なので最下部). **v2.14.0 以降、`<h4>` を持つ 9 グループは `<details class="set-group">` になっている**（`#fxl-settings-group` と `#reset-group` だけ `<div>` のまま — 前者は「レイアウトの続き」として連続表示させる設計、後者は 1 行なので畳む意味がない）。 There is **no** "この本を閉じる" group anymore; closing a book is the top-left toolbar button's job (see next bullet).
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
- **Full-text search** — `#sidebar` has two tabs (`#tab-toc` / `#tab-search`) toggled by `switchSidebarTab(tab)` (module-level `_sidebarTab` tracks current tab). The search tab contains `#search-input` and `#search-results`. `startSearch()` reads the input, increments `_searchSeq`, and calls `runSearch(query, seq)`; `runSearch()` iterates spine items, strips HTML tags, matches the query string, calls `appendSearchResult(spineIdx, snippets, extra)` for each hit, and checks `seq !== _searchSeq` after each item to abort superseded searches. `resetSearch()` increments `_searchSeq` (cancels in-progress search) and clears results. `navigateFromSearch(spineIdx)` calls `pushJumpHistory()` then `renderPage()` and closes the sidebar. `updateSearchProgress(current, total)` updates the progress indicator and cancel button. `_searchAbort` is kept for backward compatibility but `_searchSeq` is the active cancellation mechanism. `htmlToText()` strips `<head>` before tag removal — without this, the per-page `<title>`（全ページ共通の書名）would false-hit every page (fatal for FXL books with hundreds of pages). **FXL 本も検索対象**（v2.7.0）: 自炊 OCR 由来の透明テキスト（`<svg><text fill-opacity="0">`）が spine XHTML に含まれていればそのまま照合される。hit 0 かつ FXL かつ全ページ無テキストなら `search.none` の代わりに `search.fxlNoText` を表示（`runSearch` 内 `textFound` フラグで遅延判定 — load 時サンプリングはしない）。FXL の結果ラベルは TOC 不一致時 `search.fxlPageLabel`（`{n}ページ`）にフォールバック（`chapterLabelForSpine`）。制限: `<text>` 要素（=ページ上の1行）間は空白連結のため行またぎマッチは不可、ルビ・柱の OCR 断片もヒット対象。

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
| `EPUB_KEY` | iframe → parent | `{key, shiftKey, ctrlKey, metaKey, altKey, repeat}` — 本文クリックで iframe にフォーカスが移った後もキー操作を効かせるための中継（v2.20.0）。iframe 側はホワイトリストのキーだけを `preventDefault()` して送る。親は `reclaimKeyFocus()` でフォーカスを引き取ってから `handleKey()` に流す。 |
| `EPUB_TAP` | iframe → parent | `{xr: 0–1, yr: 0–1}` tap position ratio, sent when a non-link tap occurs in the iframe (text-selection taps excluded). Parent routes it through `runTapAction(tapZoneAction(xr, yr))` (v2.8.0; center → `showTapMenu()` since v2.8.1) — see 「タップページ送り」 below. FXL mode has no iframe, so `handleFxlTap()` runs an equivalent 320 ms single-tap-confirm timer (canceled by a 2nd tap = zoom toggle) and calls the same pair with coordinates taken from `#fxl-container.getBoundingClientRect()`. |

### タップページ送り・操作ガイド・起動時自動オープン（v2.8.0・両ファイル共通）

設計書は `design_tap_ux.md`。読書領域の端タップでページを送る。既存の「中央 40%×40% タップ＝コントロール表示」は全パターンで維持。

- **ゾーン 4 パターン** — `state.tapZone`（`epub_settings` に永続化、**デフォルト `'lshape'`**）: `'center'`（**設定 UI 上は「ボタン（上下＋章送り）」**＝端タップを使わず従来の画面上ボタンで操作するモード） / `'lr'`（左右端） / `'tb'`（上下端・書字方向に依らず下＝次） / `'lshape'`（進み側端 ∪ 下端＝次、戻り側端 ∪ 上端＝前）。判定は **`tapZoneAction(xr, yr)` 1 関数に集約**し、リフロー（`EPUB_TAP` ハンドラ）と FXL（`handleFxlTap`）の両方から `runTapAction()` 経由で呼ぶ。進行方向は既存 `isVerticalAxis()` に委譲（縦書き軸は左が進み側）。ページ送り自体は `scrollPage(±1)` に委譲するので、章跨ぎ・読了バナー・`_pendingScrollAfterRender` の連打キューは既存経路のまま。
- **座標系** — `TAP_EDGE_RATIO = 0.3` / `CENTER_TAP_RATIO = 0.2`。境界 0.3/0.7 でタイルする（`yr=0.70` だけは浮動小数で中央側に落ちるが、判定順の違いだけで死角は無い — 51×51 グリッドで検証済み）。**リフローの xr/yr は iframe ビューポート基準、FXL は `#fxl-container` の rect 基準**で、両者は `#page-container` と実測一致する。
- **L字のコーナーは「次」優先** — `tapZoneAction` が次L字を先に判定する。ガイド描画も同じ順（前→次の順に重ねる）なので見た目と挙動が一致する。
- **画面上ナビボタンの退避（重要）** — ゾーンが有効なとき（`state.tapZone !== 'center'`）は `body.tapzones-on` を付け、**`.chapter-btn` と `.scroll-btn` を `display:none`** にする（`updateTapZoneBodyClass()` が同期点）。理由は「**ガイドで無反応と示した場所が実際に無反応である**」ことを保証するため — これらのボタンは透明のまま帯と重なっており、`.chapter-btn`（左右端の中央高さ）は帯と意味が違う「1 章送り」を、`.scroll-btn`（`#btn-scroll-back`=上端中央 / `#btn-scroll-fwd`=下端中央、モバイルで x2–98%・y83–98%）は **`lr` 設定でガイド上は無反応のはずの上下中央でページ送り**を起こしていた（端末を持った手が触れて誤爆する）。**プラットフォーム分岐はしない** — タッチ限定にすると PC でだけガイドが嘘をつく。ページ送りは帯・スワイプ（iOS）・キーボードで、章移動は目次サイドバー・ジャンプスライダー・←→ で行えるので機能欠落はない。ボタンで操作したい人は設定の **「ボタン（上下＋章送り）」**（値 `'center'`）を選ぶと全ボタンが復帰する。**例外**: `body.fxl-zoomed` のときは `.scroll-btn` を残す（`#btn-scroll-fwd` が ZoomStep 送りの操作子で、ズーム中は `handleFxlTap` が early return してタップ判定を行わないため）。**この「ズーム中は実質ボタン設定」という状態はガイド側にも反映すること** — `showNavHint()` は `state.fxlZoomEnabled` のときタップ帯ガイドを出さず `flashNavButtons()` に落とし、`showTapGuide()` 自身も同条件で早期 return する（二重の防御）。`enableFxlZoom()` は帯ガイド／タップメニューを掃除する（ツールバーの 🔍 ボタンはガイドのオーバーレイ外なので、ガイド表示中にズームへ入る経路が実在する）。ここを怠ると「反応すると示した場所が無反応」になり、v2.8.x でナビボタンを `display:none` にしてまで守った『ガイド＝実挙動』の保証が**ズーム状態でだけ破れる**（v2.16.0 で修正）。
- **「操作を見せる」共通エントリ `showNavHint()`** — ツールバーの目玉ボタン（`btn.flash`）・**モーダルを閉じたとき**（`closeModal(skipFlash=false)`）・初回オープン・`changeTapZone()` はすべてこれを呼ぶ。`state.epub && state.tapZone !== 'center'` なら `showTapGuide()`（ゾーンガイド）、それ以外（**「ボタン（上下＋章送り）」設定**・本未オープン）は `hideTapGuide()` / `hideTapMenu()` **してから** `flashNavButtons()`。**この掃除は必須** — ゾーン設定でガイドを出したまま「ボタン」へ切り替えると、ガイドが残ったままボタンが点滅し、どちらが有効な操作系か分からなくなる。**設定に合った操作方法だけを見せる**のが要点で、`flashNavButtons()` を直接呼ぶ導線を残すと「ゾーン設定なのに旧ボタンが点滅する」不整合になる。読みかけリストの削除確認ダイアログは `closeModal(true)` なので発火しない。
- **中央エリア＝操作メニュー（`showTapMenu()` / `hideTapMenu()` / `tapMenuAct()`・v2.8.1）** — 中央 40%×40% のタップは
  `runTapAction('menu')` から **`showTapMenu()`** を呼ぶ（v2.8.0 まではナビボタンを点滅させる `revealControls()` だった。
  同関数は廃止）。`#page-container` 直下の `#tap-menu`（`z-index:70`）に、上＝前ページ／下＝次ページ／
  左＝次の章／右＝前の章の十字ボタン＋中央に ✕、下に「リストへ戻る」（全画面中は「全画面を解除」も）を出す。
  左右の割り当ては画面上の `#btn-next`（左）/ `#btn-prev`（右）と同一で、キーボードの ←/→ とも一致する。
  **FXL は章の概念がないので左右を出さず 1 列（`tm-pad-1col`）にする**。実行後は必ず閉じる（`tapMenuAct` 冒頭で
  `hideTapMenu()`）。背景タップ・✕・任意キーで閉じる。`closeBook()` と `loadEpub()`（本の切り替え）でもガイドと併せて掃除する。
- **開くときにフォーカスを引き取る（重要）** — `showTapMenu()` / `showTapGuide()` は最後に
  `setAttribute('tabindex','-1')` ＋ `focus({preventScroll:true})` する。**中央タップで開いた直後は focus が
  iframe 内にあり、そのままでは親の keydown ガードにキーが届かず Escape でも閉じられない**（Space は
  ブラウザ既定の iframe スクロールになり、裏でページが動く）。実測で確認した罠。
- **操作ガイド（`showTapGuide()` / `hideTapGuide()`）** — `#page-container` の子 `#tap-guide-overlay`（`position:absolute; inset:0; z-index:60`）に **3×3 セル**を `%` で描く。
  **各セル中心の `tapZoneAction()` の戻り値でそのまま塗る**ので、判定と表示が構造的に一致する（`null` のセルは塗らない）。
  帯（full-width/height の矩形）を重ねて描く実装では交差部が二重に着色されて「9 分割」に見えたため v2.8.1 で改めた。
  ラベルは十字（各辺の中央セル＋中央セル）の 5 枚のみで、四隅は隣接セルと同色・同濃度なので連続した L 字に見える。**`#main` ではなく `#page-container`** に置くのは、サイドバーを含まず `EPUB_TAP` の座標系と一致するため。呼び出し時点の `state.tapZone` と `isVerticalAxis()` で組み立てるので縦書き/横書きで左右が正しく反転する。表示契機は (1) `loadEpub()` の初回描画後に一度だけ（`epub_tap_guide_v1`）、(2) `changeTapZone()` 直後、(3) ヘルプの「🖐 タップ操作ガイドを表示」ボタン。**本未オープン時は `#page-container` が `display:none` なので `showTapGuide()` は早期 return し、ヘルプのボタンも出さない**（`state.epub` 条件）。
- **キーボード** — `handleKey()` の `reading-data-overlay` / モーダルガード直後に `if (_tapGuideOpen) { hideTapGuide(); e.preventDefault(); return; }` を置く。Escape 優先度チェーンや FXL ズームの Escape 分岐に触れず、ガイド表示中に Space/矢印が裏のページを送るのも防ぐ。⚠ この優先が効くため、**初回オープン直後の 1 打はガイドを閉じるだけ**になる。~~既知の制限: 読書エリアをクリックするとフォーカスが iframe へ移り親の keydown が届かなくなる~~ → **v2.20.0 の `EPUB_KEY` 転送で解消**（§キーボード操作）。
- **起動時自動オープン（`autoOpenLastBook()`）** — `state.autoOpenLast`（**デフォルト ON**）。`_idbGetAllKeys().then` の末尾（`_cachedKeys` 確定後）から呼ぶ。IDB の `.then` はスクリプト同期実行の後に走るので `loadSettings()` も `handleSharedFile()` の同期部も完了済み。発動条件は「設定 ON / `_sharedFlowActive` でない / `!state.epub` / `epub_last_book` あり / **キャッシュヒット** / 読了済でない（`spineIdx >= spineCount-1 && ratio > 0.9`）」。
- **ピッカー禁止** — `loadEpubFromCache(bookKey, opts)` に `opts.noPicker` を追加し、**3 箇所**の `openFilePicker()` フォールバックをすべてガードする。ユーザージェスチャ無しではピッカーを開けないため、失敗時は黙って読みかけリストに留まる。
- **`_sharedFlowActive`** — `handleSharedFile()` の同期部で、`history.replaceState`（クエリ除去）**より前**に立てる。後から `location.search` を見る方式は不可（自動オープン実行時には既にクエリが消えている）。**`yomikake_ios.html` は Web Share Target 非対応なので宣言のみで常に false**。

### 読み上げ（TTS・Web Speech API・v2.9.0・両ファイル共通）

設計書は `design_tts.md`。「音声だけ流す」割り切り（同期ハイライト無し・画面追従は章単位）。**リフロー本のみ**（FXL は Phase 2）。

- **方式** — `speechSynthesis`。追加依存ゼロ・オフライン可。`state.ttsRate`（0.5–2.0）/`state.ttsVoice`（voiceURI）を `epub_settings` に永続化、`state.bookLang`（OPF `dc:language` 先頭2文字）はセッションのみ。再生状態 `_tts = {active,paused,chunks,idx,spineIdx}` は非永続（本を開くたび OFF）。
- **テキスト抽出 `ttsExtractText()`** — 検索用 `htmlToText()` とは**別物**。`htmlToText` は `<rt>` を残すが、TTS は残すと「漢字かんじ」の二重読みになるため **ルビは rt 優先**（`<ruby>` を `<rt>` 連結で置換、rt 無しは親字フォールバック、`<rp>` 除去）。ブロック境界と `<br>` を改行化してから残タグ除去し、**改行を保持**（文境界の手がかり）。取得は `state.spine[idx].absPath` を直接。
- **チャンク分割 `ttsSplitChunks()`** — 句読点（`。．！？!?`）＋改行で文分割、閉じ括弧は前文に含める。**1チャンク最大120字のハードキャップ**（Chrome のネットワーク音声が長い utterance で約15秒無音停止するバグの回避＝必須）。超過は読点、無ければ強制分割。
- **再生** — v2.18.0 で**先読みキュー方式**に変更（§読み上げのバックグラウンド強化）。`ttsFillQueue()` が `TTS_LOOKAHEAD` 本まで `speak()` に積み、`onstart` で `_tts.idx` 確定＋`savePos(i/total)`、最終チャンクの `onend` で `ttsAdvanceChapter()`。一時停止は `pause()/resume()` を使わず **cancel＋現チャンク頭から再開**（iOS で `pause/resume` が不安定なため）。`onerror` の `interrupted`/`canceled`（自分の cancel 由来）は無視。速度変更・音声変更は現チャンクを cancel して即再生し直す。
- **章単位追従** — 章末チャンクの `onend` から **TTS 独自に `renderPage(idx+1,'start')`**（EPUB_EDGE 経由ではない）。`_ttsInternalNav=true` の間だけ `renderPage` 冒頭の手動ナビ検出フックを黙らせる。最終章末は `savePos(1.0)`＋`_bookFinished=true`＋`showFinishedBanner()`＋`ttsStop()`。空章は `ttsLoadChapterAndSpeak(idx,0,skipToNext=true)` の `skipToNext` で次章へ送る。
- **手動ナビとの整合** — `renderPage()` の早期 return 直後（FXL 分岐より前）に `if (_tts.active && !_ttsInternalNav) ttsOnUserNavigate()`。TOC・章ボタン・検索ジャンプ・進捗バー・アンカーは全て renderPage を通る。`ttsOnUserNavigate()` は cancel → `setTimeout(0)` → `ttsLoadChapterAndSpeak(currentSpineIdx,0,false)` で**新章の頭から読み直し**（renderPage が同期部で currentSpineIdx を更新済み）。
- **しおり保護** — 再生中は EPUB_POS ハンドラの **`savePos` だけ `!_tts.active` で抑止**（`_intraChapterRatio` 更新と `updatePageInfo()` は残す＝進捗バーは動く）。TTS の文単位しおりを無意識スクロールで上書きさせない。
- **Wake Lock** — 再生中 `navigator.wakeLock.request('screen')`、pause/stop/エラーで release。`visibilitychange` で visible 復帰時に再取得＋（停止していれば）再生再開の best effort。**既知の制限：画面ロック・タブ切替では停止する**（`speechSynthesis` は Media Session 非対応で回避不能）。
- **iOS ジェスチャアンロック** — `ttsPlay()` の**同期部で空 utterance（volume:0）を speak** してから async 抽出に入る（iOS は初回 speak がジェスチャ由来必須。抽出の await でコンテキストを失うため）。
- **UI** — ツールバー `#tts-btn`（🔊・`body.mode-fxl` で非表示・再生中 `.tts-active` でアクセント色）。`#page-container` 内下部の浮遊バー `#tts-bar`（`body.tts-active` で表示・z-index 40・`#main` の子なのでフルスクリーン退避対象外＝再生操作を残す）。ボタン記号は絵文字を避け幾何文字（◀◀ ‖ ▶▶ ■ － ＋）。速度はバー、音声選択は設定「🔊 読み上げ」group（`#drive-auto-group` の直前・`bookLang` 前方一致でフィルタ）。
- **音声ゼロ環境** — 本の言語の音声が無ければ再生せず `tts.noVoice` トースト（ヘッドレスや Linux Firefox が該当）。`_ttsSupported` が false なら 🔊 を隠す。
- **クリーンアップ** — `closeBook()` と `loadEpub()` 冒頭で `ttsStop()`、`beforeunload` で `speechSynthesis.cancel()`。ePub 由来テキストは `utterance.text` に渡すのみ（DOM 注入なし）。
- **テスト** — ヘッドレスは音声ゼロで実音声を鳴らせない。Playwright は `speechSynthesis`/`SpeechSynthesisUtterance` をモックし `onend` を手動発火して抽出・分割・状態遷移・章送り・UI・クリーンアップを検証。**実音声・iOS ジェスチャ・Wake Lock は実機手動**。

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
| `epub_pos_{title}__{creator}` | `{spineIdx, ratio, lastOpenedAt, creator, spineCount, finishedAt?, finishedCount?, cover?, source?, site?}` — reading position + book metadata written by `saveBookMeta()` on open and `savePos()` on scroll/chapter change. Separator is **double underscore** (v1.8.11+). `source`/`site` (v2.10.0・追加のみ・旧ビルド無視) = 底本 URL とサイト表示名（読みかけリストのサイトバッジ用。quota 超過時は cover→source/site の順に落として読書位置を優先）。`finishedAt`/`finishedCount` (v2.17.0) = **読了の記録**（位置と独立・§読了管理と同期）。quota 対策でもこの 2 つは絶対に落とさない。 |
| `epub_last_book` | `{title, bookKey}` — for the resume banner |
| `epub_settings` | `{fontMode, fontSize, lineHeight, letterSpacing, theme, themeAuto, themeLight, themeDark, margin, writingMode, fwdBtnSize, tapZone, autoOpenLast, ttsRate, ttsVoice, ttsKeepAlive, driveAutoSave, fontBold, fontStrokeLevel, spreadMode, fxlZoomLevel, fxlRegionOrder, fxlLtrAutoFlip, toolbarHidden, brightness, warmth, fsHud, setGroupsOpen, orientationLock, bookPrefsEnabled}` — **端末ローカルに閉じる**（しおり JSON にも Drive 同期にも含めない。端末ごとに画面サイズ・DPI・フォント資産・OS が違うため） |
| `epub_lang` | selected UI language (`ja` / `en` / `zh-TW` / `zh-CN`) |
| `epub_consolidate_v1` | one-shot flag set after `consolidateBookmarks()` runs once at startup |
| `epub_book_prefs` | `{v:1, books:{[bookKey]:{writingMode?, fontMode?, fontSize?, spreadMode?, fxlRegionOrder?, t}}}` — **本ごとの表示設定**（v2.16.0）。キーは `state.bookKey`（`makeBookKey()`）。**しおりとは別キー**にすることで Drive 同期・JSON 書き出しに載らないことを構造的に保証する。300冊 / 730日で剪定 |
| `epub_kosync` | `{server, username, userkey, method, autoSync, deviceId, deviceName}` — **KOReader 同期の設定**（v2.22.0）。`userkey` は md5 したパスワードで **API に対してパスワードと等価**。しおり JSON にも Drive にも**絶対に載せない**（別キーであること自体が保証） |
| `epub_kosync_docs` | `{v:1, books:{[bookKey]:{bin, fn, name, size, t}}}` — bookKey ↔ KOReader のドキュメントハッシュの対応表（v2.22.0）。300冊 / 730日で剪定 |
| `epub_tap_guide_v1` | one-shot flag set after the tap guide has been shown once (v2.8.0) |
| `epub_app_version` | last-seen `APP_VERSION`; on load, a change (and non-empty prior) fires the `toast.updated` "updated to vX.Y.Z" toast once (v2.10.1). First install stores silently. |

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
- **表紙の mime は manifest の `media-type` を最優先する**（v2.20.1）— 拡張子だけの三項演算子で決めていた頃は **SVG 表紙が `image/jpeg` 扱いになり `<img>` がデコードできず `onerror` → 黙って表紙なし**になっていた（novel_downloader 産の本が該当）。SVG は `f.async('string')` で読み、`data:image/svg+xml;charset=utf-8,` ＋ percent-encoding で `<img>` に渡す（日本語を含むので `btoa` は使えない）。**`width`/`height` 属性を持たない SVG は `<img>` の既定 300×150 に潰される**ので `viewBox` から補って注入する。canvas は `drawImage` の前に白で塗る（JPEG にアルファが無く、背景透明の SVG/PNG 表紙が真っ黒になるため）。テストは `tests/cases/cover-thumb.js`（両ファイル各 13 assertion・fixture の `reflow.epub` に viewBox のみの SVG 表紙を入れ、**サムネイル隅の画素**で内在サイズ補完が効いていることまで見る）
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

### FXL 透明テキスト検索ヒットハイライト（v2.7.0・両ファイル共通）

検索結果クリックでページジャンプした直後、ヒット箇所にアクセント色マーカーを重畳する。設計書は `design_fxl_text_search.md`。

- **ワンショット受け渡し**: `startSearch()` が `_lastSearchQuery` を記録 → `navigateFromSearch()` が FXL 時のみ `_fxlPendingHighlight = {spineIdx, query}` をセット → `renderFxlPair()` 末尾（`seq === _renderSeq` ブロック内）で `applyFxlSearchHighlight()` が消費。表示対象外でも必ず null に戻す。`loadEpub()`（本切替）・`closeBook()` でもリセット。
- **矩形算出**: 対象 spine の XHTML を再パース（自己終端 `<script/>` 前処理は `extractFxlImagePath` と同一）し、各 `<svg><text>` の `textContent` に対して大文字小文字無視のマッチ。**x/y 属性は文字数と 1:1 対応の文字単位座標で、グリフの左上を指す**（サンプル実測で確認済み。縦書き行= x 一定・横書き行= y 一定）。マッチ範囲の min/max ± `font-size` で viewBox 座標系の矩形を作る。座標リストが文字数より短い `<text>` はスキップ。サロゲートペアは `Array.from` ＋ code unit→グリフ index 対応表で処理。上限 50 矩形。
- **SVG オーバーレイ方式**: マークは `<svg class="fxl-search-mark" viewBox="0 0 vbW vbH" preserveAspectRatio="x{Min|Mid|Max}YMid meet">` ＋ `<rect>` 群として `#fxl-spread` に append する。`meet` は `object-fit:contain` と同一幾何のため、**viewBox 座標の rect を置くだけでレターボックス・サイドバー開閉・リサイズ・FXL ズーム transform に再計算なしで追従する**（ピクセル絶対配置だとサイドバー開閉でズレる — 実装時に実測で確認した罠）。見開き時はスロット位置 `left:0/50%`＋寄せ `xMin/xMax`（`(img.id==='fxl-page-a') === (fxlPpd==='rtl')` でノド側判定、object-position の CSS と同じ規則）。`img.naturalWidth` には依存しないため画像ロード完了を待つ必要もない。
- **クリア**: `renderFxlPair()` 冒頭で `clearFxlSearchMarks()`。CSS `@keyframes fxl-mark-fade` で 4 秒後に自動フェードアウト（`pointer-events:none`、`vector-effect:non-scaling-stroke` でズーム中も枠線 2px）。
- **`#fxl-spread` に `position:relative` を追加**（オーバーレイの absolute 基準。transform 未適用時にも必要）。
- **状態は一切永続化しない**（`_fxlPendingHighlight` はジャンプ1回限り、マークは DOM のみ）。

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
- **`openFilePickerForBook(bookKey)`** — **IDB Blob キャッシュを最優先**し、無い／読めないときだけ `handle.getFile()`、それも駄目なら `showOpenFilePicker()`。In `yomikake_ios.html`, this function uses the IDB ePub cache only (no FSA).

### IndexedDB ePub Cache (both files)

iOS Safari does not implement the File System Access API, so v1.8.8 introduced this for `yomikake_ios.html`: cache the entire ePub Blob in IndexedDB (`epub_viewer_files` DB, `files` object store) keyed by `bookKey`. The reading list can then reopen the book without showing a file picker, even after the page reload. **v1.8.12 ports the same cache to `yomikake.html`** to fix offline reading (e.g. multi-day ferry trips): the previous FSA-handle-only approach stored a *reference* to the file, so `handle.getFile()` failed when the source lived on cloud storage (OneDrive/Drive) whose bytes were not synced locally. The IDB cache stores the actual bytes, so reopen works offline. The function set below is identical in both files; the differences are:

- **`yomikake.html` complements the FSA handle**: `loadEpub()` stores *both* the handle (`fshPut`) and the Blob (`cacheEpubFile`) on every open. `openFilePickerForBook()` chains **IDB Blob (`loadEpubFromCache`) → handle.getFile() → picker**（v2.20.0）。⚠ **ハンドルを先に見てはいけない** — `requestPermission()` が Android Chrome で「このサイトに ○○.epub の表示とコピーを許可しますか？」を出し、**閉じた後もフォーカスがブラウザ UI 側に残ってページの `keydown` が一切発火しなくなる**（画面をタップするまで復帰せず、`element.focus()` でも `window.focus()` でも戻せない＝キーボード操作が全滅する）。キャッシュ経路はプロンプトを出さないので問題が起きない。**代償**: ディスク上のファイルが更新されていても自動では拾わない（「別の ePub を開く」で選び直せば拾えるし、開き直せばキャッシュも更新される）。キャッシュ読み出しは `{noPicker:true}` で呼び、失敗時のフォールバック先（ハンドル → ピッカー）は `openFilePickerForBook()` 側が決める。a failed `getFile()` does **not** delete the handle (the failure may just be transient/offline). The reading-list card shows `rl-open-direct` styling + `readingList.openDirect` label when *either* handle or cache is present, and a separate **`✈ オフラインOK` badge** (`readingList.offline`, in `.rl-meta-left`) only when `_cachedKeys.has(key)` (handle alone is not offline-safe).
- **`yomikake_ios.html` uses the cache as the sole reopen mechanism** (no FSA): `openFilePickerForBook()` branches cache → picker.

**Origin caveat (both files):** IndexedDB is per-origin. The cache only helps when reopening the *same URL* you read on while online (e.g. `https://www.ayati.com/book/yomikake.html`). A downloaded `file://` copy is a different (and unreliable) origin and will not see a cache written under the https deployment — though with JSZip inlined, a `file://` copy can still open locally-saved ePubs via the picker.

- **Storage value**: `{ buf: ArrayBuffer, name: string, size: number, type: string, savedAt: ISO }`. **The ePub bytes are stored as an `ArrayBuffer` (`buf`), not a `Blob`** — iOS Safari has a WebKit bug where a `Blob`/`File` saved to IndexedDB loses its backing store and throws `"The object can not be found here."` when later read (PC/Android unaffected; re-picking the file works). An `ArrayBuffer` is structured-cloned by value so it survives. `cacheEpubFile()` does `await file.arrayBuffer()` and stores `buf` (falling back to `value.blob = file` only if `arrayBuffer()` is unavailable on a very old engine). `loadEpubFromCache()` reads `cached.buf || cached.blob`, and for a legacy `blob` entry calls `await data.arrayBuffer()` first (which throws → clean picker fallback if the blob is already dead on iOS), then reconstructs a fresh in-memory `new File([data], name, {type})` to hand to `loadEpub()`. Legacy `blob`-only entries self-heal: a failed read falls back to the picker, and the next successful open re-caches as `buf`.
- **`EPUB_CACHE_LIMIT = 20` + `EPUB_CACHE_BUDGET_MB = 300`** (v2.5.0; was a bare `= 3`) — **dual LRU cap**: eviction fires when *either* the count reaches 20 *or* total cached bytes + the new file exceeds 300 MB. Oldest-by-`lastOpenedAt` is evicted (read from existing `epub_pos_*` entries). The book being written is always `exclude`d from eviction so it is kept even if it alone exceeds the budget (the loop `break`s when nothing else is evictable). Count/budget decision is factored into the pure helper **`_cacheNeedsEvict(othersSize, cacheCount, isUpdate, newSize, limit, budgetBytes)`** (unit-tested). Because total-size can't be computed without reading every `buf` (up to 300 MB into memory), a lightweight **size ledger `epub_cache_index`** in localStorage (`{bookKey:{size}}`) tracks per-entry sizes. Ledger writes: `_cacheIdxSet` on cache put; **removal is centralized in `_idbDelete()`** (which every eviction/delete path calls) plus `_idbClear()` wipes the whole ledger; `_cacheIdxReconcile(idbKeys)` at init drops ghost ledger entries and stubs missing ones as `size:0`; `loadEpubFromCache()` backfills `cached.size` for pre-v2.5.0 entries. LRU ordering still uses `lastOpenedAt` only (the ledger is size-only — no time duplication).
- **`_cachedKeys: Set<bookKey>`** — module-level set populated at init via `_idbGetAllKeys()`. Refresh `buildReadingList()` once it loads so the UI badge reflects cache state without flicker on slow IDB.
- **`_idbAvailable`** — flips to `false` if `indexedDB.open()` throws (Private Browsing, ITP block, etc.). All cache functions become no-ops; reading list falls back to picker.
- **Quota handling** — `cacheEpubFile()` catches `QuotaExceededError` and evicts in a **loop** (as long as `evictOldestEpubCache()` returns a key), retrying the put after each eviction, until it succeeds or nothing is left to evict (defends devices whose real quota is smaller than `EPUB_CACHE_BUDGET_MB`). Final failure is logged via `console.warn` and silently ignored. The user can still read the book; only persistence is lost.
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
- ePub 由来の**インライン `on*` ハンドラ・入れ子の `<iframe>`/`<object>`/`<embed>`・`javascript:` スキーム**も `buildSrcdoc()` で除去する（v2.22.1）。**v2.22.0 までは「リスクが低く除去コストが高い」として意図的に残していたが、KOReader 同期で localStorage に長期の資格情報（`userkey` はパスワードと等価）が載ったので方針を改めた。** srcdoc の iframe は親と同一オリジンで `sandbox` も無いため、ePub でコードが動くと `localStorage` を丸ごと読める。`<script>` を先に消してあるので、残っていた `onload` 等は参照先を失った死にコードであり、除去して壊れる正当な ePub は無い。
  - 入れ子の `<iframe srcdoc>` / `<object>` / `<embed>` も**オリジンを継承する**ので同時に落とす。
  - `javascript:` は `<a href>` なら `CLICK_HANDLER` → `handleIframeLink()` が既に拒否していたが、**SVG の `<a xlink:href>` は `getAttribute('href')` が null になり `preventDefault` されず素通りしていた**。属性値そのものを見て落とす。
  - ⚠ **これは数え上げ型の防御**。本命は `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox">`（**`allow-same-origin` は与えない**）で、**親は `contentDocument` を一切触らず、注入コードも `localStorage`/`cookie` を使わない**ので同一オリジンである必要は無い。
  - ⚠⚠ **ただし sandbox 化には既知の障害が 1 つある: ローカルフォント（`custom:`）。** `cfGetFontSrc()` は http(s) で **`blob:` URL** を返し、`buildSrcdoc()` がそれを `@font-face{src:url(...)}` として iframe に埋め込む。**blob: URL は生成元オリジンに紐づくので、不透明オリジンの iframe からは読めない**（WebKit にはこの件の bug 170075「Cannot read blobs in sandboxed iframes」があり 2021 年に RESOLVED FIXED だが、直後に regression 222312 が立ち iOS Safari 14.7.1 で再現の報告がある＝**WebKit が歴史的に弱い箇所**）。回避は `cfGetFontSrc()` の `file://` 側と同じ **data URI 経路を常用**することだが、実装のコメントどおり**27MB 級の文字列**になり、章を描くたびに srcdoc へ埋め込むことになる。iPad では実用にならない可能性が高い。**sandbox 化に着手するなら、この一点の設計が先。**
  - テストは `tests/cases/epub-sanitize.js`（両ファイル各 21 assertion）。⚠ **テストファイルに `</script>` を直書きしないこと** —— ケースは HTML へ差し込まれるので、文字列中の閉じタグがその場でスクリプトブロックを終わらせ、**テストが 1 件も走らない**（結果が空になる）。
- Drive API file IDs validated against `/^[a-zA-Z0-9_-]{10,200}$/` in `driveFindFile()` before use in fetch URLs (prevents URL injection via malicious API responses).
- `resolveCssText()` uses regex with escaped pattern (not `split().join()`) to replace `url()` references, avoiding mismatches with special characters in URL strings.
- `_driveToken` stored in memory only (not localStorage) to limit XSS token theft surface.
